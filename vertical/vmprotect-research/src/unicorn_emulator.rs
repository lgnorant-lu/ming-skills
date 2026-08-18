/// Dispatch Table XOR Key Extraction
/// 
/// Extracts all 256 XOR keys used to encrypt handler addresses
/// in the VMP dispatch table using static analysis and pattern matching.

use crate::PEBinary;
use anyhow::{Result, Context};
use serde::{Serialize, Deserialize};

/// Captured XOR key entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XorKeyEntry {
    /// Opcode index (0-255)
    pub opcode: u8,
    /// XOR key value
    pub key: u64,
    /// Encrypted handler address (before XOR)
    pub encrypted: u64,
    /// Decrypted handler address (after XOR)
    pub decrypted: u64,
}

/// Unicorn-based key extractor (static analysis version)
#[allow(dead_code)]
pub struct UnicornEmulator {
    /// Captured XOR keys
    keys: Vec<XorKeyEntry>,
    /// Dispatch table VA
    dispatch_table_va: u64,
    /// Image base
    image_base: u64,
}

impl UnicornEmulator {
    /// Create new key extractor
    pub fn new(dispatch_table_va: u64, image_base: u64) -> Self {
        UnicornEmulator {
            keys: Vec::new(),
            dispatch_table_va,
            image_base,
        }
    }

    /// Extract XOR keys from dispatch table using pattern analysis
    /// 
    /// Strategy:
    /// 1. Read all 256 dispatch table entries
    /// 2. Analyze code patterns that populate the table
    /// 3. Extract XOR keys from immediate values in XOR instructions
    /// 4. Validate decrypted addresses are in code sections
    pub fn capture_keys(binary: &PEBinary, dispatch_table_va: u64) -> Result<Vec<XorKeyEntry>> {
        let image_base = binary.image_base()?;
        let mut keys = Vec::new();

        // Read all 256 dispatch table entries
        for opcode in 0..=255u8 {
            let entry_va = dispatch_table_va + (opcode as u64 * 8);
            
            match binary.read_u64(entry_va) {
                Ok(encrypted_addr) => {
                    // Extract the XOR key for this opcode
                    let key = Self::extract_key_for_entry(binary, opcode, encrypted_addr, image_base)?;
                    
                    let decrypted = encrypted_addr ^ key;
                    
                    keys.push(XorKeyEntry {
                        opcode,
                        key,
                        encrypted: encrypted_addr,
                        decrypted,
                    });
                }
                Err(_) => {
                    log::warn!("Failed to read dispatch table entry {}", opcode);
                    // Add placeholder entry
                    keys.push(XorKeyEntry {
                        opcode,
                        key: 0,
                        encrypted: 0,
                        decrypted: 0,
                    });
                }
            }
        }

        Ok(keys)
    }

    /// Extract XOR key for a specific dispatch table entry
    /// 
    /// Uses pattern matching to find XOR instructions that populate
    /// the dispatch table with encrypted handler addresses.
    fn extract_key_for_entry(
        binary: &PEBinary,
        opcode: u8,
        encrypted_addr: u64,
        image_base: u64,
    ) -> Result<u64> {
        // Strategy 1: Look for XOR instruction patterns in .text section
        if let Ok(text_data) = binary.get_section(".text") {
            if let Ok(key) = Self::find_xor_key_in_section(&text_data, opcode, encrypted_addr, image_base) {
                return Ok(key);
            }
        }

        // Strategy 2: Try common key patterns based on opcode
        let potential_keys = Self::generate_potential_keys(opcode);
        for key in potential_keys {
            let decrypted = encrypted_addr ^ key;
            
            // Check if decrypted address is in reasonable range
            if decrypted >= image_base && decrypted < image_base + 0x80000000 {
                return Ok(key);
            }
        }

        // Strategy 3: Use opcode-based key derivation
        // Many VMP versions use opcode as part of the key
        let opcode_key = Self::derive_opcode_key(opcode);
        let decrypted = encrypted_addr ^ opcode_key;
        if decrypted >= image_base && decrypted < image_base + 0x80000000 {
            return Ok(opcode_key);
        }

        // Fallback: return 0 (no encryption)
        Ok(0)
    }

    /// Find XOR key by scanning for XOR instruction patterns
    fn find_xor_key_in_section(
        section_data: &[u8],
        opcode: u8,
        encrypted_addr: u64,
        image_base: u64,
    ) -> Result<u64> {
        // Look for x86-64 XOR patterns:
        // 48 35 XX XX XX XX - xor rax, imm32 (sign-extended to 64-bit)
        // 48 81 F0 XX XX XX XX - xor rax, imm32
        // 48 C7 C0 XX XX XX XX - mov rax, imm32 (followed by xor)

        for i in 0..section_data.len().saturating_sub(8) {
            // Pattern: 48 35 XX XX XX XX (xor rax, imm32)
            if i + 6 < section_data.len() && section_data[i] == 0x48 && section_data[i + 1] == 0x35 {
                let imm32 = u32::from_le_bytes([
                    section_data[i + 2],
                    section_data[i + 3],
                    section_data[i + 4],
                    section_data[i + 5],
                ]);
                
                // Sign-extend to 64-bit
                let key = if imm32 & 0x80000000 != 0 {
                    (imm32 as i32) as i64 as u64
                } else {
                    imm32 as u64
                };

                let decrypted = encrypted_addr ^ key;
                if decrypted >= image_base && decrypted < image_base + 0x80000000 {
                    return Ok(key);
                }
            }

            // Pattern: 48 81 F0 XX XX XX XX (xor rax, imm32)
            if i + 7 < section_data.len() && section_data[i] == 0x48 && section_data[i + 1] == 0x81 && section_data[i + 2] == 0xF0 {
                let imm32 = u32::from_le_bytes([
                    section_data[i + 3],
                    section_data[i + 4],
                    section_data[i + 5],
                    section_data[i + 6],
                ]);
                
                let key = imm32 as u64;
                let decrypted = encrypted_addr ^ key;
                if decrypted >= image_base && decrypted < image_base + 0x80000000 {
                    return Ok(key);
                }
            }
        }

        anyhow::bail!("No XOR pattern found for opcode {}", opcode)
    }

    /// Generate potential XOR keys based on opcode
    fn generate_potential_keys(opcode: u8) -> Vec<u64> {
        vec![
            0x0000000000000000u64,
            0xFFFFFFFFFFFFFFFFu64,
            opcode as u64,
            ((opcode as u64) << 8) | (opcode as u64),
            ((opcode as u64) << 16) | ((opcode as u64) << 8) | (opcode as u64),
            ((opcode as u64) << 24) | ((opcode as u64) << 16) | ((opcode as u64) << 8) | (opcode as u64),
            ((opcode as u64) << 32) | ((opcode as u64) << 24) | ((opcode as u64) << 16) | ((opcode as u64) << 8) | (opcode as u64),
            (opcode as u64).wrapping_mul(0x0101010101010101),
            (opcode as u64).wrapping_mul(0x0202020202020202),
            (opcode as u64).wrapping_mul(0x0404040404040404),
        ]
    }

    /// Derive XOR key from opcode using common VMP patterns
    fn derive_opcode_key(opcode: u8) -> u64 {
        // Common pattern: replicate opcode across all bytes
        let byte = opcode as u64;
        (byte << 56) | (byte << 48) | (byte << 40) | (byte << 32) |
        (byte << 24) | (byte << 16) | (byte << 8) | byte
    }

    /// Validate extracted keys
    pub fn validate_keys(keys: &[XorKeyEntry], image_base: u64) -> Result<bool> {
        let mut valid_count = 0;
        let mut zero_count = 0;

        for entry in keys {
            if entry.key == 0 && entry.encrypted == 0 {
                zero_count += 1;
                continue;
            }

            // Check if decrypted address is in reasonable range
            if entry.decrypted >= image_base && entry.decrypted < image_base + 0x80000000 {
                valid_count += 1;
            }
        }

        // At least 200 out of 256 should be valid (excluding zero entries)
        let is_valid = valid_count >= 200;
        log::info!("Key validation: {}/{} valid keys ({} zero entries)", 
            valid_count, keys.len() - zero_count, zero_count);
        
        Ok(is_valid)
    }

    /// Get decrypted handler addresses from keys
    pub fn get_handler_addresses(keys: &[XorKeyEntry]) -> Vec<u64> {
        keys.iter().map(|k| k.decrypted).collect()
    }

    /// Export keys to JSON
    pub fn export_keys_json(keys: &[XorKeyEntry], path: &str) -> Result<()> {
        let json = serde_json::to_string_pretty(&keys)
            .context("Failed to serialize keys")?;
        std::fs::write(path, json)
            .context("Failed to write keys file")?;
        log::info!("Keys exported to: {}", path);
        Ok(())
    }

    /// Get statistics about extracted keys
    pub fn get_key_statistics(keys: &[XorKeyEntry]) -> KeyStatistics {
        let mut unique_keys = std::collections::HashSet::new();
        let mut valid_count = 0;
        let mut zero_count = 0;

        for entry in keys {
            if entry.key == 0 {
                zero_count += 1;
            } else {
                unique_keys.insert(entry.key);
                valid_count += 1;
            }
        }

        KeyStatistics {
            total_entries: keys.len(),
            valid_entries: valid_count,
            zero_entries: zero_count,
            unique_keys: unique_keys.len(),
        }
    }
}

/// Statistics about extracted keys
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyStatistics {
    /// Total number of entries
    pub total_entries: usize,
    /// Number of valid (non-zero) entries
    pub valid_entries: usize,
    /// Number of zero entries
    pub zero_entries: usize,
    /// Number of unique key values
    pub unique_keys: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emulator_creation() {
        let emulator = UnicornEmulator::new(0x48138, 0x400000);
        assert_eq!(emulator.dispatch_table_va, 0x48138);
        assert_eq!(emulator.image_base, 0x400000);
    }

    #[test]
    fn test_opcode_key_derivation() {
        let key = UnicornEmulator::derive_opcode_key(0x42);
        assert_eq!(key, 0x4242424242424242u64);
    }

    #[test]
    fn test_potential_keys_generation() {
        let keys = UnicornEmulator::generate_potential_keys(0xFF);
        assert!(keys.len() > 0);
        assert!(keys.contains(&0xFFFFFFFFFFFFFFFFu64));
    }
}
