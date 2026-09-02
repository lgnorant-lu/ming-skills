# WebDriver BiDi Core Coverage

- Source: https://w3c.github.io/webdriver-bidi/
- Revision: `27a2f4b1aa258bb8c6859eb7ee265add0f9840fb`
- Source date: 2026-08-25T10:57:04Z

This report measures ruyiPage's low-level core protocol name surface.
Parameter schemas are guarded by `tests/test_bidi_schema_conformance.py`
and browser runtime support is deliberately reported separately.

External WebDriver BiDi specifications such as Bluetooth, Digital
Credentials, Permissions, Speculation, and User-Agent Client Hints are
outside this core snapshot and are not counted as part of 67/24.

## Summary

| Name surface | W3C | Covered | Missing | Coverage |
| --- | ---: | ---: | ---: | ---: |
| Commands | 67 | 67 | 0 | 100.0% |
| Events | 24 | 24 | 0 | 100.0% |

Events are covered by the generic `page.events` subscriber, which preserves
the complete event payload in `BidiEvent.params`.

## Modules

| Module | Commands | Wrapped | Events | Subscribable |
| --- | ---: | ---: | ---: | ---: |
| session | 5 | 5 | 0 | 0 |
| browser | 7 | 7 | 0 | 0 |
| browsingContext | 15 | 15 | 14 | 14 |
| emulation | 13 | 13 | 0 | 0 |
| network | 13 | 13 | 5 | 5 |
| script | 6 | 6 | 3 | 3 |
| storage | 3 | 3 | 0 | 0 |
| input | 3 | 3 | 1 | 1 |
| webExtension | 2 | 2 | 0 | 0 |
| log | 0 | 0 | 1 | 1 |

## Commands

### session

| Command | Status |
| --- | --- |
| `session.status` | wrapped |
| `session.new` | wrapped |
| `session.end` | wrapped |
| `session.subscribe` | wrapped |
| `session.unsubscribe` | wrapped |

### browser

| Command | Status |
| --- | --- |
| `browser.close` | wrapped |
| `browser.createUserContext` | wrapped |
| `browser.getClientWindows` | wrapped |
| `browser.getUserContexts` | wrapped |
| `browser.removeUserContext` | wrapped |
| `browser.setClientWindowState` | wrapped |
| `browser.setDownloadBehavior` | wrapped |

### browsingContext

| Command | Status |
| --- | --- |
| `browsingContext.activate` | wrapped |
| `browsingContext.captureScreenshot` | wrapped |
| `browsingContext.close` | wrapped |
| `browsingContext.create` | wrapped |
| `browsingContext.getTree` | wrapped |
| `browsingContext.handleUserPrompt` | wrapped |
| `browsingContext.locateNodes` | wrapped |
| `browsingContext.navigate` | wrapped |
| `browsingContext.print` | wrapped |
| `browsingContext.reload` | wrapped |
| `browsingContext.setBypassCSP` | wrapped |
| `browsingContext.setViewport` | wrapped |
| `browsingContext.startScreencast` | wrapped |
| `browsingContext.stopScreencast` | wrapped |
| `browsingContext.traverseHistory` | wrapped |

### emulation

| Command | Status |
| --- | --- |
| `emulation.setForcedColorsModeThemeOverride` | wrapped |
| `emulation.setGeolocationOverride` | wrapped |
| `emulation.setLocaleOverride` | wrapped |
| `emulation.setMediaFeaturesOverride` | wrapped |
| `emulation.setNetworkConditions` | wrapped |
| `emulation.setScreenSettingsOverride` | wrapped |
| `emulation.setScreenOrientationOverride` | wrapped |
| `emulation.setUserAgentOverride` | wrapped |
| `emulation.setViewportMetaOverride` | wrapped |
| `emulation.setScriptingEnabled` | wrapped |
| `emulation.setScrollbarTypeOverride` | wrapped |
| `emulation.setTimezoneOverride` | wrapped |
| `emulation.setTouchOverride` | wrapped |

### network

| Command | Status |
| --- | --- |
| `network.addDataCollector` | wrapped |
| `network.addIntercept` | wrapped |
| `network.continueRequest` | wrapped |
| `network.continueResponse` | wrapped |
| `network.continueWithAuth` | wrapped |
| `network.disownData` | wrapped |
| `network.failRequest` | wrapped |
| `network.getData` | wrapped |
| `network.provideResponse` | wrapped |
| `network.removeDataCollector` | wrapped |
| `network.removeIntercept` | wrapped |
| `network.setCacheBehavior` | wrapped |
| `network.setExtraHeaders` | wrapped |

### script

| Command | Status |
| --- | --- |
| `script.addPreloadScript` | wrapped |
| `script.disown` | wrapped |
| `script.callFunction` | wrapped |
| `script.evaluate` | wrapped |
| `script.getRealms` | wrapped |
| `script.removePreloadScript` | wrapped |

### storage

| Command | Status |
| --- | --- |
| `storage.getCookies` | wrapped |
| `storage.setCookie` | wrapped |
| `storage.deleteCookies` | wrapped |

### input

| Command | Status |
| --- | --- |
| `input.performActions` | wrapped |
| `input.releaseActions` | wrapped |
| `input.setFiles` | wrapped |

### webExtension

| Command | Status |
| --- | --- |
| `webExtension.install` | wrapped |
| `webExtension.uninstall` | wrapped |

## Events

### browsingContext

| Event | Status |
| --- | --- |
| `browsingContext.contextCreated` | generic subscriber |
| `browsingContext.contextDestroyed` | generic subscriber |
| `browsingContext.navigationStarted` | generic subscriber |
| `browsingContext.fragmentNavigated` | generic subscriber |
| `browsingContext.historyUpdated` | generic subscriber |
| `browsingContext.domContentLoaded` | generic subscriber |
| `browsingContext.load` | generic subscriber |
| `browsingContext.downloadWillBegin` | generic subscriber |
| `browsingContext.downloadEnd` | generic subscriber |
| `browsingContext.navigationAborted` | generic subscriber |
| `browsingContext.navigationCommitted` | generic subscriber |
| `browsingContext.navigationFailed` | generic subscriber |
| `browsingContext.userPromptClosed` | generic subscriber |
| `browsingContext.userPromptOpened` | generic subscriber |

### network

| Event | Status |
| --- | --- |
| `network.authRequired` | generic subscriber |
| `network.beforeRequestSent` | generic subscriber |
| `network.fetchError` | generic subscriber |
| `network.responseCompleted` | generic subscriber |
| `network.responseStarted` | generic subscriber |

### script

| Event | Status |
| --- | --- |
| `script.message` | generic subscriber |
| `script.realmCreated` | generic subscriber |
| `script.realmDestroyed` | generic subscriber |

### input

| Event | Status |
| --- | --- |
| `input.fileDialogOpened` | generic subscriber |

### log

| Event | Status |
| --- | --- |
| `log.entryAdded` | generic subscriber |

## Non-W3C Extensions

- `emulation.setBypassCSP`
- `emulation.setDocumentCookieDisabled`
- `emulation.setFocusEmulation`
- `emulation.setHardwareConcurrency`
- `permissions.setPermission`

## Runtime Note

A wrapper means ruyiPage can serialize and send the command. It does not mean
every Firefox release implements that command or emits every event.
