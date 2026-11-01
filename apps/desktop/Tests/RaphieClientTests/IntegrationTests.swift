import Foundation
import XCTest
@testable import RaphieClient

final class IntegrationTests: XCTestCase {
    func testDeviceConnectChatAndRevokeAgainstFixture() async throws {
        guard let origin = ProcessInfo.processInfo.environment["RAPHIE_TEST_ORIGIN"] else {
            throw XCTSkip("Set RAPHIE_TEST_ORIGIN to run against the disposable fixture.")
        }
        let address = try ServerAddress(origin)
        let api = RaphieAPI(address: address)
        let browser = URLSession(configuration: .ephemeral)
        let code = try await api.startAuthorization()
        func post(_ path: String, body: [String: String], cookie: String? = nil) async throws -> (Data, HTTPURLResponse) {
            var request = URLRequest(url: address.path(path))
            request.httpMethod = "POST"
            request.setValue(origin, forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let cookie { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            request.httpBody = try JSONEncoder().encode(body)
            let (data, response) = try await browser.data(for: request)
            return (data, response as! HTTPURLResponse)
        }
        let (_, login) = try await post("/api/auth/sign-in/email", body: ["email": "admin@example.test", "password": "a long synthetic test password"])
        XCTAssertEqual(login.statusCode, 200)
        guard let header = login.value(forHTTPHeaderField: "Set-Cookie") else { throw ClientError.invalidResponse }
        let cookie = String(header.split(separator: ";")[0])
        var verify = URLRequest(url: URL(string: "\(origin)/api/auth/device?user_code=\(code.user_code)")!)
        verify.setValue(cookie, forHTTPHeaderField: "Cookie")
        let (_, verification) = try await browser.data(for: verify)
        XCTAssertEqual((verification as? HTTPURLResponse)?.statusCode, 200)
        let (_, approved) = try await post("/api/auth/device/approve", body: ["userCode": code.user_code], cookie: cookie)
        XCTAssertEqual(approved.statusCode, 200)
        let token = try await api.waitForAuthorization(code)
        let store = DeviceCredentialStore()
        defer { try? store.remove(address) }
        try store.save(token, for: address)
        XCTAssertEqual(try store.read(address), token)
        let bots = try await api.bots(token: token)
        let bot = try XCTUnwrap(bots.first(where: { $0.id == "default" }))
        let eventID = UUID().uuidString.lowercased()
        let session = try await api.send(bot: bot.id, session: nil, text: "hello from the desktop fixture", eventID: eventID, token: token)
        let retry = try await api.send(bot: bot.id, session: nil, text: "hello from the desktop fixture", eventID: eventID, token: token)
        XCTAssertEqual(session, retry)
        var observation = try await api.observation(bot: bot.id, session: session, token: token)
        for _ in 0..<30 where observation.turns.last?.answer == nil {
            try await Task.sleep(nanoseconds: 500_000_000)
            observation = try await api.observation(bot: bot.id, session: session, token: token)
        }
        XCTAssertEqual(observation.turns.count, 1)
        XCTAssertNotNil(observation.turns.last?.answer)
        var devicesRequest = URLRequest(url: address.path("/api/auth/authorized-devices"))
        devicesRequest.setValue(cookie, forHTTPHeaderField: "Cookie")
        let (data, _) = try await browser.data(for: devicesRequest)
        let devices = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        let id = try XCTUnwrap(devices.first?["id"] as? String)
        let (_, revoked) = try await post("/api/auth/authorized-devices/revoke", body: ["id": id], cookie: cookie)
        XCTAssertEqual(revoked.statusCode, 200)
        do { _ = try await api.bots(token: token); XCTFail("Revoked device retained access") }
        catch ClientError.unauthorized { }
    }
}
