import { spawn } from 'node:child_process';
import { MOJO_MONITOR_TIMEOUT_MS, MOJO_FRIDA_PROBE_TIMEOUT_MS } from '@src/constants';

/**
 * Best-effort message direction inferred from the header flags byte
 * (offset 1 of a Mojo message header). The wire layout is build-specific;
 * this helper only fires when the payload looks like a header and otherwise
 * stays undefined — no hollow classification (lesson #51).
 */
export type MojoMessageDirection = 'request' | 'response' | 'sync';

export interface MojoMessage {
  timestamp: number;
  sourcePid: number;
  targetPid: number;
  interfaceName: string;
  messageType: string;
  payload: string;
  size: number;
  /**
   * Optional direction (request/response/sync). When omitted at record time
   * the monitor best-effort derives it from `payload` header flags.
   */
  direction?: MojoMessageDirection;
}

export interface MojoMessageFilter {
  interfaceName?: string;
  messageType?: string | number;
  pid?: number;
  sinceTimestamp?: number;
  hexSearch?: string;
  direction?: MojoMessageDirection;
}

export interface MojoMessageDirectionBreakdown {
  request: number;
  response: number;
  sync: number;
  unknown: number;
}

export interface MojoInterfaceSummary {
  interface: string;
  count: number;
  bytes: number;
  distinctMethods: number;
  directionBreakdown: MojoMessageDirectionBreakdown;
}

export interface MojoMethodSummary {
  interface: string;
  method: string;
  count: number;
  bytes: number;
}

export interface MojoMessageSummary {
  total: number;
  totalBytes: number;
  byDirection: MojoMessageDirectionBreakdown;
  byInterface: MojoInterfaceSummary[];
  byMethod: MojoMethodSummary[];
  topInterfaces: MojoInterfaceSummary[];
  topMethods: MojoMethodSummary[];
  timeWindow: { earliest: number | null; latest: number | null; durationMs: number };
  filtered: boolean;
  simulation: boolean;
}

export function deriveDirectionFromPayload(
  payload: string | undefined | null,
): MojoMessageDirection | undefined {
  if (typeof payload !== 'string') return undefined;
  const hex = payload.replace(/\s+/g, '').toLowerCase();
  // Need at least the version(1) + flags(1) bytes; verify a clean hex alphabet.
  if (hex.length < 4 || !/^[0-9a-f]+$/.test(hex)) return undefined;
  const flagsByte = Number.parseInt(hex.slice(2, 4), 16);
  if (!Number.isFinite(flagsByte)) return undefined;
  const isResponse = (flagsByte & 0x02) !== 0;
  const isSync = (flagsByte & 0x04) !== 0;
  if (isResponse) return 'response';
  if (isSync) return 'sync';
  return 'request';
}

/** Sort descending by `.count` (module scope — does not capture outer state). */
function byCountDesc<T extends { count: number }>(left: T, right: T): number {
  return right.count - left.count;
}

interface MojoInterfaceState {
  name: string;
  version: number;
  pendingMessages: number;
}

export type MojoInterfaceCatalogSource = 'seeded-defaults' | 'observed' | 'mixed';

export interface MojoMonitorAvailability {
  available: boolean;
  reason?: string;
  fridaAvailable: boolean;
  fridaCliAvailable: boolean;
}

function getDefaultInterfaces(): MojoInterfaceState[] {
  return [
    { name: 'blink.mojom.WidgetHost', version: 1, pendingMessages: 0 },
    { name: 'content.mojom.FrameHost', version: 2, pendingMessages: 0 },
    { name: 'network.mojom.URLLoaderFactory', version: 3, pendingMessages: 0 },
  ];
}

function detectFridaNpmPackage(): boolean {
  try {
    require.resolve('frida');
    return true;
  } catch {
    return false;
  }
}

async function probeFridaCli(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const child = spawn('frida', ['--version'], {
      timeout: MOJO_FRIDA_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim().length > 0) {
        resolve('frida');
        return;
      }

      resolve(null);
    });

    child.on('error', () => {
      resolve(null);
    });
  });
}

async function detectAvailability(): Promise<MojoMonitorAvailability> {
  const flag = process.env['JSHOOK_ENABLE_MOJO_IPC'];
  const fridaNpm = detectFridaNpmPackage();
  const fridaCli = await probeFridaCli();
  const fridaAvailable = fridaNpm || fridaCli !== null;

  if (flag === '0' || flag === 'false') {
    return {
      available: false,
      fridaAvailable,
      fridaCliAvailable: fridaCli !== null,
      reason: 'Mojo IPC disabled by JSHOOK_ENABLE_MOJO_IPC=0.',
    };
  }

  return {
    available: fridaAvailable,
    fridaAvailable,
    fridaCliAvailable: fridaCli !== null,
    reason: fridaAvailable
      ? undefined
      : 'Mojo IPC backend is not connected. Install Frida for real IPC monitoring: https://frida.re/docs/installation/',
  };
}

function matchesFilter(message: MojoMessage, filter: MojoMessageFilter): boolean {
  if (filter.interfaceName && message.interfaceName !== filter.interfaceName) {
    return false;
  }

  if (filter.messageType !== undefined && message.messageType !== String(filter.messageType)) {
    return false;
  }

  if (
    typeof filter.pid === 'number' &&
    message.sourcePid !== filter.pid &&
    message.targetPid !== filter.pid
  ) {
    return false;
  }

  if (typeof filter.sinceTimestamp === 'number' && message.timestamp < filter.sinceTimestamp) {
    return false;
  }

  if (filter.hexSearch) {
    const needle = filter.hexSearch.replace(/\s+/g, '').toLowerCase();
    if (needle.length > 0 && !message.payload.toLowerCase().includes(needle)) {
      return false;
    }
  }

  if (filter.direction) {
    // A direction filter matches when the recorded direction equals the
    // requested one; messages whose direction could not be derived are
    // excluded (honest: never silently match an unknown).
    if (message.direction !== filter.direction) return false;
  }

  return true;
}

/** Messages posted from the Frida script back to the Node host. */
export interface FridaHostMessage {
  type: 'mojo-message' | 'mojo-hook-attached' | 'mojo-hook-warning' | 'mojo-hook-error';
  hex?: string;
  iface?: string | null;
  method?: string | null;
  size?: number;
  module?: string;
  symbol?: string;
  reason?: string;
  tried?: string[];
  error?: string;
}

/**
 * Parse one stdout line emitted by the Frida CLI. The CLI wraps script
 * `send()` calls as `{"type":"send","payload":{...}}` JSON; a bare payload
 * object is also accepted. Returns null for non-JSON diagnostic output so the
 * caller can ignore Frida's progress/log chatter.
 */
export function parseFridaMessage(line: string): FridaHostMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }

  if (obj && typeof obj === 'object') {
    const record = obj as { type?: unknown; payload?: unknown };
    if (record.type === 'send' && record.payload && typeof record.payload === 'object') {
      return record.payload as FridaHostMessage;
    }
    if (typeof record.type === 'string' && record.type.startsWith('mojo-')) {
      return record as FridaHostMessage;
    }
  }
  return null;
}

function buildFridaScript(): string {
  // Real Mojo capture script for Frida (v8 runtime).
  //
  // HONEST LIMITATIONS (see research/mojo-ipc.md #4):
  // - Mojo write-path symbols (MojoWriteMessage / MojoWriteMessageNew) are
  //   build/version-specific exports. The script probes every loaded
  //   module for the common C-API names; if none resolve it reports the
  //   failure back so the host stays in simulation mode instead of faking
  //   capture (lesson #51: no hollow capture).
  // - The message handle's internal layout is NOT decoded in-page. A bounded
  //   region of the message pointer is hex-dumped and posted to the host; use
  //   mojo_decode_message there to interpret it. Per-version struct offsets
  //   remain the caller's responsibility.
  return `'use strict';
var CANDIDATE_SYMBOLS = ['MojoWriteMessage', 'MojoWriteMessageNew'];
function findMojoWrite() {
  var modules = Process.enumerateModules();
  for (var i = 0; i < modules.length; i++) {
    for (var s = 0; s < CANDIDATE_SYMBOLS.length; s++) {
      var addr = Module.findExportByName(modules[i].name, CANDIDATE_SYMBOLS[s]);
      if (addr) return { module: modules[i].name, symbol: CANDIDATE_SYMBOLS[s], address: addr };
    }
  }
  return null;
}
function toHex(arrayBuffer) {
  var view = new Uint8Array(arrayBuffer);
  var out = '';
  for (var i = 0; i < view.length; i++) {
    out += ('00' + view[i].toString(16)).slice(-2);
  }
  return out;
}
var target = findMojoWrite();
if (!target) {
  send({ type: 'mojo-hook-warning', reason: 'No Mojo write-path export found in any module', tried: CANDIDATE_SYMBOLS });
} else {
  send({ type: 'mojo-hook-attached', module: target.module, symbol: target.symbol });
  Interceptor.attach(target.address, {
    onEnter: function (args) {
      try {
        var dumpPtr = args[1];
        var size = 256;
        var hex = toHex(dumpPtr.readByteArray(size));
        send({ type: 'mojo-message', hex: hex, size: size, iface: null, method: null });
      } catch (e) {
        send({ type: 'mojo-hook-error', error: String(e) });
      }
    }
  });
}
`;
}

export class MojoMonitor {
  private active = false;
  private simulationMode = false;
  private fridaProbeSucceeded = false;
  private deviceId?: string;
  private fridaChild?: import('node:child_process').ChildProcess;
  private readonly messages: MojoMessage[] = [];
  private readonly interfaces = new Map<string, MojoInterfaceState>();
  private readonly observedInterfaceNames = new Set<string>();
  private availability: MojoMonitorAvailability = {
    available: false,
    fridaAvailable: false,
    fridaCliAvailable: false,
    reason: 'Not yet initialized. Call start() to probe availability.',
  };

  constructor() {
    this.resetInterfaces();
  }

  isAvailable(): boolean {
    return this.availability.available;
  }

  getUnavailableReason(): string | undefined {
    return this.availability.reason;
  }

  getAvailabilitySnapshot(): MojoMonitorAvailability {
    return { ...this.availability };
  }

  async probeAvailability(): Promise<MojoMonitorAvailability> {
    this.availability = await detectAvailability();
    return this.getAvailabilitySnapshot();
  }

  isSimulationMode(): boolean {
    return this.simulationMode;
  }

  didFridaProbeSucceed(): boolean {
    return this.fridaProbeSucceeded;
  }

  /**
   * True only when the Frida path actually delivered at least one real Mojo
   * message this session (script attached + message received). Stays false in
   * simulation / probe-only / unstarted states — honest, no hollow live.
   */
  isLiveCapture(): boolean {
    return this.fridaProbeSucceeded && !this.simulationMode;
  }

  setSimulationMode(enabled: boolean): void {
    this.simulationMode = enabled;
  }

  isActive(): boolean {
    return this.active;
  }

  getDeviceId(): string | undefined {
    return this.deviceId;
  }

  async start(deviceId?: string): Promise<void> {
    this.deviceId = deviceId;
    this.availability = await detectAvailability();
    this.resetInterfaces();
    this.simulationMode = false;
    this.fridaProbeSucceeded = false;

    if (!this.availability.available) {
      this.active = false;
      return;
    }

    this.active = true;

    if (this.availability.fridaCliAvailable) {
      await this.captureWithFrida(deviceId);
    } else {
      this.simulationMode = true;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.deviceId = undefined;
    this.fridaProbeSucceeded = false;
    this.fridaChild?.kill();
    this.fridaChild = undefined;
    this.resetInterfaces();
  }

  async captureMessages(filter: MojoMessageFilter = {}): Promise<MojoMessage[]> {
    if (!this.active) {
      return [];
    }

    const captured: MojoMessage[] = [];
    const remaining: MojoMessage[] = [];

    for (const message of this.messages) {
      if (matchesFilter(message, filter)) {
        captured.push({ ...message });
      } else {
        remaining.push(message);
      }
    }

    this.messages.length = 0;
    this.messages.push(...remaining);
    this.recomputePendingCounts();
    return captured;
  }

  async listInterfaces(): Promise<
    Array<{ name: string; version: number; pendingMessages: number }>
  > {
    return [...this.interfaces.values()]
      .map((item) => ({
        name: item.name,
        version: item.version,
        pendingMessages: item.pendingMessages,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  }

  hasObservedInterfaces(): boolean {
    return this.observedInterfaceNames.size > 0;
  }

  getObservedInterfaceCount(): number {
    return this.observedInterfaceNames.size;
  }

  getInterfaceCatalogSource(): MojoInterfaceCatalogSource {
    if (this.observedInterfaceNames.size === 0) {
      return 'seeded-defaults';
    }

    if (this.observedInterfaceNames.size >= this.interfaces.size) {
      return 'observed';
    }

    return 'mixed';
  }

  async getMessages(options?: {
    limit?: number;
    interfaceName?: string;
    messageType?: string | number;
    sinceTimestamp?: number;
    hexSearch?: string;
    direction?: MojoMessageDirection;
  }): Promise<{
    messages: MojoMessage[];
    totalAvailable: number;
    filtered: boolean;
    simulation: boolean;
  }> {
    if (!this.active) {
      return {
        messages: [],
        totalAvailable: 0,
        filtered: false,
        simulation: this.simulationMode,
      };
    }

    const filter = this.buildFilter(options);
    const allMessages = await this.captureMessages(filter);
    const limit = options?.limit ?? 100;

    return {
      messages: allMessages.slice(0, limit),
      totalAvailable: allMessages.length,
      filtered: this.filterIsApplied(options),
      simulation: this.simulationMode,
    };
  }

  /**
   * Aggregate the current buffer (non-destructive) into interface/method/
   * direction breakdowns plus top-N and time window. Unlike getMessages this
   * does not drain the buffer — call it freely to inspect a live trace.
   */
  async summarizeMessages(options?: {
    interfaceName?: string;
    messageType?: string | number;
    sinceTimestamp?: number;
    hexSearch?: string;
    direction?: MojoMessageDirection;
    topN?: number;
  }): Promise<MojoMessageSummary> {
    const empty: MojoMessageSummary = {
      total: 0,
      totalBytes: 0,
      byDirection: { request: 0, response: 0, sync: 0, unknown: 0 },
      byInterface: [],
      byMethod: [],
      topInterfaces: [],
      topMethods: [],
      timeWindow: { earliest: null, latest: null, durationMs: 0 },
      filtered: this.filterIsApplied(options),
      simulation: this.simulationMode,
    };

    if (!this.active) {
      return empty;
    }

    const filter = this.buildFilter(options);
    // Snapshot only — never mutate the live buffer from a summary.
    const matched = this.messages.filter((message) => matchesFilter(message, filter));

    return this.aggregateMessages(matched, options?.topN, empty);
  }

  private buildFilter(options?: {
    interfaceName?: string;
    messageType?: string | number;
    sinceTimestamp?: number;
    hexSearch?: string;
    direction?: MojoMessageDirection;
  }): MojoMessageFilter {
    const filter: MojoMessageFilter = {};
    if (options?.interfaceName) {
      filter.interfaceName = options.interfaceName;
    }
    if (options?.messageType !== undefined) {
      filter.messageType = options.messageType;
    }
    if (options?.sinceTimestamp !== undefined) {
      filter.sinceTimestamp = options.sinceTimestamp;
    }
    if (options?.hexSearch) {
      filter.hexSearch = options.hexSearch;
    }
    if (options?.direction) {
      filter.direction = options.direction;
    }
    return filter;
  }

  private filterIsApplied(options?: {
    interfaceName?: string;
    messageType?: string | number;
    sinceTimestamp?: number;
    hexSearch?: string;
    direction?: MojoMessageDirection;
  }): boolean {
    return !!(
      options?.interfaceName ||
      options?.messageType !== undefined ||
      options?.sinceTimestamp !== undefined ||
      options?.hexSearch ||
      options?.direction
    );
  }

  private aggregateMessages(
    matched: MojoMessage[],
    topN: number | undefined,
    empty: MojoMessageSummary,
  ): MojoMessageSummary {
    if (matched.length === 0) return empty;

    const limit = typeof topN === 'number' && topN > 0 ? Math.trunc(topN) : 5;

    interface InterfaceAcc {
      count: number;
      bytes: number;
      directionBreakdown: MojoMessageDirectionBreakdown;
      methods: Set<string>;
    }
    interface MethodAcc {
      count: number;
      bytes: number;
    }

    const interfaceMap = new Map<string, InterfaceAcc>();
    const methodMap = new Map<string, MethodAcc>();
    const directionBreakdown: MojoMessageDirectionBreakdown = {
      request: 0,
      response: 0,
      sync: 0,
      unknown: 0,
    };
    let totalBytes = 0;
    let earliest: number | null = null;
    let latest: number | null = null;

    for (const message of matched) {
      const bytes = typeof message.size === 'number' && message.size >= 0 ? message.size : 0;
      totalBytes += bytes;

      if (earliest === null || message.timestamp < earliest) earliest = message.timestamp;
      if (latest === null || message.timestamp > latest) latest = message.timestamp;

      const dir: MojoMessageDirection | 'unknown' = message.direction ?? 'unknown';
      directionBreakdown[dir] += 1;

      const interfaceAcc = interfaceMap.get(message.interfaceName) ?? {
        count: 0,
        bytes: 0,
        directionBreakdown: { request: 0, response: 0, sync: 0, unknown: 0 },
        methods: new Set<string>(),
      };
      interfaceAcc.count += 1;
      interfaceAcc.bytes += bytes;
      interfaceAcc.directionBreakdown[dir] += 1;
      interfaceAcc.methods.add(message.messageType);
      interfaceMap.set(message.interfaceName, interfaceAcc);

      const methodKey = `${message.interfaceName}\u{0}:${message.messageType}`;
      const methodAcc = methodMap.get(methodKey) ?? { count: 0, bytes: 0 };
      methodAcc.count += 1;
      methodAcc.bytes += bytes;
      methodMap.set(methodKey, methodAcc);
    }

    const byInterface: MojoInterfaceSummary[] = [...interfaceMap.entries()]
      .map(([interfaceName, acc]) => ({
        interface: interfaceName,
        count: acc.count,
        bytes: acc.bytes,
        distinctMethods: acc.methods.size,
        directionBreakdown: acc.directionBreakdown,
      }))
      .toSorted(byCountDesc);

    const byMethod: MojoMethodSummary[] = [...methodMap.entries()]
      .map(([key, acc]) => {
        const separator = key.indexOf('\u{0}:');
        const interfaceName = separator >= 0 ? key.slice(0, separator) : key;
        const method = separator >= 0 ? key.slice(separator + 2) : '';
        return { interface: interfaceName, method, count: acc.count, bytes: acc.bytes };
      })
      .toSorted(byCountDesc);

    const durationMs = earliest !== null && latest !== null ? Math.max(0, latest - earliest) : 0;

    return {
      total: matched.length,
      totalBytes,
      byDirection: directionBreakdown,
      byInterface,
      byMethod,
      topInterfaces: byInterface.slice(0, limit),
      topMethods: byMethod.slice(0, limit),
      timeWindow: { earliest, latest, durationMs },
      filtered: empty.filtered,
      simulation: this.simulationMode,
    };
  }

  recordMessage(message: MojoMessage, version = 1): void {
    if (!this.active) {
      return;
    }

    const normalized: MojoMessage =
      message.direction === undefined
        ? { ...message, direction: deriveDirectionFromPayload(message.payload) }
        : { ...message };
    this.messages.push(normalized);
    this.observedInterfaceNames.add(normalized.interfaceName);
    const existing = this.interfaces.get(normalized.interfaceName);
    if (existing) {
      existing.pendingMessages += 1;
      return;
    }

    this.interfaces.set(normalized.interfaceName, {
      name: normalized.interfaceName,
      version,
      pendingMessages: 1,
    });
  }

  async captureWithFrida(deviceId?: string): Promise<void> {
    const targetProcess = deviceId ?? 'chromium';
    const script = buildFridaScript();
    // Stay in simulation until a real Mojo message arrives from the script.
    this.simulationMode = true;
    this.fridaProbeSucceeded = false;

    await new Promise<void>((resolve) => {
      const child = spawn('frida', ['-q', '-n', targetProcess, '-l', '-', '--runtime=v8'], {
        windowsHide: true,
      });
      this.fridaChild = child;

      let resolved = false;
      const finish = (): void => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      // Don't block start() forever on the first message — give Frida time to
      // attach, then resolve so the monitor stays usable while capture continues.
      const probeTimeout = setTimeout(finish, MOJO_MONITOR_TIMEOUT_MS);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        for (const rawLine of text.split('\n')) {
          const line = rawLine.trim();
          if (line.length === 0) continue;
          const parsed = parseFridaMessage(line);
          if (parsed) {
            this.handleFridaMessage(parsed);
          }
        }
      });

      child.on('error', () => {
        clearTimeout(probeTimeout);
        finish();
      });
      child.on('close', () => {
        clearTimeout(probeTimeout);
        finish();
      });

      child.stdin?.end(script);
    });
  }

  /**
   * Apply one parsed Frida host message. A real mojo-message flips the monitor
   * out of simulation mode; hook-attached confirms the probe; warnings/errors
   * keep it honestly simulated (lesson #51: no hollow live capture).
   */
  private handleFridaMessage(message: FridaHostMessage): void {
    if (message.type === 'mojo-message') {
      this.simulationMode = false;
      this.fridaProbeSucceeded = true;
      // Direction is best-effort derived from the captured payload header;
      // the wire layout is build-version-specific so this stays fail-soft.
      const direction = deriveDirectionFromPayload(message.hex);
      this.recordMessage({
        timestamp: Date.now(),
        sourcePid: 0,
        targetPid: 0,
        interfaceName: message.iface ?? 'unknown',
        messageType: String(message.method ?? ''),
        payload: message.hex ?? '',
        size: message.size ?? 0,
        direction,
      });
    } else if (message.type === 'mojo-hook-attached') {
      this.fridaProbeSucceeded = true;
    }
  }

  private recomputePendingCounts(): void {
    this.resetPendingCounts();

    for (const message of this.messages) {
      this.observedInterfaceNames.add(message.interfaceName);
      const item = this.interfaces.get(message.interfaceName);
      if (item) {
        item.pendingMessages += 1;
      } else {
        this.interfaces.set(message.interfaceName, {
          name: message.interfaceName,
          version: 1,
          pendingMessages: 1,
        });
      }
    }
  }

  private resetPendingCounts(): void {
    for (const item of this.interfaces.values()) {
      item.pendingMessages = 0;
    }
  }

  private resetInterfaces(): void {
    this.messages.length = 0;
    this.interfaces.clear();
    this.observedInterfaceNames.clear();
    for (const item of getDefaultInterfaces()) {
      this.interfaces.set(item.name, { ...item });
    }
  }
}
