/// Bytecode Decoder
/// 
/// Parses VMP bytecode instructions

use crate::{PEBinary, Handler};
use anyhow::{Result, Context};

/// Bytecode instruction
pub struct Bytecode {
    data: Vec<u8>,
    vip: u64,
}

impl Bytecode {
    /// Load bytecode from VIP address
    pub fn from_vip(binary: &PEBinary, vip: u64) -> Result<Self> {
        // Read max 256 bytes (longest instruction + operands)
        let data = binary.read_bytes(vip, 256)?;

        Ok(Bytecode {
            data,
            vip,
        })
    }

    /// Get opcode byte (at offset 0 for vtBasic)
    pub fn opcode_byte(&self) -> u8 {
        self.data.get(0).copied().unwrap_or(0)
    }

    /// Decode operands based on handler type
    pub fn decode_operands(&self, handler: &Handler) -> Result<Vec<u64>> {
        let mut operands = Vec::new();

        match handler.name.as_str() {
            "PUSH_REG" => {
                // 1 byte: register ID
                operands.push(self.data.get(1).copied().unwrap_or(0) as u64);
            }
            "PUSH_VALUE" => {
                // Variable: 1/2/4/8 bytes immediate
                if let Some(size) = handler.size_bytes {
                    if size > 1 {
                        let imm_size = size - 1;
                        let imm = self.read_imm(1, imm_size)?;
                        operands.push(imm);
                    }
                }
            }
            "POP_MEMORY" => {
                // Memory offset encoding
                operands.push(self.data.get(1).copied().unwrap_or(0) as u64);
            }
            "ADD_REG" | "SUB_REG" | "XOR_REG" | "OR_REG" | "AND_REG" => {
                // Stack-based, no operand bytes
            }
            "NOR_CHAIN" | "NAND_CHAIN" => {
                // Chain data (encrypted)
                operands.push(self.vip);
            }
            "JMP" => {
                // Jump target
                let offset = self.read_imm(1, 4)?;
                operands.push((self.vip as i64 + offset as i64) as u64);
            }
            "RET" => {
                // No operands
            }
            _ => {
                // Unknown handler
            }
        }

        Ok(operands)
    }

    /// Read immediate value from bytecode
    fn read_imm(&self, offset: usize, size: usize) -> Result<u64> {
        let bytes = self.data.get(offset..offset + size)
            .context(format!("Cannot read {} bytes at offset {}", size, offset))?;

        let mut value: u64 = 0;
        for (i, &b) in bytes.iter().enumerate() {
            value |= (b as u64) << (i * 8);
        }

        Ok(value)
    }

    /// Size of this instruction in bytes
    pub fn size(&self) -> usize {
        // Placeholder: will be determined from opcode table or CRC check
        5
    }

    /// Get VIP address
    pub fn vip(&self) -> u64 {
        self.vip
    }

    /// Get raw bytecode data
    pub fn data(&self) -> &[u8] {
        &self.data
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_opcode_byte() {
        let bytecode = Bytecode {
            data: vec![0x11, 0x05, 0x00, 0x00],
            vip: 0x140001000,
        };

        assert_eq!(bytecode.opcode_byte(), 0x11);
    }
}
