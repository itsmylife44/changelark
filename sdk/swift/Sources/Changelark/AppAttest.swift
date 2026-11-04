import Foundation
#if canImport(DeviceCheck)
import CryptoKit
import DeviceCheck

/// Proves writes come from this genuine app with Apple App Attest. The key is created once and remembered on the device.
/// Simulators don't support App Attest; there `isSupported` is false and writes go out without a proof.
final class AppAttestor: @unchecked Sendable {
    private let defaultsKey = "changelark:appattest-key"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var isSupported: Bool { DCAppAttestService.shared.isSupported }

    private func keyID() async throws -> String {
        if let saved = defaults.string(forKey: defaultsKey) { return saved }
        let made = try await DCAppAttestService.shared.generateKey()
        defaults.set(made, forKey: defaultsKey)
        return made
    }

    private static func hash(_ challenge: String) -> Data { Data(SHA256.hash(data: Data(challenge.utf8))) }

    func assertion(for challenge: String) async throws -> (keyID: String, assertion: String) {
        let key = try await keyID()
        let data = try await DCAppAttestService.shared.generateAssertion(key, clientDataHash: Self.hash(challenge))
        return (key, data.base64EncodedString())
    }

    func attestation(for challenge: String) async throws -> (keyID: String, attestation: String) {
        let key = try await keyID()
        do {
            let data = try await DCAppAttestService.shared.attestKey(key, clientDataHash: Self.hash(challenge))
            return (key, data.base64EncodedString())
        } catch {
            defaults.removeObject(forKey: defaultsKey) // a key that can't be attested is useless; make a new one next time
            throw error
        }
    }
}
#endif
