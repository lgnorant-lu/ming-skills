import { readGuestCString } from '../c-strings';
import type { BionicLibrary } from './library';
import type { BionicOptions } from './types';

export function installAndroidAssetStubs(lib: BionicLibrary, options: BionicOptions): void {
  const handles = new Map<number, { bytes: Uint8Array; pos: number }>();
  let nextHandle = 10000;

  lib.set('AAssetManager_fromJava', () => 1n);
  lib.set('AAssetManager_open', (ctx) => {
    if (!options.onAssetOpen) return 0n;
    const data = options.onAssetOpen(readGuestCString(ctx, Number(ctx.x(1))));
    if (!data) return 0n;
    const handle = nextHandle++;
    handles.set(handle, { bytes: data, pos: 0 });
    return BigInt(handle);
  });
  lib.set('AAsset_read', (ctx) => {
    const asset = handles.get(Number(ctx.x(0)));
    if (!asset) return BigInt(-1);
    const data = asset.bytes.subarray(asset.pos, asset.pos + Number(ctx.x(2)));
    if (data.length > 0) ctx.write(Number(ctx.x(1)), data);
    asset.pos += data.length;
    return BigInt(data.length);
  });
  lib.set('AAsset_getLength', (ctx) => {
    const asset = handles.get(Number(ctx.x(0)));
    return asset ? BigInt(asset.bytes.length) : BigInt(-1);
  });
  lib.set('AAsset_getRemainingLength', (ctx) => {
    const asset = handles.get(Number(ctx.x(0)));
    return asset ? BigInt(asset.bytes.length - asset.pos) : BigInt(-1);
  });
  lib.set('AAsset_seek', (ctx) => {
    const asset = handles.get(Number(ctx.x(0)));
    if (!asset) return BigInt(-1);
    const offset = Number(ctx.x(1));
    const whence = Number(ctx.x(2));
    if (whence === 0) asset.pos = offset;
    else if (whence === 1) asset.pos += offset;
    else if (whence === 2) asset.pos = asset.bytes.length + offset;
    asset.pos = Math.max(0, Math.min(asset.pos, asset.bytes.length));
    return BigInt(asset.pos);
  });
  lib.set('AAsset_close', (ctx) => {
    handles.delete(Number(ctx.x(0)));
  });
  lib.set('AAsset_isAllocated', () => 0n);
  lib.set('AAsset_openFileDescriptor', () => BigInt(-1));
}
