import Foundation
import SwiftUI

/// Entry point. Call `Changelark.configure` once at launch, then add `.changelarkWhatsNew()` to your root view.
///
/// ```swift
/// init() { Changelark.configure(appKey: "clk_…") }
/// var body: some Scene { WindowGroup { ContentView().changelarkWhatsNew() } }
/// ```
public enum Changelark {
    @MainActor static var shared: ChangelarkModel?

    /// - Parameters:
    ///   - appKey: The public key from the Install tab in your dashboard (starts with `clk_`).
    ///   - baseURL: Your Changelark server.
    ///   - appVersion: Defaults to `CFBundleShortVersionString`.
    ///   - treatFirstLaunchAsUpdate: Show What's new on a fresh install too.
    ///   - useAppAttest: Sign votes and comments with App Attest. Turn on "App proofs" for the app in the dashboard to require it.
    @MainActor
    public static func configure(
        appKey: String,
        baseURL: URL = URL(string: "https://changelark.example")!,
        appVersion: String? = nil,
        treatFirstLaunchAsUpdate: Bool = false,
        useAppAttest: Bool = false
    ) {
        let version = appVersion ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "1.0"
        do {
            let client = try ChangelarkClient(baseURL: baseURL, appKey: appKey, installID: InstallStore().installID, appVersion: version, useAppAttest: useAppAttest)
            shared = ChangelarkModel(client: client, appVersion: version, treatFirstLaunchAsUpdate: treatFirstLaunchAsUpdate)
        } catch {
            assertionFailure(error.localizedDescription)
        }
    }

    /// Opens What's new for the installed version yourself, for example from a settings row.
    @MainActor public static func showWhatsNew() async { await shared?.openInstalledVersion() }
}

/// Device-local memory: the anonymous install ID and what was already shown. Lives in UserDefaults.
struct InstallStore {
    let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var installID: String {
        if let id = defaults.string(forKey: "changelark:anon") { return id }
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        let id = String((0..<24).map { _ in chars.randomElement()! })
        defaults.set(id, forKey: "changelark:anon")
        return id
    }

    var state: DeviceState {
        get { defaults.data(forKey: "changelark:state").flatMap { try? JSONDecoder().decode(DeviceState.self, from: $0) } ?? DeviceState() }
        nonmutating set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "changelark:state") }
    }
}

@MainActor
final class ChangelarkModel: ObservableObject {
    @Published var presented: Release?
    /// Server time to save once the sheet is on screen, when it opened on the chat because the developer replied.
    @Published var repliesCheckedAt: String?
    let client: ChangelarkClient
    let appVersion: String
    private let treatFirstLaunchAsUpdate: Bool
    private let store: InstallStore
    private var launched = false

    init(client: ChangelarkClient, appVersion: String, treatFirstLaunchAsUpdate: Bool, store: InstallStore = InstallStore()) {
        self.client = client
        self.appVersion = appVersion
        self.treatFirstLaunchAsUpdate = treatFirstLaunchAsUpdate
        self.store = store
    }

    /// The package's launch logic: decide locally, ask the server, show once, remember only after it was on screen.
    func launch() async {
        guard !launched else { return }
        launched = true
        var state = store.state
        let first = Decider.prepare(appVersion, &state, treatFirstLaunchAsUpdate: treatFirstLaunchAsUpdate)
        store.state = state
        do {
            if first == .fetch {
                let answer = try await client.whatsNew(version: appVersion)
                var next = store.state
                let decision = Decider.resolve(appVersion, answer.state, &next)
                store.state = next
                if decision == .show, let release = answer.release { presented = release; return }
            }
            // No What's new this launch: reopen the chat if the developer answered this person.
            let replies = try await client.newReplies(since: store.state.repliesCheckedAt)
            if replies.count > 0, let version = replies.version, let release = try await client.whatsNew(version: version).release {
                repliesCheckedAt = replies.checkedAt
                presented = release
                return
            }
            var next = store.state
            next.repliesCheckedAt = replies.checkedAt
            store.state = next
        } catch {
            // Offline or server error: try again on the next launch.
        }
    }

    /// Remember what was shown only once the sheet was really on screen.
    func didPresent() {
        var state = store.state
        if let repliesCheckedAt { state.repliesCheckedAt = repliesCheckedAt } else { Decider.markPresented(appVersion, &state) }
        store.state = state
    }

    func openInstalledVersion() async {
        if let answer = try? await client.whatsNew(version: appVersion), let release = answer.release { repliesCheckedAt = nil; presented = release }
    }
}

public extension View {
    /// Shows What's new as a sheet the first time someone opens a new version.
    func changelarkWhatsNew() -> some View { modifier(WhatsNewModifier()) }
}

struct WhatsNewModifier: ViewModifier {
    func body(content: Content) -> some View {
        if let model = Changelark.shared { Attached(content: content, model: model) } else { content }
    }

    private struct Attached: View {
        let content: Content
        @ObservedObject var model: ChangelarkModel
        var body: some View {
            content
                .task { await model.launch() }
                .sheet(item: $model.presented) { release in
                    WhatsNewSheet(release: release, client: model.client, installed: model.appVersion, startInChat: model.repliesCheckedAt != nil)
                        .onAppear { model.didPresent() }
                }
        }
    }
}
