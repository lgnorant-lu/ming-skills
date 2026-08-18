/// VMP Devirtualizer CLI Tool
/// 
/// Command-line interface for devirtualizing VMP-protected binaries

use clap::Parser;
use log::info;
use std::path::PathBuf;
use vmp_devirt::VmpDevirtualizer;

#[derive(Parser, Debug)]
#[command(name = "vmp_devirt")]
#[command(about = "VMProtect Devirtualizer (VMP 1.0-3.10.5)", long_about = None)]
struct Args {
    /// Path to VMP-protected binary
    #[arg(value_name = "BINARY")]
    binary: PathBuf,

    /// VIP address to start devirtualization (hex)
    #[arg(short, long, value_name = "ADDRESS")]
    vip: Option<String>,

    /// Output format (json, text)
    #[arg(short, long, default_value = "text")]
    format: String,

    /// Output file (default: stdout)
    #[arg(short, long, value_name = "FILE")]
    output: Option<PathBuf>,

    /// Export opcode table to JSON
    #[arg(long, value_name = "FILE")]
    export_opcodes: Option<PathBuf>,

    /// Export handler classifications to JSON
    #[arg(long, value_name = "FILE")]
    export_handlers: Option<PathBuf>,

    /// Verbose logging
    #[arg(short, long)]
    verbose: bool,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize logging
    if args.verbose {
        env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Debug)
            .init();
    } else {
        env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Info)
            .init();
    }

    info!("VMP Devirtualizer v0.1.0");
    info!("Loading binary: {}", args.binary.display());

    // Load binary and detect version
    let devirt = VmpDevirtualizer::new(&args.binary)?;
    let version = devirt.version();

    info!("Detected VMP version: {}", version.as_str());

    // Display dispatch table info
    if let Some(dt_va) = devirt.dispatch_table_va() {
        info!("Dispatch table VA: 0x{:x}", dt_va);
        info!("Handlers extracted: {}", devirt.handler_classifications().len());
        
        // Display handler statistics
        let stats = devirt.handler_statistics();
        info!("Handler types found: {}", stats.len());
        
        let mut sorted_stats: Vec<_> = stats.iter().collect();
        sorted_stats.sort_by(|a, b| b.1.cmp(a.1));
        
        info!("Top 10 handler types:");
        for (i, (handler_type, count)) in sorted_stats.iter().take(10).enumerate() {
            info!("  {}. {} ({})", i + 1, handler_type, count);
        }
    } else {
        info!("Could not locate dispatch table");
    }

    // Export opcode table if requested
    if let Some(export_path) = args.export_opcodes {
        devirt.export_opcode_table(export_path.to_str().unwrap())?;
    }

    // Export handler classifications if requested
    if let Some(export_path) = args.export_handlers {
        devirt.export_handler_classifications(export_path.to_str().unwrap())?;
    }

    // Parse VIP address
    let vip = if let Some(vip_str) = args.vip {
        let vip_str = if vip_str.starts_with("0x") || vip_str.starts_with("0X") {
            &vip_str[2..]
        } else {
            &vip_str
        };
        u64::from_str_radix(vip_str, 16)?
    } else {
        // Default: first code section
        0x140001000
    };

    info!("Starting devirtualization at VIP: 0x{:x}", vip);

    // Decode instructions
    let instructions = devirt.devirtualize_range(vip, vip + 0x1000)?;

    info!("Decoded {} instructions", instructions.len());

    // Format output
    let output = match args.format.as_str() {
        "json" => format_json(&instructions)?,
        "text" => format_text(&instructions),
        _ => anyhow::bail!("Unknown format: {}", args.format),
    };

    // Write output
    if let Some(output_path) = args.output {
        std::fs::write(&output_path, &output)?;
        info!("Output written to: {}", output_path.display());
    } else {
        println!("{}", output);
    }

    Ok(())
}

/// Format instructions as JSON
fn format_json(instructions: &[vmp_devirt::DecodedInstruction]) -> anyhow::Result<String> {
    let json_instructions: Vec<_> = instructions
        .iter()
        .map(|instr| {
            serde_json::json!({
                "vip": format!("0x{:x}", instr.vip),
                "opcode": format!("0x{:02x}", instr.opcode),
                "handler": instr.handler.name,
                "operands": instr.operands.iter().map(|o| format!("0x{:x}", o)).collect::<Vec<_>>(),
                "size": instr.size,
            })
        })
        .collect();

    Ok(serde_json::to_string_pretty(&json_instructions)?)
}

/// Format instructions as text
fn format_text(instructions: &[vmp_devirt::DecodedInstruction]) -> String {
    let mut output = String::new();
    output.push_str("VIP Address | Opcode | Handler          | Size | Operands\n");
    output.push_str("------------|--------|------------------|------|----------\n");

    for instr in instructions {
        let operands = instr
            .operands
            .iter()
            .map(|o| format!("0x{:x}", o))
            .collect::<Vec<_>>()
            .join(", ");

        output.push_str(&format!(
            "0x{:08x}  | 0x{:02x}   | {:<16} | {:>4} | {}\n",
            instr.vip, instr.opcode, instr.handler.name, instr.size, operands
        ));
    }

    output
}
