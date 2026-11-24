import SwiftUI

/// App 字体大小挡位定义
enum AppFontSize: Int, CaseIterable, Identifiable, Codable {
    case small = 0
    case standard = 1
    case mediumLarge = 2
    case large = 3
    case extraLarge = 4

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .small: return "小"
        case .standard: return "标准"
        case .mediumLarge: return "偏大"
        case .large: return "大"
        case .extraLarge: return "特大"
        }
    }

    /// 对应 iOS 系统的 DynamicTypeSize
    var dynamicTypeSize: DynamicTypeSize {
        switch self {
        case .small: return .small
        case .standard: return .large      // iOS 系统默认标准字号
        case .mediumLarge: return .xLarge
        case .large: return .xxLarge
        case .extraLarge: return .xxxLarge
        }
    }
}

extension View {
    /// 统一控制 App 字体大小；若为 nil 则跟随 iOS 系统 Dynamic Type 设置
    @ViewBuilder
    func appDynamicTypeSize(_ size: DynamicTypeSize?) -> some View {
        if let size {
            self.dynamicTypeSize(size)
        } else {
            self
        }
    }
}
