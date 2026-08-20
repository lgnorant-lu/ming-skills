import { createPrivateKey, randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const MAX_CERT_LIFESPAN_DAYS = 45;
const RSA_SIGNING_ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
} as const;
const SUBJECT_NAME_MAP: Record<string, string> = {
  commonName: 'CN',
  organizationName: 'O',
  organizationalUnitName: 'OU',
  countryName: 'C',
  localityName: 'L',
  stateOrProvinceName: 'ST',
  domainComponent: 'DC',
  serialNumber: '2.5.4.5',
};
const PATCH_MARKER = Symbol.for('jshookmcp.mockttpCaCompatPatched');

type MockttpCaOptions =
  | {
      key: string | Buffer;
      cert: string | Buffer;
      keyLength?: number;
      countryName?: string;
      localityName?: string;
      organizationName?: string;
    }
  | {
      keyPath: string;
      certPath: string;
      keyLength?: number;
      countryName?: string;
      localityName?: string;
      organizationName?: string;
    };

type MockttpCaLike = {
  generateCertificate: (domain: string) => Promise<{
    key: string;
    cert: string;
    ca: string;
    expiresAt: Date;
  }>;
};

type NodeCryptoKey = Awaited<ReturnType<typeof webcrypto.subtle.importKey>>;
type NodeCryptoKeyPair = {
  privateKey: NodeCryptoKey;
  publicKey: NodeCryptoKey;
};

type MockttpCertificatesModule = {
  getCA: (options: MockttpCaOptions) => Promise<MockttpCaLike>;
  [PATCH_MARKER]?: boolean;
};

type PeculiarBundle = {
  x509: Record<string, any>;
  asn1X509: Record<string, any>;
  asn1Schema: Record<string, any>;
};

let patchPromise: Promise<void> | null = null;

function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
  const base64 = Buffer.from(buffer).toString('base64');
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function buildSubjectName(
  peculiar: PeculiarBundle,
  subject: Record<string, string | undefined>,
  orderedKeys: string[],
): string {
  const parts: Array<Record<string, string[]>> = [];
  for (const key of orderedKeys) {
    const value = subject[key];
    if (!value) continue;
    const mappedKey = SUBJECT_NAME_MAP[key] || key;
    parts.push({ [mappedKey]: [value] });
  }
  for (const [key, value] of Object.entries(subject)) {
    if (!value || orderedKeys.includes(key)) continue;
    const mappedKey = SUBJECT_NAME_MAP[key] || key;
    parts.push({ [mappedKey]: [value] });
  }
  return new peculiar.x509.Name(parts).toString();
}

function normalizeLeafDomain(domain: string): string {
  if (!domain.includes('_')) {
    return domain;
  }

  const [, ...rest] = domain.split('.');
  if (rest.length <= 1 || rest.some((part) => part.includes('_'))) {
    throw new Error(`Cannot generate certificate for domain due to underscores: ${domain}`);
  }

  return `*.${rest.join('.')}`;
}

function shouldUseCompatFallback(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Cannot get schema for 'PrivateKeyInfo' target") ||
    error.message.includes('Unsupported or malformed key format')
  );
}

async function readCaMaterial(
  options: MockttpCaOptions,
): Promise<{ keyPem: string; certPem: string }> {
  if ('key' in options && 'cert' in options) {
    return {
      keyPem: options.key.toString(),
      certPem: options.cert.toString(),
    };
  }

  const [keyPem, certPem] = await Promise.all([
    readFile(options.keyPath, 'utf8'),
    readFile(options.certPath, 'utf8'),
  ]);
  return { keyPem, certPem };
}

async function importPrivateKeyCompat(keyPem: string): Promise<NodeCryptoKey> {
  const keyObject = createPrivateKey(keyPem);
  const pkcs8Der = keyObject.export({ type: 'pkcs8', format: 'der' });
  return await webcrypto.subtle.importKey(
    'pkcs8',
    pkcs8Der,
    {
      name: RSA_SIGNING_ALGORITHM.name,
      hash: RSA_SIGNING_ALGORITHM.hash,
    },
    true,
    ['sign'],
  );
}

function createLeafKeyPairFactory() {
  const keyPairs = new Map<number, Promise<NodeCryptoKeyPair>>();
  return (keyLength: number): Promise<NodeCryptoKeyPair> => {
    let pending = keyPairs.get(keyLength);
    if (!pending) {
      pending = webcrypto.subtle.generateKey(
        {
          ...RSA_SIGNING_ALGORITHM,
          modulusLength: keyLength,
        },
        true,
        ['sign', 'verify'],
      ) as Promise<NodeCryptoKeyPair>;
      keyPairs.set(keyLength, pending);
    }
    return pending;
  };
}

async function buildCompatCa(
  options: MockttpCaOptions,
  peculiar: PeculiarBundle,
): Promise<MockttpCaLike> {
  const { keyPem, certPem } = await readCaMaterial(options);
  const caKey = await importPrivateKeyCompat(keyPem);
  const caCert = new peculiar.x509.X509Certificate(certPem);
  const getLeafKeyPair = createLeafKeyPairFactory();
  const keyLength = Math.max(1024, options.keyLength ?? 2048);

  return {
    generateCertificate: async (rawDomain: string) => {
      const domain = normalizeLeafDomain(rawDomain);
      const leafKeyPair = await getLeafKeyPair(keyLength);
      const subjectAttributes: Record<string, string | undefined> = {
        countryName: options.countryName ?? 'XX',
        localityName: options.localityName,
        organizationName: options.organizationName,
        commonName: domain.startsWith('*.') ? undefined : domain,
      };
      const subject = buildSubjectName(peculiar, subjectAttributes, [
        'countryName',
        'organizationName',
        'localityName',
        'commonName',
      ]);
      const notBefore = new Date();
      notBefore.setDate(notBefore.getDate() - 1);
      const notAfter = new Date(notBefore.getTime() + MAX_CERT_LIFESPAN_DAYS * 24 * 60 * 60 * 1000);

      const extensions = [
        new peculiar.x509.BasicConstraintsExtension(false, undefined, true),
        new peculiar.x509.KeyUsagesExtension(
          peculiar.x509.KeyUsageFlags.digitalSignature |
            peculiar.x509.KeyUsageFlags.keyEncipherment,
          true,
        ),
        new peculiar.x509.ExtendedKeyUsageExtension(
          [peculiar.asn1X509.id_kp_serverAuth, peculiar.asn1X509.id_kp_clientAuth],
          false,
        ),
        new peculiar.x509.SubjectAlternativeNameExtension([{ type: 'dns', value: domain }], false),
        await peculiar.x509.AuthorityKeyIdentifierExtension.create(caCert, false),
      ];

      const certificate = await peculiar.x509.X509CertificateGenerator.create({
        serialNumber: `A${randomUUID().replaceAll('-', '')}`,
        subject,
        issuer: caCert.subject,
        notBefore,
        notAfter,
        signingAlgorithm: {
          name: RSA_SIGNING_ALGORITHM.name,
          hash: RSA_SIGNING_ALGORITHM.hash,
        },
        publicKey: leafKeyPair.publicKey,
        signingKey: caKey,
        extensions,
      });

      return {
        key: arrayBufferToPem(
          (await webcrypto.subtle.exportKey('pkcs8', leafKeyPair.privateKey)) as ArrayBuffer,
          'PRIVATE KEY',
        ),
        cert: certificate.toString('pem'),
        ca: caCert.toString('pem'),
        expiresAt: notAfter,
      };
    },
  };
}

export async function ensureMockttpCaCompatibilityPatched(): Promise<void> {
  if (patchPromise) {
    return await patchPromise;
  }

  patchPromise = (async () => {
    const rootRequire = createRequire(import.meta.url);
    const mockttpEntry = rootRequire.resolve('mockttp');
    const mockttpRequire = createRequire(mockttpEntry);
    const certificates = mockttpRequire('./util/certificates') as MockttpCertificatesModule;

    if (certificates[PATCH_MARKER]) {
      return;
    }

    const originalGetCA = certificates.getCA.bind(certificates);
    const peculiar: PeculiarBundle = {
      x509: mockttpRequire('@peculiar/x509') as Record<string, any>,
      asn1X509: mockttpRequire('@peculiar/asn1-x509') as Record<string, any>,
      asn1Schema: mockttpRequire('@peculiar/asn1-schema') as Record<string, any>,
    };

    certificates.getCA = async (options: MockttpCaOptions) => {
      try {
        return await originalGetCA(options);
      } catch (error) {
        if (!shouldUseCompatFallback(error)) {
          throw error;
        }
        return await buildCompatCa(options, peculiar);
      }
    };
    certificates[PATCH_MARKER] = true;
  })();

  return await patchPromise;
}
