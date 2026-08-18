# Contributing

Contributions are welcome. Here's how to help.

## How to Contribute

### Bug Reports

Open an issue with:
- Which skill and script is affected
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Python version, Claude Code version)

### Feature Requests

Open an issue describing:
- What you want to add
- Why it's useful for offensive security testing
- Which skill it belongs to

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Follow the existing code patterns (see below)
4. Test your changes
5. Submit a PR with a clear description

## Code Standards

### Python Scripts

- **Python 3.8+** compatible
- **Standard library only** - no pip dependencies
- Follow the existing pattern:
  - `log()`, `success()`, `warn()`, `vuln()` helper functions
  - `http_request()` helper for HTTP calls
  - argparse CLI with `--target`, `--output`, `--cookie`, `--header`, `--delay` conventions
  - JSON output with `meta` and `findings` structure
  - Summary banner printed to stdout at the end
- Include `#!/usr/bin/env python3` shebang
- Include docstring with skill name, description, and `Author: orizon.one`

### SKILL.md Files

- Follow the [Claude Skills Guide](https://docs.anthropic.com) format
- YAML frontmatter with `name`, `description`, `metadata`
- `name` must be kebab-case
- `description` must be under 1024 characters
- Include authorization warning in the Important section
- Use progressive disclosure (basic -> intermediate -> advanced usage)

### Naming Conventions

- Skill folders: `kebab-case`
- Python scripts: `snake_case.py`
- Output JSON keys: `snake_case`

## What We Need

Priority areas for contribution:

- Additional vulnerability test patterns and payloads
- Support for more technology stacks
- Better WAF bypass techniques
- Additional cloud provider support
- Improved report templates
- Performance optimizations
- Documentation improvements

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). All contributors must follow it.

## Legal

By contributing, you agree that your contributions will be licensed under the MIT License.

**Important**: Do not contribute:
- Exploit code for 0-day vulnerabilities
- Stolen credentials or leaked data
- Code that targets specific organizations
- Content that violates any law
