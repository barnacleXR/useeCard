import Foundation

// 与服务端 shared/src/index.ts 的契约一一对应；字段名保持 camelCase，多余字段忽略。

struct ServerInfo: Codable, Equatable {
    let service: String
    let instanceId: String
    let name: String
    let appApiVersion: Int
    let authMethods: [String]
}

struct DeviceTokens: Codable {
    struct User: Codable { let id: String; let username: String }
    struct Device: Codable { let id: String; let name: String }
    let tokenType: String
    let accessToken: String
    let accessExpiresAt: String
    let refreshToken: String
    let refreshExpiresAt: String
    let instanceId: String
    let user: User
    let device: Device
}

struct Me: Codable, Equatable {
    let username: String
    let defaultCurrency: String
    let reminderDaysBefore: Int
    let reminderTime: String
    let instanceId: String
    let deviceId: String?
}

struct Preferences: Codable, Equatable {
    let username: String
    let defaultCurrency: String
    let reminderDaysBefore: Int
    let reminderTime: String
}

struct Account: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let bankName: String
    let bankCode: String
    let iconAssetId: String?
    let note: String
    let version: Int
    let archivedAt: String?
    var isArchived: Bool { archivedAt != nil }
}

struct Card: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let issuer: String
    let last4: String
    let defaultDebitAccountId: String
    let defaultCurrency: String
    let frequency: String
    let brand: String
    let iconAssetId: String?
    let note: String
    let version: Int
    let archivedAt: String?
    var isArchived: Bool { archivedAt != nil }
    var isLowFrequency: Bool { frequency == "low" }
}

enum BillStatus: String, Codable {
    case pending, paid, void
    var label: String {
        switch self { case .pending: return "待扣款"; case .paid: return "已扣款"; case .void: return "已作废" }
    }
}

struct Bill: Codable, Identifiable, Hashable {
    let id: String
    let cardId: String
    let debitAccountId: String
    let amountMinor: Int
    let currency: String
    let dueDate: DateOnly
    let statementMonth: String?
    let note: String
    let status: BillStatus
    let version: Int
    let paidAt: String?
    let cardName: String
    let accountName: String
}

/// 新建/编辑账单的请求体；币种必须显式提交，服务端不按默认币种猜测。
struct BillInput: Codable, Equatable {
    var cardId: String
    var debitAccountId: String
    var amountMinor: Int
    var currency: String
    var dueDate: DateOnly
    var statementMonth: String?
    var note: String
}

struct BillUpdate: Encodable {
    let input: BillInput
    let version: Int
    let confirmCurrencyChange: Bool
    enum CodingKeys: String, CodingKey { case cardId, debitAccountId, amountMinor, currency, dueDate, statementMonth, note, version, confirmCurrencyChange }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.cardId, forKey: .cardId); try c.encode(input.debitAccountId, forKey: .debitAccountId)
        try c.encode(input.amountMinor, forKey: .amountMinor); try c.encode(input.currency, forKey: .currency)
        try c.encode(input.dueDate, forKey: .dueDate); try c.encode(input.statementMonth, forKey: .statementMonth)
        try c.encode(input.note, forKey: .note); try c.encode(version, forKey: .version)
        try c.encode(confirmCurrencyChange, forKey: .confirmCurrencyChange)
    }
}

struct CurrencySummary: Codable, Hashable {
    struct Day: Codable, Hashable { let dueDate: DateOnly; let amountMinor: Int; let billCount: Int }
    let currency: String
    let pendingTotalMinor: Int
    let nextDueDate: DateOnly?
    let byDate: [Day]
}

struct FundingSummary: Codable, Equatable {
    struct AccountGroup: Codable, Hashable, Identifiable {
        let accountId: String
        let accountName: String
        let byCurrency: [CurrencySummary]
        var id: String { accountId }
    }
    let dueMonth: MonthKey
    let accounts: [AccountGroup]
    let historicalPending: [Bill]
}

struct MonthlyReport: Codable, Equatable {
    struct Group: Codable, Hashable, Identifiable {
        let currency: String
        let pendingMinor: Int
        let paidMinor: Int
        let totalMinor: Int
        let billCount: Int
        var id: String { currency }
    }
    let dueMonth: MonthKey
    let byCurrency: [Group]
    let bills: [Bill]
}

enum ReviewStatus: String, Codable {
    case unreviewed, noNew = "no_new", reviewed
    var label: String {
        switch self { case .unreviewed: return "未确认"; case .noNew: return "无新增账单"; case .reviewed: return "已核对" }
    }
}

struct Review: Codable, Identifiable, Hashable {
    let id: String
    let cardId: String
    let cardName: String
    let frequency: String
    let status: ReviewStatus
    let version: Int
    let billIds: [String]
}

struct ReviewConfirmItem: Encodable {
    let id: String
    let version: Int
    let status: String
    let billIds: [String]
    let unlinkConfirmed: Bool
}

struct ReminderPlan: Codable, Equatable {
    struct Item: Codable, Hashable, Identifiable {
        let key: String
        let accountId: String
        let accountName: String
        let dueDate: DateOnly
        let currency: String
        let amountMinor: Int
        let billCount: Int
        let notifyDate: DateOnly
        let notifyTime: String
        var id: String { key }
    }
    let generatedAt: String
    let today: DateOnly
    let daysBefore: Int
    let notifyTime: String
    let items: [Item]
    let truncated: Bool
}

struct ServerMessage: Decodable { let message: String }
struct OKResponse: Decodable { let ok: Bool? }
