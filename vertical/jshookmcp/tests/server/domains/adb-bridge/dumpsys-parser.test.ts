import { describe, it, expect } from 'vitest';
import {
  parseDumpsys,
  parsePackageDumpsys,
  parseMeminfoDumpsys,
  parseBattery,
  parseActivity,
  parseWifi,
} from '@server/domains/adb-bridge/dumpsys-parser';

describe('parseDumpsys', () => {
  it('parses key=value entries', () => {
    const raw = [
      'DUMP OF SERVICE package:',
      '  versionCode=42',
      '  versionName=1.0.0',
      '  userId=10123',
    ].join('\n');

    const result = parseDumpsys(raw, 'package');
    expect(result.sectionCount).toBeGreaterThanOrEqual(1);
    const section = result.sections[0]!;
    expect(section.entries['versionCode']).toBe('42');
    expect(section.entries['versionName']).toBe('1.0.0');
    expect(section.entries['userId']).toBe('10123');
  });

  it('parses key: value entries', () => {
    const raw = ['DUMP OF SERVICE meminfo:', '  Native Heap: 12345', '  Dalvik Heap: 67890'].join(
      '\n',
    );

    const result = parseDumpsys(raw, 'meminfo');
    const section = result.sections[0]!;
    expect(section.entries['Native Heap']).toBe('12345');
    expect(section.entries['Dalvik Heap']).toBe('67890');
  });

  it('parses array values in brackets', () => {
    const raw = ['DUMP OF SERVICE package:', '  flags=[DEBUGGABLE, HAS_CODE, ALLOW_BACKUP]'].join(
      '\n',
    );

    const result = parseDumpsys(raw, 'package');
    const flags = result.sections[0]!.entries['flags'] as string[];
    expect(Array.isArray(flags)).toBe(true);
    expect(flags).toContain('DEBUGGABLE');
    expect(flags).toContain('HAS_CODE');
  });

  it('handles multiple sections', () => {
    const raw = [
      'DUMP OF SERVICE package:',
      '  pkg=com.example.app',
      'DUMP OF SERVICE activity:',
      '  mResumedActivity=ActivityRecord{abc123}',
    ].join('\n');

    const result = parseDumpsys(raw, 'activity');
    expect(result.sectionCount).toBe(2);
    expect(result.sections[0]!.entries['pkg']).toBe('com.example.app');
    expect(result.sections[1]!.entries['mResumedActivity']).toBe('ActivityRecord{abc123}');
  });

  it('handles empty input', () => {
    const result = parseDumpsys('', 'test');
    expect(result.sectionCount).toBe(0);
    expect(result.sections).toHaveLength(0);
  });

  it('handles raw dumpsys without DUMP OF SERVICE header', () => {
    const raw = '  key1=val1\n  key2=val2\n  key3=val3';
    const result = parseDumpsys(raw, 'generic');
    expect(result.sectionCount).toBe(1);
    expect(result.sections[0]).toMatchObject({
      name: 'generic',
      entries: { key1: 'val1', key2: 'val2', key3: 'val3' },
    });
  });
});

describe('parsePackageDumpsys', () => {
  it('extracts package info with normalized keys', () => {
    const raw = [
      'DUMP OF SERVICE package:',
      '  Package [com.example.app] (abc123):',
      '    versionCode=42',
      '    versionName=1.0.0',
      '    userId=10123',
      '    dataDir=/data/data/com.example.app',
    ].join('\n');

    const result = parsePackageDumpsys(raw);
    expect(result.service).toBe('package');
    expect(result.packages).toBeDefined();
  });
});

describe('parseMeminfoDumpsys', () => {
  it('extracts memory info entries', () => {
    const raw = [
      'DUMP OF SERVICE meminfo:',
      '  Native Heap=12345',
      '  Dalvik Heap=67890',
      '  TOTAL=80235',
    ].join('\n');

    const result = parseMeminfoDumpsys(raw);
    expect(result.service).toBe('meminfo');
    expect(result.entries).toBeDefined();
  });
});

// ── Battery Parser ──

describe('parseBattery', () => {
  it('parses charging battery with full details', () => {
    const raw = [
      'Current Battery Service state:',
      '  AC powered: true',
      '  USB powered: false',
      '  Wireless powered: false',
      '  Max charging current: 500000',
      '  Max charging voltage: 5000000',
      '  Charge counter: 3000000',
      '  status: 2',
      '  health: 2',
      '  present: true',
      '  level: 85',
      '  scale: 100',
      '  voltage: 4200',
      '  temperature: 320',
      '  technology: Li-ion',
    ].join('\n');

    const battery = parseBattery(raw);
    expect(battery.acPowered).toBe(true);
    expect(battery.usbPowered).toBe(false);
    expect(battery.wirelessPowered).toBe(false);
    expect(battery.status).toBe('charging');
    expect(battery.health).toBe('good');
    expect(battery.present).toBe(true);
    expect(battery.level).toBe(85);
    expect(battery.technology).toBe('Li-ion');
    expect(battery.maxChargingCurrent).toBe(500000);
    expect(battery.maxChargingVoltage).toBe(5000000);
    expect(battery.voltage).toBe(4200);
    expect(battery.temperature).toBe(320);
  });

  it('parses discharging battery', () => {
    const raw = [
      'Current Battery Service state:',
      '  AC powered: false',
      '  USB powered: false',
      '  Wireless powered: false',
      '  status: 3',
      '  health: 2',
      '  present: true',
      '  level: 15',
      '  scale: 100',
      '  voltage: 3700',
      '  temperature: 280',
      '  technology: Li-poly',
    ].join('\n');

    const battery = parseBattery(raw);
    expect(battery.acPowered).toBe(false);
    expect(battery.usbPowered).toBe(false);
    expect(battery.status).toBe('discharging');
    expect(battery.level).toBe(15);
    expect(battery.technology).toBe('Li-poly');
  });

  it('detects overheat health status', () => {
    const raw = [
      'Current Battery Service state:',
      '  AC powered: true',
      '  status: 2',
      '  health: 3',
      '  present: true',
      '  level: 90',
      '  scale: 100',
      '  temperature: 450',
      '  technology: Li-ion',
    ].join('\n');

    const battery = parseBattery(raw);
    expect(battery.health).toBe('overheat');
    expect(battery.temperature).toBe(450);
  });

  it('returns defaults for minimal input', () => {
    const battery = parseBattery('');
    expect(battery.acPowered).toBe(false);
    expect(battery.usbPowered).toBe(false);
    expect(battery.wirelessPowered).toBe(false);
    expect(battery.status).toBe('unknown');
    expect(battery.health).toBe('unknown');
    expect(battery.present).toBe(true);
    expect(battery.level).toBe(0);
    expect(battery.technology).toBe('unknown');
  });

  it('stores raw entries for debugging', () => {
    const raw = ['Current Battery Service state:', '  level: 50', '  status: 5'].join('\n');
    const battery = parseBattery(raw);
    expect(battery.raw).toBeDefined();
    expect(battery.status).toBe('full');
  });
});

// ── Activity Parser ──

describe('parseActivity', () => {
  it('parses focused and resumed activity', () => {
    const raw = [
      'ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)',
      '  mFocusedApp=ActivityRecord{abc u0 com.android.settings/.Settings t123}',
      '  mResumedActivity: ActivityRecord{def u0 com.android.settings/.Settings t123}',
      '  ResumedActivity: com.android.settings/.Settings',
    ].join('\n');

    const activity = parseActivity(raw);
    expect(activity.focusedApp).toBe('com.android.settings/.Settings');
    expect(activity.resumedActivity).toBe('com.android.settings/.Settings');
  });

  it('parses activity records', () => {
    const raw = [
      'ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)',
      '  ActivityRecord{abc u0 com.android.calendar/.MainActivity t1}',
      '    pid=12345',
      '  ActivityRecord{def u0 com.android.settings/.Settings t2}',
      '    pid=67890',
    ].join('\n');

    const activity = parseActivity(raw);
    expect(activity.activities.length).toBe(2);
    expect(activity.activityCount).toBe(2);

    const calendar = activity.activities[0]!;
    expect(calendar.packageName).toBe('com.android.calendar');
    expect(calendar.className).toBe('.MainActivity');
    expect(calendar.pid).toBe(12345);

    const settings = activity.activities[1]!;
    expect(settings.packageName).toBe('com.android.settings');
    expect(settings.className).toBe('.Settings');
    expect(settings.pid).toBe(67890);
  });

  it('extracts top process and PID from resumed activity', () => {
    const raw = [
      'ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)',
      '  ActivityRecord{abc u0 com.android.chrome/.Main t1}',
      '    pid=9999',
      '  mResumedActivity: ActivityRecord{abc u0 com.android.chrome/.Main t1}',
    ].join('\n');

    const activity = parseActivity(raw);
    // The resumed package should be extracted
    expect(activity.resumedActivity).toBeDefined();
    expect(activity.topProcess).toBe('com.android.chrome');
    expect(activity.topPid).toBe(9999);
  });

  it('handles empty dumpsys output', () => {
    const activity = parseActivity('');
    expect(activity.activities).toHaveLength(0);
    expect(activity.activityCount).toBe(0);
    expect(activity.runningActivities).toHaveLength(0);
  });
});

// ── WiFi Parser ──

describe('parseWifi', () => {
  it('parses connected WiFi state', () => {
    const raw = [
      'Wi-Fi is enabled',
      '  mWiFiEnabled=true',
      '  connected=true',
      '  SSID="MyNetwork"',
      '  BSSID=aa:bb:cc:dd:ee:ff',
      '  IP address=192.168.1.100',
      '  MAC address=00:11:22:33:44:55',
      '  Link speed=866 Mbps',
      '  RSSI=-45',
      '  frequency=5220 MHz',
      '  Network ID=0',
      '  supplicant state=COMPLETED',
    ].join('\n');

    const wifi = parseWifi(raw);
    expect(wifi.wifiEnabled).toBe(true);
    expect(wifi.wifiConnected).toBe(true);
    expect(wifi.ssid).toBe('MyNetwork');
    expect(wifi.bssid).toBe('aa:bb:cc:dd:ee:ff');
    expect(wifi.ipAddress).toBe('192.168.1.100');
    expect(wifi.macAddress).toBe('00:11:22:33:44:55');
    expect(wifi.linkSpeed).toBe(866);
    expect(wifi.rssi).toBe(-45);
    expect(wifi.frequencyBand).toBe('5GHz');
    expect(wifi.networkId).toBe(0);
    expect(wifi.supplicantState).toBe('COMPLETED');
  });

  it('parses 2.4GHz frequency band', () => {
    const raw = [
      'Wi-Fi is enabled',
      '  connected=true',
      '  SSID="HomeWiFi"',
      '  BSSID=11:22:33:44:55:66',
      '  frequency=2412 MHz',
    ].join('\n');

    const wifi = parseWifi(raw);
    expect(wifi.wifiEnabled).toBe(true);
    expect(wifi.frequencyBand).toBe('2.4GHz');
    expect(wifi.ssid).toBe('HomeWiFi');
  });

  it('parses 6GHz frequency band', () => {
    const raw = [
      'Wi-Fi is enabled',
      '  connected=true',
      '  SSID="6GhzAP"',
      '  BSSID=ff:ee:dd:cc:bb:aa',
      '  frequency=6115 MHz',
    ].join('\n');

    const wifi = parseWifi(raw);
    expect(wifi.frequencyBand).toBe('6GHz');
  });

  it('parses disabled WiFi', () => {
    const raw = ['Wi-Fi is disabled', '  mWiFiEnabled=false', '  connected=false'].join('\n');

    const wifi = parseWifi(raw);
    expect(wifi.wifiEnabled).toBe(false);
    expect(wifi.wifiConnected).toBe(false);
  });

  it('parses scan results', () => {
    const raw = [
      'Wi-Fi is enabled',
      'Latest scan results:',
      '  SSID: CoffeeShop, BSSID: aa:bb:cc:dd:ee:01, frequency: 2412, level: -55, capabilities: [WPA2-PSK-CCMP][ESS]',
      '  SSID: CorpNet, BSSID: aa:bb:cc:dd:ee:02, frequency: 5220, level: -70, capabilities: [WPA3-SAE][ESS]',
    ].join('\n');

    const wifi = parseWifi(raw);
    expect(wifi.scanResults.length).toBe(2);

    const first = wifi.scanResults[0]!;
    expect(first.ssid).toBe('CoffeeShop');
    expect(first.bssid).toBe('aa:bb:cc:dd:ee:01');
    expect(first.frequency).toBe(2412);
    expect(first.level).toBe(-55);
    expect(first.capabilities).toContain('WPA2-PSK-CCMP');

    const second = wifi.scanResults[1]!;
    expect(second.ssid).toBe('CorpNet');
    expect(second.capabilities).toContain('WPA3-SAE');
  });

  it('returns defaults for minimal input', () => {
    const wifi = parseWifi('');
    expect(wifi.wifiEnabled).toBe(false);
    expect(wifi.wifiConnected).toBe(false);
    expect(wifi.ssid).toBeUndefined();
    expect(wifi.bssid).toBeUndefined();
    expect(wifi.scanResults).toHaveLength(0);
  });
});
