# Repeat Every Day iOS wrapper

This is a compile-ready native iOS wrapper around the existing frontend.
It uses `WKWebView`. Production loads the hosted frontend so the Spring session cookie, frontend, and API all share the same HTTPS origin.

## Build on macOS

Open the project in Xcode:

```bash
open ios/EnglishSRS/EnglishSRS.xcodeproj
```

Or build from the command line:

```bash
xcodebuild \
  -project ios/EnglishSRS/EnglishSRS.xcodeproj \
  -scheme EnglishSRS \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  build
```

Linux cannot compile or sign iOS apps because that requires Xcode on macOS.

## Runtime configuration

Edit `EnglishSRS/AppConfig.plist` before building:

- `FrontendURL`: hosted frontend URL loaded by the app. The current default is `https://repeat-every-day.com`.
- `APIBaseURL`: injected into the frontend as `window.__ENGLISH_APP_API_BASE__`. The current default is `https://repeat-every-day.com/api`.

For local bundled testing, clear `FrontendURL`. The Xcode project still includes `../../frontend` as a folder resource and the wrapper will load `frontend/index.html` from the app bundle.

For production, keep frontend and backend under the same HTTPS origin. Session auth is cookie-based, not token-based, and same-origin hosted mode is the reliable path for cookie persistence in `WKWebView`.

## Frontend feature parity

The hosted frontend keeps the iOS app current after each frontend deploy. Bundled mode also picks up current frontend files on the next Xcode build because the project references `../../frontend`.

Current frontend features covered by this wrapper include:

- `INITIAL`, `REGULAR`, and `WEEKLY_CATCH_UP` review sessions.
- Partial review-session completion, where completed sentences are saved and unfinished ones stay pending.
- In-list test reviews counting as the first review, or as a due review when the sentence is currently due.
- Review speech checking, staged multi-sentence checks, and listen-back playback for the user's recording.
- Stats, per-sentence stats, AI naturalness checks with backend cache, YouGlish, Playphrase, and attached video links.

The AI naturalness check still runs through the Spring backend. Make sure the backend process has:

```bash
export ANTHROPIC_API_KEY=your_api_key
export ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

The iOS wrapper opens external learning links launched by the frontend, such as YouGlish, Playphrase, and video links, in Safari instead of replacing the app's bundled page.

## Notes

- The project references `../../frontend` from the Xcode project directory for bundled/local builds.
- `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` are included for the review speaking flow.
- The WebView uses the default persistent website data store so cookies survive app relaunches.
- `NSAllowsArbitraryLoadsInWebContent` is enabled so simulator/dev builds can point to non-HTTPS test servers if needed.
