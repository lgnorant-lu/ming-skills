# -*- coding: utf-8 -*-
"""RDP 传输层：帧编解码、应答与事件的区分。"""

import json
import socket
import threading

import pytest

from ruyipage._adapter.rdp import EVENT_TYPES, RdpConnection
from ruyipage.errors import DebuggerError


def _frame(packet):
    body = json.dumps(packet).encode("utf-8")
    return str(len(body)).encode("ascii") + b":" + body


class FakeServer(object):
    """在本机监听一个端口，按脚本回放 RDP 包。"""

    def __init__(self, script):
        """script: list of (expected_request_type_or_None, [packets_to_send])"""
        self._script = list(script)
        self._listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listener.bind(("127.0.0.1", 0))
        self._listener.listen(1)
        self.port = self._listener.getsockname()[1]
        self.received = []
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        conn, _ = self._listener.accept()
        try:
            # 首个条目是 greeting，无需等待请求
            expected, packets = self._script.pop(0)
            assert expected is None
            for packet in packets:
                conn.sendall(_frame(packet))

            # 脚本用完后继续保持连接，让「无应答」表现为超时而不是断链
            buf = b""
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    return
                buf += chunk
                while True:
                    head, sep, rest = buf.partition(b":")
                    if not sep or not head.isdigit():
                        break
                    length = int(head)
                    if len(rest) < length:
                        break
                    body, buf = rest[:length], rest[length:]
                    self.received.append(json.loads(body.decode("utf-8")))
                    if self._script:
                        _expected, packets = self._script.pop(0)
                        for packet in packets:
                            conn.sendall(_frame(packet))
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def close(self):
        try:
            self._listener.close()
        except Exception:
            pass


@pytest.fixture
def server_factory():
    created = []

    def _make(script):
        server = FakeServer(script)
        created.append(server)
        return server

    yield _make
    for server in created:
        server.close()


def test_greeting_is_read_on_connect(server_factory):
    server = server_factory(
        [(None, [{"from": "root", "applicationType": "browser"}])]
    )
    connection = RdpConnection(port=server.port, timeout=5).connect()
    try:
        assert connection.greeting["applicationType"] == "browser"
        assert connection.connected
    finally:
        connection.close()


def test_request_frames_are_length_prefixed(server_factory):
    server = server_factory(
        [
            (None, [{"from": "root"}]),
            ("listTabs", [{"from": "root", "tabs": []}]),
        ]
    )
    connection = RdpConnection(port=server.port, timeout=5).connect()
    try:
        connection.request("root", "listTabs")
        assert server.received == [{"to": "root", "type": "listTabs"}]
    finally:
        connection.close()


def test_reply_carrying_a_type_field_is_not_mistaken_for_an_event(server_factory):
    """environment form 的应答带 "type": "function"，不能被当成事件丢弃。"""
    server = server_factory(
        [
            (None, [{"from": "root"}]),
            (
                "getEnvironment",
                [{"from": "frame1", "type": "function", "bindings": {}}],
            ),
        ]
    )
    connection = RdpConnection(port=server.port, timeout=5).connect()
    try:
        reply = connection.request("frame1", "getEnvironment")
        assert reply["type"] == "function"
    finally:
        connection.close()


def test_unsolicited_event_does_not_satisfy_a_pending_request(server_factory):
    """paused 事件先到时不能被当成 resume 的应答。"""
    server = server_factory(
        [
            (None, [{"from": "root"}]),
            (
                "frames",
                [
                    {"from": "thread1", "type": "paused", "why": {"type": "breakpoint"}},
                    {"from": "thread1", "frames": [{"actor": "f1"}]},
                ],
            ),
        ]
    )
    seen = []
    connection = RdpConnection(port=server.port, timeout=5).connect()
    connection.on_event("paused", seen.append, actor="thread1")
    try:
        reply = connection.request("thread1", "frames")
        assert reply["frames"] == [{"actor": "f1"}]
        assert len(seen) == 1
        assert seen[0]["why"] == {"type": "breakpoint"}
    finally:
        connection.close()


def test_server_error_is_raised(server_factory):
    server = server_factory(
        [
            (None, [{"from": "root"}]),
            (
                "resume",
                [{"from": "thread1", "error": "wrongState", "message": "not paused"}],
            ),
        ]
    )
    connection = RdpConnection(port=server.port, timeout=5).connect()
    try:
        with pytest.raises(DebuggerError, match="wrongState"):
            connection.request("thread1", "resume")
    finally:
        connection.close()


def test_request_timeout_raises(server_factory):
    server = server_factory([(None, [{"from": "root"}]), ("sources", [])])
    connection = RdpConnection(port=server.port, timeout=0.3).connect()
    try:
        with pytest.raises(DebuggerError, match="超时"):
            connection.request("thread1", "sources")
    finally:
        connection.close()


def test_packets_split_across_tcp_reads_are_reassembled(server_factory):
    """帧可能跨多次 recv 到达，解析器必须能续接。"""
    payload = {"from": "root", "padding": "x" * 5000}
    server = server_factory([(None, [payload])])
    connection = RdpConnection(port=server.port, timeout=5).connect()
    try:
        assert connection.greeting["padding"] == "x" * 5000
    finally:
        connection.close()


def test_paused_and_resumed_are_treated_as_events():
    assert "paused" in EVENT_TYPES
    assert "resumed" in EVENT_TYPES
    # interrupt 的确认包 type 与方法同名，必须按应答处理
    assert "interrupt" not in EVENT_TYPES
