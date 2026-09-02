# -*- coding: utf-8 -*-
"""元素几何读取失败必须报错，而不是静默返回 0（issue #19）。"""

import pytest

from ruyipage._elements.firefox_element import FirefoxElement
from ruyipage._functions.bidi_values import JS_FAILED
from ruyipage._units.rect import ElementRect
from ruyipage.errors import ElementGeometryError, NoRectError


class _StubElement(object):
    """只提供 _run_safe 的最小元素替身。"""

    _read_geometry = FirefoxElement._read_geometry
    _get_center = FirefoxElement._get_center

    def __init__(self, result):
        self._result = result
        self.scripts = []

    def _run_safe(self, func_declaration, *args):
        self.scripts.append(func_declaration)
        return self._result


def test_js_failure_sentinel_is_falsy_so_legacy_defaults_still_work():
    """哨兵必须为假值，否则历史上的 ``_run_safe(...) or default`` 会行为改变。"""
    assert not JS_FAILED
    assert (JS_FAILED or False) is False
    assert (JS_FAILED or {"width": 0}) == {"width": 0}


def test_size_raises_when_call_fails():
    element = _StubElement(JS_FAILED)

    with pytest.raises(ElementGeometryError) as excinfo:
        FirefoxElement.size.fget(element)

    assert "尺寸" in str(excinfo.value)
    assert "序列化" in str(excinfo.value)


def test_size_raises_when_object_serialization_is_truncated():
    """比特浏览器定制 128 内核会把 {width, height} 序列化成空对象。"""
    element = _StubElement({})

    with pytest.raises(ElementGeometryError) as excinfo:
        FirefoxElement.size.fget(element)

    assert "不完整" in str(excinfo.value)


def test_location_raises_when_keys_are_missing():
    element = _StubElement({"x": 3})

    with pytest.raises(ElementGeometryError):
        FirefoxElement.location.fget(element)


def test_size_returns_real_geometry_when_available():
    element = _StubElement({"width": 322, "height": 30})

    assert FirefoxElement.size.fget(element) == {"width": 322, "height": 30}


def test_get_center_returns_none_for_element_without_box():
    """JS 显式返回 null 表示元素没有盒子，是合法结果而非错误。"""
    element = _StubElement(None)

    assert element._get_center() is None


def test_get_center_raises_when_call_fails():
    element = _StubElement(JS_FAILED)

    with pytest.raises(ElementGeometryError):
        element._get_center()


def test_get_center_raises_on_truncated_object():
    element = _StubElement({})

    with pytest.raises(ElementGeometryError):
        element._get_center(scroll=False)


def test_rect_viewport_accessors_propagate_geometry_errors():
    rect = ElementRect(_StubElement(JS_FAILED))

    with pytest.raises(ElementGeometryError):
        rect.viewport_location

    with pytest.raises(ElementGeometryError):
        rect.viewport_midpoint


def test_rect_viewport_accessors_return_values_when_available():
    rect = ElementRect(_StubElement({"x": 804, "y": 393}))

    assert rect.viewport_location == (804, 393)


def test_read_geometry_accepts_genuine_zero_coordinates():
    """(0, 0) 是合法几何值，只有读取失败才该报错。"""
    element = _StubElement({"x": 0, "y": 0})

    assert element._read_geometry("(el) => el", ("x", "y"), "可点击坐标") == {
        "x": 0,
        "y": 0,
    }


def test_element_js_declares_unlimited_object_depth(monkeypatch):
    """必须显式声明 maxObjectDepth，避免定制内核按 0 处理导致对象被截断。"""
    from ruyipage._elements import firefox_element as element_module

    captured = {}

    def fake_call_function(driver, context, declaration, **kwargs):
        captured.update(kwargs)
        return {"type": "success", "result": {"type": "undefined"}}

    monkeypatch.setattr(
        element_module.bidi_script, "call_function", fake_call_function
    )

    element = FirefoxElement.__new__(FirefoxElement)
    element._shared_id = "shared-1"
    element._handle = None

    class _Owner:
        _context_id = "context-1"

        class _Driver:
            _browser_driver = object()

        _driver = _Driver()

    element._owner = _Owner()

    element._call_js_on_self_raw("(el) => el")

    options = captured["serialization_options"]
    assert options["maxObjectDepth"] is None
    assert options["maxDomDepth"] == 0
