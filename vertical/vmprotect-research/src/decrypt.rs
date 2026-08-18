/// Operand Decryption
/// 
/// CRC-based operand decryption for VMP bytecode

/// Opcode cryptor for operand decryption
pub struct OpcodeCryptor {
    crc_value: u64,
}

impl OpcodeCryptor {
    /// Create new cryptor
    pub fn new() -> Self {
        OpcodeCryptor { crc_value: 0 }
    }

    /// Initialize CRC from section start address
    pub fn init_from_section(&mut self, start_vip: u64) {
        self.crc_value = start_vip;
    }

    /// Decrypt operand byte using current CRC state
    pub fn decrypt_operand(&self, encrypted_byte: u8, _cryptor_size: usize) -> u8 {
        let crc_low = (self.crc_value & 0xFF) as u8;
        encrypted_byte ^ crc_low
    }

    /// Update CRC after reading operand
    pub fn update_crc(&mut self, operand_value: u8) {
        self.crc_value = self.crc_value.wrapping_mul(31).wrapping_add(operand_value as u64);
    }

    /// Decrypt operand sequence (1/2/4/8 bytes)
    pub fn decrypt_operands(&mut self, encrypted: &[u8]) -> Vec<u8> {
        let mut decrypted = Vec::new();

        for &byte in encrypted {
            let dec = self.decrypt_operand(byte, 1);
            decrypted.push(dec);
            self.update_crc(dec);
        }

        decrypted
    }

    /// Decrypt u32 value (little-endian)
    pub fn decrypt_value_u32(&mut self, encrypted: &[u8; 4]) -> u32 {
        let decrypted = self.decrypt_operands(encrypted);
        u32::from_le_bytes([decrypted[0], decrypted[1], decrypted[2], decrypted[3]])
    }

    /// Decrypt u64 value (little-endian)
    pub fn decrypt_value_u64(&mut self, encrypted: &[u8; 8]) -> u64 {
        let decrypted = self.decrypt_operands(encrypted);
        u64::from_le_bytes([
            decrypted[0], decrypted[1], decrypted[2], decrypted[3],
            decrypted[4], decrypted[5], decrypted[6], decrypted[7],
        ])
    }

    /// Get current CRC value
    pub fn get_crc(&self) -> u64 {
        self.crc_value
    }

    /// Set CRC value
    pub fn set_crc(&mut self, value: u64) {
        self.crc_value = value;
    }
}

impl Default for OpcodeCryptor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decrypt_operand() {
        let cryptor = OpcodeCryptor::new();
        let encrypted = 0x42u8;
        let decrypted = cryptor.decrypt_operand(encrypted, 1);

        // Value should change based on CRC
        assert_ne!(decrypted, encrypted);
    }

    #[test]
    fn test_crc_update() {
        let mut cryptor = OpcodeCryptor::new();
        let initial_crc = cryptor.get_crc();

        cryptor.update_crc(0x11);
        let after_update = cryptor.get_crc();

        assert_ne!(after_update, initial_crc);
    }
}
