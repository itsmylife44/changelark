import XCTest
@testable import Changelark

/// Shapes copied from the server's responses (see sdk/react-native/src/client.d.ts).
final class DecodingTests: XCTestCase {
    func testDecodesWhatsNewAndComments() throws {
        let wn = try JSONDecoder().decode(WhatsNewResponse.self, from: Data(#"{"state":"available","release":{"id":"r1","version":"4.0","notes":"Hi","date":"2026-10-26","upCount":4,"downCount":0,"myVote":0,"commentCount":2}}"#.utf8))
        XCTAssertEqual(wn.release?.version, "4.0")
        let none = try JSONDecoder().decode(WhatsNewResponse.self, from: Data(#"{"state":"unknown_version","release":null}"#.utf8))
        XCTAssertNil(none.release)
        let page = try JSONDecoder().decode(Page<Comment>.self, from: Data(#"""
        {"items":[{"id":"c1","parentId":null,"createdAt":"2026-11-01T10:00:00Z","body":"Nice","status":"visible","removed":false,"deletedByAuthor":false,"upCount":1,"downCount":0,"myVote":1,"author":{"name":"Juniper-4C2F","kind":"user","isMe":true},
          "replies":[{"id":"c2","parentId":"c1","createdAt":"2026-11-01T11:00:00Z","body":"Thanks!","status":"visible","removed":false,"deletedByAuthor":false,"upCount":0,"downCount":0,"myVote":0,"author":{"name":"Noor","kind":"developer","isMe":false},"replies":[]}]}],"nextCursor":null}
        """#.utf8))
        XCTAssertEqual(page.items.first?.replies.first?.author.isDeveloper, true)
        XCTAssertNil(page.nextCursor)
        let cfg = try JSONDecoder().decode(Config.self, from: Data(##"{"app":{"name":"A","color":"#007AFF","proofRequired":false},"me":{"name":"Juniper","guidelinesAccepted":true}}"##.utf8))
        XCTAssertTrue(cfg.me.guidelinesAccepted)
        let replies = try JSONDecoder().decode(NewReplies.self, from: Data(#"{"count":1,"version":"2.4","checkedAt":"2026-11-04T16:00:00.123456+00:00"}"#.utf8))
        XCTAssertEqual(replies.version, "2.4")
    }

    /// State saved by the previous package version (no repliesCheckedAt) still loads, so seen versions stay seen.
    func testDecodesStateFromBeforeReplies() throws {
        let old = try JSONDecoder().decode(DeviceState.self, from: Data(#"{"firstSeenVersion":"2.3","lastKnownVersion":"2.4","handledVersions":["2.3","2.4"],"pendingSince":{}}"#.utf8))
        XCTAssertEqual(old.handledVersions, ["2.3", "2.4"])
        XCTAssertNil(old.repliesCheckedAt)
    }
}
