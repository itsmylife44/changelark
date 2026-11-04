import Foundation

/// A published version, as the Changelark API returns it.
public struct Release: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let version: String
    public let notes: String
    public let date: String
    public var upCount: Int
    public var downCount: Int
    public var myVote: Int
    public var commentCount: Int
    /// Language of `notes` ("it", "de"…), or nil for the developer's original text.
    public var language: String? = nil
    /// Translations available for this version.
    public var languages: [String]? = nil
}

/// An anonymous comment or a developer reply, with its replies nested.
public struct Comment: Codable, Identifiable, Hashable, Sendable {
    public struct Author: Codable, Hashable, Sendable {
        public let name: String
        public let kind: String
        public let isMe: Bool
        public var isDeveloper: Bool { kind == "developer" }
    }
    public let id: String
    public let parentId: String?
    public let createdAt: String
    public let body: String
    public let status: String
    public let removed: Bool
    public let deletedByAuthor: Bool
    public var upCount: Int
    public var downCount: Int
    public var myVote: Int
    public let author: Author
    public let replies: [Comment]
}

public enum ReportReason: String, Sendable { case spam, abuse, offTopic = "off-topic" }

/// One page of results; pass `nextCursor` back to get the next one.
public struct Page<T: Decodable & Sendable>: Decodable, Sendable { public let items: [T]; public let nextCursor: String? }

struct Config: Decodable {
    struct App: Decodable { let name: String; let color: String; let proofRequired: Bool }
    struct Me: Decodable { let name: String; let guidelinesAccepted: Bool }
    let app: App
    let me: Me
}

struct WhatsNewResponse: Decodable { let state: String; let release: Release? }
struct NewReplies: Decodable { let count: Int; let version: String?; let checkedAt: String }
struct VoteResult: Decodable { let upCount: Int; let downCount: Int; let myVote: Int }
struct Created: Decodable { let id: String }
struct Challenge: Decodable { let challenge: String }
struct Empty: Decodable {}
struct ServerError: Decodable { struct Detail: Decodable { let code: String; let message: String }; let error: Detail }

/// What went wrong, with the server's error code ("guidelines_required", "slow_down", "proof_required"…).
public struct ChangelarkError: Error, LocalizedError, Sendable {
    public let code: String
    public let message: String
    public var errorDescription: String? { message }
}
