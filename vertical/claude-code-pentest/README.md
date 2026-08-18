<p align="center">
  <h1 align="center">claude-code-pentest</h1>
  <p align="center">
    <strong>6 Claude Code skills that automate the entire pentest lifecycle.<br>From recon to exploit chains to bug bounty reports — just give it a domain.</strong>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/python-3.8+-blue.svg" alt="Python 3.8+">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT">
    <img src="https://img.shields.io/badge/Claude-Code-blueviolet.svg" alt="Claude Code">
    <img src="https://img.shields.io/badge/skills-6-orange.svg" alt="6 Skills">
    <img src="https://img.shields.io/badge/scripts-43-red.svg" alt="43 Scripts">
    <img src="https://img.shields.io/badge/pip_dependencies-0-brightgreen.svg" alt="Zero Dependencies">
  </p>
  <p align="center">
    Built by <a href="https://orizon.one">orizon.one</a>
  </p>
</p>

---

> **WARNING: Authorized security testing only.** Unauthorized access to computer systems is illegal.
> Read the [full disclaimer](DISCLAIMER.md) before use.

---

## The Pipeline

```
DOMAIN INPUT
    │
    ▼
┌─────────────────────┐
│  recon-dominator     │  Subdomain enum, port scan, OSINT, dorking, Wayback
└────────┬────────────┘
         │
    ┌────┼──────────────────────┐
    │    │                      │
    ▼    ▼                      ▼
┌────────────┐ ┌──────────┐ ┌──────────────┐
│ webapp-    │ │ api-     │ │ cloud-pivot- │
│ exploit-   │ │ breaker  │ │ finder       │
│ hunter     │ │          │ │              │
└─────┬──────┘ └────┬─────┘ └──────┬───────┘
      │              │              │
      └──────┬───────┘──────────────┘
             ▼
┌─────────────────────────┐
│  attack-path-architect  │  MITRE ATT&CK trees, kill chains
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  vuln-chain-composer    │  Chain exploits → bug bounty report
└─────────────────────────┘
```

## What Each Skill Does

| # | Skill | What It Does | Scripts |
|---|-------|-------------|---------|
| 1 | **recon-dominator** | Subdomain enumeration, port scanning, tech fingerprinting, OSINT, Google dorking, Wayback analysis | 8 |
| 2 | **attack-path-architect** | Asset classification, trust mapping, MITRE ATT&CK attack trees, kill chain generation | 3 |
| 3 | **webapp-exploit-hunter** | SQLi, XSS, SSRF, IDOR, SSTI, auth bypass, file upload, race conditions + PoC generation | 11 |
| 4 | **api-breaker** | API discovery, schema reconstruction, BOLA/BFLA, mass assignment, JWT attacks, GraphQL abuse | 8 |
| 5 | **cloud-pivot-finder** | Cloud provider detection, S3/GCS/Azure buckets, subdomain takeover, serverless, CI/CD exposure | 7 |
| 6 | **vuln-chain-composer** | Cross-domain vuln correlation, exploit chain composition, CVSS recalculation, bug bounty reports | 6 |

**43 Python scripts total. Zero pip dependencies. Pure standard library.**

## Quick Start

```bash
# Clone
git clone https://github.com/Orizon-eu/claude-code-pentest.git
cd claude-code-pentest

# Install all skills (personal - available in all your Claude Code projects)
for skill in recon-dominator attack-path-architect webapp-exploit-hunter api-breaker cloud-pivot-finder vuln-chain-composer; do
    cp -r "$skill" ~/.claude/skills/
done

# Verify
# Open Claude Code and ask: "What skills are available?"
```

Then just talk to Claude:

```
Run full reconnaissance on example.com
```

```
Find vulnerabilities on app.example.com
```

```
Chain all findings and generate a bug bounty report
```

## Requirements

- **Python 3.8+** (standard library only)
- **Claude Code** with skills support

### Optional (for faster scanning)

```bash
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
go install github.com/d3mondev/puredns/v2@latest
go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest
```

System tools (usually pre-installed): `dig`, `whois`, `nmap`

## Installation

### Method 1: Personal skills (all projects)

```bash
git clone https://github.com/Orizon-eu/claude-code-pentest.git
cd claude-code-pentest

for skill in recon-dominator attack-path-architect webapp-exploit-hunter api-breaker cloud-pivot-finder vuln-chain-composer; do
    cp -r "$skill" ~/.claude/skills/
done
```

### Method 2: Project-level skills (single project)

```bash
git clone https://github.com/Orizon-eu/claude-code-pentest.git
cd your-project

mkdir -p .claude/skills
for skill in recon-dominator attack-path-architect webapp-exploit-hunter api-breaker cloud-pivot-finder vuln-chain-composer; do
    cp -r "/path/to/claude-code-pentest/$skill" .claude/skills/
done
```

### Method 3: Single skill

```bash
cp -r recon-dominator ~/.claude/skills/
```

## Usage

### Natural language (Claude auto-selects the right skill)

```
Run full recon on target.com
Scan all web apps for vulnerabilities
Test the API at api.target.com
Check for S3 buckets and subdomain takeover
Analyze attack paths from the recon data
Chain all findings and generate a report
```

### Direct invocation

```
/recon-dominator
/attack-path-architect
/webapp-exploit-hunter
/api-breaker
/cloud-pivot-finder
/vuln-chain-composer
```

## Full Pentest Workflow

```
1. "Run full recon on target.com"
   → recon-dominator maps the entire attack surface

2. "Scan all web apps for vulnerabilities"
   → webapp-exploit-hunter tests for SQLi, XSS, SSRF, SSTI, IDOR...

3. "Test all discovered APIs"
   → api-breaker finds BOLA, BFLA, JWT issues, mass assignment

4. "Check cloud infrastructure and buckets"
   → cloud-pivot-finder maps cloud pivot paths

5. "Analyze attack paths from all data"
   → attack-path-architect generates MITRE ATT&CK kill chains

6. "Chain all findings and generate a report"
   → vuln-chain-composer produces bug bounty ready reports
```

Each skill outputs structured JSON that feeds into the next skill in the pipeline.

## Detailed Script Reference

<details>
<summary><b>recon-dominator</b> — 8 scripts</summary>

| Script | Function |
|--------|----------|
| `passive_recon.py` | crt.sh, HackerTarget, RapidDNS, Wayback, subfinder integration |
| `active_recon.py` | DNS brute-force, zone transfer, permutation scanning |
| `port_scanner.py` | TCP connect scan, HTTP probing, WAF detection |
| `tech_fingerprint.py` | 50+ technology signatures, security header analysis |
| `osint_correlator.py` | WHOIS, ASN, reverse IP, GitHub dorks, email providers |
| `google_dorker.py` | 88 dorks across 9 categories |
| `wayback_analyzer.py` | URL categorization, JS analysis, removed content detection |
| `generate_report.py` | Consolidated MD + JSON report |

</details>

<details>
<summary><b>attack-path-architect</b> — 3 scripts</summary>

| Script | Function |
|--------|----------|
| `classify_assets.py` | Asset type classification, exposure level, risk scoring |
| `map_trust.py` | Cookie scope, DNS relationships, TLS sharing, SSO detection |
| `generate_attack_tree.py` | Attack patterns, MITRE TTP mapping, kill chain generation |

</details>

<details>
<summary><b>webapp-exploit-hunter</b> — 11 scripts</summary>

| Script | Function |
|--------|----------|
| `crawler.py` | HTML parsing, form extraction, JS endpoint discovery, path fuzzing |
| `sqli_tester.py` | Error-based, boolean-based, time-based, UNION-based SQLi |
| `xss_tester.py` | Context-aware XSS (HTML, attribute, JS, URL), WAF bypass |
| `ssrf_tester.py` | Localhost, cloud metadata, protocol smuggling, IP bypass |
| `ssti_tester.py` | Jinja2, Twig, Freemarker, ERB, Smarty, Pebble, Velocity |
| `idor_tester.py` | Horizontal/vertical access, method variation, ID encoding |
| `auth_tester.py` | Default creds, JWT attacks, session analysis, CORS, headers |
| `upload_tester.py` | Double extension, null byte, magic bytes, Content-Type bypass |
| `race_tester.py` | Double spend, coupon reuse, parallel request racing |
| `generate_poc.py` | curl commands, Python scripts, reproduction steps |
| `vuln_report.py` | Bug bounty reports with CVSS scoring |

</details>

<details>
<summary><b>api-breaker</b> — 8 scripts</summary>

| Script | Function |
|--------|----------|
| `api_discovery.py` | 70+ common API paths, GraphQL introspection, OpenAPI parsing |
| `schema_builder.py` | API schema reconstruction, OpenAPI 3.0 output |
| `auth_analyzer.py` | JWT decode/attack, none algorithm, key confusion, weak secrets |
| `authz_tester.py` | BOLA/BFLA testing with dual tokens |
| `mass_assignment.py` | 30+ injection fields, nested object testing |
| `rate_limiter.py` | 120+ rapid requests, 12 IP spoofing headers, GraphQL batching |
| `logic_tester.py` | Price manipulation, quantity overflow, privilege escalation |
| `api_report.py` | OWASP API Top 10 mapping, per-finding reports |

</details>

<details>
<summary><b>cloud-pivot-finder</b> — 7 scripts</summary>

| Script | Function |
|--------|----------|
| `cloud_detector.py` | CNAME patterns, header analysis, IP whois for cloud providers |
| `bucket_enum.py` | S3/GCS/Azure bucket name generation and permission testing |
| `takeover_scanner.py` | 18 service fingerprints for dangling CNAME detection |
| `serverless_finder.py` | Lambda, API Gateway, Cloud Functions, Cloud Run discovery |
| `cicd_finder.py` | Jenkins, GitLab, GitHub Actions, Terraform, Docker/K8s configs |
| `metadata_paths.py` | SSRF vectors, metadata-to-credential pivot chain mapping |
| `cloud_report.py` | Consolidated cloud security report with remediation |

</details>

<details>
<summary><b>vuln-chain-composer</b> — 6 scripts</summary>

| Script | Function |
|--------|----------|
| `import_findings.py` | Normalizes findings from all tools to common format |
| `correlate.py` | 10 chain templates matching vulnerability combinations |
| `build_chains.py` | Detailed chain construction with per-phase steps |
| `calculate_impact.py` | CVSS v3.1 recalculation, amplification rules |
| `generate_chain_poc.py` | Python scripts, curl sequences per chain |
| `generate_report.py` | HackerOne, Bugcrowd, and generic pentest report formats |

</details>

## Architecture

```
claude-code-pentest/
├── README.md
├── LICENSE
├── DISCLAIMER.md
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── .gitignore
├── recon-dominator/
│   ├── SKILL.md
│   ├── scripts/           (8 scripts)
│   └── references/        (wordlists, tool setup)
├── attack-path-architect/
│   ├── SKILL.md
│   ├── scripts/           (3 scripts)
│   └── references/        (MITRE ATT&CK mapping)
├── webapp-exploit-hunter/
│   ├── SKILL.md
│   └── scripts/           (11 scripts)
├── api-breaker/
│   ├── SKILL.md
│   └── scripts/           (8 scripts)
├── cloud-pivot-finder/
│   ├── SKILL.md
│   └── scripts/           (7 scripts)
└── vuln-chain-composer/
    ├── SKILL.md
    └── scripts/           (6 scripts)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Skill not triggering automatically | Invoke directly with `/skill-name` |
| Scripts fail with "command not found" | Install optional Go tools (see Requirements) |
| Permission denied on scripts | Run `chmod +x scripts/*.py` inside the skill folder |
| Too many skills loaded | Install only the skills you need |
| Rate limiting (429 errors) | Scripts auto-adjust rate; use `--delay` flag |

## Legal Disclaimer

**This software is provided for authorized security testing and educational purposes only.**

By using this software, you agree that:

1. You have **explicit, written authorization** to test any target system
2. You accept **full responsibility** for your actions and any consequences
3. The authors are **not liable** for any misuse, damage, or legal consequences
4. You will comply with all **applicable laws** in your jurisdiction

Unauthorized access to computer systems is a criminal offense under the Computer Fraud and Abuse Act (CFAA), Computer Misuse Act, Budapest Convention on Cybercrime, and equivalent laws worldwide.

**Read the full [DISCLAIMER.md](DISCLAIMER.md) before using these tools.**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Security

Found a vulnerability in this project? See [SECURITY.md](SECURITY.md).

---

<p align="center">
  Built by <a href="https://orizon.one">orizon.one</a> — Offensive Security & AI Integration
</p>
