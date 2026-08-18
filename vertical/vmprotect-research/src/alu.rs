/// ALU Reconstruction
/// 
/// Reconstructs arithmetic operations from NOR/NAND chains

use std::collections::HashMap;

/// ALU operation types
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ALUOp {
    /// Addition
    Add,
    /// Subtraction
    Sub,
    /// XOR
    Xor,
    /// OR
    Or,
    /// AND
    And,
    /// NOT
    Not,
    /// Shift left
    Shl,
    /// Shift right
    Shr,
}

/// ALU chain reconstructor
pub struct ALUReconstructor {
    patterns: HashMap<Vec<String>, ALUOp>,
}

impl ALUReconstructor {
    /// Create new ALU reconstructor
    pub fn new() -> Self {
        let mut patterns = HashMap::new();

        // NOR truth table: NOR(a,b) = !(a | b)
        // NAND truth table: NAND(a,b) = !(a & b)

        // Pattern: 4x NOR → ADD (De Morgan's law composition)
        patterns.insert(
            vec!["NOR".to_string(); 4],
            ALUOp::Add,
        );

        // Pattern: 2x NAND → AND (De Morgan's law)
        patterns.insert(
            vec!["NAND".to_string(), "NAND".to_string()],
            ALUOp::And,
        );

        // Pattern: Single NOR → NOT
        patterns.insert(
            vec!["NOR".to_string()],
            ALUOp::Not,
        );

        // Pattern: 3x NOR → SUB
        patterns.insert(
            vec!["NOR".to_string(); 3],
            ALUOp::Sub,
        );

        ALUReconstructor { patterns }
    }

    /// Match chain of operations to ALU type
    pub fn match_chain(&self, chain: &[String]) -> Option<ALUOp> {
        self.patterns.get(chain).cloned()
    }

    /// Decompose NOR/NAND chain to operands and operation
    pub fn decompose_chain(&self, chain: &[String]) -> Option<(String, String, ALUOp)> {
        if chain.len() >= 2 {
            let op1 = "stack_val_1".to_string();
            let op2 = "stack_val_2".to_string();
            let alu_op = self.match_chain(chain)?;
            Some((op1, op2, alu_op))
        } else {
            None
        }
    }

    /// Check if sequence is valid NOR/NAND chain
    pub fn is_valid_chain(chain: &[String]) -> bool {
        chain.iter().all(|op| op == "NOR" || op == "NAND")
    }
}

impl Default for ALUReconstructor {
    fn default() -> Self {
        Self::new()
    }
}

/// Handler context for ALU chain
#[derive(Debug, Clone)]
pub struct HandlerContext {
    /// Handler name
    pub handler_name: String,
    /// Opcode slot byte
    pub opcode: u8,
    /// Size in bytes
    pub size_bytes: usize,
    /// Operand chain
    pub operand_chain: Vec<String>,
}

impl HandlerContext {
    /// Check if handler is ALU chain
    pub fn is_alu_chain(&self) -> bool {
        self.handler_name.contains("NOR") || self.handler_name.contains("NAND")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pattern_matching() {
        let reconstructor = ALUReconstructor::new();

        let chain = vec!["NOR".to_string(); 4];
        let op = reconstructor.match_chain(&chain);

        assert_eq!(op, Some(ALUOp::Add));
    }

    #[test]
    fn test_nor_not() {
        let reconstructor = ALUReconstructor::new();

        let chain = vec!["NOR".to_string()];
        let op = reconstructor.match_chain(&chain);

        assert_eq!(op, Some(ALUOp::Not));
    }

    #[test]
    fn test_nand_and() {
        let reconstructor = ALUReconstructor::new();

        let chain = vec!["NAND".to_string(), "NAND".to_string()];
        let op = reconstructor.match_chain(&chain);

        assert_eq!(op, Some(ALUOp::And));
    }
}
