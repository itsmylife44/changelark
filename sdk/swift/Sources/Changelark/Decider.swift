import Foundation

/// What the device remembers between launches. Same rules as the React Native package.
public struct DeviceState: Codable, Equatable, Sendable {
    public var firstSeenVersion: String?
    public var lastKnownVersion: String?
    public var handledVersions: [String] = []
    public var pendingSince: [String: Double] = [:]
    /// Server time of the last look at developer replies; nil until the first check.
    public var repliesCheckedAt: String?
    public init() {}
}

enum Decision: Equatable { case fetch, show, skip(String) }

/// When to show What's new, vote toggling and version badges.
enum Decider {
    /// Up to four numeric parts, so "4.1" equals "4.1.0".
    static func parts(_ v: String) -> [Int] {
        var p = v.split(separator: ".", omittingEmptySubsequences: false).prefix(4).map { Int($0.prefix(while: \.isNumber)) ?? 0 }
        while p.count < 4 { p.append(0) }
        return p
    }

    static func normalize(_ v: String) -> String {
        var p = parts(v)
        while p.count > 1 && p.last == 0 { p.removeLast() }
        return p.map(String.init).joined(separator: ".")
    }

    static func compare(_ a: String, _ b: String) -> Int {
        for (x, y) in zip(parts(a), parts(b)) where x != y { return x - y }
        return 0
    }

    /// Before any network call. First install records the version quietly; seen or older versions are skipped.
    static func prepare(_ version: String, _ s: inout DeviceState, treatFirstLaunchAsUpdate: Bool = false) -> Decision {
        let key = normalize(version)
        if s.firstSeenVersion == nil {
            s.firstSeenVersion = key
            s.lastKnownVersion = key
            if !treatFirstLaunchAsUpdate { s.handledVersions.append(key); return .skip("first") }
        }
        if s.handledVersions.contains(key) { return .skip("seen") }
        if let last = s.lastKnownVersion, compare(key, last) < 0 {
            s.handledVersions.append(key)
            s.lastKnownVersion = key
            return .skip("older")
        }
        s.lastKnownVersion = key
        return .fetch
    }

    /// After asking the server. Pending notes are retried for 3 days, unknown versions for 7.
    static func resolve(_ version: String, _ releaseState: String, _ s: inout DeviceState, now: Date = Date()) -> Decision {
        let key = normalize(version)
        switch releaseState {
        case "available": return .show
        case "hidden": s.handledVersions.append(key); return .skip("hidden")
        case "not_live_yet": return .skip("not_live_yet")
        default:
            let ms = now.timeIntervalSince1970 * 1000
            let since = s.pendingSince[key] ?? ms
            s.pendingSince[key] = since
            let days: Double = releaseState == "notes_pending" ? 3 : 7
            if ms - since > days * 86_400_000 { s.handledVersions.append(key) }
            return .skip("pending")
        }
    }

    /// Only once the sheet was really on screen.
    static func markPresented(_ version: String, _ s: inout DeviceState) {
        let key = normalize(version)
        if !s.handledVersions.contains(key) { s.handledVersions.append(key) }
        s.pendingSince[key] = nil
    }

    /// Votes are absolute (-1, 0, 1): pressing the same direction again clears it.
    static func toggle(up: Int, down: Int, mine: Int, pressed dir: Int) -> (up: Int, down: Int, mine: Int) {
        let next = mine == dir ? 0 : dir
        var u = up, d = down
        if mine == 1 { u = max(0, u - 1) }
        if mine == -1 { d = max(0, d - 1) }
        if next == 1 { u += 1 }
        if next == -1 { d += 1 }
        return (u, d, next)
    }

    static func badge(_ version: String, installed: String?, latest: String?) -> String? {
        if let i = installed, compare(version, i) == 0 { return "Installed" }
        if let l = latest, compare(version, l) == 0, compare(installed ?? "0", l) != 0 { return "Latest" }
        return nil
    }
}
