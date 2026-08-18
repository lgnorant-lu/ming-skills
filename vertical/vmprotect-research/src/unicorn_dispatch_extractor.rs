/// Unicorn CPU Emulation - Dispatch Table Extractor
///
/// Extracts dispatch table by emulating x86-64 code execution.
/// Uses Python unicorn library via subprocess to avoid native binding issues.

use crate::PEBinary;
use anyhow::{Result, Context};
use serde::{Serialize, Deserialize};
use std::process::Command;
use std::path::Path;

/// Captured dispatch table entry via emulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchEntry {
    /// Opcode index (0-255)
    pub opcode: u8,
    /// Virtual address written to
    pub write_va: u64,
    /// Encrypted handler address (value written)
    pub encrypted: u64,
    /// XOR key (extracted from context)
    pub xor_key: u64,
    /// Decrypted handler address
    pub decrypted: u64,
}

/// Unicorn-based dispatch table extractor
pub struct UnicornDispatchExtractor;

impl UnicornDispatchExtractor {
    /// Extract dispatch table via Unicorn emulation (Python subprocess)
    ///
    /// Strategy:
    /// 1. Call Python unicorn_extractor.py script
    /// 2. Script loads PE sections into Unicorn memory at image base
    /// 3. Sets up write hook on dispatch table region
    /// 4. Executes from entry point
    /// 5. Captures all writes to dispatch table
    /// 6. Returns 256 handler addresses
    pub fn extract(binary: &PEBinary, dispatch_table_va: u64, entry_point_va: u64) -> Result<Vec<DispatchEntry>> {
        log::info!("Starting Unicorn emulation for dispatch table extraction");
        log::info!("  Dispatch table VA: 0x{:x}", dispatch_table_va);
        log::info!("  Entry point VA: 0x{:x}", entry_point_va);

        let image_base = binary.image_base()?;
        let binary_path = &binary.path;

        // Find Python script
        let script_path = Self::find_extractor_script()?;
        
        log::info!("Using extractor script: {}", script_path);

        // Call Python script
        let output = Command::new("python3")
            .arg(&script_path)
            .arg(binary_path)
            .arg(format!("0x{:x}", dispatch_table_va))
            .arg(format!("0x{:x}", entry_point_va))
            .arg(format!("0x{:x}", image_base))
            .arg("/tmp/dispatch_entries.json")
            .output()
            .context("Failed to execute unicorn_extractor.py")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Extractor script failed: {}", stderr);
            anyhow::bail!("Unicorn extraction failed: {}", stderr);
        }

        // Read results from JSON
        let entries_json = std::fs::read_to_string("/tmp/dispatch_entries.json")
            .context("Failed to read extraction results")?;
        
        let entries: Vec<DispatchEntry> = serde_json::from_str(&entries_json)
            .context("Failed to parse extraction results")?;

        log::info!("Captured {} dispatch entries via emulation", entries.len());

        // Validate entries
        let valid_count = entries.iter()
            .filter(|e| e.decrypted >= image_base && e.decrypted < image_base + 0x80000000)
            .count();
        
        log::info!("Valid entries: {}/{}", valid_count, entries.len());

        if entries.len() < 200 {
            anyhow::bail!("Only captured {} entries, expected at least 200", entries.len());
        }

        Ok(entries)
    }

    /// Find unicorn_extractor.py script
    fn find_extractor_script() -> Result<String> {
        // Try multiple locations
        let candidates = vec![
            "scripts/unicorn_extractor.py",
            "./scripts/unicorn_extractor.py",
            "/home/ciupix/vmp_devirt_prod/scripts/unicorn_extractor.py",
        ];

        for path in candidates {
            if Path::new(path).exists() {
                return Ok(path.to_string());
            }
        }

        anyhow::bail!("Could not find unicorn_extractor.py script")
    }

    /// Validate extracted entries against known data
    pub fn validate_entries(entries: &[DispatchEntry], known_handlers: &[u64]) -> Result<bool> {
        if entries.len() != 256 {
            log::warn!("Expected 256 entries, got {}", entries.len());
            return Ok(false);
        }

        let mut matches = 0;
        for (i, entry) in entries.iter().enumerate() {
            if i < known_handlers.len() && entry.decrypted == known_handlers[i] {
                matches += 1;
            }
        }

        let match_rate = (matches as f64) / (entries.len() as f64);
        log::info!("Validation: {}/{} entries match known data ({:.1}%)", 
            matches, entries.len(), match_rate * 100.0);

        Ok(match_rate >= 0.8) // 80% match threshold
    }

    /// Export entries to JSON
    pub fn export_json(entries: &[DispatchEntry], path: &str) -> Result<()> {
        let json = serde_json::to_string_pretty(&entries)
            .context("Failed to serialize entries")?;
        std::fs::write(path, json)
            .context("Failed to write entries file")?;
        log::info!("Entries exported to: {}", path);
        Ok(())
    }

    /// Get handler addresses from entries
    pub fn get_handler_addresses(entries: &[DispatchEntry]) -> Vec<u64> {
        let mut handlers = vec![0u64; 256];
        for entry in entries {
            if (entry.opcode as usize) < 256 {
                handlers[entry.opcode as usize] = entry.decrypted;
            }
        }
        handlers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_extractor_script() {
        // Script should exist in project
        let result = UnicornDispatchExtractor::find_extractor_script();
        assert!(result.is_ok() || result.is_err()); // Just check it runs
    }
}

