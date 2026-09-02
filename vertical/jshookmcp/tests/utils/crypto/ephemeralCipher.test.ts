import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateEphemeralKey,
  encryptBuffer,
  decryptEnvelope,
  sealFileToPath,
  openSealedFile,
  secureWipe,
} from '@utils/crypto/ephemeralCipher';

describe('ephemeralCipher', () => {
  describe('encryptBuffer / decryptEnvelope', () => {
    it('round-trips plaintext through encrypt then decrypt with the same key', () => {
      const key = generateEphemeralKey();
      const plaintext = Buffer.from('CLIENT_RANDOM aabbcc 001122', 'utf8');

      const envelope = encryptBuffer(plaintext, key);
      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(envelope.payload.split(':')).toHaveLength(3);

      const decrypted = decryptEnvelope(envelope, key);
      expect(decrypted.toString('utf8')).toBe('CLIENT_RANDOM aabbcc 001122');
    });

    it('fails to decrypt with the wrong key', () => {
      const key = generateEphemeralKey();
      const wrongKey = generateEphemeralKey();
      const envelope = encryptBuffer(Buffer.from('secret'), key);

      expect(() => decryptEnvelope(envelope, wrongKey)).toThrow();
    });

    it('rejects a malformed envelope payload', () => {
      const key = generateEphemeralKey();
      expect(() =>
        decryptEnvelope({ payload: 'not-enough-parts', algorithm: 'aes-256-gcm' }, key),
      ).toThrow('Malformed encrypted envelope');
    });

    it('generates distinct IVs across calls (no nonce reuse)', () => {
      const key = generateEphemeralKey();
      const plaintext = Buffer.from('same plaintext');
      const first = encryptBuffer(plaintext, key);
      const second = encryptBuffer(plaintext, key);
      expect(first.payload).not.toBe(second.payload);
    });
  });

  describe('sealFileToPath / openSealedFile', () => {
    let dir: string;

    it('encrypts a plaintext file, wipes the source, and can be opened back', async () => {
      dir = await mkdtemp(join(tmpdir(), 'jshook-seal-'));
      const plainPath = join(dir, 'plain.log');
      const cipherPath = join(dir, 'sealed.json');
      await writeFile(plainPath, 'CLIENT_RANDOM deadbeef cafebabe\n', 'utf8');

      const { key } = await sealFileToPath(plainPath, cipherPath);

      expect(existsSync(plainPath)).toBe(false);
      expect(existsSync(cipherPath)).toBe(true);

      const raw = await readFile(cipherPath, 'utf8');
      expect(raw).not.toContain('CLIENT_RANDOM');
      expect(raw).not.toContain('deadbeef');

      const recovered = await openSealedFile(cipherPath, key);
      expect(recovered.toString('utf8')).toBe('CLIENT_RANDOM deadbeef cafebabe\n');

      await rm(dir, { recursive: true, force: true });
    });

    it('uses a caller-supplied key when provided', async () => {
      dir = await mkdtemp(join(tmpdir(), 'jshook-seal-'));
      const plainPath = join(dir, 'plain.log');
      const cipherPath = join(dir, 'sealed.json');
      await writeFile(plainPath, 'payload', 'utf8');
      const suppliedKey = generateEphemeralKey();

      const { key } = await sealFileToPath(plainPath, cipherPath, suppliedKey);
      expect(key).toBe(suppliedKey);

      const recovered = await openSealedFile(cipherPath, suppliedKey);
      expect(recovered.toString('utf8')).toBe('payload');

      await rm(dir, { recursive: true, force: true });
    });
  });

  describe('secureWipe', () => {
    it('removes the file after overwriting', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jshook-wipe-'));
      const filePath = join(dir, 'secret.txt');
      await writeFile(filePath, 'sensitive-content', 'utf8');

      await secureWipe(filePath);

      expect(existsSync(filePath)).toBe(false);
      await rm(dir, { recursive: true, force: true });
    });

    it('is a no-op for a missing file (idempotent)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jshook-wipe-'));
      const filePath = join(dir, 'does-not-exist.txt');

      await expect(secureWipe(filePath)).resolves.toBeUndefined();
      await rm(dir, { recursive: true, force: true });
    });

    it('handles a zero-byte file without error', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jshook-wipe-'));
      const filePath = join(dir, 'empty.txt');
      await writeFile(filePath, '', 'utf8');

      await secureWipe(filePath);
      expect(existsSync(filePath)).toBe(false);
      await rm(dir, { recursive: true, force: true });
    });
  });
});
