import XCTest
@testable import Changelark

final class DeciderTests: XCTestCase {
    func testVersionsCompareByNumbers() {
        XCTAssertEqual(Decider.compare("4.1", "4.1.0"), 0)
        XCTAssertLessThan(Decider.compare("4.9", "4.10"), 0)
        XCTAssertEqual(Decider.normalize("4.1.0.0"), "4.1")
    }

    func testFirstLaunchIsQuietThenNewVersionShowsOnce() {
        var s = DeviceState()
        XCTAssertEqual(Decider.prepare("1.0", &s), .skip("first"))
        XCTAssertEqual(Decider.prepare("1.1", &s), .fetch)
        Decider.markPresented("1.1", &s)
        XCTAssertEqual(Decider.prepare("1.1", &s), .skip("seen"))
        XCTAssertEqual(Decider.prepare("1.1.0", &s), .skip("seen"))
        XCTAssertEqual(Decider.prepare("0.9", &s), .skip("older"))
    }

    func testTreatFirstLaunchAsUpdate() {
        var s = DeviceState()
        XCTAssertEqual(Decider.prepare("2.0", &s, treatFirstLaunchAsUpdate: true), .fetch)
    }

    func testPendingNotesAreRetriedForThreeDaysThenGivenUp() {
        var s = DeviceState()
        _ = Decider.prepare("1.0", &s)
        let start = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(Decider.resolve("1.1", "notes_pending", &s, now: start), .skip("pending"))
        XCTAssertFalse(s.handledVersions.contains("1.1"))
        _ = Decider.resolve("1.1", "notes_pending", &s, now: start.addingTimeInterval(4 * 86_400))
        XCTAssertTrue(s.handledVersions.contains("1.1"))
        XCTAssertEqual(Decider.resolve("1.2", "available", &s), .show)
    }

    func testVotesToggle() {
        XCTAssertTrue(Decider.toggle(up: 3, down: 1, mine: 0, pressed: 1) == (4, 1, 1))
        XCTAssertTrue(Decider.toggle(up: 4, down: 1, mine: 1, pressed: 1) == (3, 1, 0))
        XCTAssertTrue(Decider.toggle(up: 4, down: 1, mine: 1, pressed: -1) == (3, 2, -1))
    }

    func testBadges() {
        XCTAssertEqual(Decider.badge("4.0", installed: "4.0.0", latest: "4.1"), "Installed")
        XCTAssertEqual(Decider.badge("4.1", installed: "4.0", latest: "4.1"), "Latest")
        XCTAssertNil(Decider.badge("3.9", installed: "4.0", latest: "4.1"))
    }

    func testNotesSplitIntoTextAndBullets() {
        let n = splitNotes("New charts!\n\n- Swell graph\n• Moon phase\nThanks")
        XCTAssertEqual(n.text, ["New charts!", "Thanks"])
        XCTAssertEqual(n.bullets, ["Swell graph", "Moon phase"])
    }

    func testRejectsSecretKeys() {
        XCTAssertThrowsError(try ChangelarkClient(baseURL: URL(string: "https://x.test")!, appKey: "sb_secret_abc", installID: "x", appVersion: "1"))
    }
}
