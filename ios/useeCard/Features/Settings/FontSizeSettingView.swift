import SwiftUI

/// 字体大小调节页面：支持实时交互预览与挡位选择（或跟随 iOS 系统）。
struct FontSizeSettingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Form {
            // MARK: - 实时效果预览
            Section {
                previewCard
                    .appListRow()
            } header: {
                AppEyebrow("实时预览")
            } footer: {
                Text("字体大小将影响 App 内的列表、卡片、金额及设置页文字。")
                    .font(AppTypography.caption)
            }

            // MARK: - 跟随系统开关
            Section {
                Toggle("跟随系统大小", isOn: Binding(
                    get: { model.isFollowSystemFontSize },
                    set: { model.setFollowSystemFontSize($0) }
                ))
                .tint(AppTheme.accent)
                .appListRow()
            } footer: {
                Text(model.isFollowSystemFontSize
                     ? "当前已开启跟随系统。App 字体大小与 iOS 系统「设置 > 显示与亮度 > 文字大小」自动保持一致。"
                     : "已关闭跟随系统，下方调节将独立生效于 useeCard。")
                    .font(AppTypography.caption)
            }

            // MARK: - 挡位滑块与快速选择
            Section {
                VStack(spacing: 16) {
                    // 当前所选挡位标签
                    HStack {
                        Text("当前设定")
                            .font(AppTypography.supporting)
                            .foregroundStyle(AppTheme.muted)
                        Spacer()
                        Text(model.isFollowSystemFontSize ? "跟随系统（\(model.customFontSize.label)）" : model.customFontSize.label)
                            .font(AppTypography.badge)
                            .foregroundStyle(AppTheme.accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(AppTheme.accentSurface, in: Capsule())
                    }

                    // A - Slider - A
                    HStack(spacing: 14) {
                        Text("A")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(AppTheme.muted)

                        Slider(
                            value: Binding(
                                get: { Double(model.customFontSize.rawValue) },
                                set: { newValue in
                                    let step = Int(round(newValue))
                                    if let size = AppFontSize(rawValue: step) {
                                        model.setCustomFontSize(size)
                                    }
                                }
                            ),
                            in: 0...Double(AppFontSize.allCases.count - 1),
                            step: 1
                        )
                        .tint(AppTheme.accent)

                        Text("A")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                    }

                    // 挡位刻度文字（轻点亦可直接选中）
                    HStack {
                        ForEach(AppFontSize.allCases) { size in
                            Button {
                                model.setCustomFontSize(size)
                            } label: {
                                VStack(spacing: 4) {
                                    Circle()
                                        .fill(model.customFontSize == size ? AppTheme.accent : AppTheme.divider)
                                        .frame(width: 5, height: 5)
                                    Text(size.label)
                                        .font(.caption2)
                                        .fontWeight(model.customFontSize == size ? .bold : .regular)
                                        .foregroundStyle(model.customFontSize == size ? AppTheme.accent : AppTheme.muted)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.vertical, 8)
                .appListRow()
                .sensoryFeedback(.selection, trigger: model.customFontSize)

                if !model.isFollowSystemFontSize {
                    Button("恢复标准字号") {
                        model.setCustomFontSize(.standard)
                    }
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.ink)
                    .disabled(model.customFontSize == .standard)
                    .appListRow()
                }
            } header: {
                AppEyebrow("字号调节")
            } footer: {
                Text("“标准”对应 iOS 默认文本基准（17pt）。轻点各挡位名称或拖动滑块可快速切换。")
                    .font(AppTypography.caption)
            }
        }
        .appPage()
        .navigationTitle("字体大小")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - 模拟卡片预览视图
    private var previewCard: some View {
        AppGroup(fill: AppTheme.surfaceElevated) {
            VStack(alignment: .leading, spacing: 14) {
                // 顶部卡片来源与状态
                HStack(spacing: 12) {
                    FormIconSlot(systemName: "creditcard.fill", tint: AppTheme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("招商银行 · 经典白金卡")
                            .font(AppTypography.cardTitle)
                            .foregroundStyle(AppTheme.ink)
                            .lineLimit(1)
                        Text("尾号 8820 · 信用卡")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                    Spacer()
                    ExpressivePill(title: "待扣款", systemImage: "clock", tint: AppTheme.warning)
                }

                AppDivider(inset: 0)

                // 核心金额展示
                VStack(alignment: .leading, spacing: 6) {
                    Text("本期应还款")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                    HeroAmountText(formatted: "¥ 12,580.00")
                }

                // 底部还款信息提示
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.accent)
                    Text("4月10日扣款 · 剩余 3 天")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.ink)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(AppTheme.surfaceMuted, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .padding(16)
        }
    }
}
