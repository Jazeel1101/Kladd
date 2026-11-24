// swift-tools-version: 6.1
import PackageDescription

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
      dependencies: [
        .product(name: "PermissionFlow", package: "PermissionFlow")
      ],
      path: "Sources/KladdCapture",
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
