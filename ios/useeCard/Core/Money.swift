import Foundation

/// 金额一律用最小货币单位的整数（amountMinor）加币种表示，不经过 Double。
/// 小数位数以服务端 `/currencies` 返回的目录为准，与 Web、MCP 共用同一规则。
struct CurrencyCatalog: Codable, Equatable {
    var digits: [String: Int]

    static let fallback = CurrencyCatalog(digits: ["JPY": 0, "CNY": 2, "USD": 2, "EUR": 2, "GBP": 2, "HKD": 2, "TWD": 2, "KRW": 0])
    /// 与服务端安全整数上限一致（2^53 - 1）。
    static let maxMinor = 9_007_199_254_740_991

    /// 常用币种在前，其余按代码排序。
    var codes: [String] {
        let preferred = ["JPY", "CNY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW"].filter { digits[$0] != nil }
        return preferred + digits.keys.filter { !preferred.contains($0) }.sorted()
    }

    func fractionDigits(_ currency: String) -> Int { digits[currency] ?? 2 }

    /// 把用户输入的十进制字符串解析为最小货币单位；拒绝负数、零、精度超限和溢出。
    func parse(_ raw: String, currency: String) throws -> Int {
        let fraction = fractionDigits(currency)
        // 全角逗号、句点按半角处理，再判断逗号是千分位还是小数点。
        let text = try Self.normalizeSeparators(
            raw.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "，", with: ",")
                .replacingOccurrences(of: "．", with: "."),
            fraction: fraction)
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), let whole = parts.first, !whole.isEmpty,
              whole.allSatisfy({ $0.isASCII && $0.isNumber }) else { throw MoneyError.invalid }
        let decimals = parts.count == 2 ? String(parts[1]) : ""
        guard decimals.allSatisfy({ $0.isASCII && $0.isNumber }), parts.count == 1 || !decimals.isEmpty else { throw MoneyError.invalid }
        guard decimals.count <= fraction else { throw MoneyError.tooManyDecimals(currency, fraction) }
        let digitsText = String(whole) + decimals.padding(toLength: fraction, withPad: "0", startingAt: 0)
        let trimmed = digitsText.drop(while: { $0 == "0" })
        guard trimmed.count <= 16, let value = Int(trimmed.isEmpty ? "0" : String(trimmed)) else { throw MoneyError.overflow }
        guard value > 0 else { throw MoneyError.zero }
        guard value <= Self.maxMinor else { throw MoneyError.overflow }
        return value
    }

    /// 统一为“.”作小数点、无千分位的文本。部分地区的小数键盘输入的是“,”，
    /// 因此逗号只在符合三位分组时视为千分位，否则单个逗号视为小数点；无法区分时拒绝，绝不静默放大金额。
    private static func normalizeSeparators(_ text: String, fraction: Int) throws -> String {
        guard text.contains(",") else { return text }
        let dotParts = text.split(separator: ".", omittingEmptySubsequences: false)
        let wholeGroups = dotParts[0].split(separator: ",", omittingEmptySubsequences: false)
        let isGrouping = wholeGroups.count > 1
            && (1...3).contains(wholeGroups[0].count)
            && wholeGroups.dropFirst().allSatisfy { $0.count == 3 }
        if dotParts.count > 1 {
            // 同时出现逗号和小数点：逗号只能是整数部分的千分位。
            guard isGrouping else { throw MoneyError.invalid }
            return text.replacingOccurrences(of: ",", with: "")
        }
        if isGrouping {
            // “1,000”在支持 3 位小数的币种下也可能是 1.000，无法判断。
            guard wholeGroups.count > 2 || fraction < 3 else { throw MoneyError.ambiguousSeparator }
            return text.replacingOccurrences(of: ",", with: "")
        }
        guard wholeGroups.count == 2 else { throw MoneyError.invalid }
        return text.replacingOccurrences(of: ",", with: ".")
    }

    /// 最小货币单位转回十进制字符串（用于编辑表单回填）。
    func decimalString(_ minor: Int, currency: String) -> String {
        let fraction = fractionDigits(currency)
        guard fraction > 0 else { return String(minor) }
        let padded = String(minor).leftPadded(to: fraction + 1)
        return "\(padded.dropLast(fraction)).\(padded.suffix(fraction))"
    }

    /// “JPY 12,000”“USD 200.50”格式，与 Web 端一致。
    func format(_ minor: Int, currency: String) -> String {
        let decimal = decimalString(minor, currency: currency)
        let parts = decimal.split(separator: ".")
        var grouped = ""
        for (index, char) in parts[0].reversed().enumerated() {
            if index > 0 && index % 3 == 0 { grouped.append(",") }
            grouped.append(char)
        }
        let whole = String(grouped.reversed())
        return parts.count > 1 ? "\(currency) \(whole).\(parts[1])" : "\(currency) \(whole)"
    }

    /// 同币种求和，溢出时报错而不是静默回绕。
    static func add(_ a: Int, _ b: Int) throws -> Int {
        let (sum, overflow) = a.addingReportingOverflow(b)
        guard !overflow, sum <= maxMinor else { throw MoneyError.overflow }
        return sum
    }
}

enum MoneyError: LocalizedError, Equatable {
    case invalid, zero, overflow, ambiguousSeparator
    case tooManyDecimals(String, Int)

    var errorDescription: String? {
        switch self {
        case .invalid: return "请输入正数金额"
        case .ambiguousSeparator: return "无法判断“,”是千分位还是小数点，请用“.”表示小数"
        case .zero: return "零金额请在月度检查中标记“无新增账单”，不必录入"
        case .overflow: return "金额超出安全范围"
        case let .tooManyDecimals(currency, digits): return "\(currency) 最多支持 \(digits) 位小数"
        }
    }
}

private extension String {
    func leftPadded(to length: Int) -> String {
        count >= length ? self : String(repeating: "0", count: length - count) + self
    }
}
