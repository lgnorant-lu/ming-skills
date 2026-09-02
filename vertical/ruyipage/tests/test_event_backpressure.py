# -*- coding: utf-8 -*-
"""事件与数据包缓冲的上限、锁与背压行为。"""

import threading

import pytest

import ruyipage._base.driver as driver_module

from ruyipage._base.driver import BrowserBiDiDriver
from ruyipage._functions.settings import Settings
from ruyipage._units.listener import Listener


class _Packet(object):
    def __init__(self, index):
        self.url = "https://example.test/{}".format(index)


def _bare_listener(max_packets):
    """构造一个不连接浏览器的 Listener。"""
    original = Settings.listen_max_packets
    Settings.listen_max_packets = max_packets
    try:
        return Listener(owner=None)
    finally:
        Settings.listen_max_packets = original


def test_listener_history_is_capped():
    listener = _bare_listener(3)

    for index in range(10):
        listener._offer(_Packet(index))

    steps = listener.steps
    assert len(steps) == 3
    assert [p.url[-1] for p in steps] == ["7", "8", "9"]


def test_listener_offer_never_blocks_when_wait_queue_is_full():
    """_offer 跑在事件线程上，队列满时必须丢弃最旧项而不是阻塞。"""
    listener = _bare_listener(2)

    finished = threading.Event()

    def produce():
        for index in range(50):
            listener._offer(_Packet(index))
        finished.set()

    thread = threading.Thread(target=produce)
    thread.start()
    thread.join(timeout=5)

    assert finished.is_set(), "_offer 阻塞了生产线程"
    assert listener._caught.qsize() <= 2


def test_listener_uses_lock_protected_bounded_buffers():
    listener = _bare_listener(5)

    assert isinstance(listener._lock, type(threading.Lock()))
    assert listener._packets.maxlen == 5
    assert listener._caught.maxsize == 5
    # steps 必须返回副本，避免调用方拿到内部容器
    listener._offer(_Packet(0))
    snapshot = listener.steps
    snapshot.clear()
    assert len(listener.steps) == 1


def _bare_driver():
    driver = object.__new__(BrowserBiDiDriver)
    driver._event_queue = driver_module.Queue(maxsize=3)
    driver._immediate_pool = None
    driver._immediate_pending = 0
    driver._immediate_lock = threading.Lock()
    return driver


def test_event_queue_drops_oldest_instead_of_blocking_recv_loop():
    driver = _bare_driver()

    for index in range(10):
        driver._offer_event(("network.responseCompleted", None, {"i": index}))

    assert driver._event_queue.qsize() == 3
    remaining = [driver._event_queue.get_nowait()[2]["i"] for _ in range(3)]
    assert remaining == [7, 8, 9]


def test_event_queue_accepts_shutdown_sentinel_when_full():
    driver = _bare_driver()

    for index in range(5):
        driver._offer_event(("evt", None, {"i": index}))

    driver._offer_event(None)

    items = []
    while not driver._event_queue.empty():
        items.append(driver._event_queue.get_nowait())
    assert None in items


def test_immediate_events_run_on_a_bounded_pool():
    driver = _bare_driver()
    done = threading.Event()
    seen = []

    def handler(params):
        seen.append(params)
        done.set()

    driver._handle_immediate_event(handler, {"ok": True})
    assert done.wait(timeout=5)
    assert seen == [{"ok": True}]
    assert driver._immediate_pool is not None
    assert driver._immediate_pool._max_workers == driver_module._IMMEDIATE_WORKERS

    driver._immediate_pool.shutdown(wait=True)


def test_immediate_events_are_dropped_when_backlog_is_saturated(caplog):
    driver = _bare_driver()
    driver._immediate_pending = driver_module._IMMEDIATE_MAX_PENDING

    called = []

    with caplog.at_level("WARNING", logger="ruyipage"):
        driver._handle_immediate_event(lambda params: called.append(params), {})

    assert called == []
    assert driver._immediate_pool is None
    assert "积压" in caplog.text
