#!/bin/sh
# Builds kladd-capture and kladd-transcribe. Without Xcode (Command Line Tools only) it leaves out PermissionFlow, whose
# SwiftUI macros only Xcode can build; grant Screen Recording and Accessibility in System Settings.
set -e
cd "$(dirname "$0")"

case "$(xcode-select -p 2>/dev/null)" in
  */CommandLineTools)
    if [ -z "$KLADD_NO_PERMISSIONFLOW" ]; then
      export KLADD_NO_PERMISSIONFLOW=1
      echo "kladd-capture: no Xcode, building without PermissionFlow (grant permissions in System Settings)"
    fi
    ;;
esac

swift build -c release --package-path .

# kladd-transcribe links libswiftCompatibilitySpan, which macOS 26 has in /usr/lib/swift but macOS 15
# doesn't. Copy the toolchain's beside it, where its @loader_path rpath finds it once packaged.
span="$(ls "$(dirname "$(xcrun --find swiftc)")"/../lib/swift-*/macosx/libswiftCompatibilitySpan.dylib | tail -1)"
cp -f "$span" .build/release/
