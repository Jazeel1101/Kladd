// swift-tools-version: 6.1
import Foundation
import PackageDescription

// PermissionFlow uses SwiftUI macros, which only Xcode can build. native/build.sh sets
// KLADD_NO_PERMISSIONFLOW=1 without Xcode; the package stays declared so Package.resolved
// doesn't change, but nothing compiles it.
let withPermissionFlow = ProcessInfo.processInfo.environment["KLADD_NO_PERMISSIONFLOW"] == nil

// kladd-capture: the macOS helper ScreenCaptureDarwin runs for permission, screenshots and video.
let package = Package(
  name: "KladdCapture",
  platforms: [.macOS(.v15)],
  dependencies: [
    .package(url: "https://github.com/noxaur/PermissionFlow.git", exact: "2.11.3")
  ],
  targets: [
    .executableTarget(
      name: "kladd-capture",
      dependencies: withPermissionFlow
        ? [.product(name: "PermissionFlow", package: "PermissionFlow")]
        : [],
      path: "Sources/KladdCapture",
      swiftSettings: [.swiftLanguageMode(.v5)]
        + (withPermissionFlow ? [.define("KLADD_PERMISSIONFLOW")] : [])
    )
  ]
)
