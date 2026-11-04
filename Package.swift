// swift-tools-version:5.9
// The Swift package lives in sdk/swift; this manifest sits at the repository root so Xcode can add it by URL.
import PackageDescription

let package = Package(
    name: "Changelark",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "Changelark", targets: ["Changelark"])],
    targets: [
        .target(name: "Changelark", path: "sdk/swift/Sources/Changelark"),
        .testTarget(name: "ChangelarkTests", dependencies: ["Changelark"], path: "sdk/swift/Tests/ChangelarkTests"),
    ]
)
