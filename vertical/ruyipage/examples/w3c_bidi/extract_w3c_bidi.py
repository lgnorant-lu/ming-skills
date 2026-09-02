#!/usr/bin/env python
"""Synchronize the local WebDriver BiDi API snapshot with the W3C draft."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Optional


EDITOR_DRAFT_URL = "https://w3c.github.io/webdriver-bidi/"
GITHUB_API_URL = "https://api.github.com/repos/w3c/webdriver-bidi"
RAW_SOURCE_URL = (
    "https://raw.githubusercontent.com/w3c/webdriver-bidi/{revision}/index.bs"
)
DEFAULT_OUTPUT = Path(__file__).with_name("w3c_bidi_apis.json")
USER_AGENT = "ruyiPage-w3c-bidi-sync"

COMMAND_HEADING_RE = re.compile(
    r"####\s+The\s+([A-Za-z][\w]*\.[A-Za-z][\w]*)\s+Command"
)
EVENT_HEADING_RE = re.compile(
    r"####\s+The\s+([A-Za-z][\w]*\.[A-Za-z][\w]*)\s+Event"
)


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
        },
    )


def _read_url(url: str) -> bytes:
    with urllib.request.urlopen(_request(url), timeout=30) as response:
        return response.read()


def fetch_editor_draft() -> tuple[str, dict[str, str]]:
    """Fetch one pinned revision of the W3C Editor's Draft source."""
    repository = json.loads(_read_url(GITHUB_API_URL).decode("utf-8"))
    branch = repository["default_branch"]
    commit = json.loads(
        _read_url("{}/commits/{}".format(GITHUB_API_URL, branch)).decode("utf-8")
    )
    revision = commit["sha"]
    source_date = commit["commit"]["committer"]["date"]
    source = _read_url(RAW_SOURCE_URL.format(revision=revision)).decode("utf-8")
    metadata = {
        "source": EDITOR_DRAFT_URL,
        "source_revision": revision,
        "source_date": source_date,
    }
    return source, metadata


def read_source(source: str) -> tuple[str, dict[str, Optional[str]]]:
    """Read an explicit local file or URL for offline/reproducible extraction."""
    if source.startswith(("https://", "http://")):
        content = _read_url(source).decode("utf-8")
    else:
        content = Path(source).read_text(encoding="utf-8")
    return content, {
        "source": source,
        "source_revision": None,
        "source_date": None,
    }


def _unique_in_order(pattern: re.Pattern[str], source: str) -> list[str]:
    return list(dict.fromkeys(match.group(1) for match in pattern.finditer(source)))


def extract_snapshot(source: str, metadata: dict[str, Optional[str]]) -> dict:
    commands = _unique_in_order(COMMAND_HEADING_RE, source)
    events = _unique_in_order(EVENT_HEADING_RE, source)
    if not commands or not events:
        raise ValueError("W3C source did not contain BiDi command/event headings")

    modules = list(
        dict.fromkeys(item.split(".", 1)[0] for item in commands + events)
    )
    commands_by_module = {
        module: [item for item in commands if item.startswith(module + ".")]
        for module in modules
        if any(item.startswith(module + ".") for item in commands)
    }
    events_by_module = {
        module: [item for item in events if item.startswith(module + ".")]
        for module in modules
        if any(item.startswith(module + ".") for item in events)
    }

    return {
        "schema_version": 1,
        "scope": "core",
        **metadata,
        "modules": modules,
        "commands": commands_by_module,
        "events": events_by_module,
        "total_commands": len(commands),
        "total_events": len(events),
    }


def render_snapshot(snapshot: dict) -> str:
    return json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        help="Read index.bs from a local path or URL instead of the latest draft",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero when the checked-in snapshot differs from W3C",
    )
    parser.add_argument("--stdout", action="store_true")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    source, metadata = (
        read_source(args.source) if args.source else fetch_editor_draft()
    )
    rendered = render_snapshot(extract_snapshot(source, metadata))

    if args.stdout:
        sys.stdout.write(rendered)

    if args.check:
        current = (
            args.output.read_text(encoding="utf-8") if args.output.exists() else ""
        )
        if current != rendered:
            print("WebDriver BiDi snapshot is stale: {}".format(args.output))
            return 1
        print("WebDriver BiDi snapshot is current: {}".format(args.output))
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    snapshot = json.loads(rendered)
    print(
        "Wrote {} commands and {} events to {}".format(
            snapshot["total_commands"], snapshot["total_events"], args.output
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
