import Foundation
import Security

/// 当前连接的服务器与账号。只有一个活动服务器；更换服务器必须重新认证。
struct ActiveServer: Codable, Equatable {
    var baseURL: URL
    var serverName: String
    var instanceId: String
    var userId: String
    var username: String
    var deviceId: String
    /// 缓存、草稿与钥匙串条目都以“实例 + 用户”隔离，避免把旧服务器数据带到新服务器。
    var scope: String { "\(instanceId)_\(userId)" }
}

enum ServerStore {
    private static let key = "useecard.activeServer"
    static func load() -> ActiveServer? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(ActiveServer.self, from: data)
    }
    static func save(_ server: ActiveServer) {
        if let data = try? JSONEncoder().encode(server) { UserDefaults.standard.set(data, forKey: key) }
    }
    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

/// 设备凭证保存在钥匙串，仅本机、解锁后可读；不保存密码。
enum CredentialVault {
    private static let service = (Bundle.main.bundleIdentifier ?? "useecard") + ".device"

    static func save(_ credentials: DeviceCredentials, scope: String) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        delete(scope: scope)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: scope,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(scope: String) -> DeviceCredentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: scope,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(DeviceCredentials.self, from: data)
    }

    static func delete(scope: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: scope]
        SecItemDelete(query as CFDictionary)
    }
}

/// 离线只读缓存：最近一次成功同步的数据。只用于展示，不参与写入。
struct Snapshot: Codable {
    var syncedAt: Date
    var me: Me?
    var currencies: CurrencyCatalog
    var accounts: [Account]
    var cards: [Card]
    var month: MonthKey
    var summary: FundingSummary?
    var bills: [Bill]
    var reviewMonth: MonthKey
    var reviews: [Review]
    var reminderPlan: ReminderPlan?
}

/// 离线录入的草稿：明确标注“未保存到服务器”，不计入备款合计，由用户手动提交。
struct BillDraft: Codable, Identifiable, Equatable {
    var id: UUID
    var input: BillInput
    var amountText: String
    var createdAt: Date
    /// 草稿 id 兼作幂等键：重复提交同一草稿不会生成两笔账单。
    var idempotencyKey: String { id.uuidString.lowercased() }
}

enum LocalStore {
    private static func directory(scope: String) throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = base.appendingPathComponent("useecard", isDirectory: true).appendingPathComponent(scope, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func write<T: Encodable>(_ value: T, _ name: String, scope: String) {
        guard let dir = try? directory(scope: scope), let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: dir.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func read<T: Decodable>(_ type: T.Type, _ name: String, scope: String) -> T? {
        guard let dir = try? directory(scope: scope), let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func saveSnapshot(_ snapshot: Snapshot, scope: String) { write(snapshot, "snapshot.json", scope: scope) }
    static func loadSnapshot(scope: String) -> Snapshot? { read(Snapshot.self, "snapshot.json", scope: scope) }
    static func saveDrafts(_ drafts: [BillDraft], scope: String) { write(drafts, "drafts.json", scope: scope) }
    static func loadDrafts(scope: String) -> [BillDraft] { read([BillDraft].self, "drafts.json", scope: scope) ?? [] }

    /// 注销时清除该账号在本机的全部缓存与草稿。
    static func wipe(scope: String) {
        guard let dir = try? directory(scope: scope) else { return }
        try? FileManager.default.removeItem(at: dir)
    }
}
