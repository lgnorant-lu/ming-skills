# Frida MCP

A Model Context Protocol (MCP) implementation for Frida dynamic instrumentation toolkit.

## Overview

This package provides an MCP-compliant server for Frida, enabling AI systems to interact with mobile and desktop applications through Frida's dynamic instrumentation capabilities. It uses the official [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) to enable seamless integration with AI applications.

## Demo


https://github.com/user-attachments/assets/5dc0e8f5-5011-4cf2-be77-6a77ec960501



## Features

- Built with the official MCP Python SDK
- Comprehensive Frida tools exposed through MCP:
  - Process management (list, attach, spawn, resume, kill)
  - Device management (USB, remote devices)
  - Interactive JavaScript REPL with real-time execution
  - Script injection with progress tracking
  - Process and device monitoring
- Resources for providing Frida data to models
- Prompts for guided Frida analysis workflows
- Progress tracking for long-running operations
- Full support for all MCP transport methods

## Installation

### Prerequisites

- Python 3.8 or later
- pip package manager
- Frida 16.0.0 or later

### Quick Install

```bash
pip install frida-mcp
```

### Development Install

```bash
# Clone the repository
git clone https://github.com/yourusername/frida-mcp.git
cd frida-mcp

# Install in development mode with extra tools
pip install -e ".[dev]"
```

## Claude Desktop Integration

To use Frida MCP with Claude Desktop, you'll need to update your Claude configuration file:

1. Locate your Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. Add the following to your configuration file:

```json
{
  "mcpServers": {
    "frida": {
      "command": "frida-mcp"
    }
  }
}
```

## Usage

Once installed, you can use Frida MCP directly from Claude Desktop. The server provides the following capabilities:

### Process Management
- List all running processes
- Attach to specific processes
- Spawn new processes
- Resume suspended processes
- Kill processes

### Device Management
- List all connected devices (USB, remote)
- Get device information
- Connect to specific devices

### Interactive JavaScript REPL
- Create interactive sessions with processes
- Execute JavaScript code in real-time
- Monitor process state and memory
- Hook functions and intercept calls
- Capture console.log output
- Handle errors and exceptions gracefully

### Script Injection
- Inject custom JavaScript scripts
- Track injection progress
- Handle script errors and exceptions

### Resources
- Get Frida version information
- Access process list in human-readable format
- Access device list in human-readable format

## Development

```bash
# Clone repository
git clone https://github.com/yourusername/frida-mcp.git
cd frida-mcp

# Install development dependencies
pip install -e ".[dev]"
```

## License

MIT
