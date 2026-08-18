/// Dispatch Table Locator
/// 
/// Finds and extracts VMP dispatch table from binary

use crate::{PEBinary, UnicornEmulator, UnicornDispatchExtractor};
use anyhow::Result;

/// Dispatch table locator
pub struct DispatchTableLocator;

impl DispatchTableLocator {
    /// Locate dispatch table VA in binary
    /// 
    /// Returns the virtual address of the dispatch table
    pub fn locate(binary: &PEBinary) -> Result<u64> {
        let image_base = binary.image_base()?;
        
        // Known RVA from analysis: 0x48138
        let known_rva = 0x48138u64;
        let dispatch_table_va = image_base + known_rva;
        
        // Verify it's in a valid section
        let pe = binary.parse_pe()?;
        for section in &pe.sections {
            let section_va = image_base + section.virtual_address as u64;
            let section_end = section_va + section.virtual_size as u64;
            
            if dispatch_table_va >= section_va && dispatch_table_va < section_end {
                log::info!("Found dispatch table at VA: 0x{:x} (RVA: 0x{:x})", dispatch_table_va, known_rva);
                return Ok(dispatch_table_va);
            }
        }
        
        // Fallback: try to find dispatch table signature patterns
        // Strategy 1: Look for dispatch table pattern in .text section
        if let Ok(text_data) = binary.get_section(".text") {
            if let Ok(va) = Self::find_dispatch_pattern(&text_data, binary, ".text") {
                return Ok(va);
            }
        }
        
        // Strategy 2: Look in .rdata section
        if let Ok(rdata_data) = binary.get_section(".rdata") {
            if let Ok(va) = Self::find_dispatch_pattern(&rdata_data, binary, ".rdata") {
                return Ok(va);
            }
        }
        
        // Strategy 3: Look in virtualized code sections (VMP 3.x)
        let sections = binary.get_all_sections().unwrap_or_default();
        for section_name in sections {
            if section_name.starts_with(".vmp") || section_name.starts_with(".kbB") {
                if let Ok(section_data) = binary.get_section(&section_name) {
                    if let Ok(va) = Self::find_dispatch_pattern(&section_data, binary, &section_name) {
                        return Ok(va);
                    }
                }
            }
        }
        
        // Fallback: return error - dispatch table not found
        anyhow::bail!("Could not locate dispatch table in any section")
    }
    
    /// Find dispatch table pattern in section data
    fn find_dispatch_pattern(section_data: &[u8], binary: &PEBinary, section_name: &str) -> Result<u64> {
        // Look for patterns that indicate a dispatch table
        // Dispatch tables typically have:
        // - Multiple consecutive pointers/addresses
        // - Regular spacing (4 or 8 bytes)
        // - Addresses pointing to code sections
        
        let image_base = binary.image_base()?;
        let mut potential_tables = Vec::new();
        
        // Scan for sequences of valid code pointers
        // Try both 4-byte and 8-byte entries
        for entry_size in &[4, 8] {
            for i in 0..section_data.len().saturating_sub(256 * entry_size) {
                let mut valid_count = 0;
                
                // Check if next 256 entries look like valid addresses
                for j in 0..256 {
                    let offset = i + j * entry_size;
                    if offset + entry_size > section_data.len() {
                        break;
                    }
                    
                    let addr = if *entry_size == 4 {
                        let bytes = &section_data[offset..offset + 4];
                        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as u64
                    } else {
                        let bytes = &section_data[offset..offset + 8];
                        u64::from_le_bytes([
                            bytes[0], bytes[1], bytes[2], bytes[3],
                            bytes[4], bytes[5], bytes[6], bytes[7],
                        ])
                    };
                    
                    // Check if address is in reasonable range (image base ± 2GB)
                    if addr >= image_base && addr < image_base + 0x80000000 {
                        valid_count += 1;
                    }
                }
                
                if valid_count >= 200 {
                    potential_tables.push((i, valid_count, *entry_size));
                }
            }
        }
        
        if let Some((offset, _, _)) = potential_tables.first() {
            // Get section VA from binary
            let pe = binary.parse_pe()?;
            for section in &pe.sections {
                let sec_name = std::str::from_utf8(&section.name[..])
                    .unwrap_or("")
                    .trim_end_matches('\0');
                
                if sec_name == section_name {
                    let section_va = image_base + section.virtual_address as u64;
                    return Ok(section_va + *offset as u64);
                }
            }
        }
        
        anyhow::bail!("No dispatch table pattern found in {}", section_name)
    }
    
    /// Extract all 256 handler addresses from dispatch table
    /// 
    /// Primary method: Unicorn CPU emulation
    /// Fallback: Static analysis with XOR key extraction
    pub fn extract_handlers(binary: &PEBinary, dispatch_table_va: u64) -> Result<Vec<u64>> {
        let image_base = binary.image_base()?;
        
        // Try primary method: Unicorn emulation
        log::info!("Attempting dispatch table extraction via Unicorn emulation...");
        
        // Get entry point from binary
        let entry_point_va = Self::get_entry_point(binary)?;
        
        match UnicornDispatchExtractor::extract(binary, dispatch_table_va, entry_point_va) {
            Ok(entries) => {
                log::info!("Successfully extracted {} entries via Unicorn", entries.len());
                
                // Validate against known data if available
                if let Ok(known_handlers) = Self::load_known_handlers() {
                    match UnicornDispatchExtractor::validate_entries(&entries, &known_handlers) {
                        Ok(true) => {
                            log::info!("Unicorn extraction validated successfully");
                            return Ok(UnicornDispatchExtractor::get_handler_addresses(&entries));
                        }
                        Ok(false) => {
                            log::warn!("Unicorn extraction validation failed, trying fallback");
                        }
                        Err(e) => {
                            log::warn!("Validation error: {}", e);
                        }
                    }
                } else {
                    // No known data, trust Unicorn extraction
                    return Ok(UnicornDispatchExtractor::get_handler_addresses(&entries));
                }
            }
            Err(e) => {
                log::warn!("Unicorn extraction failed: {}", e);
                log::info!("Falling back to static analysis...");
            }
        }
        
        // Fallback: Static analysis with XOR key extraction
        log::info!("Capturing XOR keys using static analysis...");
        let keys = UnicornEmulator::capture_keys(binary, dispatch_table_va)?;
        
        // Validate keys
        match UnicornEmulator::validate_keys(&keys, image_base) {
            Ok(true) => {
                log::info!("XOR key validation passed");
            }
            Ok(false) => {
                log::warn!("XOR key validation failed - some keys may be incorrect");
            }
            Err(e) => {
                log::warn!("Error validating keys: {}", e);
            }
        }
        
        // Get statistics
        let stats = UnicornEmulator::get_key_statistics(&keys);
        log::info!("Key statistics: {} total, {} valid, {} unique keys", 
            stats.total_entries, stats.valid_entries, stats.unique_keys);
        
        // Return decrypted handler addresses
        Ok(UnicornEmulator::get_handler_addresses(&keys))
    }
    
    /// Get entry point from PE header
    fn get_entry_point(binary: &PEBinary) -> Result<u64> {
        let pe = binary.parse_pe()?;
        let image_base = binary.image_base()?;
        
        let entry_point_rva = pe.header.optional_header
            .map(|oh| oh.standard_fields.address_of_entry_point as u64)
            .unwrap_or(0x1000);
        
        Ok(image_base + entry_point_rva)
    }
    
    /// Load known handlers from dispatch_table_info.json if available
    fn load_known_handlers() -> Result<Vec<u64>> {
        let path = "dispatch_table_info.json";
        if !std::path::Path::new(path).exists() {
            anyhow::bail!("Known handlers file not found");
        }
        
        let data = std::fs::read_to_string(path)?;
        let json: serde_json::Value = serde_json::from_str(&data)?;
        
        let handlers = json["handlers"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("No handlers array in JSON"))?
            .iter()
            .filter_map(|v| v.as_u64())
            .collect();
        
        Ok(handlers)
    }
    
    /// Validate dispatch table (check if addresses are reasonable)
    pub fn validate(binary: &PEBinary, handlers: &[u64]) -> Result<bool> {
        let image_base = binary.image_base()?;
        let mut valid_count = 0;
        
        for &handler_va in handlers {
            if handler_va == 0 {
                continue;
            }
            
            // Check if address is in reasonable range
            if handler_va >= image_base && handler_va < image_base + 0x80000000 {
                valid_count += 1;
            }
        }
        
        // At least 200 out of 256 should be valid
        Ok(valid_count >= 200)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_dispatch_table_locator() {
        // Test will use real binary
    }
}

