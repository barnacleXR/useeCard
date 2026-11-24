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

/// 日本金融机构实体（与服务端 /banks 与 shared/src/index.ts 契约一致）
struct BankEntry: Codable, Identifiable, Hashable {
    let code: String
    let name: String
    let kana: String
    let domain: String?

    var id: String { code }

    /// 对齐 Web 端名称规范：清单名称不含后缀；信金、信組、農協等合作金融机构保持原名，其余补齐“銀行”。
    var displayName: String {
        let pattern = "信金|信組|農協|漁協|信漁連|信連|労金|銀行|ゆうちょ|ＪＡ"
        if name.range(of: pattern, options: .regularExpression) != nil {
            return name
        }
        return "\(name)銀行"
    }

    /// 快捷展示简写（用于快捷选择胶囊）
    var shortName: String {
        switch code {
        case "0001": return "みずほ"
        case "0005": return "三菱UFJ"
        case "0009": return "三井住友"
        case "0010": return "りそな"
        case "0017": return "埼玉りそな"
        case "0033": return "PayPay"
        case "0034": return "セブン"
        case "0036": return "楽天"
        case "0039": return "auじぶん"
        case "0040": return "イオン"
        case "0041": return "大和ネクスト"
        case "0042": return "ローソン"
        case "9900": return "ゆうちょ"
        default: return name
        }
    }

    /// 默认日本常用金融机构列表（与服务端 banks.service.ts 预设的常用行与官网域名严格对齐）
    static let defaultJapaneseBanks: [BankEntry] = [
        BankEntry(code: "0001", name: "みずほ", kana: "ミズホ", domain: "mizuhobank.co.jp"),
        BankEntry(code: "0005", name: "三菱ＵＦＪ", kana: "ミツビシユ－エフジエイ", domain: "bk.mufg.jp"),
        BankEntry(code: "0009", name: "三井住友", kana: "ミツイスミトモ", domain: "smbc.co.jp"),
        BankEntry(code: "0010", name: "りそな", kana: "リソナ", domain: "resonabank.co.jp"),
        BankEntry(code: "0017", name: "埼玉りそな", kana: "サイタマリソナ", domain: "saitamaresona.co.jp"),
        BankEntry(code: "0033", name: "ＰａｙＰａｙ", kana: "ペイペイ", domain: "paypay-bank.co.jp"),
        BankEntry(code: "0034", name: "セブン", kana: "セブン", domain: "sevenbank.co.jp"),
        BankEntry(code: "0036", name: "楽天", kana: "ラクテン", domain: "rakuten-bank.co.jp"),
        BankEntry(code: "0039", name: "ａｕじぶん", kana: "エ－ユ－ジブン", domain: "jibunbank.co.jp"),
        BankEntry(code: "0040", name: "イオン", kana: "イオン", domain: "aeonbank.co.jp"),
        BankEntry(code: "0041", name: "大和ネクスト", kana: "ダイワネクスト", domain: "bank-daiwa.co.jp"),
        BankEntry(code: "0042", name: "ローソン", kana: "ロ－ソン", domain: "lawsonbank.jp"),
        BankEntry(code: "0134", name: "千葉", kana: "チバ", domain: "chibabank.co.jp"),
        BankEntry(code: "0138", name: "横浜", kana: "ヨコハマ", domain: "boy.co.jp"),
        BankEntry(code: "0149", name: "静岡", kana: "シズオカ", domain: "shizuokabank.co.jp"),
        BankEntry(code: "0158", name: "京都", kana: "キヨウト", domain: "kyotobank.co.jp"),
        BankEntry(code: "0159", name: "関西みらい", kana: "カンサイミライ", domain: "kansaimiraibank.co.jp"),
        BankEntry(code: "0177", name: "福岡", kana: "フクオカ", domain: "fukuokabank.co.jp"),
        BankEntry(code: "0288", name: "三菱ＵＦＪ信託", kana: "ミツビシＵＦＪシンタク", domain: "tr.mufg.jp"),
        BankEntry(code: "0294", name: "三井住友信託", kana: "ミツイスミトモシンタク", domain: "smtb.jp"),
        BankEntry(code: "0310", name: "ＧＭＯあおぞらネット", kana: "ジ－エムオ－アオゾラネツト", domain: "gmo-aozora.com"),
        BankEntry(code: "0397", name: "ＳＢＩ新生", kana: "エスビ－アイシンセイ", domain: "sbishinseibank.co.jp"),
        BankEntry(code: "0398", name: "あおぞら", kana: "アオゾラ", domain: "aozorabank.co.jp"),
        BankEntry(code: "0501", name: "北洋", kana: "ホクヨウ", domain: "hokuyobank.co.jp"),
        BankEntry(code: "9900", name: "ゆうちょ", kana: "ユウチヨ", domain: "jp-bank.japanpost.jp"),
    ]

    static func searchLocal(query: String) -> [BankEntry] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return defaultJapaneseBanks }
        return defaultJapaneseBanks.filter {
            $0.code.contains(q) ||
            $0.name.lowercased().contains(q) ||
            $0.displayName.lowercased().contains(q) ||
            $0.kana.lowercased().contains(q) ||
            ($0.domain?.lowercased().contains(q) ?? false)
        }
    }
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
    let defaultDueDay: Int?
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

/// 服务端返回的新建账单日期预填结果（纯日历日，不推算节假日）。
struct BillPrefill: Codable, Equatable {
    let dueDate: DateOnly
    let statementMonth: String
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

enum CardBrand: String, CaseIterable, Identifiable, Codable {
    case unspecified = ""
    case visa = "visa"
    case mastercard = "mastercard"
    case jcb = "jcb"
    case amex = "amex"
    case diners = "diners"
    case discover = "discover"
    case unionpay = "unionpay"
    case maestro = "maestro"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .unspecified: return "未指定"
        case .visa: return "Visa"
        case .mastercard: return "Mastercard"
        case .jcb: return "JCB"
        case .amex: return "American Express"
        case .diners: return "Diners Club"
        case .discover: return "Discover"
        case .unionpay: return "银联 (UnionPay)"
        case .maestro: return "Maestro"
        }
    }
}

enum CardFrequency: String, CaseIterable, Identifiable, Codable {
    case regular = "regular"
    case low = "low"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .regular: return "常用卡"
        case .low: return "低频卡"
        }
    }
}

struct AccountInput: Codable, Equatable {
    var name: String
    var bankName: String = ""
    var bankCode: String = ""
    var iconAssetId: String? = nil
    var note: String = ""
}

struct AccountUpdate: Encodable {
    let input: AccountInput
    let version: Int
    enum CodingKeys: String, CodingKey { case name, bankName, bankCode, iconAssetId, note, version }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.name, forKey: .name)
        try c.encode(input.bankName, forKey: .bankName)
        try c.encode(input.bankCode, forKey: .bankCode)
        try c.encode(input.iconAssetId, forKey: .iconAssetId)
        try c.encode(input.note, forKey: .note)
        try c.encode(version, forKey: .version)
    }
}

struct CardInput: Codable, Equatable {
    var name: String
    var issuer: String = ""
    var last4: String = ""
    var defaultDebitAccountId: String
    var defaultCurrency: String
    var defaultDueDay: Int? = nil
    var frequency: String = "regular"
    var brand: String = ""
    var iconAssetId: String? = nil
    var note: String = ""
}

struct CardUpdate: Encodable {
    let input: CardInput
    let version: Int
    enum CodingKeys: String, CodingKey {
        case name, issuer, last4, defaultDebitAccountId, defaultCurrency, defaultDueDay, frequency, brand, iconAssetId, note, version
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.name, forKey: .name)
        try c.encode(input.issuer, forKey: .issuer)
        try c.encode(input.last4, forKey: .last4)
        try c.encode(input.defaultDebitAccountId, forKey: .defaultDebitAccountId)
        try c.encode(input.defaultCurrency, forKey: .defaultCurrency)
        try c.encode(input.defaultDueDay, forKey: .defaultDueDay)
        try c.encode(input.frequency, forKey: .frequency)
        try c.encode(input.brand, forKey: .brand)
        try c.encode(input.iconAssetId, forKey: .iconAssetId)
        try c.encode(input.note, forKey: .note)
        try c.encode(version, forKey: .version)
    }
}

struct ReorderInput: Codable, Equatable {
    let ids: [String]
}
