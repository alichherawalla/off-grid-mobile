#!/usr/bin/env bash
# Refresh ONLY the JavaScript in the already-installed Debug build on a physical
# device, then reinstall + relaunch. No xcodebuild, no Metro connection needed.
#
# Why this exists: on a physical device a Debug build does NOT load JS from
# Metro unless the packager probe succeeds. RN's RCTBundleURLProvider probes
# http://<ip-from-ip.txt>:8081/status synchronously during app launch; if that
# probe fails (e.g. iOS Local Network privacy blocks it) the app silently falls
# back to the embedded main.jsbundle and shows the
# "Connect to Metro to develop JavaScript." banner (RCTDevLoadingView
# showWithURL: -> showOfflineMessage, taken whenever the bundle URL is file://).
#
# The embedded bundle is a real DEV bundle (react-native-xcode.sh sets DEV=true
# for device Debug builds), so __DEV__ stays true and the debug log sink in
# src/utils/debugLogFile.ts keeps working. What you lose is only Fast Refresh.
#
# This script rebundles JS + assets straight into the existing .app and
# reinstalls it, which takes ~1 min and costs no extra disk — as opposed to a
# full xcodebuild into a second derivedDataPath.
#
# Usage:
#   ./scripts/ios-refresh-js.sh              # auto-detect device + newest Debug .app
#   IOS_DEVICE_ID=<udid> ./scripts/ios-refresh-js.sh
#   IOS_APP_PATH=/path/to/OffgridMobile.app ./scripts/ios-refresh-js.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# --- device -----------------------------------------------------------------
# Same detection contract as scripts/ios-device.sh: select on
# connectionProperties.tunnelState == "connected", never on transportType.
detect_device_id() {
  local json
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || { rm -f "$json"; return 0; }
  python3 - "$json" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)
for dev in devices:
    if dev.get("connectionProperties", {}).get("tunnelState") == "connected":
        udid = dev.get("hardwareProperties", {}).get("udid")
        if udid:
            print(udid)
            break
PY
  rm -f "$json"
}

DEVICE_ID="${IOS_DEVICE_ID:-$(detect_device_id)}"
if [ -z "$DEVICE_ID" ]; then
  echo "No connected iOS device found. Plug in and trust a device, or set IOS_DEVICE_ID." >&2
  exit 1
fi

# --- app --------------------------------------------------------------------
# Prefer an explicit path, then this repo's ios/build/device output (used by
# scripts/ios-device.sh), then the newest Xcode DerivedData Debug-iphoneos app.
find_app() {
  if [ -n "${IOS_APP_PATH:-}" ]; then echo "$IOS_APP_PATH"; return; fi
  local local_app="ios/build/device/Build/Products/Debug-iphoneos/OffgridMobile.app"
  if [ -d "$local_app" ]; then echo "$local_app"; return; fi
  ls -dt "$HOME/Library/Developer/Xcode/DerivedData"/OffgridMobile-*/Build/Products/Debug-iphoneos/OffgridMobile.app 2>/dev/null | head -1
}

APP="$(find_app)"
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "No built Debug .app found. Build once in Xcode (or ./scripts/ios-device.sh) first." >&2
  exit 1
fi
echo "Device : $DEVICE_ID"
echo "App    : $APP"

# --- bundle -----------------------------------------------------------------
# dev=true keeps __DEV__ on so the debug log sink + LogBox stay available.
echo "Bundling JS + assets into the .app ..."
npx react-native bundle \
  --platform ios \
  --dev true \
  --entry-file index.js \
  --bundle-output "$APP/main.jsbundle" \
  --assets-dest "$APP"

# --- re-sign ----------------------------------------------------------------
# Changing resources inside a signed .app breaks its seal, and iOS refuses to
# install an app whose signature does not verify. So re-sign, reusing the
# identity that already signed the app (we then need no team/profile knowledge).
#
# Sign by SHA-1 HASH, never by the human-readable name: the same
# "Apple Development: <name> (<id>)" string can match several certs in the
# keychain — including expired/revoked ones — and codesign then fails with an
# ambiguity error. Override with IOS_SIGN_ID if you need a specific cert.
resolve_sign_id() {
  if [ -n "${IOS_SIGN_ID:-}" ]; then echo "$IOS_SIGN_ID"; return; fi
  local authority
  authority="$(codesign -dvv "$APP" 2>&1 | awk -F'= *' '/^Authority=/{print $2; exit}')" || true
  [ -n "$authority" ] || return 0
  # Match that authority among codesigning identities, skipping any the keychain
  # flags as unusable (revoked/expired show up with a CSSMERR_ marker).
  security find-identity -v -p codesigning 2>/dev/null \
    | grep -F "$authority" \
    | grep -v CSSMERR_ \
    | awk '{print $2; exit}'
}

# Preserve the existing entitlements — this app needs
# extended-virtual-addressing + increased-memory-limit to run the large models,
# and dropping them yields an app that installs but dies under load.
ENT_FILE="$(mktemp -t offgrid-ent).plist"
if ! codesign -d --entitlements :- --xml "$APP" > "$ENT_FILE" 2>/dev/null; then
  codesign -d --entitlements :- "$APP" > "$ENT_FILE" 2>/dev/null || true
fi
[ -s "$ENT_FILE" ] || { echo "Could not read entitlements from $APP; aborting rather than installing an app that would lose its memory entitlements." >&2; exit 1; }

SIGN_ID="$(resolve_sign_id)"
[ -n "$SIGN_ID" ] || { echo "Could not resolve a usable codesigning identity for $APP. Set IOS_SIGN_ID=<sha1> (see: security find-identity -v -p codesigning)." >&2; exit 1; }

echo "Re-signing with identity $SIGN_ID ..."
codesign --force --sign "$SIGN_ID" \
  --entitlements "$ENT_FILE" \
  --generate-entitlement-der \
  "$APP"
codesign --verify --verbose=2 "$APP"
rm -f "$ENT_FILE"

# --- reinstall + relaunch ---------------------------------------------------
# The CoreDevice tunnel drops if the phone leaves the network or locks, which
# surfaces as CoreDeviceError 3002 / "Connection interrupted" partway through
# the transfer. Retry a couple of times before giving up so a brief hiccup does
# not cost the whole (already-completed) bundle step.
echo "Installing ..."
for attempt in 1 2 3; do
  if xcrun devicectl device install app --device "$DEVICE_ID" "$APP"; then
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "Install failed 3 times. Unlock the phone, confirm it is on the same Wi-Fi as this Mac, then re-run (the JS bundle is already built, so this is quick)." >&2
    exit 1
  fi
  echo "Install attempt $attempt failed; retrying in 5s ..." >&2
  /bin/sleep 5
done

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null || echo 'ai.offgridmobile.dev')"
echo "Launching $BUNDLE_ID ..."
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"

echo
echo "Done. The app is running your current JS from the embedded bundle."
echo "The \"Connect to Metro\" banner is expected here and is cosmetic — it only"
echo "means the bundle came from file:// rather than the packager."
