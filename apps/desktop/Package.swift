// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "RaphieDesktop",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "RaphieDesktop", targets: ["RaphieDesktop"])],
    targets: [
        .target(name: "RaphieClient"),
        .executableTarget(name: "RaphieDesktop", dependencies: ["RaphieClient"]),
        .testTarget(name: "RaphieClientTests", dependencies: ["RaphieClient"]),
    ]
)
