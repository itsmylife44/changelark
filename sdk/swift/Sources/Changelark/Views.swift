import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Changelark's palette: lime accent with dark text, a darker green for links, mono for versions and counts.
enum Brand {
    static let lime = Color(red: 0.608, green: 0.882, blue: 0.365) // #9BE15D
    static func soft(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.098, green: 0.137, blue: 0.067) : Color(red: 0.902, green: 0.973, blue: 0.855) // #192311 / #E6F8DA
    }
    static func link(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.627, green: 0.808, blue: 0.486) : Color(red: 0.247, green: 0.455, blue: 0) // #A0CE7C / #3F7400
    }
    static let mono = Font.system(.footnote, design: .monospaced)
}

/// "2026-10-26" → "Oct 26" in the reader's language.
func shortDate(_ iso: String) -> String {
    let parser = DateFormatter()
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.timeZone = TimeZone(identifier: "UTC")
    parser.dateFormat = "yyyy-MM-dd"
    guard let date = parser.date(from: String(iso.prefix(10))) else { return iso }
    let out = DateFormatter()
    out.timeZone = TimeZone(identifier: "UTC")
    out.setLocalizedDateFormatFromTemplate("MMMd")
    return out.string(from: date)
}

/// "Intro\n\n- a\n- b" → paragraphs and a bullet list, the same rule as the web and React Native.
func splitNotes(_ notes: String) -> (text: [String], bullets: [String]) {
    let lines = notes.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    let isBullet = { (l: String) in l.hasPrefix("- ") || l.hasPrefix("• ") || l.hasPrefix("* ") }
    return (lines.filter { !isBullet($0) }, lines.filter(isBullet).map { String($0.dropFirst(2)) })
}

/// The half-height sheet people see after an update: notes, two big reactions, and a way into the feedback chat.
public struct WhatsNewSheet: View {
    @State private var release: Release
    @State private var chatOpen: Bool
    @Environment(\.dismiss) private var dismiss
    let client: ChangelarkClient
    let installed: String

    /// - Parameter startInChat: Open on the feedback chat, for example when the developer replied.
    public init(release: Release, client: ChangelarkClient, installed: String, startInChat: Bool = false) {
        _release = State(initialValue: release)
        _chatOpen = State(initialValue: startInChat)
        self.client = client
        self.installed = installed
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                SheetContent(release: $release, client: client, installed: installed, onClose: { dismiss() })
                    .padding(.horizontal, 20).padding(.top, 8)
            }
            .navigationDestination(isPresented: $chatOpen) { FeedbackChat(version: release.version, client: client, onClose: { dismiss() }) }
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #endif
    }
}

struct SheetContent: View {
    @Binding var release: Release
    let client: ChangelarkClient
    let installed: String
    var onClose: () -> Void = {}

    var body: some View {
        let notes = splitNotes(release.notes)
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("New in \(release.version)").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Spacer()
                if let badge = Decider.badge(release.version, installed: installed, latest: nil) {
                    Text(badge.uppercased())
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(Brand.lime))
                        .foregroundStyle(.black)
                }
                Text(shortDate(release.date)).font(Brand.mono).foregroundStyle(.secondary)
            }
            ForEach(notes.text, id: \.self) { Text($0).foregroundStyle(.secondary) }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(notes.bullets, id: \.self) { b in
                    HStack(alignment: .top, spacing: 10) {
                        RoundedRectangle(cornerRadius: 2).fill(Brand.lime).frame(width: 8, height: 8).padding(.top, 6)
                        Text(b).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            HStack(spacing: 8) {
                Reaction(title: "Love it", symbol: "hand.thumbsup", count: release.upCount, on: release.myVote == 1) { await react(1) }
                Reaction(title: "Not for me", symbol: "hand.thumbsdown", count: release.downCount, on: release.myVote == -1) { await react(-1) }
            }
            NavigationLink {
                FeedbackChat(version: release.version, client: client, onClose: onClose)
            } label: {
                HStack {
                    Text("Leave feedback").bold()
                    Spacer()
                    Text("\(release.commentCount)").font(Brand.mono).foregroundStyle(.secondary)
                    Image(systemName: "chevron.right").foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14).frame(minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.secondary.opacity(0.12)))
            }
            .buttonStyle(.plain)
            Button(action: onClose) { Text("Got it").bold().frame(maxWidth: .infinity, minHeight: 48) }
                .background(RoundedRectangle(cornerRadius: 12).fill(Brand.lime))
                .foregroundStyle(.black)
                .buttonStyle(.plain)
            NavigationLink {
                BugReportView(client: client)
            } label: {
                Label("Report a bug", systemImage: "ladybug").font(.subheadline).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func react(_ dir: Int) async {
        let before = release
        let next = Decider.toggle(up: release.upCount, down: release.downCount, mine: release.myVote, pressed: dir)
        release.upCount = next.up; release.downCount = next.down; release.myVote = next.mine // optimistic
        do {
            let r = try await client.vote(.release, id: release.id, value: next.mine)
            release.upCount = r.upCount; release.downCount = r.downCount; release.myVote = r.myVote
        } catch { release = before }
    }
}

struct Reaction: View {
    let title: String, symbol: String, count: Int, on: Bool
    let action: () async -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button { Task { await action() } } label: {
            HStack(spacing: 6) {
                Image(systemName: on ? symbol + ".fill" : symbol)
                Text(title).bold()
                Text("\(count)").font(Brand.mono).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 14).fill(on ? Brand.soft(scheme) : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(on ? Brand.link(scheme) : Color.secondary.opacity(0.35), lineWidth: on ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(count)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Feedback for one version: oldest first, replies indented under what they answer, the developer's outlined in lime.
struct FeedbackChat: View {
    let version: String
    let client: ChangelarkClient
    /// With it, the toolbar shows Close, which closes the whole sheet.
    var onClose: (() -> Void)?
    @State private var items: [Comment]?
    @State private var cursor: String?
    @State private var accepted = false
    @State private var myName = ""
    @State private var text = ""
    @State private var replyTo: Comment?
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let cursor {
                    Button("Load earlier comments") { Task { await loadMore(cursor) } }
                        .buttonStyle(.plain).foregroundStyle(Brand.link(scheme))
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                if let items {
                    if items.isEmpty { Text("No feedback yet. Say what you think.").foregroundStyle(.secondary).padding(.vertical, 24) }
                    ForEach(items.reversed()) { c in
                        CommentThread(comment: c, client: client, onReply: { replyTo = $0 }, onChanged: { await load() })
                    }
                } else {
                    ProgressView().padding(.vertical, 24)
                }
            }
            .padding(16)
        }
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { if let onClose { ToolbarItem(placement: .confirmationAction) { Button("Close", action: onClose) } } }
        .safeAreaInset(edge: .bottom) { composer.padding(12).background(.bar) }
        .task { await load() }
    }

    private var title: String {
        guard let items else { return "Feedback" }
        let n = items.reduce(0) { $0 + 1 + $1.replies.count }
        return n == 1 ? "1 comment" : "\(n) comments"
    }

    @ViewBuilder private var composer: some View {
        if !accepted {
            VStack(alignment: .leading, spacing: 8) {
                Text("Before you write").font(.headline)
                Text("Be kind and stay on topic. No spam, no personal attacks. You stay anonymous\(myName.isEmpty ? "" : " as \(myName)").")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button {
                    Task { do { try await client.acceptGuidelines(); accepted = true } catch { self.error = error.localizedDescription } }
                } label: { Text("Accept and continue").bold().frame(maxWidth: .infinity).padding(.vertical, 10) }
                .background(RoundedRectangle(cornerRadius: 12).fill(Brand.lime))
                .foregroundStyle(.black)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if let replyTo {
                    HStack {
                        Text("Replying to \(replyTo.author.isMe ? "yourself" : replyTo.author.name)").lineLimit(1)
                        Spacer()
                        Button { self.replyTo = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Cancel reply")
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.12)))
                }
                HStack {
                    TextField("Message…", text: $text, axis: .vertical).lineLimit(1...4)
                    Button("Send") { Task { await send() } }
                        .bold().padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Capsule().fill(Brand.lime)).foregroundStyle(.black)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.leading, 14).padding(4)
                .background(Capsule().fill(Color.secondary.opacity(0.12)))
            }
        }
    }

    private func load() async {
        do {
            async let list = client.comments(version: version)
            async let config = client.config()
            let (l, c) = try await (list, config)
            items = l.items; cursor = l.nextCursor
            accepted = c.me.guidelinesAccepted; myName = c.me.name; error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func loadMore(_ from: String) async {
        do {
            let page = try await client.comments(version: version, cursor: from)
            items = (items ?? []) + page.items; cursor = page.nextCursor
        } catch { self.error = error.localizedDescription }
    }

    private func send() async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await client.addComment(version: version, text: body, parentID: replyTo?.id)
            text = ""; replyTo = nil
            await load()
        } catch { self.error = error.localizedDescription }
    }
}

/// A comment with its replies indented under it, behind a thread line.
struct CommentThread: View {
    let comment: Comment
    let client: ChangelarkClient
    let onReply: (Comment) -> Void
    let onChanged: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CommentRow(comment: comment, client: client, onReply: { onReply(comment) }, onChanged: onChanged)
            if !comment.replies.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(comment.replies) { r in CommentRow(comment: r, client: client, onReply: {}, onChanged: onChanged) }
                }
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.3)).frame(width: 2) }
                .padding(.leading, 4)
            }
        }
    }
}

struct CommentRow: View {
    @State var comment: Comment
    let client: ChangelarkClient
    let onReply: () -> Void
    let onChanged: () async -> Void
    @State private var confirmDelete = false
    @Environment(\.colorScheme) private var scheme

    init(comment: Comment, client: ChangelarkClient, onReply: @escaping () -> Void, onChanged: @escaping () async -> Void) {
        _comment = State(initialValue: comment)
        self.client = client
        self.onReply = onReply
        self.onChanged = onChanged
    }

    var body: some View {
        let dev = comment.author.isDeveloper
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(comment.author.isMe ? "You" : comment.author.name).font(.subheadline.weight(.semibold))
                if dev {
                    Text("DEVELOPER").font(.system(size: 9, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(RoundedRectangle(cornerRadius: 4).fill(Brand.lime)).foregroundStyle(.black)
                }
            }
            if comment.removed {
                Text(comment.deletedByAuthor ? "Deleted by its author." : "Hidden for breaking the community guidelines.").italic().foregroundStyle(.secondary)
            } else {
                Text(comment.body).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 14) {
                    Button { Task { await vote() } } label: {
                        Label("\(comment.upCount)", systemImage: comment.myVote == 1 ? "heart.fill" : "heart").font(Brand.mono)
                            .foregroundStyle(comment.myVote == 1 ? Brand.link(scheme) : .secondary)
                    }
                    .accessibilityLabel("Like, \(comment.upCount)").accessibilityAddTraits(comment.myVote == 1 ? .isSelected : [])
                    if comment.parentId == nil {
                        Button(action: onReply) { Image(systemName: "arrowshape.turn.up.left") }
                            .font(.caption.weight(.medium)).foregroundStyle(Brand.link(scheme)).accessibilityLabel("Reply")
                    }
                    menu
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(dev ? 10 : 0)
        .overlay { if dev { RoundedRectangle(cornerRadius: 14).strokeBorder(Brand.lime, lineWidth: 2) } }
        .confirmationDialog("Delete your comment?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { try? await client.deleteComment(id: comment.id); await onChanged() } }
        }
    }

    private var menu: some View {
        Menu {
            if comment.author.isMe {
                Button("Delete comment", role: .destructive) { confirmDelete = true }
            } else {
                Button("Report", role: .destructive) { Task { try? await client.report(commentID: comment.id); await onChanged() } }
                if !comment.author.isDeveloper {
                    Button("Block \(comment.author.name)") { Task { try? await client.block(commentID: comment.id); await onChanged() } }
                }
            }
        } label: {
            Image(systemName: "ellipsis").foregroundStyle(.secondary).frame(width: 32, height: 22).contentShape(Rectangle())
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
        .accessibilityLabel("More")
    }

    private func vote() async {
        let before = comment
        let next = Decider.toggle(up: comment.upCount, down: comment.downCount, mine: comment.myVote, pressed: 1)
        comment.upCount = next.up; comment.downCount = next.down; comment.myVote = next.mine
        do {
            let r = try await client.vote(.comment, id: comment.id, value: next.mine)
            comment.upCount = r.upCount; comment.downCount = r.downCount; comment.myVote = r.myVote
        } catch { comment = before }
    }
}

// MARK: Bug report

/// A private note to the developer, with a screenshot of the app behind the sheet.
struct BugReportView: View {
    let client: ChangelarkClient
    @State private var text = ""
    @State private var screenshot: Data?
    @State private var attach = true
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        Form {
            if sent {
                Section { Label("Thanks! The developer got your report.", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            } else {
                Section {
                    TextField("What went wrong? What did you expect?", text: $text, axis: .vertical).lineLimit(4...10)
                } footer: { Text("Only the developer sees this. It isn't posted publicly.") }
                if let screenshot, let image = BugReportView.image(screenshot) {
                    if attach {
                        Section {
                            image.resizable().scaledToFit().frame(maxHeight: 220).clipShape(RoundedRectangle(cornerRadius: 10))
                                .frame(maxWidth: .infinity)
                                .overlay(alignment: .topTrailing) {
                                    Button { attach = false } label: {
                                        Image(systemName: "xmark").font(.caption.bold()).foregroundStyle(.white)
                                            .frame(width: 28, height: 28).background(Circle().fill(.black.opacity(0.6)))
                                    }
                                    .buttonStyle(.plain).padding(8).accessibilityLabel("Remove screenshot")
                                }
                        } header: { Text("Screenshot of the screen you were on") }
                          footer: { Text("Check it doesn't show anything private before you send it.") }
                    } else {
                        Section { Button("Attach the screenshot") { attach = true } }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button(sending ? "Sending…" : "Send report") { Task { await send() } }
                        .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .navigationTitle("Report a bug")
        .onAppear { if screenshot == nil { screenshot = BugReportView.captureApp() } }
    }

    private func send() async {
        sending = true; error = nil
        do {
            _ = try await client.reportBug(text: text.trimmingCharacters(in: .whitespacesAndNewlines), screenshot: attach ? screenshot : nil, device: BugReportView.device)
            sent = true
        } catch { self.error = (error as? ChangelarkError)?.message ?? error.localizedDescription }
        sending = false
    }

    #if canImport(UIKit)
    static var device: String { "\(UIDevice.current.model), \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)" }
    static func image(_ data: Data) -> Image? { UIImage(data: data).map { Image(uiImage: $0) } }
    /// The app's main screen without the sheet on top, as a JPEG small enough to upload.
    @MainActor static func captureApp() -> Data? {
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }
        guard let view = window?.rootViewController?.view, view.bounds.width > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat(); format.scale = min(2, UIScreen.main.scale)
        let shot = UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { _ in view.drawHierarchy(in: view.bounds, afterScreenUpdates: false) }
        return shot.jpegData(compressionQuality: 0.6)
    }
    #else
    static var device: String { ProcessInfo.processInfo.operatingSystemVersionString }
    static func image(_ data: Data) -> Image? { nil }
    static func captureApp() -> Data? { nil }
    #endif
}
