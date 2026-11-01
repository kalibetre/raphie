import Foundation

public struct DeviceCode: Decodable {
    public let device_code: String
    public let user_code: String
    public let verification_uri_complete: String
    public let interval: Int
    public let expires_in: Int
}
public struct Bot: Decodable, Identifiable, Hashable { public let id: String; public let name: String; public let description: String }
public struct Conversation: Decodable, Identifiable, Hashable { public let id: String; public let title: String; public let preview: String; public let working: Bool }
public struct Turn: Decodable, Identifiable { public let id: String; public let text: String; public let answer: String?; public let status: String }
public struct Approval: Decodable, Identifiable { public let id: String; public let tool: String; public let server: String; public let argumentsJson: String; public let status: String }
public struct Observation: Decodable { public let turns: [Turn]; public let toolApprovals: [Approval]; public let phase: String }
private struct Page<T: Decodable>: Decodable { let items: [T] }
private struct TokenResponse: Decodable { let access_token: String?; let error: String? }
private struct Receipt: Decodable { let sessionId: String }

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

public final class RaphieAPI {
    public let address: ServerAddress
    private let session: URLSession
    private let delegate = RejectRedirects()
    public init(address: ServerAddress) {
        self.address = address
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 20
        self.session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }
    init(address: ServerAddress, session: URLSession) {
        self.address = address
        self.session = session
    }
    private func request(_ path: String, token: String? = nil, body: [String: String]? = nil) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: address.path(path))
        request.setValue("Raphie macOS", forHTTPHeaderField: "User-Agent")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("web", forHTTPHeaderField: "x-raphie-client")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
        if response.statusCode == 401 { throw ClientError.unauthorized }
        return (data, response)
    }
    private func decode<T: Decodable>(_ type: T.Type, path: String, token: String? = nil, body: [String: String]? = nil) async throws -> T {
        let (data, response) = try await request(path, token: token, body: body)
        guard (200..<300).contains(response.statusCode) else { throw ClientError.server("Server request failed (\(response.statusCode)).") }
        return try JSONDecoder().decode(type, from: data)
    }
    public func startAuthorization() async throws -> DeviceCode {
        let code = try await decode(DeviceCode.self, path: "/api/auth/device/code", body: ["client_id": "raphie-native"])
        let verification = try address.verificationURL(code.verification_uri_complete)
        guard code.interval > 0, code.interval <= 60, code.expires_in > 0, code.expires_in <= 600, !code.user_code.isEmpty, !code.device_code.isEmpty else { throw ClientError.invalidResponse }
        let query = URLComponents(url: verification, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard query.count == 1, query[0].name == "user_code", query[0].value == code.user_code else { throw ClientError.invalidVerificationURL }
        return code
    }
    public func waitForAuthorization(_ code: DeviceCode) async throws -> String {
        let deadline = Date().addingTimeInterval(TimeInterval(code.expires_in))
        var interval = max(code.interval, 5)
        while Date() < deadline {
            try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)
            let (data, response) = try await request("/api/auth/device/token", body: ["client_id": "raphie-native", "device_code": code.device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code"])
            let payload = try JSONDecoder().decode(TokenResponse.self, from: data)
            if (200..<300).contains(response.statusCode), let token = payload.access_token, !token.isEmpty { return token }
            switch payload.error {
            case "authorization_pending": continue
            case "slow_down": interval += 5
            case "access_denied": throw ClientError.server("Device access was denied.")
            case "expired_token": throw ClientError.server("The approval code expired. Try again.")
            default: throw ClientError.server("Device authorization failed. Try again.")
            }
        }
        throw ClientError.server("The approval code expired. Try again.")
    }
    public func bots(token: String) async throws -> [Bot] { try await decode(Page<Bot>.self, path: "/api/bots", token: token).items }
    public func conversations(bot: String, token: String) async throws -> [Conversation] {
        try await decode(Page<Conversation>.self, path: "/api/bots/\(bot)/sessions", token: token).items
    }
    public func observation(bot: String, session: String, token: String) async throws -> Observation {
        try await decode(Observation.self, path: "/api/bots/\(bot)/sessions/\(session)", token: token)
    }
    public func send(bot: String, session: String?, text: String, eventID: String, token: String) async throws -> String {
        var body = ["text": text, "eventId": eventID]
        if let session { body["sessionId"] = session }
        return try await decode(Receipt.self, path: "/api/bots/\(bot)/sessions/messages", token: token, body: body).sessionId
    }
    public func decide(bot: String, approval: String, approved: Bool, token: String) async throws {
        let (_, response) = try await request("/api/bots/\(bot)/tool-approvals/\(approval)", token: token, body: ["decision": approved ? "approved" : "rejected"])
        guard (200..<300).contains(response.statusCode) else { throw ClientError.server("Decision failed (\(response.statusCode)).") }
    }
}
