#![deny(dead_code)]
#![deny(unused_variables)]
#![warn(missing_docs)]

/// VMP Devirtualizer - Production Core
/// 
/// Supports VMProtect versions 1.0 → 3.10.5
/// 
/// # Architecture
/// - PE loader: Binary parsing, VA mapping
/// - Version detector: Identify VMP version
/// - Opcode table: Dispatch table management
/// - Bytecode decoder: Instruction parsing
/// - Operand decryption: CRC-based decryption
/// - ALU reconstructor: NOR/NAND → arithmetic

use anyhow::{Result, Context};
use std::path::Path;
use std::collections::HashMap;

pub mod version;
pub mod pe_loader;
pub mod opcode_table;
pub mod bytecode;
pub mod decrypt;
pub mod alu;
pub mod dispatch_table;
pub mod handler_classifier;
pub mod unicorn_emulator;
pub mod unicorn_dispatch_extractor;

pub use version::{VmpVersion, VersionDetector};
pub use pe_loader::PEBinary;
pub use opcode_table::{OpcodeTable, Handler};
pub use bytecode::Bytecode;
pub use decrypt::OpcodeCryptor;
pub use alu::{ALUReconstructor, ALUOp};
pub use dispatch_table::DispatchTableLocator;
pub use handler_classifier::{HandlerClassifier, HandlerClassification};
pub use unicorn_emulator::{UnicornEmulator, XorKeyEntry};
pub use unicorn_dispatch_extractor::{UnicornDispatchExtractor, DispatchEntry};

/// Main VMP Devirtualizer
pub struct VmpDevirtualizer {
    binary: PEBinary,
    version: VmpVersion,
    opcode_table: OpcodeTable,
    dispatch_table_va: Option<u64>,
    handler_classifications: Vec<HandlerClassification>,
}

impl VmpDevirtualizer {
    /// Load binary and detect VMP version
    pub fn new(binary_path: impl AsRef<Path>) -> Result<Self> {
        let binary = PEBinary::load(binary_path)
            .context("Failed to load PE binary")?;

        let version = VersionDetector::detect(&binary)
            .context("Failed to detect VMP version")?;

        let mut opcode_table = OpcodeTable::new();
        let mut dispatch_table_va = None;
        let mut handler_classifications = Vec::new();

        // Try to locate and extract dispatch table
        match DispatchTableLocator::locate(&binary) {
            Ok(dt_va) => {
                log::info!("Found dispatch table at VA: 0x{:x}", dt_va);
                dispatch_table_va = Some(dt_va);

                // Extract all 256 handler addresses
                match DispatchTableLocator::extract_handlers(&binary, dt_va) {
                    Ok(handlers) => {
                        log::info!("Extracted {} handler addresses", handlers.len());

                        // Validate dispatch table
                        match DispatchTableLocator::validate(&binary, &handlers) {
                            Ok(true) => {
                                log::info!("Dispatch table validation passed");

                                // Classify all handlers
                                match HandlerClassifier::classify_all(&binary, &handlers) {
                                    Ok(classifications) => {
                                        log::info!("Classified {} handlers", classifications.len());
                                        
                                        // Populate opcode table with classifications
                                        for (opcode, classification) in classifications.iter().enumerate() {
                                            if opcode <= 255 {
                                                opcode_table.register(opcode as u8, Handler {
                                                    name: classification.handler_type.clone(),
                                                    opcode: opcode as u8,
                                                    size_bytes: Some(classification.size),
                                                });
                                            }
                                        }

                                        handler_classifications = classifications;
                                    }
                                    Err(e) => {
                                        log::warn!("Failed to classify handlers: {}", e);
                                    }
                                }
                            }
                            Ok(false) => {
                                log::warn!("Dispatch table validation failed");
                            }
                            Err(e) => {
                                log::warn!("Error validating dispatch table: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to extract handlers: {}", e);
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to locate dispatch table: {}", e);
            }
        }

        Ok(VmpDevirtualizer {
            binary,
            version,
            opcode_table,
            dispatch_table_va,
            handler_classifications,
        })
    }

    /// Get detected VMP version
    pub fn version(&self) -> VmpVersion {
        self.version
    }

    /// Get PE binary reference
    pub fn binary(&self) -> &PEBinary {
        &self.binary
    }

    /// Get dispatch table VA
    pub fn dispatch_table_va(&self) -> Option<u64> {
        self.dispatch_table_va
    }

    /// Get handler classifications
    pub fn handler_classifications(&self) -> &[HandlerClassification] {
        &self.handler_classifications
    }

    /// Get handler statistics
    pub fn handler_statistics(&self) -> HashMap<String, usize> {
        HandlerClassifier::get_statistics(&self.handler_classifications)
    }

    /// Export opcode table as JSON
    pub fn export_opcode_table(&self, path: &str) -> Result<()> {
        self.opcode_table.to_json(path)
            .context("Failed to export opcode table")?;
        log::info!("Opcode table exported to: {}", path);
        Ok(())
    }

    /// Export handler classifications as JSON
    pub fn export_handler_classifications(&self, path: &str) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.handler_classifications)
            .context("Failed to serialize classifications")?;
        std::fs::write(path, json)
            .context("Failed to write classifications file")?;
        log::info!("Handler classifications exported to: {}", path);
        Ok(())
    }

    /// Decode instruction at VIP address
    pub fn decode_instruction(&self, vip: u64) -> Result<DecodedInstruction> {
        let bytecode = Bytecode::from_vip(&self.binary, vip)?;
        let opcode_slot = bytecode.opcode_byte();

        let handler = self.opcode_table.lookup(opcode_slot)
            .context(format!("Unknown opcode: 0x{:02x}", opcode_slot))?;

        let operands = bytecode.decode_operands(&handler)?;

        Ok(DecodedInstruction {
            vip,
            opcode: opcode_slot,
            handler,
            operands,
            size: bytecode.size(),
        })
    }

    /// Devirtualize instruction range
    pub fn devirtualize_range(&self, start_vip: u64, end_vip: u64) -> Result<Vec<DecodedInstruction>> {
        let mut instructions = Vec::new();
        let mut vip = start_vip;

        while vip < end_vip {
            match self.decode_instruction(vip) {
                Ok(instr) => {
                    vip += instr.size as u64;
                    instructions.push(instr);
                }
                Err(e) => {
                    log::warn!("Error at VIP 0x{:x}: {}", vip, e);
                    break;
                }
            }
        }

        Ok(instructions)
    }
}

/// Decoded instruction
#[derive(Debug, Clone)]
pub struct DecodedInstruction {
    /// Virtual instruction pointer
    pub vip: u64,
    /// Opcode slot byte
    pub opcode: u8,
    /// Handler type
    pub handler: Handler,
    /// Operand values
    pub operands: Vec<u64>,
    /// Instruction size in bytes
    pub size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_detection() {
        // Test will be implemented after version detector
    }
}
