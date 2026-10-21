import Foundation

/// 实际扣款日等“只有日期”的值。按日本时间解释，序列化为 `YYYY-MM-DD`，
/// 不随设备时区变化，避免 Foundation `Date` 的时区换算把日期挪到前一天。
struct DateOnly: Codable, Hashable, Comparable, Identifiable, CustomStringConvertible {
    let year: Int
    let month: Int
    let day: Int

    static let tokyo = TimeZone(identifier: "Asia/Tokyo")!
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = tokyo
        return calendar
    }

    init?(year: Int, month: Int, day: Int) {
        guard let date = Self.calendar.date(from: DateComponents(year: year, month: month, day: day)),
              Self.calendar.component(.day, from: date) == day,
              Self.calendar.component(.month, from: date) == month else { return nil }
        self.year = year; self.month = month; self.day = day
    }

    init?(_ string: String) {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard string.count == 10, parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    /// 取某一时刻在日本时间下的日期。
    init(date: Date) {
        let c = Self.calendar.dateComponents([.year, .month, .day], from: date)
        year = c.year!; month = c.month!; day = c.day!
    }

    static func today() -> DateOnly { DateOnly(date: Date()) }

    /// 供 DatePicker 使用：日本时间当天正午，远离日期边界。
    var date: Date { Self.calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12))! }
    var string: String { String(format: "%04d-%02d-%02d", year, month, day) }
    var description: String { string }
    var id: String { string }
    var monthKey: MonthKey { MonthKey(year: year, month: month) }
    /// 0 = 周日。
    var weekday: Int { Self.calendar.component(.weekday, from: date) - 1 }

    /// “10月27日 周二”。
    var shortLabel: String { "\(month)月\(day)日 周\(["日", "一", "二", "三", "四", "五", "六"][weekday])" }

    func adding(days: Int) -> DateOnly { DateOnly(date: Self.calendar.date(byAdding: .day, value: days, to: date)!) }
    func days(until other: DateOnly) -> Int { Self.calendar.dateComponents([.day], from: date, to: other.date).day ?? 0 }

    static func < (lhs: DateOnly, rhs: DateOnly) -> Bool { lhs.string < rhs.string }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let value = DateOnly(raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "无效日期 \(raw)"))
        }
        self = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(string)
    }
}

/// 账单月份 `YYYY-MM`。
struct MonthKey: Codable, Hashable, Comparable, CustomStringConvertible {
    let year: Int
    let month: Int

    static func current() -> MonthKey { DateOnly.today().monthKey }

    var string: String { String(format: "%04d-%02d", year, month) }
    var description: String { string }
    var label: String { "\(year)年\(month)月" }
    var firstDay: DateOnly { DateOnly(year: year, month: month, day: 1)! }
    var dayCount: Int { DateOnly.calendar.range(of: .day, in: .month, for: firstDay.date)?.count ?? 30 }
    var days: [DateOnly] { (1...dayCount).compactMap { DateOnly(year: year, month: month, day: $0) } }

    func shifted(by months: Int) -> MonthKey {
        let index = year * 12 + (month - 1) + months
        return MonthKey(year: index / 12, month: index % 12 + 1)
    }

    static func < (lhs: MonthKey, rhs: MonthKey) -> Bool { lhs.string < rhs.string }

    init(year: Int, month: Int) { self.year = year; self.month = month }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        let parts = raw.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, (1...12).contains(parts[1]) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "无效月份 \(raw)"))
        }
        self.init(year: parts[0], month: parts[1])
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(string)
    }
}
