import Foundation

/// Talks to your Changelark server. The app key is public: it only says which app's notes to load and where feedback goes.
public final class ChangelarkClient: @unchecked Sendable {
    public enum Target: String, Sendable { case release, comment }

    let baseURL: URL
    let appKey: String
    let installID: String
    let appVersion: String
    let session: URLSession
    #if canImport(DeviceCheck)
    let attestor: AppAttestor?
    #endif

    public init(baseURL: URL, appKey: String, installID: String, appVersion: String, useAppAttest: Bool = false, session: URLSession = .shared) throws {
        guard appKey.hasPrefix("clk_") else {
            throw ChangelarkError(code: "bad_key", message: "Changelark: use the public app key (starts with clk_). Never put a secret key inside an app.")
        }
        self.baseURL = baseURL
        self.appKey = appKey
        self.installID = installID
        self.appVersion = appVersion
        self.session = session
        #if canImport(DeviceCheck)
        let attestor = useAppAttest ? AppAttestor() : nil
        self.attestor = attestor?.isSupported == true ? attestor : nil
        #endif
    }

    // MARK: API

    func config() async throws -> Config { try await call("/config") }
    func whatsNew(version: String) async throws -> WhatsNewResponse { try await call("/whats-new", query: ["version": version]) }
    func newReplies(since: String?) async throws -> NewReplies { try await call("/new-replies", query: since.map { ["since": $0] } ?? [:]) }
    public func releases(cursor: String? = nil) async throws -> Page<Release> { try await call("/releases", query: cursor.map { ["cursor": $0] } ?? [:]) }
    public func comments(version: String, cursor: String? = nil) async throws -> Page<Comment> {
        var query = ["sort": "new"]
        if let cursor { query["cursor"] = cursor }
        return try await call("/releases/\(escape(version))/comments", query: query)
    }
    func vote(_ target: Target, id: String, value: Int) async throws -> VoteResult { try await call("/votes", method: "POST", body: ["targetType": target.rawValue, "targetId": id, "value": value]) }
    func acceptGuidelines() async throws { let _: Empty = try await call("/guidelines/accept", method: "POST", body: [:]) }
    func addComment(version: String, text: String, parentID: String? = nil) async throws -> String {
        (try await call("/releases/\(escape(version))/comments", method: "POST", body: ["body": text, "parentId": parentID.map { $0 as Any } ?? NSNull()]) as Created).id
    }
    func report(commentID: String, reason: ReportReason = .abuse) async throws { let _: Empty = try await call("/reports", method: "POST", body: ["targetId": commentID, "reason": reason.rawValue]) }
    func deleteComment(id: String) async throws { let _: Empty = try await call("/comments/\(id)", method: "DELETE", body: [:]) }
    func block(commentID: String) async throws { let _: Empty = try await call("/blocks", method: "POST", body: ["commentId": commentID]) }
    /// A private bug report for the developer, with an optional PNG or JPEG screenshot (up to 1.5 MB).
    public func reportBug(text: String, screenshot: Data? = nil, device: String = "") async throws -> String {
        let shot: Any = screenshot.map { $0.base64EncodedString() } ?? NSNull()
        return (try await call("/bugs", method: "POST", body: ["body": text, "version": appVersion, "device": device, "screenshot": shot]) as Created).id
    }

    // MARK: Transport

    private func escape(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s }

    private func send(_ path: String, method: String, query: [String: String], body: [String: Any]?, headers: [String: String]) async throws -> (Data, Int) {
        var url = baseURL.appendingPathComponent("api/v1/sdk" + path)
        if !query.isEmpty, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
            url = parts.url ?? url
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(appKey, forHTTPHeaderField: "X-Changelark-App-Key")
        req.setValue(installID, forHTTPHeaderField: "X-Changelark-Anon-Id")
        req.setValue(appVersion, forHTTPHeaderField: "X-Changelark-App-Version")
        req.setValue("swift/0.1.0", forHTTPHeaderField: "X-Changelark-SDK")
        // Notes come back in the phone's language when the developer translated them.
        if let lang = Locale.preferredLanguages.first { req.setValue(lang, forHTTPHeaderField: "X-Changelark-Locale") }
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: req)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func errorCode(_ data: Data) -> String? { (try? JSONDecoder().decode(ServerError.self, from: data))?.error.code }

    private func check(_ data: Data, _ status: Int) throws {
        guard (200..<300).contains(status) else {
            if let e = try? JSONDecoder().decode(ServerError.self, from: data) { throw ChangelarkError(code: e.error.code, message: e.error.message) }
            throw ChangelarkError(code: String(status), message: "Request failed (\(status)).")
        }
    }

    private func call<T: Decodable>(_ path: String, method: String = "GET", query: [String: String] = [:], body: [String: Any]? = nil) async throws -> T {
        let write = method != "GET"
        var (data, status) = try await send(path, method: method, query: query, body: body, headers: write ? try await proofHeaders() : [:])
        #if canImport(DeviceCheck)
        if write, attestor != nil, errorCode(data) == "attestation_required" {
            try await registerKey()
            (data, status) = try await send(path, method: method, query: query, body: body, headers: try await proofHeaders())
        }
        #endif
        try check(data, status)
        return try JSONDecoder().decode(T.self, from: data.isEmpty ? Data("{}".utf8) : data)
    }

    // MARK: App Attest

    private func challenge() async throws -> String {
        let (data, status) = try await send("/attest/challenge", method: "POST", query: [:], body: [:], headers: [:])
        try check(data, status)
        return try JSONDecoder().decode(Challenge.self, from: data).challenge
    }

    private func proofHeaders() async throws -> [String: String] {
        #if canImport(DeviceCheck)
        guard let attestor else { return [:] }
        let c = try await challenge()
        let proof = try await attestor.assertion(for: c)
        return ["X-Changelark-Challenge": c, "X-Changelark-Proof-Kind": "apple", "X-Changelark-Proof-Key": proof.keyID, "X-Changelark-Proof": proof.assertion]
        #else
        return [:]
        #endif
    }

    #if canImport(DeviceCheck)
    private func registerKey() async throws {
        guard let attestor else { return }
        let c = try await challenge()
        let proof = try await attestor.attestation(for: c)
        let (data, status) = try await send("/attest/register", method: "POST", query: [:], body: ["keyId": proof.keyID, "attestation": proof.attestation, "challenge": c], headers: [:])
        if errorCode(data) != "key_exists" { try check(data, status) }
    }
    #endif
}
