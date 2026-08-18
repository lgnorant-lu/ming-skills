#!/usr/bin/env python3
"""
独立的首启 UI 自动点击脚本：

- 启动 app
- 用 uiautomator dump 导出当前 UI 树
- 自动识别“同意 / 允许 / 继续”一类按钮
- 处理常见前台 blocker
- 尽量避免误点整段协议文案与重复点击
"""

import argparse
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


UIAUTOMATOR_DUMP_PATH = "/sdcard/xfqtrace_ui.xml"
POLL_SEC = 1.0
MIN_READY_SEC = 4.0
READY_STABLE_POLLS = 2
ACTION_REPEAT_COOLDOWN_SEC = 6.0

UI_PRIMARY_KEYWORDS = [
    "同意", "接受", "允许", "始终允许", "继续", "下一步", "进入", "开始",
    "确认", "确定", "好的", "知道了", "我知道了", "立即开启", "立即体验",
    "开始使用", "进入应用", "跳过", "去开启", "开启", "不再提醒",
    "仅在使用该应用时允许", "使用期间允许", "while using the app",
    "allow", "allow only while using the app", "agree", "accept", "continue",
    "next", "ok", "confirm", "start", "skip", "done", "got it", "later",
]

UI_BLOCKER_APPROVE_KEYWORDS = [
    "允许", "始终允许", "仅在使用该应用时允许", "使用期间允许",
    "allow", "allow only while using the app", "ok", "continue", "confirm",
]

UI_DANGEROUS_ACTION_KEYWORDS = [
    # Auto-click is only for privacy/permission/first-launch blockers.
    # Upgrade/update buttons can change app code and invalidate trace offsets,
    # so never tap them automatically.
    "立即升级", "马上升级", "立刻升级", "立即更新", "马上更新", "立刻更新",
    "升级", "更新版本", "版本更新", "新版", "新版本", "下载安装",
    "upgrade", "update now", "upgrade now", "install update", "download update",
]

UI_NEGATIVE_KEYWORDS = [
    "不同意", "拒绝", "不允许", "deny", "donotallow", "don't allow",
    "disagree", "decline", "browse only", "cancel", "取消", "退出",
    "close app", "app isn't responding", "isn't responding", "wait", "关闭应用",
    "应用无响应", "无响应", "停止运行",
]

UI_CHECKBOX_KEYWORDS = [
    "隐私", "协议", "条款", "policy", "privacy", "consent", "agreement",
    "checkbox", "check", "勾选",
]

TRANSIENT_ACTIVITY_KEYWORDS = [
    "splash", "launch", "startup", "welcome", "guide", "loading",
    "boot", "init", "advert", "adactivity", "onboarding",
]

ONBOARDING_ACTIVITY_KEYWORDS = [
    "onboarding", "guide", "welcome",
]


def adb(*args, serial=None):
    cmd = ["adb"]
    if serial:
        cmd.extend(["-s", serial])
    cmd.extend(args)
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",
    )
    return proc.stdout or "", proc.stderr or "", proc.returncode


def adb_shell(command, serial=None):
    return adb("shell", command, serial=serial)


def launch_app(serial, package):
    out, err, rc = adb(
        "shell", "monkey", "-p", package,
        "-c", "android.intent.category.LAUNCHER", "1",
        serial=serial,
    )
    if rc != 0:
        text = "\n".join(x for x in [out, err] if x).strip()
        print(f"[!] failed to launch {package}: {text or 'unknown error'}")
        return False
    print(f"[*] Launch requested: {package}")
    return True


def adb_pidof(serial, package):
    out, _, rc = adb_shell(f"pidof {package}", serial=serial)
    if rc == 0 and out.strip():
        try:
            return int(out.strip().split()[0])
        except ValueError:
            pass

    short = package.rsplit(".", 1)[-1]
    out, _, rc = adb_shell("ps -A", serial=serial)
    if rc != 0 or not out:
        return None
    for line in out.splitlines():
        cols = line.split()
        if len(cols) < 2:
            continue
        name = cols[-1]
        if name != package and name != short:
            continue
        for token in cols[1:-1]:
            if token.isdigit():
                try:
                    return int(token)
                except ValueError:
                    pass
    return None


def get_top_activity(serial):
    out, _, rc = adb_shell("dumpsys activity activities", serial=serial)
    if rc != 0 or not out:
        return None
    for line in out.splitlines():
        if "topResumedActivity" not in line and "mResumedActivity" not in line:
            continue
        match = re.search(r"([A-Za-z0-9._$]+/[A-Za-z0-9._$]+)", line)
        if match:
            return match.group(1)
    return None


def parse_bounds(bounds):
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds or "")
    if not match:
        return None
    x1, y1, x2, y2 = map(int, match.groups())
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1 + x2) // 2, (y1 + y2) // 2


def parse_rect(bounds):
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds or "")
    if not match:
        return None
    x1, y1, x2, y2 = map(int, match.groups())
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def dump_ui_hierarchy(serial):
    _, err, rc = adb("shell", "uiautomator", "dump", UIAUTOMATOR_DUMP_PATH, serial=serial)
    if rc != 0:
        err = err.strip()
        if err:
            print(f"[!] uiautomator dump failed: {err}")
        return None
    out, _, rc = adb_shell(f"cat {UIAUTOMATOR_DUMP_PATH}", serial=serial)
    if rc != 0 or not out:
        return None
    xml_start = out.find("<?xml")
    if xml_start >= 0:
        out = out[xml_start:]
    return out if out.lstrip().startswith("<?xml") else None


def iter_ui_nodes(xml_text):
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    nodes = []
    for node in root.iter("node"):
        center = parse_bounds(node.attrib.get("bounds", ""))
        if center is None:
            continue
        nodes.append({
            "text": (node.attrib.get("text") or "").strip(),
            "desc": (node.attrib.get("content-desc") or "").strip(),
            "resource_id": (node.attrib.get("resource-id") or "").strip(),
            "class_name": (node.attrib.get("class") or "").strip(),
            "package": (node.attrib.get("package") or "").strip(),
            "enabled": node.attrib.get("enabled", "true") == "true",
            "clickable": node.attrib.get("clickable", "false") == "true",
            "checkable": node.attrib.get("checkable", "false") == "true",
            "checked": node.attrib.get("checked", "false") == "true",
            "center": center,
            "bounds": node.attrib.get("bounds", ""),
            "rect": parse_rect(node.attrib.get("bounds", "")),
        })
    return nodes


def _normalize_ui_value(value):
    return (value or "").strip().lower().replace(" ", "")


def _ui_keyword_hit(haystack_lower, normalized, keyword):
    key = keyword.lower()
    compact_key = key.replace(" ", "")
    # English action words must be token-like matches.  Plain substring matching
    # makes "agree" hit "Disagree", which can reject a privacy dialog.
    if re.fullmatch(r"[a-z][a-z0-9_'-]*", key):
        return re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", haystack_lower) is not None
    if " " in key:
        return key in haystack_lower or compact_key in normalized
    if len(key) <= 2:
        return re.search(rf"(?<![a-z]){re.escape(key)}(?![a-z])", haystack_lower) is not None
    return key in haystack_lower or key in normalized


def is_custom_checkbox_node(node):
    rect = node.get("rect")
    if not rect:
        return False
    width = rect[2] - rect[0]
    height = rect[3] - rect[1]
    rid_lower = node.get("resource_id", "").lower()
    return (
        node.get("clickable")
        and not node.get("checked")
        and width <= 140
        and height <= 140
        and any(token in rid_lower for token in [
            "cb", "checkbox", "check", "privacy", "policy",
            "agreement", "consent", "thirdparty", "third_party",
            "personalinformation",
        ])
    )


def score_ui_node(node):
    if not node["enabled"]:
        return -1, None

    text = node["text"]
    desc = node["desc"]
    resource_id = node["resource_id"]
    class_name = node["class_name"]
    haystack = " ".join(v for v in [text, desc, resource_id, class_name] if v)
    normalized = _normalize_ui_value(haystack)
    text_len = len(text or desc or "")
    rect = node.get("rect")
    width = (rect[2] - rect[0]) if rect else 0
    height = (rect[3] - rect[1]) if rect else 0

    if any(_ui_keyword_hit(haystack.lower(), normalized, keyword) for keyword in UI_DANGEROUS_ACTION_KEYWORDS):
        return -1, None

    if any(_ui_keyword_hit(haystack.lower(), normalized, keyword) for keyword in UI_NEGATIVE_KEYWORDS):
        return -1, None

    if "已阅读并同意" in text and not node["checkable"] and "button" not in class_name.lower():
        return -1, None
    if (
        text_len >= 60
        and not node["clickable"]
        and not node["checkable"]
        and "button" not in class_name.lower()
        and any(_ui_keyword_hit(haystack.lower(), normalized, keyword)
                for keyword in ["privacy", "policy", "terms", "agreement", "agree", "个人信息", "隐私", "协议"])
    ):
        return -1, None
    if (
        text_len >= 24
        and not node["checkable"]
        and "button" not in class_name.lower()
        and any(token in text for token in ["协议", "隐私", "政策", "登录", "服务"])
    ):
        return -1, None

    score = 0
    reason = None

    if node["checkable"] and not node["checked"]:
        checkbox_hits = 0
        for keyword in UI_CHECKBOX_KEYWORDS:
            if _ui_keyword_hit(haystack.lower(), normalized, keyword):
                checkbox_hits += 1
        if checkbox_hits > 0:
            score += 70 + checkbox_hits
            reason = "checkable-agreement"

    # A lot of first-launch consent pages use custom Views for small checkboxes:
    # checkable=false, text="", clickable=true, but resource-id carries names
    # such as cbPrivacyPolicy.  Prefer ticking those before pressing the final
    # agree button; otherwise we keep tapping "Agree and continue" forever.
    if is_custom_checkbox_node(node):
        score += 180
        reason = "checkbox-resource"

    for keyword in UI_PRIMARY_KEYWORDS:
        if _ui_keyword_hit(haystack.lower(), normalized, keyword):
            score += 100
            reason = reason or f"primary:{keyword}"

    if node["clickable"]:
        score += 5
    if "button" in class_name.lower():
        score += 10
    if node["checkable"]:
        score += 15
    if resource_id:
        rid = resource_id.lower()
        if any(token in rid for token in ["allow", "agree", "accept", "confirm", "continue", "next", "ok", "privacy", "skipguide"]):
            score += 20
            reason = reason or f"resource:{resource_id}"

    if text_len >= 18 and not node["checkable"] and "button" not in class_name.lower():
        score -= 80
    if width >= 700 and height <= 140 and not node["checkable"] and "button" not in class_name.lower():
        score -= 60

    return score, reason


def choose_ui_action(nodes, action_history=None):
    best_node = None
    best_score = 0
    best_reason = None
    now = time.time()
    for node in nodes:
        if action_history is not None:
            last_ts = action_history.get(ui_action_key(node))
            if last_ts is not None and is_custom_checkbox_node(node):
                continue
            if last_ts is not None and (now - last_ts) < ACTION_REPEAT_COOLDOWN_SEC:
                continue
        score, reason = score_ui_node(node)
        if score > best_score:
            best_node = node
            best_score = score
            best_reason = reason
    if best_node is None or best_score < 40 or best_reason is None:
        return None
    return best_node, best_reason, best_score


def filter_nodes_for_package(nodes, package):
    """Only click UI nodes that belong to the package currently under test."""
    filtered = []
    for node in nodes:
        node_pkg = node.get("package") or ""
        if not node_pkg or node_pkg == package:
            filtered.append(node)
    return filtered


def is_blocking_top_activity(top_activity, package):
    if not top_activity:
        return False
    lowered = top_activity.lower()
    if package.lower() in lowered:
        return False
    return (
        "permissioncontroller" in lowered or
        "popupdialog" in lowered or
        "permission.ui" in lowered or
        "packageinstaller" in lowered or
        "gms" in lowered or
        "systemupdateactivity" in lowered or
        "update.phone" in lowered
    )


def is_safe_blocker_action(node):
    label = " ".join(
        value for value in [
            node.get("text", ""),
            node.get("desc", ""),
            node.get("resource_id", ""),
        ] if value
    )
    lowered = label.lower()
    normalized = _normalize_ui_value(label)
    if not node.get("clickable") and "button" not in node.get("class_name", "").lower():
        return False
    return any(_ui_keyword_hit(lowered, normalized, keyword) for keyword in UI_BLOCKER_APPROVE_KEYWORDS)


def is_transient_app_activity(top_activity, package):
    if not top_activity:
        return True
    lowered = top_activity.lower()
    if package.lower() not in lowered:
        return True
    return any(keyword in lowered for keyword in TRANSIENT_ACTIVITY_KEYWORDS)


def is_onboarding_app_activity(top_activity, package):
    if not top_activity:
        return False
    lowered = top_activity.lower()
    if package.lower() not in lowered:
        return False
    return any(keyword in lowered for keyword in ONBOARDING_ACTIVITY_KEYWORDS)


def top_activity_package(top_activity):
    if not top_activity or "/" not in top_activity:
        return None
    return top_activity.split("/", 1)[0]


def tap_point(serial, x, y):
    adb("shell", "input", "tap", str(x), str(y), serial=serial)


def send_key(serial, keycode):
    adb("shell", "input", "keyevent", str(keycode), serial=serial)


def ui_action_key(node):
    label = node["text"] or node["desc"] or node["resource_id"] or node["class_name"]
    return f"{node['bounds']}|{node['resource_id']}|{label}"


def drive_first_launch_ui(serial, package, timeout_sec, launch, stop_event=None,
                          relaunch_on_exit=True):
    if timeout_sec is None:
        print("[*] Auto first-launch UI handling enabled (no timeout; follows trace lifecycle)")
    else:
        print(f"[*] Auto first-launch UI handling enabled ({timeout_sec:.0f}s timeout)")
    if launch and not launch_app(serial, package):
        return False

    deadline = None if timeout_sec is None else time.time() + timeout_sec
    follow_trace_lifecycle = stop_event is not None and timeout_sec is None
    start_ts = time.time()
    stable_ready_polls = 0
    stable_reported = False
    action_history = {}
    last_onboarding_swipe_ts = 0.0
    onboarding_swipes = 0
    seen_pid = False

    while deadline is None or time.time() < deadline:
        if stop_event is not None and stop_event.is_set():
            print("[*] Auto first-launch UI handling stopped")
            return True
        pid = adb_pidof(serial, package)
        if pid is not None:
            seen_pid = True
        top_activity = get_top_activity(serial)
        blocker = is_blocking_top_activity(top_activity, package)
        top_pkg = top_activity_package(top_activity)

        xml_text = dump_ui_hierarchy(serial)
        nodes = iter_ui_nodes(xml_text)
        # When another app is still foreground (for example the previous
        # regression sample), do not tap its buttons while waiting for the
        # newly injected target to come up.  Only system blockers are allowed
        # to be handled out-of-package.
        if blocker:
            action = choose_ui_action(nodes, action_history)
        elif top_pkg == package:
            action = choose_ui_action(filter_nodes_for_package(nodes, package), action_history)
        else:
            action = None

        if blocker:
            if action is not None:
                node, reason, score = action
                if is_safe_blocker_action(node) and node.get("package") == top_activity_package(top_activity):
                    x, y = node["center"]
                    label = node["text"] or node["desc"] or node["resource_id"] or node["class_name"]
                    print(f"[*] UI blocker action: tap '{label}' ({reason}, score={score}) @ ({x},{y}) top={top_activity or '?'}")
                    tap_point(serial, x, y)
                    time.sleep(1.2)
                    continue
            print(f"[*] Foreground blocker detected: {top_activity}; sending BACK")
            send_key(serial, 4)
            time.sleep(1.0)
            continue

        if action is not None:
            node, reason, score = action
            action_key = ui_action_key(node)
            x, y = node["center"]
            label = node["text"] or node["desc"] or node["resource_id"] or node["class_name"]
            print(f"[*] UI action: tap '{label}' ({reason}, score={score}) @ ({x},{y}) top={top_activity or '?'}")
            tap_point(serial, x, y)
            action_history[action_key] = time.time()
            stable_ready_polls = 0
            stable_reported = False
            time.sleep(1.2)
            continue

        if pid is not None and top_activity and package in top_activity and not blocker:
            if not is_transient_app_activity(top_activity, package) and (time.time() - start_ts) >= MIN_READY_SEC:
                stable_ready_polls += 1
                if stable_ready_polls >= READY_STABLE_POLLS:
                    if not stable_reported:
                        print(f"[*] App looks stable now: pid={pid} top={top_activity}")
                        stable_reported = True
                    if follow_trace_lifecycle:
                        stable_ready_polls = READY_STABLE_POLLS
                        time.sleep(POLL_SEC)
                        continue
                    return True
            else:
                stable_ready_polls = 0
                stable_reported = False
                if is_onboarding_app_activity(top_activity, package):
                    now = time.time()
                    if now - last_onboarding_swipe_ts >= 2.5 and onboarding_swipes < 8:
                        print(f"[*] Onboarding activity: swipe left ({onboarding_swipes + 1}/8) top={top_activity}")
                        adb("shell", "input", "swipe", "900", "1600", "150", "1600", "350", serial=serial)
                        last_onboarding_swipe_ts = now
                        onboarding_swipes += 1
                        time.sleep(1.0)
                        continue
                print(f"[*] Waiting for non-transient app activity: top={top_activity}")
        else:
            stable_ready_polls = 0
            stable_reported = False

        if stop_event is not None and stop_event.is_set():
            print("[*] Auto first-launch UI handling stopped")
            return True

        if pid is None:
            if not relaunch_on_exit:
                if seen_pid:
                    print("[*] Target process exited; auto-click will not relaunch it")
                    return True
                print("[*] Waiting for target process; auto-click will not launch it")
                time.sleep(POLL_SEC)
                continue
            print("[*] Target process is not running; relaunching")
            if not launch_app(serial, package):
                return False
            time.sleep(1.5)
            continue

        time.sleep(POLL_SEC)

    top_activity = get_top_activity(serial)
    pid = adb_pidof(serial, package)
    print(f"[!] Auto first-launch UI handling timed out: pid={pid} top={top_activity or '?'}")
    return pid is not None


def main():
    parser = argparse.ArgumentParser(description="Auto tap privacy/permission dialogs on first launch")
    parser.add_argument("-p", "--package", required=True, help="Android package name")
    parser.add_argument("--serial", help="adb device serial")
    parser.add_argument("--timeout", type=float, default=35.0, help="overall timeout in seconds")
    parser.add_argument("--no-launch", action="store_true", help="do not launch app automatically")
    args = parser.parse_args()

    ok = drive_first_launch_ui(
        serial=args.serial,
        package=args.package,
        timeout_sec=args.timeout,
        launch=not args.no_launch,
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
