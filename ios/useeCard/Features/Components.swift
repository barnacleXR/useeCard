import SwiftUI
import UIKit

/// 读取受设备令牌保护的图片资产；失败时返回 nil，由调用方显示兜底样式。
enum AssetImageLoader {
    @MainActor
    static func load(_ assetId: String?, api: APIClient?) async -> UIImage? {
        guard let assetId, let api else { return nil }
        if let cached = IconCache.shared.image(for: assetId) { return cached }
        guard let data = try? await api.data("/assets/\(assetId)"), let image = UIImage(data: data) else { return nil }
        IconCache.shared.store(image, for: assetId)
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
                Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                    .font(.system(size: size * 0.45, weight: .bold))
                    .foregroundStyle(Color(hue: stableHue(name), saturation: 0.55, brightness: 0.45))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(hue: stableHue(name), saturation: 0.18, brightness: 0.96))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.26))
        .accessibilityLabel(name)
        .task(id: assetId) { image = await AssetImageLoader.load(assetId, api: model.api) }
    }
}

/// 信用卡卡面：按 ISO 卡片比例（1.586:1）显示，主显示卡面图片，右下角显示卡组织角标。
/// 没有卡面图片时显示与 Web 一致的默认卡面（名称、芯片、末四位）。
struct CardFace: View {
    @Environment(AppModel.self) private var model
    let card: Card?
    var fallbackName: String = ""
    var width: CGFloat = 56
    @State private var image: UIImage?

    private var name: String { card?.name ?? fallbackName }
    private var height: CGFloat { width / 1.586 }

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
                    .padding(width * 0.04)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: width * 0.075))
        .shadow(color: .black.opacity(0.15), radius: 3, y: 2)
        .accessibilityLabel("\(name) 卡面")
        .task(id: card?.iconAssetId) { image = await AssetImageLoader.load(card?.iconAssetId, api: model.api) }
    }

    private var defaultFace: some View {
        let hue = stableHue(name)
        return VStack(alignment: .leading, spacing: height * 0.08) {
            Text(name).font(.system(size: max(7, width * 0.09), weight: .semibold)).lineLimit(1)
            RoundedRectangle(cornerRadius: 2)
                .fill(LinearGradient(colors: [Color(red: 0.87, green: 0.82, blue: 0.68), Color(red: 0.66, green: 0.56, blue: 0.33)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: width * 0.19, height: height * 0.24)
            Spacer(minLength: 0)
            Text("•••• \(card?.last4.isEmpty == false ? card!.last4 : "••••")").font(.system(size: max(6, width * 0.075), design: .monospaced)).opacity(0.8)
        }
        .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.91))
        .padding(.horizontal, width * 0.09).padding(.vertical, height * 0.1)
        .frame(width: width, height: height, alignment: .topLeading)
        .background(LinearGradient(colors: [Color(hue: hue, saturation: 0.2, brightness: 0.3), Color(hue: hue, saturation: 0.17, brightness: 0.13)], startPoint: .topLeading, endPoint: .bottomTrailing))
    }
}

/// 资产 id 不可变，可放心按 id 缓存。
final class IconCache {
    static let shared = IconCache()
    private let cache = NSCache<NSString, UIImage>()
    func image(for id: String) -> UIImage? { cache.object(forKey: id as NSString) }
    func store(_ image: UIImage, for id: String) { cache.setObject(image, forKey: id as NSString) }
}

struct StatusBadge: View {
    let status: BillStatus
    var body: some View {
        Text(status.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
    private var color: Color {
        switch status { case .pending: return .accentColor; case .paid: return .green; case .void: return .secondary }
    }
}

/// 账单行：卡片图标 | 卡名与扣款账户 | 金额与状态。
struct BillRow: View {
    @Environment(AppModel.self) private var model
    let bill: Bill

    var body: some View {
        let card = model.card(bill.cardId)
        HStack(spacing: 12) {
            CardFace(card: card, fallbackName: bill.cardName, width: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text(bill.cardName).font(.body.weight(.semibold)).lineLimit(1)
                HStack(spacing: 6) {
                    EntityIcon(name: bill.accountName, assetId: model.account(bill.debitAccountId)?.iconAssetId, size: 16)
                    Text(bill.accountName).lineLimit(1)
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(model.currencies.format(bill.amountMinor, currency: bill.currency))
                    .font(.body.weight(.semibold).monospacedDigit())
                HStack(spacing: 6) {
                    Text(bill.dueDate.shortLabel).font(.caption).foregroundStyle(.secondary)
                    StatusBadge(status: bill.status)
                }
            }
        }
        .opacity(bill.status == .void ? 0.5 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// 离线与最后同步时间提示。
struct SyncStatusBar: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if model.isOffline {
            Label("离线 · 显示 \(model.lastSync.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "未同步") 的数据", systemImage: "wifi.slash")
                .font(.caption).foregroundStyle(.orange)
        } else if let lastSync = model.lastSync {
            Text("最后同步 \(lastSync.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
        }
    }
}
