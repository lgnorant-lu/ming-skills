# -*- coding: utf-8 -*-

import json
import logging

import pytest

from ruyipage import FirefoxOptions, FirefoxPage
from ruyipage.errors import BiDiError
from ruyipage._units.capture import CaptureManager, CapturePacket


@pytest.mark.fast
def test_capture_packet_fallback_fetches_get_response_body_when_collector_empty():
    class EmptyCollector:
        def get(self, request_id, data_type="response"):
            raise RuntimeError("collector empty")

    class Owner:
        def __init__(self):
            self.calls = []

        def run_js(self, script, url, timeout=15):
            self.calls.append((script, url, timeout))
            return "<html>bing result body</html>"

    owner = Owner()
    packet = CapturePacket(
        request={
            "request": "req-1",
            "url": "https://cn.bing.com/search?q=ruyipage",
            "method": "GET",
        },
        response={"status": 200, "headers": []},
        response_collector=EmptyCollector(),
        owner=owner,
    )

    assert packet.response_body == "<html>bing result body</html>"
    assert owner.calls[0][1] == "https://cn.bing.com/search?q=ruyipage"


@pytest.mark.fast
@pytest.mark.parametrize(
    "fallback_message",
    [
        "The command does not support browsing contexts in privileged scope",
        (
            "System access is required. Start Firefox with "
            '"-remote-allow-system-access" to enable it.'
        ),
    ],
)
def test_capture_start_falls_back_to_global_subscription(
    monkeypatch, caplog, fallback_message
):
    class Network:
        def add_data_collector(self, *args, **kwargs):
            raise RuntimeError("collector unavailable")

    class ContextDriver:
        def __init__(self):
            self._browser_driver = object()
            self.callbacks = []

        def set_callback(self, event, callback):
            self.callbacks.append((event, callback))

        def remove_callback(self, event):
            pass

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = ContextDriver()
            self.network = Network()

    calls = []

    def fake_subscribe(driver, events, contexts=None):
        calls.append({"driver": driver, "events": events, "contexts": contexts})
        if contexts:
            raise BiDiError("unsupported operation", fallback_message)
        return {"subscription": "global-subscription"}

    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe", fake_subscribe
    )
    manager = CaptureManager(Owner())

    with caplog.at_level(logging.WARNING, logger="ruyipage"):
        returned = manager.start(collect_bodies=False)

    assert returned is manager
    assert manager.active is True
    assert manager._subscription_id == "global-subscription"
    assert [call["contexts"] for call in calls] == [["context-1"], None]
    assert "retrying globally" in caplog.text


@pytest.mark.fast
def test_capture_global_fallback_collects_bodies(monkeypatch):
    class Data:
        def __init__(self, value):
            self.bytes = {"type": "string", "value": value}
            self.base64 = None
            self.raw = {}

    class Collector:
        def __init__(self):
            self.remove_calls = 0

        def get(self, request_id, data_type="response"):
            assert request_id == "request-1"
            if data_type == "request":
                return Data('{"n": 1}')
            return Data('{"status": "ok"}')

        def remove(self):
            self.remove_calls += 1

    collector = Collector()

    class Network:
        def __init__(self):
            self.calls = []

        def add_data_collector(self, **kwargs):
            self.calls.append(("context", kwargs))
            raise BiDiError(
                "unsupported operation",
                (
                    "System access is required. Start Firefox with "
                    '"-remote-allow-system-access" to enable it.'
                ),
            )

        def _add_data_collector(self, **kwargs):
            self.calls.append(("global", kwargs))
            assert kwargs["contexts"] is None
            return collector

    class Driver:
        def __init__(self):
            self._browser_driver = object()
            self.callbacks = {}

        def set_callback(self, event, callback):
            self.callbacks[event] = callback

        def remove_callback(self, event):
            self.callbacks.pop(event, None)

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = Driver()
            self.network = Network()

    subscribe_calls = []

    def fake_subscribe(driver, events, contexts=None):
        subscribe_calls.append(contexts)
        if contexts:
            raise BiDiError(
                "unsupported operation",
                "The command does not support browsing contexts in privileged scope",
            )
        return {"subscription": "global-subscription"}

    unsubscribe_calls = []
    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe", fake_subscribe
    )
    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.unsubscribe",
        lambda *args, **kwargs: unsubscribe_calls.append(kwargs),
    )

    owner = Owner()
    manager = CaptureManager(owner).start()
    request_params = {
        "request": {
            "request": "request-1",
            "url": "https://example.test/api/echo",
            "method": "POST",
            "headers": [],
        },
        "timestamp": 1,
    }
    response_params = dict(
        request_params,
        response={"status": 200, "headers": []},
        timestamp=2,
    )

    owner._driver.callbacks["network.beforeRequestSent"](request_params)
    owner._driver.callbacks["network.responseCompleted"](response_params)
    packet = manager.wait(timeout=0.1)

    assert packet.request_body == '{"n": 1}'
    assert packet.response_body == '{"status": "ok"}'
    assert [call[0] for call in owner.network.calls] == ["context", "global"]
    assert subscribe_calls == [["context-1"], None]
    manager.stop()

    assert owner._driver.callbacks == {}
    assert collector.remove_calls == 1
    assert unsubscribe_calls == [{"subscription": "global-subscription"}]


@pytest.mark.fast
def test_capture_start_preserves_global_subscription_error(monkeypatch):
    class Collector:
        def __init__(self):
            self.removed = False

        def remove(self):
            self.removed = True

    collector = Collector()

    class Network:
        def add_data_collector(self, *args, **kwargs):
            return collector

    class ContextDriver:
        def __init__(self):
            self._browser_driver = object()

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = ContextDriver()
            self.network = Network()

    errors = [
        BiDiError(
            "unsupported operation",
            "The command does not support browsing contexts in privileged scope",
        ),
        BiDiError("unsupported operation", "global subscription unavailable"),
    ]

    def fake_subscribe(driver, events, contexts=None):
        raise errors.pop(0)

    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe", fake_subscribe
    )

    with pytest.raises(BiDiError, match="global subscription unavailable"):
        manager = CaptureManager(Owner())
        manager.start()

    assert collector.removed is True
    assert manager.active is False
    assert manager._subscription_id is None
    assert manager._request_collector is None
    assert manager._response_collector is None


@pytest.mark.fast
def test_capture_start_does_not_retry_non_bidi_errors(monkeypatch):
    class Collector:
        def __init__(self):
            self.removed = False

        def remove(self):
            self.removed = True

    collector = Collector()

    class Network:
        def add_data_collector(self, *args, **kwargs):
            return collector

    class ContextDriver:
        def __init__(self):
            self._browser_driver = object()

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = ContextDriver()
            self.network = Network()

    calls = []

    def fake_subscribe(driver, events, contexts=None):
        calls.append(contexts)
        raise RuntimeError("connection closed")

    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe", fake_subscribe
    )

    with pytest.raises(RuntimeError, match="connection closed"):
        manager = CaptureManager(Owner())
        manager.start()

    assert calls == [["context-1"]]
    assert collector.removed is True
    assert manager._request_collector is None
    assert manager._response_collector is None


@pytest.mark.fast
def test_capture_start_does_not_retry_unrelated_bidi_errors(monkeypatch):
    class ContextDriver:
        def __init__(self):
            self._browser_driver = object()

    class Owner:
        def __init__(self):
            self._context_id = "stale-context"
            self._driver = ContextDriver()
            self.network = object()

    calls = []

    def fake_subscribe(driver, events, contexts=None):
        calls.append(contexts)
        raise BiDiError("no such frame", "Browsing context was discarded")

    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe", fake_subscribe
    )

    with pytest.raises(BiDiError, match="Browsing context was discarded"):
        CaptureManager(Owner()).start(collect_bodies=False)

    assert calls == [["stale-context"]]


@pytest.mark.fast
def test_capture_start_does_not_retry_bidi_timeout(monkeypatch):
    class ContextDriver:
        def __init__(self):
            self._browser_driver = object()

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = ContextDriver()
            self.network = object()

    calls = []

    def fake_subscribe(driver, events, contexts=None):
        calls.append(contexts)
        raise BiDiError("timeout", "session.subscribe timed out")

    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe", fake_subscribe
    )

    with pytest.raises(BiDiError, match="session.subscribe timed out"):
        CaptureManager(Owner()).start(collect_bodies=False)

    assert calls == [["context-1"]]


@pytest.mark.fast
def test_capture_start_rolls_back_after_callback_registration_failure(monkeypatch):
    class Collector:
        def __init__(self):
            self.remove_calls = 0

        def remove(self):
            self.remove_calls += 1

    collector = Collector()

    class Network:
        def add_data_collector(self, *args, **kwargs):
            return collector

    class ContextDriver:
        def __init__(self):
            self._browser_driver = object()
            self.registered = []
            self.removed = []

        def set_callback(self, event, callback):
            if len(self.registered) == 1:
                raise RuntimeError("callback registration failed")
            self.registered.append(event)

        def remove_callback(self, event):
            self.removed.append(event)

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = ContextDriver()
            self.network = Network()

    owner = Owner()
    unsubscribe_calls = []
    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe",
        lambda *args, **kwargs: {"subscription": "subscription-1"},
    )
    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.unsubscribe",
        lambda *args, **kwargs: unsubscribe_calls.append(kwargs),
    )
    manager = CaptureManager(owner)

    with pytest.raises(RuntimeError, match="callback registration failed"):
        manager.start()

    assert manager.active is False
    assert manager._subscription_id is None
    assert manager._request_collector is None
    assert manager._response_collector is None
    assert owner._driver.removed == ["network.beforeRequestSent"]
    assert unsubscribe_calls == [{"subscription": "subscription-1"}]
    assert collector.remove_calls == 1


@pytest.mark.fast
def test_capture_stop_uses_driver_that_registered_callbacks(monkeypatch):
    class Driver:
        def __init__(self, name):
            self.name = name
            self._browser_driver = object()
            self.callbacks = {}

        def set_callback(self, event, callback):
            self.callbacks[event] = callback

        def remove_callback(self, event):
            self.callbacks.pop(event, None)

    class Owner:
        def __init__(self):
            self._context_id = "context-1"
            self._driver = Driver("original")
            self.network = object()

    unsubscribe_drivers = []
    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.subscribe",
        lambda *args, **kwargs: {"subscription": "subscription-1"},
    )
    monkeypatch.setattr(
        "ruyipage._units.capture.bidi_session.unsubscribe",
        lambda driver, **kwargs: unsubscribe_drivers.append(driver),
    )

    owner = Owner()
    original_driver = owner._driver
    manager = CaptureManager(owner).start(collect_bodies=False)
    owner._driver = Driver("replacement")

    manager.stop()

    assert original_driver.callbacks == {}
    assert unsubscribe_drivers == [original_driver._browser_driver]


@pytest.mark.feature
@pytest.mark.local_server
def test_capture_can_collect_multiple_request_and_response_packets(page, server):
    page.get("about:blank")
    page.capture.start("/api/echo", method="POST")

    try:
        result = page.run_js(
            """
            const url = arguments[0];
            return Promise.all([
              fetch(url + "?n=1", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({n: 1})
              }).then(r => r.json()),
              fetch(url + "?n=2", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({n: 2})
              }).then(r => r.json())
            ]).catch(e => [{error: String(e)}]);
            """,
            server.get_url("/api/echo"),
            as_expr=False,
        )

        packets = page.capture.wait(timeout=8, count=2)
        assert len(packets) == 2

        bodies = [json.loads(packet.request_body) for packet in packets]
        assert {body["n"] for body in bodies} == {1, 2}
        assert all(packet.method == "POST" for packet in packets)
        assert all(packet.response_status == 200 for packet in packets)
        assert all("content-type" in packet.response_headers for packet in packets)
        assert all(packet.response_body for packet in packets)
        assert len(page.capture.steps) == 2
        assert result[0]["status"] == "ok"
    finally:
        page.capture.stop()


@pytest.mark.feature
@pytest.mark.local_server
def test_capture_wait_single_packet_returns_none_on_timeout(page):
    page.capture.start("/api/not-fired", method="GET")
    try:
        assert page.capture.wait(timeout=0.5) is None
    finally:
        page.capture.stop()


@pytest.mark.feature
@pytest.mark.local_server
@pytest.mark.skipif(
    not __import__("sys").platform.startswith("win"),
    reason="Firefox privileged-scope fallback is Windows-specific",
)
def test_capture_falls_back_from_privileged_context_with_bodies(
    test_browser_path, server, caplog
):
    options = FirefoxOptions().allow_system_access(False)
    if test_browser_path:
        options.set_browser_path(test_browser_path)
    page = FirefoxPage(options)

    try:
        assert page.url == "about:home"
        with caplog.at_level(logging.WARNING, logger="ruyipage"):
            page.capture.start("/api/echo", method="POST")

        assert "capture data collector failed; retrying globally" in caplog.text
        assert "capture subscription failed; retrying globally" in caplog.text

        page.get(server.get_url("/"))
        result = page.run_js(
            """
            const url = arguments[0];
            return fetch(url, {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({source: "privileged-fallback"})
            }).then(r => r.json());
            """,
            server.get_url("/api/echo"),
            as_expr=False,
        )
        packet = page.capture.wait(timeout=8)

        assert json.loads(packet.request_body) == {
            "source": "privileged-fallback"
        }
        response = json.loads(packet.response_body)
        assert json.loads(response["body"]) == {
            "source": "privileged-fallback"
        }
        assert result["status"] == "ok"
    finally:
        page.capture.stop()
        page.quit()
