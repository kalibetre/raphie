import Foundation

public struct ServerAddress: Equatable, Codable {
    public let origin: URL

    public init(_ value: String) throws {
        guard let parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme?.lowercased() == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/", parts.url != nil else {
            throw ClientError.invalidServer
        }
        var canonical = parts
        canonical.path = ""
        guard let origin = canonical.url else { throw ClientError.invalidServer }
        self.origin = origin
    }

    public func path(_ path: String) -> URL {
        origin.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    public func verificationURL(_ value: String) throws -> URL {
        guard let url = URL(string: value), let base = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let candidate = URLComponents(url: url, resolvingAgainstBaseURL: false),
              candidate.scheme?.lowercased() == "https", candidate.host?.lowercased() == base.host?.lowercased(),
              (candidate.port ?? 443) == (base.port ?? 443), candidate.user == nil, candidate.password == nil,
              candidate.path == "/device", candidate.fragment == nil else { throw ClientError.invalidVerificationURL }
        return url
    }
}

public enum ClientError: LocalizedError {
    case invalidServer, invalidVerificationURL, unauthorized, invalidResponse, server(String), keychain(OSStatus)
    public var errorDescription: String? {
        switch self {
        case .invalidServer: return "Enter an HTTPS server address without a path."
        case .invalidVerificationURL: return "The server returned an unexpected approval link."
        case .unauthorized: return "This device is disconnected. Connect it again."
        case .invalidResponse: return "The server returned an unexpected response."
        case .server(let message): return message
        case .keychain(let status): return "Keychain could not store the device session (\(status))."
        }
    }
}
