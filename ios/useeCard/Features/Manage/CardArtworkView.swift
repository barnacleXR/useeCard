import SwiftUI

/// Revolut 级曜石质感实体卡面视觉组件。
/// 支持自定义卡面图片（来自服务器资产，支持卡面网址/上传）与纯暗黑拟真卡面动态切换。
struct CardArtworkView: View {
    @Environment(AppModel.self) private var model

    let name: String
    let issuer: String
    let last4: String
    let brand: String
    var assetId: String? = nil
    var isLowFrequency: Bool = false
    var width: CGFloat = 280

    @State private var loadedImage: UIImage?

    private var height: CGFloat { width / 1.586 }

    var body: some View {
        ZStack {
            if let loadedImage {
                // 自定义展示卡面图片（铺满并裁切圆角）
                Image(uiImage: loadedImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: width, height: height)
                    .clipShape(RoundedRectangle(cornerRadius: width * 0.055, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: width * 0.055, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                    )

                // 右下角卡组织角标叠加
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        brandBadge
                            .padding(width * 0.05)
                    }
                }
            } else {
                proceduralCardFace
            }
        }
        .frame(width: width, height: height)
        .shadow(color: Color.black.opacity(0.45), radius: 16, x: 0, y: 8)
        .task(id: assetId) {
            loadedImage = await AssetImageLoader.load(assetId, api: model.api, scope: model.server?.scope)
        }
    }

    /// 纯暗黑曜石拟真卡面
    private var proceduralCardFace: some View {
        ZStack {
            // 底板与材质微光
            RoundedRectangle(cornerRadius: width * 0.055, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(hex: 0x1E2330),
                            Color(hex: 0x141822),
                            Color(hex: 0x0C0E14)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    // 钛金属光晕弧线
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [Color.white.opacity(0.06), Color.clear],
                                center: .center,
                                startRadius: 0,
                                endRadius: width * 0.7
                            )
                        )
                        .frame(width: width * 1.4, height: width * 1.4)
                        .offset(x: -width * 0.4, y: -height * 0.3)
                        .clipped()
                )
                .overlay(
                    RoundedRectangle(cornerRadius: width * 0.055, style: .continuous)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.18),
                                    Color.white.opacity(0.06),
                                    Color.white.opacity(0.02)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )

            // 卡面元素布局
            VStack(alignment: .leading, spacing: 0) {
                // 顶栏：发卡行与非接闪付符号
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(issuer.isEmpty ? "CREDIT CARD" : issuer.uppercased())
                            .font(.system(size: width * 0.042, weight: .semibold, design: .monospaced))
                            .foregroundStyle(Color.white.opacity(0.72))
                            .lineLimit(1)
                        if isLowFrequency {
                            Text("低频卡")
                                .font(.system(size: width * 0.032, weight: .medium))
                                .foregroundStyle(Color(hex: 0x22C58B))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color(hex: 0x22C58B).opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }
                    Spacer()
                    Image(systemName: "wave.3.forward")
                        .font(.system(size: width * 0.055, weight: .light))
                        .foregroundStyle(Color.white.opacity(0.45))
                }

                Spacer()

                // 中间：EMV 智能金芯
                HStack {
                    emvChip
                    Spacer()
                }

                Spacer()

                // 底栏：卡片名称、尾号与卡组织
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(name.isEmpty ? "未命名卡片" : name)
                            .font(.system(size: width * 0.052, weight: .bold))
                            .foregroundStyle(Color.white)
                            .lineLimit(1)

                        Text("•••• •••• •••• \(last4.isEmpty ? "••••" : last4)")
                            .font(.system(size: width * 0.042, weight: .medium, design: .monospaced))
                            .foregroundStyle(Color.white.opacity(0.65))
                    }

                    Spacer()

                    brandBadge
                }
            }
            .padding(width * 0.075)
        }
    }

    /// EMV 金色/香槟芯片
    private var emvChip: some View {
        let chipWidth = width * 0.15
        let chipHeight = chipWidth * 0.78
        return ZStack {
            RoundedRectangle(cornerRadius: chipWidth * 0.18, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0xD4AF37), Color(hex: 0xAA820A)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: chipWidth * 0.18, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.2), lineWidth: 0.5)
                )

            // 芯片电路微线
            Path { path in
                path.move(to: CGPoint(x: 0, y: chipHeight * 0.5))
                path.addLine(to: CGPoint(x: chipWidth, y: chipHeight * 0.5))
                path.move(to: CGPoint(x: chipWidth * 0.35, y: 0))
                path.addLine(to: CGPoint(x: chipWidth * 0.35, y: chipHeight))
                path.move(to: CGPoint(x: chipWidth * 0.65, y: 0))
                path.addLine(to: CGPoint(x: chipWidth * 0.65, y: chipHeight))
            }
            .stroke(Color.black.opacity(0.25), lineWidth: 0.75)
        }
        .frame(width: chipWidth, height: chipHeight)
    }

    /// 卡组织标志
    @ViewBuilder
    private var brandBadge: some View {
        let badgeSize = width * 0.058
        let brandClean = brand.lowercased().trimmingCharacters(in: .whitespaces)

        switch brandClean {
        case "visa":
            Text("VISA")
                .font(.system(size: badgeSize, weight: .heavy, design: .rounded))
                .italic()
                .foregroundStyle(
                    LinearGradient(colors: [Color(hex: 0x1A73E8), Color(hex: 0x4285F4)], startPoint: .leading, endPoint: .trailing)
                )
        case "mastercard":
            HStack(spacing: -badgeSize * 0.35) {
                Circle().fill(Color(hex: 0xEB001B)).frame(width: badgeSize * 1.1, height: badgeSize * 1.1)
                Circle().fill(Color(hex: 0xF79E1B).opacity(0.92)).frame(width: badgeSize * 1.1, height: badgeSize * 1.1)
            }
        case "jcb":
            Text("JCB")
                .font(.system(size: badgeSize * 0.95, weight: .black, design: .rounded))
                .foregroundStyle(Color(hex: 0x0079C1))
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Color.white.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 3))
        case "amex":
            Text("AMEX")
                .font(.system(size: badgeSize * 0.85, weight: .black, design: .monospaced))
                .foregroundStyle(Color(hex: 0x006FCF))
                .padding(.horizontal, 4)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 3))
        case "unionpay":
            Text("银联")
                .font(.system(size: badgeSize * 0.9, weight: .bold))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Color(hex: 0xDF251A))
                .clipShape(RoundedRectangle(cornerRadius: 3))
        case "diners":
            Text("DINERS")
                .font(.system(size: badgeSize * 0.8, weight: .heavy))
                .foregroundStyle(Color.white.opacity(0.85))
        case "discover":
            Text("DISCOVER")
                .font(.system(size: badgeSize * 0.78, weight: .heavy))
                .foregroundStyle(Color(hex: 0xFF6000))
        default:
            EmptyView()
        }
    }
}
