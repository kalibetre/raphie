import XCTest
@testable import RaphieClient

final class ServerAddressTests: XCTestCase {
    func testRequiresExactHTTPSOrigin() throws {
        XCTAssertEqual(try ServerAddress("https://agent.tail.ts.net/").origin.absoluteString, "https://agent.tail.ts.net")
        for value in ["http://agent.tail.ts.net", "https://example.com/path", "https://user:pass@example.com", "https://example.com?query=yes", "https://example.com/#fragment", "not a url"] {
            XCTAssertThrowsError(try ServerAddress(value), "Accepted \(value)")
        }
    }
    func testApprovalLinkMustStayOnSameOriginAndPage() throws {
        let server = try ServerAddress("https://agent.tail.ts.net")
        XCTAssertEqual(try server.verificationURL("https://agent.tail.ts.net/device?user_code=12345678").path, "/device")
        for value in ["http://agent.tail.ts.net/device", "https://evil.example/device", "https://agent.tail.ts.net:8443/device", "https://agent.tail.ts.net/other", "https://user@agent.tail.ts.net/device", "https://agent.tail.ts.net/device#fragment"] {
            XCTAssertThrowsError(try server.verificationURL(value), "Accepted \(value)")
        }
    }
}
