#!/bin/zsh
# Builds "Rehearsal.app" into ./build. Usage: ./build.sh [--install]
set -e
cd "$(dirname "$0")"
APP="build/Rehearsal.app"
# version and update settings (release.sh raises the version; release/config names the GitHub repo)
VERSION=$(cat release/VERSION)
NATIVE=$(cat release/NATIVE)
REPO=""; source release/config
PUBKEY=$(cat release/public-key.txt 2>/dev/null || true)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

echo "Compiling Rehearsal $VERSION (native $NATIVE)…"
swiftc -parse-as-library -O -target arm64-apple-macos13.0 native/*.swift -o build/ClassPilot-arm64
swiftc -parse-as-library -O -target x86_64-apple-macos13.0 native/*.swift -o build/ClassPilot-x86_64
lipo -create build/ClassPilot-arm64 build/ClassPilot-x86_64 -output "$APP/Contents/MacOS/ClassPilot"
rm build/ClassPilot-arm64 build/ClassPilot-x86_64

cp -R web/. "$APP/Contents/Resources/web/"
find "$APP/Contents/Resources/web" -name .DS_Store -delete
printf '{"version":"%s","native":%s}\n' "$VERSION" "$NATIVE" > "$APP/Contents/Resources/web/version.json"
[[ -f icon/AppIcon.icns ]] && cp icon/AppIcon.icns "$APP/Contents/Resources/"

# The bundle identifier stays local.classpilot.app (the app's old name) on purpose: macOS keys the
# Screen Recording / Accessibility permissions and the web sign-ins (Google etc.) to it.
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Rehearsal</string>
  <key>CFBundleDisplayName</key><string>Rehearsal</string>
  <key>CFBundleIdentifier</key><string>local.classpilot.app</string>
  <key>CFBundleExecutable</key><string>ClassPilot</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$NATIVE</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>ClassPilotUpdateRepo</key><string>$REPO</string>
  <key>ClassPilotUpdateKey</key><string>$PUBKEY</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Rehearsal uses the microphone for the noise meter, the tuner and grading sight reading. Audio is never sent anywhere.</string>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
</dict></plist>
PLIST

# Ad-hoc sign with a requirement based on the bundle ID (not the build's hash), so macOS
# Screen Recording / Accessibility permissions survive future rebuilds.
codesign --force --deep -s - -r='designated => identifier "local.classpilot.app"' "$APP" >/dev/null 2>&1 \
  || codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
echo "Built: $APP"

if [[ "$1" == "--install" ]]; then
  rm -rf "/Applications/Class Pilot.app"          # the app's old name
  rm -rf "/Applications/Rehearsal.app"
  cp -R "$APP" /Applications/
  echo "Installed to /Applications/Rehearsal.app"
fi
