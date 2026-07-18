# English SRS iOS wrapper

This is a compile-ready native iOS wrapper around the existing static frontend.
It uses `WKWebView` and includes the repository's `frontend` directory as a bundled resource.

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

- `FrontendURL`: when set, the app loads this hosted frontend URL directly.
- `APIBaseURL`: used when `FrontendURL` is empty and the bundled frontend is loaded from the app.

The current default bundles this repository's frontend and injects:

```text
https://repeat-every-day.com/api
```

If session cookies do not persist in bundled mode, deploy the frontend and backend on the same HTTPS origin and set `FrontendURL` to that frontend URL. That is the most reliable mode for cookie-based Spring sessions inside `WKWebView`.

## Frontend feature parity

The Xcode project references `../../frontend` as a folder resource. That means current frontend features, including Stats, AI naturalness checks, review voice playback, and the latest review UI, are included on the next Xcode build.

The AI naturalness check still runs through the Spring backend. Make sure the backend process has:

```bash
export ANTHROPIC_API_KEY=your_api_key
export ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

The iOS wrapper opens external learning links launched by the frontend, such as YouGlish, Playphrase, and video links, in Safari instead of replacing the app's bundled page.

## Notes

- The project references `../../frontend` from the Xcode project directory, so new frontend changes are included on the next Xcode build.
- `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` are included for the review speaking flow.
- `NSAllowsArbitraryLoadsInWebContent` is enabled so simulator/dev builds can point to non-HTTPS test servers if needed.
