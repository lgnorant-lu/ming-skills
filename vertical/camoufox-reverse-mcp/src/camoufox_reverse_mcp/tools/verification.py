"""Offline signer verification tool (v1.0.0).

Replaces verify_against_session. Fully stateless — user provides samples.
"""
from __future__ import annotations

from ..server import mcp, browser_manager


@mcp.tool()
async def verify_signer_offline(
    signer_code: str,
    samples: list[dict],
    compare_params: list[str] | None = None,
) -> dict:
    """Offline verify a signing function against user-provided samples.

    Typical workflow:
      1. Capture real signed requests via network_capture + list_network_requests
      2. Extract samples into a list
      3. Write candidate signing code
      4. Call this tool -> get pass_rate + first_divergence
      5. Iterate

    Args:
        signer_code: JS evaluating to a function: (sample) => {param: computed_value}.
            Runs in current page context.
        samples: List of sample dicts, each with:
            - id: user-defined identifier
            - input: dict passed to signer function
            - expected: dict of {param_name: expected_value_str}
        compare_params: Which params to compare. If None, compare all keys
            in each sample's expected.

    Returns:
        dict with total_samples, passed, failed, pass_rate, first_divergence, details.
    """
    try:
        if not isinstance(samples, list) or not samples:
            return {"error": "samples must be a non-empty list"}

        page = await browser_manager.get_active_page()
        try:
            await page.evaluate(f"window.__mcp_signer_fn = {signer_code};")
        except Exception as e:
            return {"error": f"signer_code failed to evaluate: {e}"}

        details = []
        passed = failed = 0
        first_divergence = None

        for s in samples:
            sid = s.get("id", f"sample_{len(details)}")
            sample_input = s.get("input", {})
            expected = s.get("expected", {})

            try:
                computed = await page.evaluate(
                    "(sample) => window.__mcp_signer_fn(sample)", sample_input)
            except Exception as e:
                details.append({"sample_id": sid, "passed": False, "error": f"signer threw: {e}"})
                failed += 1
                continue

            diffs = _compare_params(expected, computed, compare_params)
            if not diffs:
                passed += 1
                details.append({"sample_id": sid, "passed": True})
            else:
                failed += 1
                details.append({"sample_id": sid, "passed": False, "diffs": diffs})
                if first_divergence is None:
                    first_divergence = {"sample_id": sid, "diffs": diffs, "input": sample_input}

        return {
            "total_samples": len(samples), "passed": passed, "failed": failed,
            "pass_rate": round(passed / len(samples), 3) if samples else 0,
            "first_divergence": first_divergence, "details": details,
        }
    except Exception as e:
        return {"error": str(e)}


def _compare_params(expected: dict, computed: dict, focus: list[str] | None) -> list[dict]:
    diffs = []
    keys = focus if focus else list(expected.keys())
    for k in keys:
        exp = expected.get(k)
        act = (computed or {}).get(k)
        if exp == act:
            continue
        if isinstance(exp, str) and isinstance(act, str):
            first_diff = -1
            for i in range(min(len(exp), len(act))):
                if exp[i] != act[i]:
                    first_diff = i
                    break
            if first_diff == -1 and len(exp) != len(act):
                first_diff = min(len(exp), len(act))
            diffs.append({"param": k, "expected": exp, "actual": act,
                          "first_diff_char": first_diff,
                          "expected_length": len(exp), "actual_length": len(act)})
        else:
            diffs.append({"param": k, "expected": exp, "actual": act})
    return diffs
