import SwiftUI
import UIKit

/// 读取受设备令牌保护的图片资产；失败时返回 nil，由调用方显示兜底样式。
enum AssetImageLoader {
    @MainActor
    static func load(_ assetId: String?, api: APIClient?, scope: String?) async -> UIImage? {
        guard let assetId, let api, let scope else { return nil }
        // 不同服务器可能有相同的资产 id，缓存键必须带上“实例 + 用户”。
        let key = "\(scope)/\(assetId)"
        if let cached = IconCache.shared.image(for: key) { return cached }
        guard let data = try? await api.data("/assets/\(assetId)"), let image = UIImage(data: data) else { return nil }
        IconCache.shared.store(image, for: key)
        return image
    }
}

/// 按名称生成稳定色相，同名颜色一致。
private func stableHue(_ name: String) -> Double {
    Double(name.unicodeScalars.reduce(7) { ($0 * 31 + Int($1.value)) % 360 }) / 360
}

/// 账户等方形图标：自定义图片 → 卡组织图标 → 彩色首字母。图片铺满后裁切圆角，不垫白底。
struct EntityIcon: View {
    @Environment(AppModel.self) private var model
    let name: String
    var assetId: String? = nil
    var brand: String = ""
    var size: CGFloat = 36
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if !brand.isEmpty, UIImage(named: "brand-\(brand)") != nil {
                Image("brand-\(brand)").resizable().scaledToFit()
            } else {
                let hue = stableHue(name)
                Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                    .font(.system(size: max(11, size * 0.46), weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hue: hue, saturation: 0.42, brightness: 0.92))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(hue: hue, saturation: 0.34, brightness: 0.28))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
        .accessibilityLabel(name)
        .task(id: assetId) { image = await AssetImageLoader.load(assetId, api: model.api, scope: model.server?.scope) }
    }
}

/// 信用卡卡面：按 ISO 卡片比例（1.586:1）显示，主显示卡面图片，右下角显示卡组织角标。
/// 缩略尺寸（width < 80）隐藏微型噪点文字，仅保留高辨识度色带、芯片与角标；大尺寸才渲染可读卡名与末四位。
struct CardFace: View {
    @Environment(AppModel.self) private var model
    let card: Card?
    var fallbackName: String = ""
    var width: CGFloat = 56
    @State private var image: UIImage?

    private var name: String { card?.name ?? fallbackName }
    private var height: CGFloat { width / 1.586 }
    private var showsMicroText: Bool { width >= 96 }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let image {
                Image(uiImage: image).resizable().scaledToFill().frame(width: width, height: height)
            } else {
                defaultFace
            }
            if let brand = card?.brand, !brand.isEmpty, UIImage(named: "brand-\(brand)") != nil {
                Image("brand-\(brand)").resizable().scaledToFit()
                    .frame(width: width * 0.3)
                    .padding(width * 0.05)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: max(5, width * 0.11), style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: max(5, width * 0.11), style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 0.75)
        }
        .accessibilityLabel("\(name) 卡面")
        .task(id: card?.iconAssetId) { image = await AssetImageLoader.load(card?.iconAssetId, api: model.api, scope: model.server?.scope) }
    }

    private var defaultFace: some View {
        let hue = stableHue(name)
        return ZStack(alignment: .topLeading) {
            LinearGradient(
                colors: [
                    Color(hue: hue, saturation: 0.24, brightness: 0.34),
                    Color(hue: hue, saturation: 0.20, brightness: 0.16)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            // 柔和的卡面高光层次，提升小尺寸缩略辨识度
            Circle()
                .fill(Color.white.opacity(0.08))
                .frame(width: width * 0.72, height: width * 0.72)
                .offset(x: width * 0.45, y: -height * 0.35)

            VStack(alignment: .leading, spacing: height * 0.08) {
                if showsMicroText {
                    Text(name)
                        .font(.system(size: max(11, width * 0.095), weight: .semibold))
                        .lineLimit(1)
                } else {
                    Spacer(minLength: 0)
                }
                RoundedRectangle(cornerRadius: max(2, width * 0.03), style: .continuous)
                    .fill(LinearGradient(
                        colors: [Color(red: 0.90, green: 0.84, blue: 0.68), Color(red: 0.68, green: 0.57, blue: 0.34)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                    .frame(width: width * 0.22, height: height * 0.24)
                Spacer(minLength: 0)
                if showsMicroText {
                    let last4 = card?.last4.isEmpty == false ? card!.last4 : "••••"
                    Text("•••• \(last4)")
                        .font(.system(size: max(10, width * 0.085), design: .monospaced))
                        .opacity(0.84)
                }
            }
            .foregroundStyle(Color(red: 0.97, green: 0.95, blue: 0.91))
            .padding(.horizontal, width * 0.1)
            .padding(.vertical, height * 0.12)
            .frame(width: width, height: height, alignment: .topLeading)
        }
    }
}

/// 同一服务器内资产 id 不可变，按“账号作用域/资产 id”缓存；切换或退出账号时整体清空。
final class IconCache {
    static let shared = IconCache()
    private let cache = NSCache<NSString, UIImage>()
    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }
    func store(_ image: UIImage, for key: String) { cache.setObject(image, forKey: key as NSString) }
    func removeAll() { cache.removeAllObjects() }
}

struct StatusBadge: View {
    let status: BillStatus

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)
                .accessibilityHidden(true)
            Text(status.label)
                .font(AppTypography.badge)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3.5)
        .foregroundStyle(color)
        .background(surface, in: Capsule())
    }

    private var color: Color {
        switch status {
        case .pending: return AppTheme.warning
        case .paid: return AppTheme.success
        case .void: return AppTheme.muted
        }
    }

    private var surface: Color {
        switch status {
        case .pending: return AppTheme.warningSurface
        case .paid: return AppTheme.successSurface
        case .void: return AppTheme.surfaceMuted
        }
    }
}

struct BillDayGroup: Identifiable {
    let id: DateOnly
    let bills: [Bill]

    static func groups(for bills: [Bill]) -> [Self] {
        Dictionary(grouping: bills, by: \.dueDate)
            .sorted { $0.key < $1.key }
            .map { day, bills in
                Self(id: day, bills: bills.sorted { ($0.cardName, $0.id) < ($1.cardName, $1.id) })
            }
    }
}

/// 账单行：卡片图标 | 卡名与扣款账户（Baseline） | 金额（Emphasized）与状态。
struct BillRow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    let bill: Bill
    var showsDate = true
    var showsStatus = true

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            identity
                .frame(maxWidth: .infinity, alignment: .leading)
            details
                .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil, alignment: .trailing)
        }
        .padding(.vertical, 7)
        .frame(minHeight: 44)
        .opacity(bill.status == .void ? 0.65 : 1)
        .accessibilityElement(children: .combine)
    }

    private var identity: some View {
        let card = model.card(bill.cardId)
        return HStack(spacing: 11) {
            CardFace(card: card, fallbackName: bill.cardName, width: 52)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(bill.cardName)
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(bill.status == .void ? AppTheme.muted : AppTheme.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                HStack(spacing: 6) {
                    EntityIcon(name: bill.accountName, assetId: model.account(bill.debitAccountId)?.iconAssetId, size: 16)
                        .accessibilityHidden(true)
                    Text(bill.accountName)
                        .lineLimit(1)
                    if showsDate {
                        Text("·")
                        Text(bill.dueDate.shortLabel)
                            .lineLimit(1)
                    }
                }
                .font(AppTypography.caption)
                .foregroundStyle(AppTheme.muted)
            }
        }
    }

    private var details: some View {
        VStack(alignment: .trailing, spacing: 5) {
            StructuredAmountText(
                formatted: model.currencies.format(bill.amountMinor, currency: bill.currency),
                numberFont: AppTypography.rowAmount,
                currencyFont: AppTypography.badge,
                color: bill.status == .void ? AppTheme.muted : AppTheme.ink,
                strikethrough: bill.status == .void
            )
            .fixedSize(horizontal: true, vertical: false)
            .layoutPriority(1)
            if showsStatus {
                StatusBadge(status: bill.status)
            }
        }
        .layoutPriority(1)
    }
}

/// 离线状态提示：在线正常同步时静默退场，避免占用主内容区；异常离线或显式要求时浮现。
struct SyncStatusBar: View {
    @Environment(AppModel.self) private var model
    var showsLastSync = false

    var body: some View {
        if model.isOffline {
            ExpressivePill(
                title: model.lastSync == nil ? "离线 · 尚未同步数据" : "离线 · 正在查看缓存",
                systemImage: "wifi.slash",
                tint: AppTheme.warning,
                fill: AppTheme.warningSurface
            )
        } else if showsLastSync, let lastSync = model.lastSync {
            Label("最后同步 \(lastSync.formatted(date: .omitted, time: .shortened))", systemImage: "checkmark.circle")
                .font(AppTypography.caption)
                .foregroundStyle(AppTheme.muted)
        }
    }
}
