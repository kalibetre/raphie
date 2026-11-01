import Foundation
import Security

public struct DeviceCredentialStore {
    private let service = "com.raphie.desktop.device"
    public init() {}
    private func query(_ address: ServerAddress) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: address.origin.absoluteString]
    }
    public func read(_ address: ServerAddress) throws -> String? {
        var request = query(address)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw ClientError.keychain(status) }
        guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else { throw ClientError.invalidResponse }
        return value
    }
    public func save(_ token: String, for address: ServerAddress) throws {
        let data = Data(token.utf8)
        let request = query(address)
        let status = SecItemUpdate(request as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = request
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw ClientError.keychain(added) }
        } else if status != errSecSuccess { throw ClientError.keychain(status) }
    }
    public func remove(_ address: ServerAddress) throws {
        let status = SecItemDelete(query(address) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ClientError.keychain(status) }
    }
}
