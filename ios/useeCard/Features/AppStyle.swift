import SwiftUI

/// Revolut 级纯粹暗黑黑卡美学（Dark-Only）：OLED 极黑画布 + 亮度阶梯与 1px 微光描边 + 清透翡翠绿强调色。
enum AppTheme {
    // MARK: - 暗黑层级表面（OLED 分层：画布 → 卡片 → 交互胶囊）
    static let canvas = hex(0x060709)
    static let surface = hex(0x13161D)
    static let surfaceElevated = hex(0x191D26)
    static let surfaceMuted = hex(0x1E232E)
    static let surfaceBorder = Color.white.opacity(0.065)

    // MARK: - 文字与分割线
    static let ink = hex(0xF5F7FA)
    static let onInk = hex(0x090B0E)
    static let muted = hex(0x8D95A5)
    static let divider = Color.white.opacity(0.08)

    // MARK: - 主强调色（清透翡翠绿）
    static let accent = hex(0x22C58B)
    static let onAccent = hex(0x041F16)
    static let accentSurface = Color(red: 0.13, green: 0.77, blue: 0.55).opacity(0.14)

    // MARK: - 语义状态色（暗底高对比清透色）
    static let success = hex(0x34D399)
    static let successSurface = Color(red: 0.20, green: 0.83, blue: 0.60).opacity(0.14)
    static let warning = hex(0xFBBF24)
    static let warningSurface = Color(red: 0.98, green: 0.75, blue: 0.14).opacity(0.14)
    static let danger = hex(0xF87171)
    static let dangerSurface = Color(red: 0.97, green: 0.44, blue: 0.44).opacity(0.14)

    // MARK: - 曜石金属黑卡表面
    static let heroTop = hex(0x1D222E)
    static let heroBottom = hex(0x0E1117)
    static let heroInk = hex(0xF8FAFC)
    static let heroMuted = Color.white.opacity(0.62)
    static let heroControlFill = Color.white.opacity(0.11)
    static let heroDivider = Color.white.opacity(0.10)
    static let heroBorder = Color.white.opacity(0.12)

    static let heroShape = RoundedRectangle(cornerRadius: 26, style: .continuous)
    static let groupShape = RoundedRectangle(cornerRadius: 20, style: .continuous)
    static let innerShape = RoundedRectangle(cornerRadius: 14, style: .continuous)

    static let expressiveSpring = Animation.spring(response: 0.32, dampingFraction: 0.78)
    static let snappySpring = Animation.spring(response: 0.20, dampingFraction: 0.72)
    static let tickerSpring = Animation.spring(response: 0.35, dampingFraction: 0.82)
    static let interactiveSpring = Animation.interactiveSpring(response: 0.26, dampingFraction: 0.75)

    static func hex(_ rgb: UInt32) -> Color {
        Color(hex: rgb)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 255) / 255,
            green: Double((hex >> 8) & 255) / 255,
            blue: Double(hex & 255) / 255
        )
    }
}

/// 统一语义字阶（对齐 Material 3 Expressive Baseline/Emphasized 与 iOS Dynamic Type）。
enum AppTypography {
    /// Display 级次级数字（账户汇总、日汇总等）：22pt Rounded Bold 等宽数字。
    static let sectionAmount = Font.system(.title2, design: .rounded, weight: .bold).monospacedDigit()
    /// 页面一级分区标题（20pt Bold，显著大于卡片内小标题）。
    static let sectionHeader = Font.title3.weight(.bold)
    /// 卡片/实体主标题（17pt Semibold）。
    static let cardTitle = Font.headline
    /// 列表行核心金额（Emphasized：比左侧卡名更紧凑醒目）。
    static let rowAmount = Font.system(.headline, design: .rounded, weight: .bold).monospacedDigit()
    /// 列表行主标题（Baseline：17pt Medium，避免与右侧金额争抢焦点）。
    static let rowTitle = Font.body.weight(.medium)
    /// 卡片内眉题与日期分组头（Label Large Emphasized：15pt Semibold）。
    static let groupEyebrow = Font.subheadline.weight(.semibold)
    /// 次级说明文案（Body Medium：15pt）。
    static let supporting = Font.subheadline
    /// 元信息（12pt，保证中文最小可读阈值）。
    static let caption = Font.caption
    /// 徽章与胶囊标签（Label Medium Emphasized：12pt Semibold，不再使用 11pt caption2 承载中文）。
    static let badge = Font.caption.weight(.semibold)
}

/// Editorial 级主金额展示：小号币种前缀 + 缩放自 38pt 的 Rounded Bold 等宽数字，建立整页第一视觉锚点。
struct HeroAmountText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let formatted: String
    var baseSize: CGFloat = 38
    var color: Color = AppTheme.ink
    @ScaledMetric(relativeTo: .largeTitle) private var scale: CGFloat = 1

    private var split: (prefix: String?, number: String) {
        let parts = formatted.split(separator: " ", maxSplits: 1)
        if parts.count == 2 {
            return (String(parts[0]), String(parts[1]))
        }
        return (nil, formatted)
    }

    var body: some View {
        let parts = split
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let prefix = parts.prefix {
                Text(prefix)
                    .font(.system(size: min(baseSize * 0.48 * scale, 28), weight: .semibold, design: .rounded))
                    .foregroundStyle(color.opacity(0.60))
            }
            Text(parts.number)
                .font(.system(size: min(baseSize * scale, 56), weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(color)
                .minimumScaleFactor(0.68)
                .lineLimit(1)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: parts.number)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(formatted)
    }
}

/// 紧凑型结构化金额（如账户总额、行内金额）：略弱化币种前缀，突出等宽数字。
struct StructuredAmountText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let formatted: String
    var numberFont: Font = AppTypography.rowAmount
    var currencyFont: Font = AppTypography.badge
    var color: Color = AppTheme.ink
    var strikethrough = false

    private var split: (prefix: String?, number: String) {
        let parts = formatted.split(separator: " ", maxSplits: 1)
        if parts.count == 2 {
            return (String(parts[0]), String(parts[1]))
        }
        return (nil, formatted)
    }

    var body: some View {
        let parts = split
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if let prefix = parts.prefix {
                Text(prefix)
                    .font(currencyFont)
                    .foregroundStyle(color.opacity(0.56))
            }
            Text(parts.number)
                .font(numberFont)
                .foregroundStyle(color)
                .strikethrough(strikethrough, color: color.opacity(0.6))
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: parts.number)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(formatted)
    }
}

extension View {
    func appPage() -> some View {
        scrollContentBackground(.hidden)
            .background(AppTheme.canvas.ignoresSafeArea())
            .foregroundStyle(AppTheme.ink)
    }

    func appListRow() -> some View {
        listRowBackground(AppTheme.surface)
            .listRowSeparatorTint(AppTheme.divider)
    }
}

/// 暗黑层级分组容器：采用 1px 微光边缘替代传统阴影，呈现 Revolut / Apple 暗黑质感。
struct AppGroup<Content: View>: View {
    var fill: Color = AppTheme.surface
    var shape: RoundedRectangle = AppTheme.groupShape
    var border: Color? = AppTheme.surfaceBorder
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: shape)
            .overlay {
                if let border {
                    shape.strokeBorder(border, lineWidth: 1)
                }
            }
    }
}

/// 曜石金属黑卡主视觉容器：冷黑金属渐变 + 左上至右下微光边框 + 极克制翡翠微光。
struct AppHeroCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                ZStack(alignment: .topTrailing) {
                    LinearGradient(
                        colors: [AppTheme.heroTop, AppTheme.heroBottom],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    RadialGradient(
                        colors: [AppTheme.accent.opacity(0.20), .clear],
                        center: .topTrailing,
                        startRadius: 6,
                        endRadius: 230
                    )
                }
            }
            .clipShape(AppTheme.heroShape)
            .overlay {
                AppTheme.heroShape.strokeBorder(
                    LinearGradient(
                        colors: [Color.white.opacity(0.18), Color.white.opacity(0.05)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
            }
    }
}

/// 表单与列表的像素级光学对齐常量。
enum AppLayout {
    static let iconSlotSize: CGFloat = 38
    /// 与卡片内 16pt 边距 + 38pt 槽位 + 12pt 间距对齐的文字 Keyline 缩进。
    static let formTextKeyline: CGFloat = 66
}

/// 像素级对齐光学图标槽位（大厂统一 Leading Bounding Box）：
/// 无论内部是 1.586:1 横向卡面、1:1 银行徽标还是 SF Symbol，外框统一固定为 38×38pt，
/// 严格保证表单/列表每一行的文字起点落在同一条垂直 Keyline 上。
struct FormIconSlot<Content: View>: View {
    var fill: Color = AppTheme.surfaceMuted
    @ViewBuilder let content: Content

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(fill)
            content
        }
        .frame(width: AppLayout.iconSlotSize, height: AppLayout.iconSlotSize)
        .overlay {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.75)
        }
        .accessibilityHidden(true)
    }
}

extension FormIconSlot where Content == AnyView {
    init(systemName: String, tint: Color = AppTheme.ink, fill: Color = AppTheme.surfaceMuted) {
        self.fill = fill
        self.content = AnyView(
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
        )
    }
}

struct AppDivider: View {
    var leading: CGFloat = 16
    var trailing: CGFloat = 16

    init(inset: CGFloat = 16) {
        self.leading = inset
        self.trailing = inset
    }

    init(leading: CGFloat, trailing: CGFloat = 16) {
        self.leading = leading
        self.trailing = trailing
    }

    var body: some View {
        Rectangle()
            .fill(AppTheme.divider)
            .frame(height: 0.75)
            .padding(.leading, leading)
            .padding(.trailing, trailing)
            .accessibilityHidden(true)
    }
}

/// 页面一级分区标题（20pt Bold），与卡片内部小标题拉开层级。
struct AppSectionTitle: View {
    let title: String
    var color: Color = AppTheme.ink

    init(_ title: String, color: Color = AppTheme.ink) {
        self.title = title
        self.color = color
    }

    var body: some View {
        Text(title)
            .font(AppTypography.sectionHeader)
            .foregroundStyle(color)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}

/// 卡片内眉题 / 日期分组头（15pt Semibold），用于二级信息锚点。
struct AppEyebrow: View {
    let title: String
    var color: Color = AppTheme.muted

    init(_ title: String, color: Color = AppTheme.muted) {
        self.title = title
        self.color = color
    }

    var body: some View {
        Text(title)
            .font(AppTypography.groupEyebrow)
            .foregroundStyle(color)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}

struct AppNotice: View {
    let message: String
    let systemImage: String
    var color: Color = AppTheme.muted

    var body: some View {
        Label(message, systemImage: systemImage)
            .font(AppTypography.supporting)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Expressive 语义胶囊标签（如“智能预填”“3 天内扣款”等上下文微反馈）。
struct ExpressivePill: View {
    let title: String
    var systemImage: String? = nil
    var tint: Color = AppTheme.ink
    var fill: Color? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
            }
            Text(title)
                .font(AppTypography.badge)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(fill ?? tint.opacity(0.14), in: Capsule())
    }
}

struct AppActionStyle: ButtonStyle {
    enum Tone {
        case subtle, prominent, accent, tonal(Color, Color)
    }

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var prominent = false
    var tone: Tone? = nil
    var expands = false
    var compact = false
    var horizontalPadding: CGFloat = 14

    private var resolvedTone: Tone {
        tone ?? (prominent ? .prominent : .subtle)
    }

    private var foreground: Color {
        switch resolvedTone {
        case .prominent: return AppTheme.onInk
        case .accent: return AppTheme.onAccent
        case .subtle: return AppTheme.ink
        case let .tonal(fg, _): return fg
        }
    }

    private var background: Color {
        switch resolvedTone {
        case .prominent: return AppTheme.ink
        case .accent: return AppTheme.accent
        case .subtle: return AppTheme.surfaceMuted
        case let .tonal(_, bg): return bg
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? AppTypography.badge : AppTypography.groupEyebrow)
            .multilineTextAlignment(.center)
            .foregroundStyle(foreground)
            .padding(.horizontal, compact ? min(horizontalPadding, 12) : horizontalPadding)
            .padding(.vertical, compact ? 7 : 10)
            .frame(maxWidth: expands ? .infinity : nil, minHeight: compact ? 36 : 44)
            .background(background, in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(isEnabled ? (configuration.isPressed ? 0.82 : 1) : 0.40)
            .animation(reduceMotion ? nil : AppTheme.snappySpring, value: configuration.isPressed)
    }
}

struct AppRowButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.65 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(reduceMotion ? nil : AppTheme.snappySpring, value: configuration.isPressed)
    }
}

struct AppActionLabel: View {
    let title: String
    var busy = false
    var tint: Color = AppTheme.onInk

    var body: some View {
        HStack(spacing: 8) {
            if busy { ProgressView().tint(tint).accessibilityHidden(true) }
            Text(title)
        }
    }
}

struct AppActionBar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 8) { content }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            // 与页面同色，靠顶部细线分隔；折叠屏等窗口的安全区可能左右不对称，底色铺满两侧，按钮仍留在安全区内。
            .background(AppTheme.canvas.ignoresSafeArea(edges: [.bottom, .horizontal]))
            .overlay(alignment: .top) { Rectangle().fill(AppTheme.divider).frame(height: 0.75) }
    }
}
