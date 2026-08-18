/// Opcode Dispatch Table
/// 
/// Maps opcode slot bytes to handler information

use std::collections::HashMap;
use serde::{Serialize, Deserialize};

/// Handler information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handler {
    /// Handler name
    pub name: String,
    /// Opcode slot byte
    pub opcode: u8,
    /// Typical size in bytes
    pub size_bytes: Option<usize>,
}

/// Opcode dispatch table
pub struct OpcodeTable {
    table: HashMap<u8, Handler>,
}

impl OpcodeTable {
    /// Create new opcode table
    pub fn new() -> Self {
        OpcodeTable {
            table: HashMap::new(),
        }
    }

    /// Register opcode → handler mapping
    pub fn register(&mut self, opcode: u8, handler: Handler) {
        self.table.insert(opcode, handler);
    }

    /// Lookup handler by opcode slot byte
    pub fn lookup(&self, opcode: u8) -> Option<Handler> {
        self.table.get(&opcode).cloned()
    }

    /// Get all registered opcodes
    pub fn opcodes(&self) -> Vec<u8> {
        let mut opcodes: Vec<_> = self.table.keys().copied().collect();
        opcodes.sort();
        opcodes
    }

    /// Get table size
    pub fn len(&self) -> usize {
        self.table.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.table.is_empty()
    }

    /// Load from JSON file
    pub fn from_json(path: &str) -> anyhow::Result<Self> {
        let data = std::fs::read_to_string(path)?;
        let entries: Vec<TraceEntry> = serde_json::from_str(&data)?;

        let mut table = OpcodeTable::new();
        for entry in entries {
            let opcode = u8::from_str_radix(&entry.opcode_byte[2..], 16)?;
            table.register(opcode, Handler {
                name: entry.handler,
                opcode,
                size_bytes: Some(entry.size_bytes),
            });
        }

        Ok(table)
    }

    /// Save to JSON file
    pub fn to_json(&self, path: &str) -> anyhow::Result<()> {
        let entries: Vec<_> = self.table.values()
            .map(|h| TraceEntry {
                opcode_byte: format!("0x{:02x}", h.opcode),
                handler: h.name.clone(),
                size_bytes: h.size_bytes.unwrap_or(5),
            })
            .collect();

        let json = serde_json::to_string_pretty(&entries)?;
        std::fs::write(path, json)?;
        Ok(())
    }
}

impl Default for OpcodeTable {
    fn default() -> Self {
        Self::new()
    }
}

/// Trace entry (for JSON serialization)
#[derive(Debug, Serialize, Deserialize)]
struct TraceEntry {
    opcode_byte: String,
    handler: String,
    size_bytes: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_opcode_table() {
        let mut table = OpcodeTable::new();
        
        table.register(0x11, Handler {
            name: "PUSH_REG".to_string(),
            opcode: 0x11,
            size_bytes: Some(5),
        });

        assert_eq!(table.len(), 1);
        assert!(table.lookup(0x11).is_some());
        assert!(table.lookup(0x22).is_none());
    }
}
