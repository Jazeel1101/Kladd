#!/bin/sh
# Builds kladd-capture. Without Xcode (Command Line Tools only) it leaves out PermissionFlow, whose
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

exec swift build -c release --package-path .
