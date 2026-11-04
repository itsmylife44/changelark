#if os(macOS)
import XCTest
import SwiftUI
@testable import Changelark

/// Renders the sheet's pieces to PNG (light and dark) so they can be looked at: CHANGELARK_RENDER_DIR=/tmp/out swift test
@MainActor
final class RenderTests: XCTestCase {
    func testRendersReleaseAndComments() throws {
        let client = try ChangelarkClient(baseURL: URL(string: "https://example.test")!, appKey: "clk_render", installID: "render", appVersion: "4.0")
        let release = Release(id: "r1", version: "2.4", notes: "Tide charts got a full rework.\n\n- Swell and period on one graph\n- Moon phase under every day", date: "2026-10-26", upCount: 12, downCount: 1, myVote: 1, commentCount: 2)
        let reply = Comment(id: "c2", parentId: "c1", createdAt: "", body: "Thanks! Wind arrows are next.", status: "visible", removed: false, deletedByAuthor: false, upCount: 3, downCount: 0, myVote: 0, author: .init(name: "Noor", kind: "developer", isMe: false), replies: [])
        let comment = Comment(id: "c1", parentId: nil, createdAt: "", body: "The swell graph is exactly what I check before paddling out.", status: "visible", removed: false, deletedByAuthor: false, upCount: 5, downCount: 0, myVote: 0, author: .init(name: "Juniper-4C2F", kind: "user", isMe: false), replies: [reply])

        for scheme in [ColorScheme.light, .dark] {
            let view = VStack(spacing: 16) {
                NavigationStack { SheetContent(release: .constant(release), client: client, installed: "2.4") }
                    .frame(height: 330)
                    .padding(20)
                    .background(RoundedRectangle(cornerRadius: 24).fill(.background))
                CommentThread(comment: comment, client: client, onReply: { _ in }, onChanged: {})
            }
            .padding(12)
            .frame(width: 390)
            .background(scheme == .dark ? Color.black : Color(white: 0.95))
            .environment(\.colorScheme, scheme)

            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.nsImage)
            XCTAssertGreaterThan(image.size.height, 200)
            if let dir = ProcessInfo.processInfo.environment["CHANGELARK_RENDER_DIR"],
               let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("sheet-\(scheme == .dark ? "dark" : "light").png"))
            }
        }
    }
}
#endif
