/**
 * Android dumpsys output parser — structured JSON from adb shell dumpsys.
 *
 * Parses key-value pairs and sectioned output from Android's dumpsys command.
 * Supports common service outputs: battery, activity, wifi, package, meminfo.
 *
 * Pure TS — no native dependencies.
 */

export interface DumpsysSection {
  name: string;
  /** Key-value pairs within this section. */
  entries: Record<string, string | string[]>;
  /** Nested subsections (e.g., per-package sections within "package"). */
  subsections: DumpsysSection[];
  /** Raw text content if parsing failed. */
  raw?: string;
}

export interface DumpsysResult {
  service: string;
  /** Top-level sections. */
  sections: DumpsysSection[];
  /** Total sections found. */
  sectionCount: number;
  /** Raw output preserved if requested. */
  raw?: string;
}

/** Parsed battery information from dumpsys battery. */
export interface BatteryInfo {
  /** AC powered: true/false. */
  acPowered: boolean;
  /** USB powered: true/false. */
  usbPowered: boolean;
  /** Wireless powered: true/false. */
  wirelessPowered: boolean;
  /** Dock powered: true/false (Android 12+). */
  dockPowered?: boolean;
  /** Battery status: charging/discharging/full/not-charging/unknown. */
  status: string;
  /** Battery health: good/overheat/dead/over-voltage/unknown-failure/cold. */
  health: string;
  /** Present: true/false. */
  present: boolean;
  /** Charge level (0-100). */
  level: number;
  /** Max charging current in microamps. */
  maxChargingCurrent?: number;
  /** Max charging voltage in microvolts. */
  maxChargingVoltage?: number;
  /** Battery voltage in millivolts. */
  voltage?: number;
  /** Battery temperature in tenths of degrees Celsius. */
  temperature?: number;
  /** Technology (Li-ion, Li-poly, etc.). */
  technology: string;
  /** Raw parsed key-value entries. */
  raw: Record<string, string>;
}

/** Parsed activity manager info from dumpsys activity. */
export interface ActivityInfo {
  /** Current focused activity (package/class). */
  focusedApp?: string;
  /** Current focused window. */
  focusedWindow?: string;
  /** Current resumed activity. */
  resumedActivity?: string;
  /** Top-most resumed activity package. */
  topResumedPackage?: string;
  /** Currently running activities. */
  runningActivities: string[];
  /** Recent tasks. */
  recentTasks: string[];
  /** Process name of the top activity. */
  topProcess?: string;
  /** PID of the top activity. */
  topPid?: number;
  /** Total number of running activities. */
  activityCount: number;
  /** Per-activity detail entries keyed by package. */
  activities: Array<{
    packageName: string;
    className: string;
    pid: number;
    state: string;
    taskId?: number;
  }>;
  /** Raw parsed key-value entries. */
  raw: Record<string, string>;
}

/** Parsed WiFi information from dumpsys wifi. */
export interface WifiInfo {
  /** Wi-Fi enabled state. */
  wifiEnabled: boolean;
  /** Wi-Fi connected state. */
  wifiConnected: boolean;
  /** Current SSID (if connected). */
  ssid?: string;
  /** Current BSSID (AP MAC, if connected). */
  bssid?: string;
  /** IP address (if connected). */
  ipAddress?: string;
  /** MAC address of device. */
  macAddress?: string;
  /** Link speed in Mbps. */
  linkSpeed?: number;
  /** RSSI (signal strength in dBm). */
  rssi?: number;
  /** WiFi frequency band (2.4GHz/5GHz/6GHz). */
  frequencyBand?: string;
  /** Network ID. */
  networkId?: number;
  /** Supplicant state. */
  supplicantState?: string;
  /** Scan results (visible networks). */
  scanResults: Array<{
    ssid: string;
    bssid: string;
    frequency: number;
    level: number;
    capabilities: string;
  }>;
  /** Raw parsed key-value entries. */
  raw: Record<string, string>;
}

/**
 * Parse dumpsys output into structured sections and key-value pairs.
 *
 * The parser handles:
 * - Section headers: indented or marked with "DUMP OF SERVICE"
 * - Key-value lines: "key=value" or "key: value"
 * - List items: lines beginning with spaces + item text
 * - Array values: "key=[value1, value2, ...]"
 */
export function parseDumpsys(raw: string, service: string): DumpsysResult {
  const lines = raw.split('\n');
  const sections: DumpsysSection[] = [];
  let currentSection: DumpsysSection | null = null;
  let currentEntries: Record<string, string | string[]> = {};
  let currentSubsections: DumpsysSection[] = [];
  let currentListKey: string | null = null;
  let currentListValues: string[] = [];

  function ensureSection() {
    currentSection ??= { name: service || 'default', entries: {}, subsections: [] };
  }

  function flushList() {
    if (currentListKey && currentListValues.length > 0) {
      currentEntries[currentListKey] = currentListValues;
    }
    currentListKey = null;
    currentListValues = [];
  }

  function flushSection() {
    if (currentSection) {
      flushList();
      currentSection.entries = currentEntries;
      currentSection.subsections = currentSubsections;
      sections.push(currentSection);
    }
    currentEntries = {};
    currentSubsections = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip empty lines (but not within list values)
    if (line.trim().length === 0 && !currentListKey) continue;

    // Detect section headers
    // "DUMP OF SERVICE ..." lines
    const dumpHeader = line.match(/^DUMP OF SERVICE\s+(.+?)(?:\s*\(.*\))?\s*$/i);
    if (dumpHeader) {
      flushSection();
      currentSection = { name: dumpHeader[1]!.trim(), entries: {}, subsections: [] };
      continue;
    }

    // Lines starting with "  -----" or similar separators
    if (/^\s*-{3,}/.test(line) && currentSection) {
      // Could be a subsection separator
      continue;
    }

    // Key-value: "key=value" or "key: value"
    const kvMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.\s-]{0,80})[=:]\s*(.+)$/);
    if (kvMatch && !currentListKey) {
      ensureSection();
      const key = kvMatch[1]!.trim();
      void key; // stored in result below
      const value = kvMatch[2]!.trim();

      // Handle array values: "[val1, val2, ...]"
      if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1);
        currentEntries[key] = inner
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        currentEntries[key] = value;
      }
      continue;
    }

    // List continuation: indented lines that appear to be list items
    if (line.length > 0 && line[0] === ' ' && currentListKey) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        currentListValues.push(trimmed);
      }
      continue;
    }

    // Detect list start: a key followed by nothing on the same line
    // e.g. "  Packages:"
    const listKeyMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.\s-]{0,60}):\s*$/);
    if (listKeyMatch) {
      flushList();
      currentListKey = listKeyMatch[1]!.trim();
      currentListValues = [];
      continue;
    }
  }

  flushSection();

  return {
    service,
    sections,
    sectionCount: sections.length,
  };
}

/**
 * Parse dumpsys package output into structured package info.
 * Extracts version, UID, data dir, permissions, and more.
 */
export function parsePackageDumpsys(raw: string): Record<string, unknown> {
  const result = parseDumpsys(raw, 'package');
  const packages: Record<string, unknown>[] = [];

  for (const section of result.sections) {
    if (section.name.toLowerCase().includes('package')) {
      const pkg: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(section.entries)) {
        pkg[key.toLowerCase().replace(/\s+/g, '_')] = value;
      }
      packages.push(pkg);
    }
  }

  return {
    service: 'package',
    packages,
    sectionCount: result.sectionCount,
  };
}

/**
 * Parse dumpsys meminfo output into structured memory info.
 */
export function parseMeminfoDumpsys(raw: string): Record<string, unknown> {
  const result = parseDumpsys(raw, 'meminfo');
  const entries: Record<string, string | string[]> = {};

  for (const section of result.sections) {
    Object.assign(entries, section.entries);
  }

  return {
    service: 'meminfo',
    entries,
    sectionCount: result.sectionCount,
  };
}

// ── Battery Parser ──

const BATTERY_PATTERNS = {
  acPowered: /AC[ _]?powered:\s*(true|false)/i,
  usbPowered: /USB[ _]?powered:\s*(true|false)/i,
  wirelessPowered: /Wireless[ _]?powered:\s*(true|false)/i,
  dockPowered: /Dock[ _]?powered:\s*(true|false)/i,
  status: /status:\s*(\d+)/i,
  health: /health:\s*(\d+)/i,
  present: /present:\s*(true|false)/i,
  level: /level:\s*(\d+)/i,
  scale: /scale:\s*(\d+)/i,
  voltage: /^[\t ]*voltage:\s*(\d+)/im,
  temperature: /temperature:\s*(\d+)/i,
  technology: /technology:\s*(\S+)/i,
  maxChargingCurrent: /max[ _]?charging[ _]?current:\s*(\d+)/i,
  maxChargingVoltage: /max[ _]?charging[ _]?voltage:\s*(\d+)/i,
};

function parseBool(s: string): boolean {
  return s.toLowerCase() === 'true';
}

function parseOptionalInt(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}

const BATTERY_STATUS_LABELS: Record<number, string> = {
  1: 'unknown',
  2: 'charging',
  3: 'discharging',
  4: 'not-charging',
  5: 'full',
};

const BATTERY_HEALTH_LABELS: Record<number, string> = {
  1: 'unknown',
  2: 'good',
  3: 'overheat',
  4: 'dead',
  5: 'over-voltage',
  6: 'unspecified-failure',
  7: 'cold',
};

/**
 * Parse dumpsys battery output into structured BatteryInfo.
 *
 * Handles dumpsys battery output from Android 8 through 14.
 * Extracts AC/USB/Wireless power status, battery level, voltage,
 * temperature, technology, and health indicators.
 */
export function parseBattery(raw: string): BatteryInfo {
  const result = parseDumpsys(raw, 'battery');

  // Merge all section entries into a flat map
  const entries: Record<string, string | string[]> = {};
  for (const section of result.sections) {
    Object.assign(entries, section.entries);
  }

  const flatRaw: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    flatRaw[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  // Regex extraction for fields not captured by key-value parser
  const match = (pat: RegExp): string | undefined => raw.match(pat)?.[1];

  const statusCode =
    parseOptionalInt(entries['status'] as string | undefined) ??
    parseOptionalInt(match(BATTERY_PATTERNS.status));
  const healthCode =
    parseOptionalInt(entries['health'] as string | undefined) ??
    parseOptionalInt(match(BATTERY_PATTERNS.health));

  return {
    acPowered: parseBool(
      (entries['AC powered'] as string) ??
        (entries['ac powered'] as string) ??
        match(BATTERY_PATTERNS.acPowered) ??
        'false',
    ),
    usbPowered: parseBool(
      (entries['USB powered'] as string) ??
        (entries['usb powered'] as string) ??
        match(BATTERY_PATTERNS.usbPowered) ??
        'false',
    ),
    wirelessPowered: parseBool(
      (entries['Wireless powered'] as string) ??
        (entries['wireless powered'] as string) ??
        match(BATTERY_PATTERNS.wirelessPowered) ??
        'false',
    ),
    dockPowered: match(BATTERY_PATTERNS.dockPowered)
      ? parseBool(match(BATTERY_PATTERNS.dockPowered)!)
      : undefined,
    status:
      statusCode !== undefined
        ? (BATTERY_STATUS_LABELS[statusCode] ?? `code-${statusCode}`)
        : 'unknown',
    health:
      healthCode !== undefined
        ? (BATTERY_HEALTH_LABELS[healthCode] ?? `code-${healthCode}`)
        : 'unknown',
    present: parseBool((entries['present'] as string) ?? match(BATTERY_PATTERNS.present) ?? 'true'),
    level:
      parseOptionalInt(entries['level'] as string | undefined) ??
      parseOptionalInt(match(BATTERY_PATTERNS.level)) ??
      0,
    maxChargingCurrent:
      parseOptionalInt(entries['max charging current'] as string | undefined) ??
      parseOptionalInt(match(BATTERY_PATTERNS.maxChargingCurrent)),
    maxChargingVoltage:
      parseOptionalInt(entries['max charging voltage'] as string | undefined) ??
      parseOptionalInt(match(BATTERY_PATTERNS.maxChargingVoltage)),
    voltage:
      parseOptionalInt(entries['voltage'] as string | undefined) ??
      parseOptionalInt(match(BATTERY_PATTERNS.voltage)),
    temperature:
      parseOptionalInt(entries['temperature'] as string | undefined) ??
      parseOptionalInt(match(BATTERY_PATTERNS.temperature)),
    technology:
      (entries['technology'] as string) ?? match(BATTERY_PATTERNS.technology) ?? 'unknown',
    raw: flatRaw,
  };
}

// ── Activity Parser ──

const ACTIVITY_PATTERNS = {
  focusedApp: /mFocusedApp=ActivityRecord\{[^}]*\s+([^\s}]+\/[^\s}]+)/,
  focusedWindow: /mFocusedWindow=Window\{[^}]*\s+([^\s}]+)/,
  resumedActivity: /mResumedActivity:\s*ActivityRecord\{[^}]*\s+([^\s}]+\/[^\s}]+)/,
  topResumedActivity: /ResumedActivity:\s*([^\s]+)/,
  topResumedPackage: /mTopResumedPackage=\s*(\S+)/,
  // Activity record line: "ActivityRecord{abc u0 com.pkg/.Class t123}"
  activityRecord:
    /^\s*(?:ActivityRecord|HistoryRecord)\{[^}]*\s+([^\s}]+)\/([^\s}]+)\s+t(-?\d+)\}(?:\s*(?:\([^)]*\))?)?$/,
  // Task record: "* Task{abc #123 ...}"
  taskRecord: /^\s*\*?\s*Task\{[^}]*#(\d+)\s.*\}\s*$/,
  // Recent task line
  recentTask: /^\s*\*?\s*Recent\s+#(\d+):\s*(.+)$/,
  // PID line in activity section
  pid: /pid=(\d+)/,
  // Standalone pid line (pid on separate line from ActivityRecord)
  pidLine: /^\s*pid=(\d+)/,
  processName: /proc=([^\s}]+)/,
  activityState: /\}(?:\s*\(([^)]*)\))?/,
};

/**
 * Parse dumpsys activity output into structured ActivityInfo.
 *
 * Extracts focused activity, resumed activity, running activities list,
 * recent tasks, and per-activity details (package, class, PID, state).
 *
 * Handles dumpsys activity output from Android 8 through 14.
 */
export function parseActivity(raw: string): ActivityInfo {
  const result = parseDumpsys(raw, 'activity');

  // Extract focused app
  const focusedAppMatch = raw.match(ACTIVITY_PATTERNS.focusedApp);
  const focusedApp = focusedAppMatch?.[1];

  // Extract focused window
  const focusedWindowMatch = raw.match(ACTIVITY_PATTERNS.focusedWindow);
  const focusedWindow = focusedWindowMatch?.[1];

  // Extract resumed activity
  const resumedMatch =
    raw.match(ACTIVITY_PATTERNS.resumedActivity) ?? raw.match(ACTIVITY_PATTERNS.topResumedActivity);
  const resumedActivity = resumedMatch?.[1];

  // Extract top resumed package
  const topPkgMatch = raw.match(ACTIVITY_PATTERNS.topResumedPackage);
  const topResumedPackage = topPkgMatch?.[1];

  // Parse activity records
  const activities: ActivityInfo['activities'] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const actMatch = line.match(ACTIVITY_PATTERNS.activityRecord);
    if (actMatch) {
      const pkgName = actMatch[1]!;
      const className = actMatch[2]!;
      const taskId = parseInt(actMatch[3]!, 10);

      const pidMatch = line.match(ACTIVITY_PATTERNS.pid);
      const pid = pidMatch ? parseInt(pidMatch[1]!, 10) : 0;

      // Extract state
      let state = 'unknown';
      if (line.includes('focused')) state = 'focused';
      else if (line.includes('resumed')) state = 'resumed';
      else if (line.includes('paused')) state = 'paused';
      else if (line.includes('stopped')) state = 'stopped';
      else if (line.includes('destroyed')) state = 'destroyed';
      else if (line.includes('finishing')) state = 'finishing';

      // Check for explicit state label in parens
      const stateMatch = line.match(ACTIVITY_PATTERNS.activityState);
      if (stateMatch?.[1]) {
        state = stateMatch[1].trim() || state;
      }

      activities.push({
        packageName: pkgName,
        className,
        pid,
        state,
        taskId: isNaN(taskId) ? undefined : taskId,
      });
    } else {
      // Check for pid on separate line (common in dumpsys output)
      const pidLineMatch = line.match(ACTIVITY_PATTERNS.pidLine);
      if (pidLineMatch && activities.length > 0) {
        activities[activities.length - 1]!.pid = parseInt(pidLineMatch[1]!, 10);
      }
    }
  }

  // Extract running activities (legacy format)
  const runningActivities: string[] = [];
  for (const section of result.sections) {
    for (const [, value] of Object.entries(section.entries)) {
      if (Array.isArray(value)) {
        runningActivities.push(...value);
      }
    }
  }

  // Extract recent tasks
  const recentTasks: string[] = [];
  for (const line of lines) {
    const taskMatch = line.match(ACTIVITY_PATTERNS.recentTask);
    if (taskMatch) {
      recentTasks.push(`#${taskMatch[1]}: ${taskMatch[2]!.trim()}`);
    }
  }

  // Find top process from resumed activity
  let topProcess: string | undefined;
  let topPid: number | undefined;
  if (resumedActivity) {
    const [resumedPkg] = resumedActivity.split('/');
    const topAct = activities.find((a) => a.packageName === resumedPkg);
    if (topAct) {
      topProcess = topAct.packageName;
      topPid = topAct.pid;
    }
  }

  // Merge section entries into raw
  const flatRaw: Record<string, string> = {};
  for (const section of result.sections) {
    for (const [key, value] of Object.entries(section.entries)) {
      flatRaw[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  return {
    focusedApp,
    focusedWindow,
    resumedActivity,
    topResumedPackage,
    runningActivities,
    recentTasks,
    topProcess,
    topPid,
    activityCount: activities.length,
    activities,
    raw: flatRaw,
  };
}

// ── WiFi Parser ──

const WIFI_PATTERNS = {
  wifiEnabled: /Wi-Fi[ is]* (enabled|disabled)/i,
  wifiEnabledAlt: /mWiFiEnabled[=:]?\s*(true|false)/i,
  wifiState: /Wi-Fi state:\s*(\S+)/i,
  connected: /connected[=:]?\s*(true|false)/i,
  ssid: /SSID[=:]?\s*"?([^"\n]+)"?/i,
  bssid: /BSSID[=:]?\s*([0-9a-fA-F:]{17})/i,
  ipAddress: /IP[ -]?address[=:]?\s*(\d+\.\d+\.\d+\.\d+)/i,
  macAddress: /MAC[ -]?address[=:]?\s*([0-9a-fA-F:]{17})/i,
  linkSpeed: /Link[ -]?speed[=:]?\s*(\d+)\s*(Mbps)?/i,
  rssi: /RSSI[=:]?\s*(-?\d+)/i,
  frequency: /frequency[=:]?\s*(\d+)\s*(MHz)?/i,
  networkId: /(?:Network[ -]?)?[Nn]et[Ww]ork[ -]?[Ii][Dd][=:]?\s*(-?\d+)/i,
  supplicantState: /supplicant[ -]?state[=:]?\s*(\S+)/i,
  band24: /(?:2[.,]4\s*GHz|2400|2412|2437|2462|2472|2484)/i,
  band5:
    /(?:5\s*GHz|5180|5200|5220|5240|5260|5280|5300|5320|5500|5520|5540|5560|5580|5600|5620|5640|5660|5680|5700|5720|5745|5765|5785|5805|5825)/i,
  band6:
    /(?:6\s*GHz|5955|5975|5995|6015|6035|6055|6075|6095|6115|6135|6155|6175|6195|6215|6235|6255|6275|6295|6315|6335|6355|6375|6395|6415|6435|6455|6475|6495|6515|6535|6555|6575|6595|6615|6635|6655|6675|6695|6715|6735|6755|6775|6795|6815|6835|6855|6875|6895|6915|6935|6955|6975|6995|7015|7035|7055|7075|7085|7095|7105|7115)/i,
  // Scan result line: "SSID: MyWiFi, BSSID: aa:bb:cc:dd:ee:ff, freq: 2412, level: -45, capabilities: [WPA2-PSK-CCMP][ESS]"
  scanResult:
    /SSID:\s*([^,]+),\s*BSSID:\s*([0-9a-fA-F:]{17}),\s*(?:freq|frequency):\s*(\d+),\s*(?:level|signal):\s*(-?\d+),\s*(?:capabilities|capab):\s*(.+)$/i,
};

/**
 * Parse dumpsys wifi output into structured WifiInfo.
 *
 * Extracts enabled/connected state, SSID, BSSID, IP address, MAC address,
 * link speed, RSSI, frequency band, and scan results.
 *
 * Handles dumpsys wifi output from Android 8 through 14.
 */
export function parseWifi(raw: string): WifiInfo {
  const result = parseDumpsys(raw, 'wifi');

  // Merge all section entries into a flat map
  const entries: Record<string, string | string[]> = {};
  for (const section of result.sections) {
    Object.assign(entries, section.entries);
  }

  const flatRaw: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    flatRaw[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const match = (pat: RegExp): string | undefined => raw.match(pat)?.[1];

  // Wi-Fi enabled detection
  let wifiEnabled: boolean;
  const enabledAlt = match(WIFI_PATTERNS.wifiEnabledAlt);
  if (enabledAlt) {
    wifiEnabled = parseBool(enabledAlt);
  } else {
    const enabledStr = match(WIFI_PATTERNS.wifiEnabled);
    wifiEnabled = enabledStr ? enabledStr.toLowerCase() === 'enabled' : false;
  }

  // Wi-Fi connected detection
  const connectedStr = match(WIFI_PATTERNS.connected);
  const wifiConnected = connectedStr ? parseBool(connectedStr) : false;

  // SSID and BSSID
  const ssid = match(WIFI_PATTERNS.ssid);
  const bssid = match(WIFI_PATTERNS.bssid);

  // IP address
  const ipAddress =
    (entries['ip address'] as string) ??
    (entries['IP address'] as string) ??
    match(WIFI_PATTERNS.ipAddress);

  // MAC address
  const macAddress = match(WIFI_PATTERNS.macAddress);

  // Link speed
  const linkSpeedStr = match(WIFI_PATTERNS.linkSpeed);
  const linkSpeed = linkSpeedStr ? parseInt(linkSpeedStr, 10) : undefined;

  // RSSI
  const rssiStr = match(WIFI_PATTERNS.rssi);
  const rssi = rssiStr ? parseInt(rssiStr, 10) : undefined;

  // Frequency band detection (use raw.match directly — band patterns have no capture groups)
  let frequencyBand: string | undefined;
  if (WIFI_PATTERNS.band6.test(raw)) {
    frequencyBand = '6GHz';
  } else if (WIFI_PATTERNS.band5.test(raw)) {
    frequencyBand = '5GHz';
  } else if (WIFI_PATTERNS.band24.test(raw)) {
    frequencyBand = '2.4GHz';
  }

  // Network ID
  const netIdStr = match(WIFI_PATTERNS.networkId);
  const networkId = netIdStr ? parseInt(netIdStr, 10) : undefined;

  // Supplicant state
  const supplicantState = match(WIFI_PATTERNS.supplicantState);

  // Parse scan results
  const scanResults: WifiInfo['scanResults'] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const scanMatch = line.match(WIFI_PATTERNS.scanResult);
    if (scanMatch) {
      scanResults.push({
        ssid: scanMatch[1]!.trim(),
        bssid: scanMatch[2]!,
        frequency: parseInt(scanMatch[3]!, 10),
        level: parseInt(scanMatch[4]!, 10),
        capabilities: scanMatch[5]!.trim(),
      });
    }
  }

  return {
    wifiEnabled,
    wifiConnected,
    ssid: ssid ? ssid.replace(/^"|"$/g, '') : undefined,
    bssid,
    ipAddress,
    macAddress,
    linkSpeed,
    rssi,
    frequencyBand,
    networkId: networkId !== undefined && !isNaN(networkId) ? networkId : undefined,
    supplicantState,
    scanResults,
    raw: flatRaw,
  };
}
