import XCTest
@testable import Changelark

/// Launch logic when the developer replied: open the chat for that version, and save the check only once it was on screen.
@MainActor
final class RepliesTests: XCTestCase {
    func testOpensChatWhenDeveloperReplied() async throws {
        Stub.routes = [
            "/new-replies": #"{"count":1,"version":"3.9","checkedAt":"t1"}"#,
            "/whats-new": #"{"state":"available","release":{"id":"r39","version":"3.9","notes":"Hi","date":"2026-10-01","upCount":0,"downCount":0,"myVote":0,"commentCount":2}}"#,
        ]
        let (model, store) = try make(checkedAt: "t0")
        await model.launch()
        XCTAssertEqual(model.presented?.version, "3.9")
        XCTAssertEqual(model.repliesCheckedAt, "t1", "sheet opens on the chat")
        XCTAssertEqual(store.state.repliesCheckedAt, "t0", "not saved before it's on screen")
        model.didPresent()
        XCTAssertEqual(store.state.repliesCheckedAt, "t1")
    }

    func testNoRepliesJustMovesTheClock() async throws {
        Stub.routes = ["/new-replies": #"{"count":0,"version":null,"checkedAt":"t2"}"#]
        let (model, store) = try make(checkedAt: nil)
        await model.launch()
        XCTAssertNil(model.presented)
        XCTAssertEqual(store.state.repliesCheckedAt, "t2")
    }

    /// Installed version 4.0 was already shown, so launch goes straight to the replies check.
    private func make(checkedAt: String?) throws -> (ChangelarkModel, InstallStore) {
        let defaults = UserDefaults(suiteName: "changelark-test-\(UUID().uuidString)")!
        let store = InstallStore(defaults: defaults)
        var s = DeviceState()
        s.firstSeenVersion = "4"; s.lastKnownVersion = "4"; s.handledVersions = ["4"]; s.repliesCheckedAt = checkedAt
        store.state = s
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Stub.self]
        let client = try ChangelarkClient(baseURL: URL(string: "https://test.example")!, appKey: "clk_test", installID: "install", appVersion: "4.0", session: URLSession(configuration: config))
        return (ChangelarkModel(client: client, appVersion: "4.0", treatFirstLaunchAsUpdate: false, store: store), store)
    }
}

/// Answers each request by its path after /api/v1/sdk.
final class Stub: URLProtocol {
    nonisolated(unsafe) static var routes: [String: String] = [:]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path.replacingOccurrences(of: "/api/v1/sdk", with: "")
        let body = Stub.routes[path]
        let response = HTTPURLResponse(url: request.url!, statusCode: body == nil ? 404 : 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((body ?? #"{"error":{"code":"nope","message":"no stub"}}"#).utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
