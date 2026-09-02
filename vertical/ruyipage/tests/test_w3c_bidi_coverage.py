import importlib.util
from pathlib import Path

from ruyipage._units.contexts import ContextManager
from ruyipage._units.emulation import EmulationManager


PROJECT_ROOT = Path(__file__).resolve().parents[1]
W3C_DIR = PROJECT_ROOT / "examples" / "w3c_bidi"


def _load_script(name, filename):
    path = W3C_DIR / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


comparison = _load_script("w3c_bidi_comparison", "generate_comparison.py")
extractor = _load_script("w3c_bidi_extractor", "extract_w3c_bidi.py")


class DummyBrowserDriver:
    def __init__(self):
        self.calls = []

    def run(self, method, params=None, **kwargs):
        self.calls.append((method, params, kwargs))
        if method == "browsingContext.startScreencast":
            return {"screencast": "recording-1", "path": "recording.webm"}
        if method == "browsingContext.stopScreencast":
            return {"path": "recording.webm"}
        return {}


class DummyContextDriver:
    def __init__(self, browser_driver):
        self._browser_driver = browser_driver

    def run(self, method, params=None, **kwargs):
        return self._browser_driver.run(method, params, **kwargs)


class DummyOwner:
    def __init__(self):
        browser_driver = DummyBrowserDriver()
        self._driver = DummyContextDriver(browser_driver)
        self._context_id = "context-1"
        self.tab_id = "context-1"


def test_checked_in_w3c_snapshot_matches_expected_revision_shape():
    snapshot = comparison.load_snapshot()

    assert snapshot["schema_version"] == 1
    assert snapshot["scope"] == "core"
    assert snapshot["source"] == extractor.EDITOR_DRAFT_URL
    assert len(snapshot["source_revision"]) == 40
    assert snapshot["total_commands"] == 67
    assert snapshot["total_events"] == 24


def test_all_current_w3c_commands_and_events_are_covered():
    snapshot = comparison.load_snapshot()
    coverage = comparison.build_coverage(snapshot)

    assert coverage["missing_commands"] == set()
    assert coverage["missing_events"] == set()
    assert coverage["generic_events"] is True


def test_checked_in_coverage_report_is_current():
    snapshot = comparison.load_snapshot()
    expected = comparison.render_report(snapshot, comparison.build_coverage(snapshot))
    report = W3C_DIR / "W3C_BIDI_COMPARISON.md"

    assert report.read_text(encoding="utf-8") == expected


def test_extractor_preserves_spec_order_and_groups_modules():
    source = """
#### The session.status Command ####
#### The browsingContext.load Event ####
#### The session.end Command ####
"""
    snapshot = extractor.extract_snapshot(
        source,
        {"source": "fixture", "source_revision": None, "source_date": None},
    )

    assert snapshot["modules"] == ["session", "browsingContext"]
    assert snapshot["commands"] == {
        "session": ["session.status", "session.end"]
    }
    assert snapshot["events"] == {
        "browsingContext": ["browsingContext.load"]
    }


def test_context_manager_exposes_screencast_commands():
    owner = DummyOwner()
    manager = ContextManager(owner)

    started = manager.start_screencast(
        mime_type="video/webm",
        video={"width": 1280, "height": 720, "frameRate": 30},
        audio=True,
    )
    stopped = manager.stop_screencast(started["screencast"])

    assert stopped == {"path": "recording.webm"}
    assert owner._driver._browser_driver.calls == [
        (
            "browsingContext.startScreencast",
            {
                "context": "context-1",
                "mimeType": "video/webm",
                "video": {"width": 1280, "height": 720, "frameRate": 30},
                "audio": True,
            },
            {},
        ),
        (
            "browsingContext.stopScreencast",
            {"screencast": "recording-1"},
            {},
        ),
    ]


def test_context_manager_preserves_unspecified_device_pixel_ratio():
    owner = DummyOwner()

    ContextManager(owner).set_viewport(800, 600)

    assert owner._driver._browser_driver.calls == [
        (
            "browsingContext.setViewport",
            {
                "context": "context-1",
                "viewport": {"width": 800, "height": 600},
            },
            {"timeout": None},
        )
    ]


def test_emulation_manager_exposes_new_editor_draft_commands():
    owner = DummyOwner()
    manager = EmulationManager(owner)

    assert manager.set_media_features(
        {"prefers-color-scheme": "dark", "prefers-reduced-motion": "reduce"}
    )
    assert manager.set_viewport_meta(False)

    assert owner._driver._browser_driver.calls == [
        (
            "emulation.setMediaFeaturesOverride",
            {
                "features": {
                    "prefers-color-scheme": "dark",
                    "prefers-reduced-motion": "reduce",
                },
                "contexts": ["context-1"],
            },
            {},
        ),
        (
            "emulation.setViewportMetaOverride",
            {"viewportMeta": None, "contexts": ["context-1"]},
            {},
        ),
    ]


def test_emulation_manager_accepts_secondary_orientation_without_angle():
    owner = DummyOwner()

    EmulationManager(owner).set_screen_orientation("portrait-secondary")

    assert owner._driver._browser_driver.calls == [
        (
            "emulation.setScreenOrientationOverride",
            {
                "screenOrientation": {
                    "type": "portrait-secondary",
                    "natural": "portrait",
                },
                "contexts": ["context-1"],
            },
            {},
        )
    ]
