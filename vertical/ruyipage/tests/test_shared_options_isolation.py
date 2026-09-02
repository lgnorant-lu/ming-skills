# -*- coding: utf-8 -*-
"""并发共享 FirefoxOptions 时的 profile 隔离与临时目录回收（issue #28）。"""

import threading

import pytest

import ruyipage._base.browser as browser_module

from ruyipage._base.browser import Firefox
from ruyipage._configs.firefox_options import FirefoxOptions


@pytest.fixture(autouse=True)
def _clear_browser_state():
    Firefox._BROWSERS.clear()
    Firefox._RESERVED_PORTS.clear()
    yield
    Firefox._BROWSERS.clear()
    Firefox._RESERVED_PORTS.clear()


def _browser_shell(options):
    browser = Firefox.__new__(Firefox)
    browser._options = options
    browser._address = options.address
    browser._auto_profile = None
    browser._process = None
    browser._driver = None
    browser._owns_session = False
    browser._quit_lock = threading.RLock()
    browser._initialized = True
    return browser


def test_copy_returns_independent_options():
    opts = FirefoxOptions().set_port(9333)

    clone = opts.copy()
    clone.set_profile("/tmp/clone-profile")
    clone._set_port_for_launch(4444)

    assert opts.profile_path is None
    assert opts.port == 9333
    assert clone.profile_path == "/tmp/clone-profile"
    assert clone.port == 4444


def test_browser_does_not_write_launch_state_back_to_caller_options(monkeypatch):
    """共享同一个 options 的多个实例必须各自拿到独立 profile。"""
    allocated = []

    def fake_launch(self):
        # 复刻 _launch_browser 里的 profile 分配逻辑
        if not self._options.profile_path:
            self._auto_profile = "/tmp/profile-{}".format(len(allocated))
            self._options.set_profile(self._auto_profile)
        allocated.append(self._options.profile_path)

    monkeypatch.setattr(Firefox, "_ensure_launch_port_available", lambda self: None)
    monkeypatch.setattr(Firefox, "_launch_browser", fake_launch)
    monkeypatch.setattr(Firefox, "_wait_for_connection", lambda self: True)
    monkeypatch.setattr(Firefox, "_register_exit_cleanup", lambda self: None)

    shared = FirefoxOptions()
    first = Firefox(shared)
    second = Firefox(shared)

    assert allocated == ["/tmp/profile-0", "/tmp/profile-1"]
    assert first._auto_profile != second._auto_profile
    # 调用方的 options 不能被启动过程污染
    assert shared.profile_path is None
    assert first._options is not shared
    assert second._options is not first._options


def test_launch_port_is_not_shared_between_instances(monkeypatch):
    monkeypatch.setattr(Firefox, "_ensure_launch_port_available", lambda self: None)
    monkeypatch.setattr(Firefox, "_launch_browser", lambda self: None)
    monkeypatch.setattr(Firefox, "_wait_for_connection", lambda self: True)
    monkeypatch.setattr(Firefox, "_register_exit_cleanup", lambda self: None)

    ports = iter([31000, 31001])
    monkeypatch.setattr(Firefox, "_find_free_port", lambda self, start=None: next(ports))

    shared = FirefoxOptions()
    first = Firefox(shared)
    second = Firefox(shared)

    assert first._address.endswith(":31000")
    assert second._address.endswith(":31001")
    assert shared.port == 9222


def test_remove_auto_profile_retries_then_gives_up(monkeypatch, caplog):
    browser = _browser_shell(FirefoxOptions())
    browser._auto_profile = "/tmp/stubborn-profile"
    calls = []

    monkeypatch.setattr(
        browser_module.shutil, "rmtree", lambda path, **kw: calls.append(path)
    )
    monkeypatch.setattr(browser_module.os.path, "exists", lambda path: True)
    monkeypatch.setattr(browser_module.time, "sleep", lambda seconds: None)

    with caplog.at_level("WARNING", logger="ruyipage"):
        browser._remove_auto_profile(attempts=3, delay=0)

    assert calls == ["/tmp/stubborn-profile"] * 3
    assert browser._auto_profile is None
    assert "手动清理" in caplog.text


def test_remove_auto_profile_stops_once_directory_is_gone(monkeypatch):
    browser = _browser_shell(FirefoxOptions())
    browser._auto_profile = "/tmp/removable-profile"
    calls = []

    monkeypatch.setattr(
        browser_module.shutil, "rmtree", lambda path, **kw: calls.append(path)
    )
    monkeypatch.setattr(browser_module.os.path, "exists", lambda path: False)

    browser._remove_auto_profile()

    assert calls == ["/tmp/removable-profile"]
    assert browser._auto_profile is None


def test_exit_cleanup_reclaims_profile_when_driver_already_gone(monkeypatch):
    """连接已断开时 atexit 仍需回收临时 profile，否则目录永久残留。"""
    browser = _browser_shell(FirefoxOptions())
    browser._auto_profile = "/tmp/orphan-profile"
    removed = []

    monkeypatch.setattr(
        browser_module.shutil, "rmtree", lambda path, **kw: removed.append(path)
    )
    monkeypatch.setattr(browser_module.os.path, "exists", lambda path: False)

    browser._cleanup_on_exit()

    assert removed == ["/tmp/orphan-profile"]
    assert browser._auto_profile is None


def test_exit_cleanup_keeps_external_browser_profile(monkeypatch):
    options = FirefoxOptions().existing_only(True)
    browser = _browser_shell(options)
    browser._auto_profile = "/tmp/should-stay"
    removed = []

    monkeypatch.setattr(
        browser_module.shutil, "rmtree", lambda path, **kw: removed.append(path)
    )

    browser._cleanup_on_exit()

    assert removed == []
    assert browser._auto_profile == "/tmp/should-stay"


def test_plain_quit_terminates_process_tree_before_removing_profile(monkeypatch):
    """terminate() 只杀启动进程，content 进程仍会占用 profile 目录。"""
    order = []

    class _Process:
        pid = 5150

        def poll(self):
            return None

        def terminate(self):
            order.append("terminate")

        def wait(self, timeout=None):
            order.append("wait")

    browser = _browser_shell(FirefoxOptions())
    browser._process = _Process()
    browser._auto_profile = "/tmp/quit-profile"

    monkeypatch.setattr(browser_module.sys, "platform", "win32")
    monkeypatch.setattr(
        browser_module.subprocess,
        "run",
        lambda command, **kwargs: order.append(" ".join(command)),
    )
    monkeypatch.setattr(
        browser_module.shutil, "rmtree", lambda path, **kw: order.append("rmtree")
    )
    monkeypatch.setattr(browser_module.os.path, "exists", lambda path: False)

    browser.quit()

    assert order == [
        "terminate",
        "wait",
        "taskkill /F /T /PID 5150",
        "wait",
        "rmtree",
    ]
    assert browser._process is None
    assert browser._auto_profile is None
