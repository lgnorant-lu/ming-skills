#!/usr/bin/env python
"""Generate ruyiPage's WebDriver BiDi coverage report from source code."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[1]
DEFAULT_SNAPSHOT = HERE / "w3c_bidi_apis.json"
DEFAULT_OUTPUT = HERE / "W3C_BIDI_COMPARISON.md"
BIDI_SOURCE_DIR = PROJECT_ROOT / "ruyipage" / "_bidi"
EVENT_TRACKER_PATH = PROJECT_ROOT / "ruyipage" / "_units" / "events.py"


def _constant_string(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def discover_wrapped_commands(source_dir: Path = BIDI_SOURCE_DIR) -> set[str]:
    """Discover literal BiDi method names passed to driver.run/_safe_run."""
    commands = set()
    for path in source_dir.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue

            method = None
            if (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "run"
                and node.args
            ):
                method = _constant_string(node.args[0])
            elif (
                isinstance(node.func, ast.Name)
                and node.func.id == "_safe_run"
                and len(node.args) >= 2
            ):
                method = _constant_string(node.args[1])

            if method and "." in method:
                commands.add(method)
    return commands


def has_generic_event_support(path: Path = EVENT_TRACKER_PATH) -> bool:
    """Verify EventTracker forwards arbitrary requested events to subscribe()."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not (isinstance(node.func, ast.Attribute) and node.func.attr == "subscribe"):
            continue
        for argument in node.args:
            if (
                isinstance(argument, ast.Attribute)
                and isinstance(argument.value, ast.Name)
                and argument.value.id == "self"
                and argument.attr == "_events"
            ):
                return True
    return False


def flatten(mapping: dict[str, list[str]]) -> list[str]:
    return [item for values in mapping.values() for item in values]


def load_snapshot(path: Path = DEFAULT_SNAPSHOT) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    commands = flatten(data["commands"])
    events = flatten(data["events"])
    if data["total_commands"] != len(commands):
        raise ValueError("snapshot total_commands does not match command list")
    if data["total_events"] != len(events):
        raise ValueError("snapshot total_events does not match event list")
    return data


def build_coverage(snapshot: dict) -> dict:
    spec_commands = set(flatten(snapshot["commands"]))
    spec_events = set(flatten(snapshot["events"]))
    wrapped_commands = discover_wrapped_commands()
    generic_events = has_generic_event_support()
    covered_events = spec_events if generic_events else set()
    return {
        "spec_commands": spec_commands,
        "spec_events": spec_events,
        "wrapped_commands": wrapped_commands,
        "covered_events": covered_events,
        "missing_commands": spec_commands - wrapped_commands,
        "missing_events": spec_events - covered_events,
        "extra_commands": wrapped_commands - spec_commands,
        "generic_events": generic_events,
    }


def _percent(covered: int, total: int) -> str:
    return "{:.1f}%".format((covered / total * 100) if total else 100.0)


def render_report(snapshot: dict, coverage: dict) -> str:
    command_total = len(coverage["spec_commands"])
    command_covered = command_total - len(coverage["missing_commands"])
    event_total = len(coverage["spec_events"])
    event_covered = event_total - len(coverage["missing_events"])

    lines = [
        "# WebDriver BiDi Core Coverage",
        "",
        "- Source: {}".format(snapshot.get("source") or "unknown"),
        "- Revision: `{}`".format(snapshot.get("source_revision") or "unversioned"),
        "- Source date: {}".format(snapshot.get("source_date") or "unknown"),
        "",
        "This report measures ruyiPage's low-level core protocol name surface.",
        "Parameter schemas are guarded by `tests/test_bidi_schema_conformance.py`",
        "and browser runtime support is deliberately reported separately.",
        "",
        "External WebDriver BiDi specifications such as Bluetooth, Digital",
        "Credentials, Permissions, Speculation, and User-Agent Client Hints are",
        "outside this core snapshot and are not counted as part of 67/24.",
        "",
        "## Summary",
        "",
        "| Name surface | W3C | Covered | Missing | Coverage |",
        "| --- | ---: | ---: | ---: | ---: |",
        "| Commands | {} | {} | {} | {} |".format(
            command_total,
            command_covered,
            len(coverage["missing_commands"]),
            _percent(command_covered, command_total),
        ),
        "| Events | {} | {} | {} | {} |".format(
            event_total,
            event_covered,
            len(coverage["missing_events"]),
            _percent(event_covered, event_total),
        ),
        "",
        "Events are covered by the generic `page.events` subscriber, which preserves",
        "the complete event payload in `BidiEvent.params`.",
        "",
        "## Modules",
        "",
        "| Module | Commands | Wrapped | Events | Subscribable |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]

    for module in snapshot["modules"]:
        commands = snapshot["commands"].get(module, [])
        events = snapshot["events"].get(module, [])
        wrapped = sum(item in coverage["wrapped_commands"] for item in commands)
        subscribed = sum(item in coverage["covered_events"] for item in events)
        lines.append(
            "| {} | {} | {} | {} | {} |".format(
                module, len(commands), wrapped, len(events), subscribed
            )
        )

    lines.extend(["", "## Commands", ""])
    for module, commands in snapshot["commands"].items():
        lines.extend(
            [
                "### {}".format(module),
                "",
                "| Command | Status |",
                "| --- | --- |",
            ]
        )
        for command in commands:
            status = "wrapped" if command in coverage["wrapped_commands"] else "missing"
            lines.append("| `{}` | {} |".format(command, status))
        lines.append("")

    lines.extend(["## Events", ""])
    for module, events in snapshot["events"].items():
        lines.extend(
            [
                "### {}".format(module),
                "",
                "| Event | Status |",
                "| --- | --- |",
            ]
        )
        for event in events:
            status = "generic subscriber" if event in coverage["covered_events"] else "missing"
            lines.append("| `{}` | {} |".format(event, status))
        lines.append("")

    lines.extend(["## Non-W3C Extensions", ""])
    if coverage["extra_commands"]:
        for command in sorted(coverage["extra_commands"]):
            lines.append("- `{}`".format(command))
    else:
        lines.append("None.")
    lines.extend(
        [
            "",
            "## Runtime Note",
            "",
            "A wrapper means ruyiPage can serialize and send the command. It does not mean",
            "every Firefox release implements that command or emits every event.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--stdout", action="store_true")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    snapshot = load_snapshot(args.snapshot)
    coverage = build_coverage(snapshot)
    report = render_report(snapshot, coverage)

    if args.stdout:
        sys.stdout.write(report)

    if coverage["missing_commands"] or coverage["missing_events"]:
        print(
            "Missing W3C coverage: commands={} events={}".format(
                sorted(coverage["missing_commands"]),
                sorted(coverage["missing_events"]),
            )
        )
        return 1

    if args.check:
        current = args.output.read_text(encoding="utf-8") if args.output.exists() else ""
        if current != report:
            print("WebDriver BiDi coverage report is stale: {}".format(args.output))
            return 1
        print("WebDriver BiDi coverage report is current: {}".format(args.output))
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    print("Wrote WebDriver BiDi coverage report to {}".format(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
