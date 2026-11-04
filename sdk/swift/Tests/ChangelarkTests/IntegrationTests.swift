import XCTest
@testable import Changelark

/// Runs against a real Changelark server with the demo workspace: CHANGELARK_TEST_URL=http://127.0.0.1:3000 swift test
final class IntegrationTests: XCTestCase {
    func testTalksToTheServer() async throws {
        let base = try XCTUnwrap(ProcessInfo.processInfo.environment["CHANGELARK_TEST_URL"].flatMap(URL.init(string:)), "set CHANGELARK_TEST_URL")
        let client = try ChangelarkClient(baseURL: base, appKey: "clk_t1d3p00l7q", installID: "swifttest" + UUID().uuidString.prefix(12).lowercased(), appVersion: "4.0")

        let wn = try await client.whatsNew(version: "2.4.0")
        XCTAssertEqual(wn.state, "available")
        let release = try XCTUnwrap(wn.release)

        let up = try await client.vote(.release, id: release.id, value: 1)
        XCTAssertEqual(up.myVote, 1)
        _ = try await client.vote(.release, id: release.id, value: 0)

        do { _ = try await client.addComment(version: "2.4", text: "too early"); XCTFail("posted before accepting guidelines") }
        catch let e as ChangelarkError { XCTAssertEqual(e.code, "guidelines_required") }

        try await client.acceptGuidelines()
        let id = try await client.addComment(version: "2.4", text: "Posted from the Swift package")
        let mine = try await client.comments(version: "2.4").items.first { $0.id == id }
        XCTAssertEqual(mine?.author.isMe, true)
        try await client.deleteComment(id: id)
        let deleted = try await client.comments(version: "2.4").items.first { $0.id == id }
        XCTAssertEqual(deleted?.deletedByAuthor, true)

        let first = try await client.newReplies(since: nil)
        XCTAssertEqual(first.count, 0)
        let again = try await client.newReplies(since: first.checkedAt)
        XCTAssertEqual(again.count, 0)
    }

    override func setUp() async throws {
        try XCTSkipIf(ProcessInfo.processInfo.environment["CHANGELARK_TEST_URL"] == nil, "set CHANGELARK_TEST_URL to run against a server")
    }
}
