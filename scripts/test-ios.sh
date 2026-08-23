#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../ios"

# Simulator names change between Xcode releases and CI images. Select an available iPhone by its
# stable runtime identifier instead of assuming one named model is installed everywhere.
if [ -n "${IOS_SIMULATOR_ID:-}" ]; then
  simulator_id="$IOS_SIMULATOR_ID"
else
  simulator_id="$(xcrun simctl list devices available -j | python3 -c '
import json, re, sys

devices = json.load(sys.stdin).get("devices", {})
def runtime_version(runtime):
    return tuple(int(part) for part in re.findall(r"\d+", runtime))

for runtime in sorted(devices, key=runtime_version, reverse=True):
    for device in devices[runtime]:
        if device.get("isAvailable") and "iPhone" in device.get("deviceTypeIdentifier", ""):
            print(device["udid"])
            raise SystemExit(0)
raise SystemExit("No available iPhone simulator is installed.")
')"
fi

xcodebuild test \
  -workspace OffgridMobile.xcworkspace \
  -scheme OffgridMobile \
  -destination "platform=iOS Simulator,id=${simulator_id}" \
  -only-testing:OffgridMobileTests \
  | (xcpretty 2>/dev/null || cat)
