## Catches
A `compatibility` value over 500 characters. The Agent Skills spec allows 1 to 500.

## Bad
```markdown
---
name: ios-build
description: Build and sign the iOS app. Use when asked for a TestFlight build.
compatibility: Requires macOS 15 or later with Xcode 16.2 installed at /Applications/Xcode.app, the command line tools selected with xcode-select, a valid Apple Developer account logged in, fastlane 2.228 installed through Homebrew, Ruby 3.3 via rbenv, ... (620 characters)
---
```

## Good
```markdown
---
name: ios-build
description: Build and sign the iOS app. Use when asked for a TestFlight build.
compatibility: Requires macOS 15, Xcode 16.2 and fastlane. See SETUP.md for the full environment.
---
```

## Fix
Name the hard requirements in one line and link a setup file for the rest. Most skills do not need `compatibility` at all.
