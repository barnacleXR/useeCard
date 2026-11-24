import SwiftUI

/// 日本金融机构检索与选择弹窗
struct BankPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    let selectedBankCode: String
    let onSelect: (BankEntry) -> Void
    var onClear: (() -> Void)? = nil

    @State private var searchText = ""
    @State private var banks: [BankEntry] = BankEntry.defaultJapaneseBanks
    @State private var isSearching = false

    var body: some View {
        NavigationStack {
            List {
                if let onClear, !selectedBankCode.isEmpty {
                    Section {
                        Button(role: .destructive) {
                            onClear()
                            dismiss()
                        } label: {
                            Label("清除关联（不关联预设银行）", systemImage: "xmark.circle")
                                .font(AppTypography.rowTitle)
                        }
                        .appListRow()
                    }
                }

                Section {
                    if isSearching {
                        HStack(spacing: 12) {
                            ProgressView()
                                .tint(AppTheme.accent)
                            Text("正在检索金融机构…")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.vertical, 8)
                        .appListRow()
                    } else if banks.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 28))
                                .foregroundStyle(AppTheme.muted)
                            Text("未找到相关金融机构")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.muted)
                            Text("可直接在表单中手动填写银行名称与代码")
                                .font(AppTypography.caption)
                                .foregroundStyle(AppTheme.muted.opacity(0.8))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                        .appListRow()
                    } else {
                        ForEach(banks) { bank in
                            Button {
                                onSelect(bank)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    FormIconSlot(systemName: "building.columns", tint: AppTheme.accent)

                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            Text(bank.displayName)
                                                .font(AppTypography.cardTitle)
                                                .foregroundStyle(AppTheme.ink)

                                            if bank.code == selectedBankCode {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .font(.system(size: 14))
                                                    .foregroundStyle(AppTheme.accent)
                                            }
                                        }

                                        HStack(spacing: 6) {
                                            Text(bank.kana)
                                                .font(AppTypography.caption)
                                                .foregroundStyle(AppTheme.muted)

                                            Text("· 代码 \(bank.code)")
                                                .font(AppTypography.caption.monospacedDigit())
                                                .foregroundStyle(AppTheme.muted)
                                        }
                                    }

                                    Spacer()

                                    if bank.domain != nil {
                                        ExpressivePill(
                                            title: "可抓取官网图标",
                                            systemImage: "sparkles",
                                            tint: AppTheme.accent,
                                            fill: AppTheme.accentSurface
                                        )
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                            .buttonStyle(AppRowButtonStyle())
                            .appListRow()
                        }
                    }
                } header: {
                    AppEyebrow(searchText.isEmpty ? "常用日本金融机构（\(banks.count)）" : "检索结果（\(banks.count)）")
                } footer: {
                    if searchText.isEmpty {
                        Text("支持按银行名（如 三井住友）、假名（ミツイスミトモ）、罗马字（mitsui）或 4 位代码（0009）检索。选中后将自动填充并抓取官方图标。")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }
            .appPage()
            .navigationTitle("选择金融机构")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "输入 みずほ / mitsui / 0009")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .task(id: searchText) {
                let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
                if query.isEmpty {
                    banks = BankEntry.defaultJapaneseBanks
                    isSearching = false
                    return
                }

                isSearching = true
                do {
                    try await Task.sleep(nanoseconds: 180_000_000)
                    let results = await model.searchBanks(query: query)
                    if !Task.isCancelled {
                        banks = results
                    }
                } catch {
                    // Task cancelled
                }
                isSearching = false
            }
        }
    }
}
