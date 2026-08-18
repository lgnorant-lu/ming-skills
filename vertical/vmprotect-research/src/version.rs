/// VMP Version Detection
/// 
/// Identifies VMProtect version from binary structure

use crate::PEBinary;
use anyhow::Result;

/// Supported VMP versions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VmpVersion {
    /// VMProtect 1.x
    Vmp1,
    /// VMProtect 2.x
    Vmp2,
    /// VMProtect 3.0-3.4
    Vmp30,
    /// VMProtect 3.5.0-3.5.1
    Vmp35,
    /// VMProtect 3.6-3.10.5
    Vmp36Plus,
    /// Unknown version
    Unknown,
}

impl VmpVersion {
    /// Get version string
    pub fn as_str(&self) -> &'static str {
        match self {
            VmpVersion::Vmp1 => "VMP 1.x",
            VmpVersion::Vmp2 => "VMP 2.x",
            VmpVersion::Vmp30 => "VMP 3.0-3.4",
            VmpVersion::Vmp35 => "VMP 3.5.0-3.5.1",
            VmpVersion::Vmp36Plus => "VMP 3.6-3.10.5",
            VmpVersion::Unknown => "Unknown",
        }
    }
}

/// VMP Version Detector
pub struct VersionDetector;

impl VersionDetector {
    /// Detect VMP version from binary
    pub fn detect(binary: &PEBinary) -> Result<VmpVersion> {
        // Check for VMP 3.5.1 (.vmp0/.vmp1 sections)
        if Self::has_vmp35_sections(binary)? {
            return Ok(VmpVersion::Vmp35);
        }

        // Check for VMP 3.6+ sections
        if Self::has_vmp36_sections(binary)? {
            return Ok(VmpVersion::Vmp36Plus);
        }

        // Check for VMP 3.0-3.4 sections
        if Self::has_vmp30_sections(binary)? {
            return Ok(VmpVersion::Vmp30);
        }

        // Check for VMP 2.x sections
        if Self::has_vmp2_sections(binary)? {
            return Ok(VmpVersion::Vmp2);
        }

        // Check for VMP 1.x sections
        if Self::has_vmp1_sections(binary)? {
            return Ok(VmpVersion::Vmp1);
        }

        Ok(VmpVersion::Unknown)
    }

    /// Check for VMP 3.5.1 signature (.vmp0/.vmp1 sections)
    fn has_vmp35_sections(binary: &PEBinary) -> Result<bool> {
        // VMP 3.5.1 has .vmp0 and .vmp1 sections
        let has_vmp0 = binary.get_section(".vmp0").is_ok();
        let has_vmp1 = binary.get_section(".vmp1").is_ok();

        Ok(has_vmp0 && has_vmp1)
    }

    /// Check for VMP 3.6+ signature
    fn has_vmp36_sections(binary: &PEBinary) -> Result<bool> {
        // VMP 3.6+ has different section structure than 3.5.1
        // Check for single vmp section (not both vmp0 and vmp1)
        let has_vmp0 = binary.get_section(".vmp0").is_ok();
        let has_vmp1 = binary.get_section(".vmp1").is_ok();

        // VMP 3.6+ may have .vmp0 XOR .vmp1 but not both
        if (has_vmp0 || has_vmp1) && !(has_vmp0 && has_vmp1) {
            return Ok(true);
        }

        // Check for other VMP 3.6+ markers (empirical)
        let sections = binary.get_all_sections()?;
        let has_text = sections.iter().any(|s| s == ".text");
        let has_rdata = sections.iter().any(|s| s == ".rdata");
        
        // VMP 3.6+ typically has standard sections + vmp markers
        Ok(has_text && has_rdata && sections.len() > 5)
    }

    /// Check for VMP 3.0-3.4 signature
    fn has_vmp30_sections(binary: &PEBinary) -> Result<bool> {
        // VMP 3.0-3.4 has standard PE sections (no .vmp0/.vmp1)
        // Detect by absence of 3.5.1 markers + presence of standard sections
        let has_vmp0 = binary.get_section(".vmp0").is_ok();
        let has_vmp1 = binary.get_section(".vmp1").is_ok();

        // Not 3.5.1 (no both vmp0 and vmp1)
        if has_vmp0 && has_vmp1 {
            return Ok(false);
        }

        // Check for standard VMP 3.x sections
        let sections = binary.get_all_sections()?;
        let has_text = sections.iter().any(|s| s == ".text");
        let has_rdata = sections.iter().any(|s| s == ".rdata");
        
        // VMP 3.0-3.4: standard sections, no vmp markers
        Ok(has_text && has_rdata && !has_vmp0 && !has_vmp1)
    }

    /// Check for VMP 2.x signature
    fn has_vmp2_sections(_binary: &PEBinary) -> Result<bool> {
        // VMP 2.x has different section structure
        // Placeholder for version 2.x detection
        Ok(false)
    }

    /// Check for VMP 1.x signature
    fn has_vmp1_sections(_binary: &PEBinary) -> Result<bool> {
        // VMP 1.x has different section structure
        // Placeholder for version 1.x detection
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_string() {
        assert_eq!(VmpVersion::Vmp35.as_str(), "VMP 3.5.0-3.5.1");
        assert_eq!(VmpVersion::Vmp36Plus.as_str(), "VMP 3.6-3.10.5");
    }
}
