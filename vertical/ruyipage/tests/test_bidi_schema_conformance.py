import pytest

from ruyipage._bidi import (
    browser_module,
    browsing_context,
    emulation,
    input_,
    log,
    network,
    permissions,
    script,
    session,
    storage,
    web_extension,
)
from ruyipage._units.events import BidiEvent


class DummyDriver:
    def __init__(self):
        self.calls = []

    def run(self, method, params=None, **kwargs):
        self.calls.append((method, params, kwargs))
        return {}


def test_pen_actions_use_current_pointer_common_properties():
    actions = input_.build_pen_action(
        10,
        20,
        altitude_angle=0.5,
        azimuth_angle=1.25,
        width=4,
        height=6,
    )[0]["actions"]

    for action in actions[:2]:
        assert "tiltX" not in action
        assert "tiltY" not in action
        assert action["altitudeAngle"] == 0.5
        assert action["azimuthAngle"] == 1.25
        assert action["width"] == 4
        assert action["height"] == 6


def test_wheel_actions_do_not_emit_removed_fields():
    action = input_.build_wheel_action(
        10,
        20,
        delta_x=2,
        delta_y=3,
        duration=40,
    )[0]["actions"][0]

    assert action == {
        "type": "scroll",
        "x": 10,
        "y": 20,
        "deltaX": 2,
        "deltaY": 3,
        "duration": 40,
    }


def test_script_ownership_and_plain_type_key_serialization():
    driver = DummyDriver()

    script.call_function(
        driver,
        "context-1",
        "value => value",
        arguments=[{"type": "invoice", "amount": 3}],
        result_ownership="none",
    )

    params = driver.calls[-1][1]
    assert params["resultOwnership"] == "none"
    assert params["arguments"] == [
        {
            "type": "object",
            "value": [
                ["type", {"type": "string", "value": "invoice"}],
                ["amount", {"type": "number", "value": 3}],
            ],
        }
    ]

    script.call_function(driver, "context-1", "() => ({})")
    assert driver.calls[-1][1]["resultOwnership"] == "root"


def test_preload_arguments_only_accept_channel_values():
    driver = DummyDriver()
    channel = {
        "type": "channel",
        "value": {"channel": "updates", "ownership": "none"},
    }

    script.add_preload_script(driver, "channel => channel", arguments=[channel])
    assert driver.calls[-1][1]["arguments"] == [channel]

    with pytest.raises(ValueError, match="ChannelValue"):
        script.add_preload_script(driver, "value => value", arguments=["text"])


def test_unsubscribe_requires_exactly_one_standard_form():
    driver = DummyDriver()

    session.unsubscribe(driver, events=["log.entryAdded"])
    assert driver.calls[-1][1] == {"events": ["log.entryAdded"]}
    session.unsubscribe(driver, subscription="subscription-1")
    assert driver.calls[-1][1] == {"subscriptions": ["subscription-1"]}

    with pytest.raises(ValueError, match="exactly one"):
        session.unsubscribe(driver)
    with pytest.raises(ValueError, match="exactly one"):
        session.unsubscribe(
            driver,
            events=["log.entryAdded"],
            subscription="subscription-1",
        )


def test_client_window_state_enforces_union_shape():
    driver = DummyDriver()

    browser_module.set_client_window_state(
        driver,
        "window-1",
        width=800,
        height=600,
    )
    assert driver.calls[-1][1] == {
        "clientWindow": "window-1",
        "state": "normal",
        "width": 800,
        "height": 600,
    }

    with pytest.raises(ValueError, match="geometry"):
        browser_module.set_client_window_state(
            driver,
            "window-1",
            state="maximized",
            width=800,
        )


def test_continue_with_auth_enforces_discriminated_union():
    driver = DummyDriver()
    credentials = {"type": "password", "username": "u", "password": "p"}

    network.continue_with_auth(
        driver,
        "request-1",
        action="provideCredentials",
        credentials=credentials,
    )
    assert driver.calls[-1][1]["credentials"] == credentials

    with pytest.raises(ValueError, match="required"):
        network.continue_with_auth(
            driver,
            "request-1",
            action="provideCredentials",
        )
    with pytest.raises(ValueError, match="only valid"):
        network.continue_with_auth(
            driver,
            "request-1",
            action="cancel",
            credentials=credentials,
        )


def test_emulation_reset_and_validation_shapes():
    driver = DummyDriver()

    emulation.set_screen_orientation_override(driver, contexts=["context-1"])
    assert driver.calls[-1][1] == {
        "screenOrientation": None,
        "contexts": ["context-1"],
    }
    emulation.set_viewport_meta_override(driver, None)
    assert driver.calls[-1][1] == {"viewportMeta": None}
    emulation.set_media_features_override(
        driver,
        {"prefers-color-scheme": "dark"},
    )
    assert driver.calls[-1][1] == {
        "features": {"prefers-color-scheme": "dark"}
    }

    with pytest.raises(ValueError, match="provided together"):
        emulation.set_geolocation_override(driver, latitude=1)
    with pytest.raises(ValueError, match="cannot be combined"):
        emulation.set_geolocation_override(
            driver,
            error={"type": "positionUnavailable"},
            accuracy=1,
        )
    with pytest.raises(ValueError, match="require latitude and longitude"):
        emulation.set_geolocation_override(driver, speed=10)
    with pytest.raises(ValueError, match="positionUnavailable"):
        emulation.set_geolocation_override(driver, error={"type": "denied"})
    with pytest.raises(TypeError, match="dictionary"):
        emulation.set_media_features_override(
            driver,
            [{"name": "prefers-color-scheme", "value": "dark"}],
        )
    with pytest.raises(ValueError, match="True or None"):
        emulation.set_viewport_meta_override(driver, False)
    with pytest.raises(ValueError, match="True or None"):
        emulation.set_viewport_meta_override(driver, 1)
    with pytest.raises(ValueError, match="1..9007199254740991"):
        emulation.set_touch_override(driver, 0)
    with pytest.raises(ValueError, match="required"):
        emulation.set_locale_override(driver, "en-US")


def test_viewport_and_csp_can_send_standard_null_resets():
    driver = DummyDriver()

    browsing_context.set_viewport(
        driver,
        context="context-1",
        width=None,
        height=None,
        device_pixel_ratio=None,
    )
    assert driver.calls[-1][1] == {
        "context": "context-1",
        "viewport": None,
        "devicePixelRatio": None,
    }
    browsing_context.set_bypass_csp(
        driver,
        contexts=["context-1"],
        enabled=False,
    )
    assert driver.calls[-1][1] == {
        "bypass": None,
        "contexts": ["context-1"],
    }

    with pytest.raises(ValueError, match="True or None"):
        browsing_context.set_bypass_csp(driver, bypass=False)
    with pytest.raises(ValueError, match="True or None"):
        browsing_context.set_bypass_csp(driver, bypass=1)
    with pytest.raises(ValueError, match="required"):
        browsing_context.set_viewport(driver, width=800, height=600)
    with pytest.raises(ValueError, match="must not be empty"):
        browsing_context.set_viewport(
            driver,
            width=800,
            height=600,
            user_contexts=[],
        )


def test_removed_input_fields_keep_positional_slots_without_reaching_wire():
    pen = input_.build_pen_action(
        10,
        20,
        0.5,
        0,
        0,
        45,
        0.25,
        0,
        60,
    )[0]["actions"][0]
    assert pen["twist"] == 45
    assert pen["tangentialPressure"] == 0.25
    assert pen["duration"] == 60
    assert "tiltX" not in pen and "tiltY" not in pen

    wheel = input_.build_wheel_action(1, 2, 3, 4, 0, 0, 50, "pointer")
    assert wheel[0]["actions"][0] == {
        "type": "scroll",
        "x": 1,
        "y": 2,
        "deltaX": 3,
        "deltaY": 4,
        "duration": 50,
        "origin": "pointer",
    }

    with pytest.raises(ValueError, match="removed"):
        input_.build_pen_action(1, 2, tilt_x=1)
    with pytest.raises(ValueError, match="not part"):
        input_.build_wheel_action(1, 2, delta_z=1)


def test_legacy_positional_parameters_do_not_shift_standard_fields():
    driver = DummyDriver()

    with pytest.warns(DeprecationWarning, match="events"):
        network.add_data_collector(
            driver,
            ["responseCompleted"],
            ["context-1"],
            data_types=["response"],
        )
    assert driver.calls[-1][1] == {
        "dataTypes": ["response"],
        "maxEncodedDataSize": 10485760,
        "collectorType": "blob",
        "contexts": ["context-1"],
    }

    with pytest.raises(ValueError, match="does not accept contexts"):
        permissions.set_permission(
            driver,
            {"name": "geolocation"},
            "granted",
            "https://example.com",
            ["legacy-context"],
        )

    emulation.set_screen_orientation_override(
        driver,
        "landscape-primary",
        90,
        ["context-1"],
    )
    assert driver.calls[-1][1]["contexts"] == ["context-1"]

    with pytest.raises(ValueError, match="device_pixel_ratio"):
        emulation.set_screen_settings_override(
            driver,
            800,
            600,
            2,
            ["context-1"],
        )


def test_storage_partition_rejects_unknown_descriptor():
    driver = DummyDriver()

    with pytest.raises(ValueError, match="identify"):
        storage.get_cookies(driver, partition={"opaque": "value"})
    with pytest.raises(ValueError, match="does not accept fields"):
        storage.get_cookies(
            driver,
            partition={
                "type": "context",
                "context": "context-1",
                "userContext": "user-context-1",
            },
        )

    storage.get_cookies(
        driver,
        partition={
            "type": "storageKey",
            "userContext": None,
            "sourceOrigin": None,
        },
    )
    assert driver.calls[-1][1] == {"partition": {"type": "storageKey"}}


def test_web_extension_supports_base64_extension_data():
    driver = DummyDriver()

    web_extension.install(driver, base64_value="ZXh0ZW5zaW9u")
    assert driver.calls[-1][1] == {
        "extensionData": {"type": "base64", "value": "ZXh0ZW5zaW9u"}
    }


def test_permissions_extension_uses_current_optional_fields():
    driver = DummyDriver()

    permissions.set_permission(
        driver,
        {"name": "geolocation"},
        "granted",
        origin="https://example.com",
        embedded_origin="https://embed.example.com",
        user_context="user-context-1",
    )
    assert driver.calls[-1][1] == {
        "descriptor": {"name": "geolocation"},
        "state": "granted",
        "origin": "https://example.com",
        "embeddedOrigin": "https://embed.example.com",
        "userContext": "user-context-1",
    }


def test_nullable_log_text_and_auth_challenges_are_preserved():
    entry = log.LogEntry.from_params({"level": "info", "text": None})
    assert entry.text is None
    assert repr(entry) == "<LogEntry [info] >"

    event = BidiEvent(
        "network.authRequired",
        {"response": {"authChallenges": [{"scheme": "basic", "realm": "x"}]}},
    )
    assert event.auth_challenges == [{"scheme": "basic", "realm": "x"}]
    assert event.auth_challenge == {"scheme": "basic", "realm": "x"}
