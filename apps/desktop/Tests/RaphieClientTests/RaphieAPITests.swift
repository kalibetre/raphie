import Foundation
import XCTest
@testable import RaphieClient

private final class MockProtocol: URLProtocol {
    static var respond: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.respond!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class RaphieAPITests: XCTestCase {
    private func client() throws -> RaphieAPI {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockProtocol.self]
        return RaphieAPI(address: try ServerAddress("https://agent.example.test"), session: URLSession(configuration: config))
    }
    override func tearDown() { MockProtocol.respond = nil; super.tearDown() }

    func testDeviceRequestContainsNoExistingCredentials() async throws {
        MockProtocol.respond = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://agent.example.test/api/auth/device/code")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            let data: Data
            if let body = request.httpBody { data = body }
            else if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var result = Data()
                var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    guard count > 0 else { break }
                    result.append(contentsOf: buffer.prefix(count))
                }
                data = result
            } else { throw ClientError.invalidResponse }
            let body = try JSONSerialization.jsonObject(with: data) as! [String: String]
            XCTAssertEqual(body, ["client_id": "raphie-native"])
            return (200, Data("""
                {"device_code":"synthetic-device","user_code":"ABCDEFGH","verification_uri_complete":"https://agent.example.test/device?user_code=ABCDEFGH","interval":5,"expires_in":600}
                """.utf8))
        }
        let request = try await client().startAuthorization()
        XCTAssertEqual(request.user_code, "ABCDEFGH")
    }

    func testDeviceAuthorizationRejectsUnexpectedApprovalSite() async throws {
        MockProtocol.respond = { _ in
            (200, Data("""
                {"device_code":"synthetic-device","user_code":"ABCDEFGH","verification_uri_complete":"https://evil.example/device?user_code=ABCDEFGH","interval":5,"expires_in":600}
                """.utf8))
        }
        do { _ = try await client().startAuthorization(); XCTFail("Accepted another origin") }
        catch ClientError.invalidVerificationURL { }
    }

    func testDeviceAuthorizationRejectsMismatchedApprovalCode() async throws {
        MockProtocol.respond = { _ in
            (200, Data("""
                {"device_code":"synthetic-device","user_code":"ABCDEFGH","verification_uri_complete":"https://agent.example.test/device?user_code=DIFFERENT","interval":5,"expires_in":600}
                """.utf8))
        }
        do { _ = try await client().startAuthorization(); XCTFail("Accepted a different approval code") }
        catch ClientError.invalidVerificationURL { }
    }

    func testBearerSessionIsAttachedToRuntimeRequestsAndRevocationIsReported() async throws {
        MockProtocol.respond = { request in
            XCTAssertEqual(request.url?.path, "/api/bots")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-token")
            return (401, Data("{}".utf8))
        }
        do { _ = try await client().bots(token: "synthetic-token"); XCTFail("Accepted a revoked session") }
        catch ClientError.unauthorized { }
    }
}
