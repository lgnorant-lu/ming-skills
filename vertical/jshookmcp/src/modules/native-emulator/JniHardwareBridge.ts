/**
 * JNI Hardware Snapshot Bridge (SOTA Phase 3).
 *
 * Wires a caller-supplied device snapshot into the JniEnvironment mock Java
 * world so emulated `.so` code that reads system properties / device
 * identifiers observes the captured state instead of an empty device.
 *
 * Deliberately carries NO pre-baked device fingerprints or vendor strings:
 * the snapshot is supplied by the caller (e.g. captured from a real device
 * over adb-bridge, or hand-provided by the user). This module only knows how
 * to replay a snapshot, never what a snapshot should contain.
 */

import type { NativeEmulator } from './NativeEmulator';
import type { JniEnvironment, JavaMethodCall } from './jni';

/** Caller-supplied device state to replay inside the emulated JNI world. */
export interface DeviceHardwareSnapshot {
  /** Device identifiers keyed by Settings.Secure name (e.g. `android_id`). */
  deviceIdentifiers: Record<string, string>;
  /** System properties keyed by getprop name (e.g. `ro.build.version.sdk`). */
  systemProperties: Record<string, string>;
  /** Capture time (epoch ms), informational only. */
  timestamp: number;
}

/** Resolve a jstring handle argument to its host-side UTF value ('' if absent). */
function resolveStringArg(env: JniEnvironment, handle: bigint | undefined): string {
  if (handle === undefined) return '';
  const value = env.valueOf(Number(handle));
  if (
    value !== null &&
    typeof value === 'object' &&
    'value' in value &&
    typeof (value as { value?: unknown }).value === 'string'
  ) {
    return (value as { value: string }).value;
  }
  return '';
}

// Static utility class: installs the hardware snapshot into the emulated JNI
// world. Grouped under a class to namespace the two registration steps.
// eslint-disable-next-line typescript/no-extraneous-class
export class JniHardwareBridge {
  /**
   * Install the snapshot as the emulated device state: mock Java methods that
   * read system properties and device identifiers return snapshot values.
   */
  static applyHardwareSnapshot(emulator: NativeEmulator, snapshot: DeviceHardwareSnapshot): void {
    const jni = emulator.jni;

    // android.os.SystemProperties.get(key) -> snapshot.systemProperties[key]
    jni.registerJavaMethod(
      'android/os/SystemProperties',
      'get',
      '(Ljava/lang/String;)Ljava/lang/String;',
      ({ args, jni: env }: JavaMethodCall) => {
        const key = resolveStringArg(env, args[0]);
        const value = snapshot.systemProperties[key] ?? '';
        return BigInt(env.allocHandle({ kind: 'string', value }));
      },
    );

    // android.provider.Settings$Secure.getString(resolver, key) -> device identifier
    jni.registerJavaMethod(
      'android/provider/Settings$Secure',
      'getString',
      '(Landroid/content/ContentResolver;Ljava/lang/String;)Ljava/lang/String;',
      ({ args, jni: env }: JavaMethodCall) => {
        const key = resolveStringArg(env, args[1]);
        const value = snapshot.deviceIdentifiers[key] ?? '';
        return BigInt(env.allocHandle({ kind: 'string', value }));
      },
    );
  }
}
