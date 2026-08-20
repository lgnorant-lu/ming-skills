import { alignGuestAddress, readGuestU64, type GuestMemoryReader } from './guest-memory';

const VA_LIST_HEADER_SIZE = 32;
const GENERAL_REGISTER_SLOT_SIZE = 8;
const VECTOR_REGISTER_SLOT_SIZE = 16;

/** Stateful reader for the AArch64 Procedure Call Standard va_list layout. */
export class Aarch64VaListReader {
  private stack: number;
  private readonly generalTop: number;
  private readonly vectorTop: number;
  private generalOffset: number;
  private vectorOffset: number;

  constructor(
    private readonly memory: GuestMemoryReader,
    address: number,
  ) {
    const header = memory.read(address, VA_LIST_HEADER_SIZE);
    if (header.byteLength < VA_LIST_HEADER_SIZE) {
      throw new Error(`AArch64 va_list header is truncated at 0x${address.toString(16)}`);
    }
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    this.stack = Number(view.getBigUint64(0, true));
    this.generalTop = Number(view.getBigUint64(8, true));
    this.vectorTop = Number(view.getBigUint64(16, true));
    this.generalOffset = view.getInt32(24, true);
    this.vectorOffset = view.getInt32(28, true);
  }

  nextGeneral(): bigint {
    if (this.generalOffset < 0) {
      const address = this.generalTop + this.generalOffset;
      this.generalOffset += GENERAL_REGISTER_SLOT_SIZE;
      return readGuestU64(this.memory, address);
    }
    return this.nextStackValue();
  }

  nextFloating(): bigint {
    if (this.vectorOffset < 0) {
      const address = this.vectorTop + this.vectorOffset;
      this.vectorOffset += VECTOR_REGISTER_SLOT_SIZE;
      return readGuestU64(this.memory, address);
    }
    return this.nextStackValue();
  }

  private nextStackValue(): bigint {
    const address = alignGuestAddress(this.stack, GENERAL_REGISTER_SLOT_SIZE);
    this.stack = address + GENERAL_REGISTER_SLOT_SIZE;
    return readGuestU64(this.memory, address);
  }
}
