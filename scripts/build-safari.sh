#!/usr/bin/env bash
# Build the Safari (macOS) app wrapper for local, unsigned use.
set -euo pipefail
cd "$(dirname "$0")/.."

npx wxt build -b safari --mv3
rm -rf .output/safari-xcode
xcrun safari-web-extension-converter .output/safari-mv3 \
  --project-location .output/safari-xcode \
  --app-name "lingo-patch" \
  --bundle-identifier "dev.local.lingo-patch" \
  --macos-only --no-open --no-prompt --copy-resources --force

xcodebuild -project .output/safari-xcode/lingo-patch/lingo-patch.xcodeproj \
  -scheme lingo-patch -configuration Debug \
  -derivedDataPath .output/safari-xcode/build \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" \
  build | grep -E "error:|BUILD (SUCCEEDED|FAILED)"

echo "App: .output/safari-xcode/build/Build/Products/Debug/lingo-patch.app"
