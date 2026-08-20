import type { HostContext } from '../host-context';
import {
  formatGuestCString,
  formatGuestVaList,
  readGuestCString,
  utf8ByteLength,
  writeGuestCString,
} from '../c-strings';
import { writeGuestPointer } from '../guest-memory';
import type { BionicLibrary } from './library';
import type { BionicAllocator, BionicOptions } from './types';

export function installFortifiedFormatStubs(lib: BionicLibrary): void {
  lib.set('__vsnprintf_chk', (ctx) => {
    const text = formatGuestVaList(ctx, Number(ctx.x(4)), Number(ctx.x(5)));
    return BigInt(
      writeGuestCString(ctx, Number(ctx.x(0)), text, Math.min(Number(ctx.x(1)), Number(ctx.x(3)))),
    );
  });
  lib.set('__vsprintf_chk', (ctx) => {
    const text = formatGuestVaList(ctx, Number(ctx.x(3)), Number(ctx.x(4)));
    return BigInt(writeGuestCString(ctx, Number(ctx.x(0)), text, Number(ctx.x(2))));
  });
  lib.set('__sprintf_chk', (ctx) => {
    const text = formatGuestCString(ctx, Number(ctx.x(3)), 4);
    return BigInt(writeGuestCString(ctx, Number(ctx.x(0)), text, Number(ctx.x(2))));
  });
}

export function installFormattedOutputStubs(lib: BionicLibrary, alloc: BionicAllocator): void {
  lib.set('vsnprintf', (ctx) => {
    const text = formatGuestVaList(ctx, Number(ctx.x(2)), Number(ctx.x(3)));
    return BigInt(writeGuestCString(ctx, Number(ctx.x(0)), text, Number(ctx.x(1))));
  });
  lib.set('vasprintf', (ctx) => {
    return allocateFormatted(
      ctx,
      formatGuestVaList(ctx, Number(ctx.x(1)), Number(ctx.x(2))),
      alloc,
    );
  });
  lib.set('asprintf', (ctx) => {
    return allocateFormatted(ctx, formatGuestCString(ctx, Number(ctx.x(1)), 2), alloc);
  });
}

export function installStdioExtensionStubs(
  lib: BionicLibrary,
  options: BionicOptions,
  alloc: BionicAllocator,
): void {
  lib.set('fputc', (ctx) => {
    const value = Number(ctx.x(0) & 0xffn);
    options.onStdout?.(String.fromCharCode(value));
    return BigInt(value);
  });
  lib.set('fputs', (ctx) => {
    const text = readGuestCString(ctx, Number(ctx.x(0)));
    options.onStdout?.(text);
    return BigInt(utf8ByteLength(text));
  });
  lib.set('fwrite', (ctx) => {
    const count = Number(ctx.x(2));
    const total = Number(ctx.x(1)) * count;
    if (total > 0) options.onStdout?.(new TextDecoder().decode(ctx.read(Number(ctx.x(0)), total)));
    return BigInt(count);
  });
  lib.set('vfprintf', (ctx) => {
    const text = formatGuestVaList(ctx, Number(ctx.x(1)), Number(ctx.x(2)));
    if (Number(ctx.x(0)) === 2) options.onStderr?.(text);
    else options.onStdout?.(text);
    return BigInt(utf8ByteLength(text));
  });
  lib.set('fflush', () => 0n);
  lib.set('clearerr', () => undefined);
  lib.set('rewind', () => undefined);
  lib.set('ftell', () => BigInt(-1));
  lib.set('fseek', () => 0n);
  lib.set('fgetc', () => BigInt(-1));

  lib.dataSymbols.set('__sF', alloc(3 * 256));
}

function allocateFormatted(ctx: HostContext, text: string, alloc: BionicAllocator): bigint {
  const length = utf8ByteLength(text);
  const pointer = alloc(length + 1);
  writeGuestCString(ctx, pointer, text);
  if (ctx.x(0) !== 0n) writeGuestPointer(ctx, Number(ctx.x(0)), pointer);
  return BigInt(length);
}
