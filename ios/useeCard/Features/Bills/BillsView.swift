import SwiftUI

/// 所选月份的账单按实际扣款日分组，未提交的草稿单列。
struct BillsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var editor: BillEditorView.Mode?
    @State private var voiding: Bill?
    @State private var filter: Filter = .all

    private enum Filter: CaseIterable, Hashable {
        case all, pending, paid, void

        var status: BillStatus? {
            switch self {
            case .all: return nil
            case .pending: return .pending
            case .paid: return .paid
            case .void: return .void
            }
        }

        var title: String { status?.label ?? "全部" }
    }

    private func count(for item: Filter) -> Int {
        guard let status = item.status else { return model.bills.count }
        return model.bills.filter { $0.status == status }.count
    }

    private var filteredBills: [Bill] {
        guard let status = filter.status else { return model.bills }
        return model.bills.filter { $0.status == status }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 14) {
                        DebitMonthHeader { isCompact in
                            addBillButton(isCompact: isCompact)
                        }
                        filters
                    }
                    .padding(.vertical, 6)
                    .appListRow()
                }
                if !model.drafts.isEmpty {
                    Section {
                        ForEach(model.drafts) { draft in
                            Button { editor = .draft(draft) } label: { DraftRow(draft: draft) }
                                .buttonStyle(AppRowButtonStyle())
                                .swipeActions {
                                    Button("删除", role: .destructive) {
                                        do { try model.deleteDraft(draft) } catch { model.alertMessage = error.localizedDescription }
                                    }
                                }
                                .appListRow()
                        }
                    } header: {
                        AppEyebrow("待提交草稿 · \(model.drafts.count)", color: AppTheme.warning)
                    }
                }
                let groups = BillDayGroup.groups(for: filteredBills)
                if groups.isEmpty {
                    Section {
                        emptyState.appListRow()
                    } header: {
                        AppEyebrow("账单明细")
                    }
                }
                ForEach(groups) { group in
                    Section {
                        ForEach(group.bills) { bill in
                            billRow(bill).appListRow()
                        }
                    } header: {
                        HStack(spacing: 6) {
                            AppEyebrow(group.id.shortLabel, color: AppTheme.ink)
                            Text("· \(group.bills.count) 笔")
                                .font(AppTypography.caption)
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .appPage()
            .refreshable { await model.refresh() }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $editor) { mode in BillEditorView(mode: mode) }
            .sensoryFeedback(.success, trigger: model.bills.count)
            .confirmationDialog("作废这笔账单？", isPresented: Binding(get: { voiding != nil }, set: { if !$0 { voiding = nil } }), titleVisibility: .visible, presenting: voiding) { bill in
                Button("作废", role: .destructive) { Task { await model.perform(.void, on: bill) } }
            } message: { _ in
                Text("历史记录会保留，并从备款汇总中排除。")
            }
        }
    }

    private func addBillButton(isCompact: Bool) -> some View {
        Button { editor = .create } label: {
            HStack(spacing: isCompact ? 0 : 5) {
                Image(systemName: "plus")
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
                if !isCompact {
                    Text("录入")
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .frame(minWidth: isCompact ? 16 : nil)
        }
        .buttonStyle(AppActionStyle(tone: .accent, horizontalPadding: 14))
        .disabled(model.activeCards.isEmpty)
        .accessibilityLabel("录入账单")
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            filterButtons
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel("账单状态筛选")
    }

    private var filterButtons: some View {
        HStack(spacing: 8) {
            ForEach(Filter.allCases, id: \.self) { item in
                let isSelected = filter == item
                let itemCount = count(for: item)
                Button {
                    withAnimation(reduceMotion ? nil : AppTheme.snappySpring) {
                        filter = item
                    }
                } label: {
                    HStack(spacing: 5) {
                        if isSelected {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.bold))
                                .accessibilityHidden(true)
                                .transition(.scale.combined(with: .opacity))
                        }
                        Text(item.title)
                        if itemCount > 0 {
                            Text("\(itemCount)")
                                .font(AppTypography.badge.monospacedDigit())
                                .foregroundStyle(isSelected ? AppTheme.onInk.opacity(0.76) : AppTheme.muted)
                                .contentTransition(.numericText())
                        }
                    }
                    .fixedSize()
                }
                .buttonStyle(AppActionStyle(prominent: isSelected, compact: true, horizontalPadding: 13))
                .accessibilityLabel("\(item.title)，\(itemCount) 笔")
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: filter)
    }

    @ViewBuilder private var emptyState: some View {
        if model.isSyncing, model.summary == nil {
            HStack(spacing: 10) {
                ProgressView()
                Text("正在读取账单…")
                    .font(AppTypography.supporting)
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(.vertical, 10)
        } else if model.summary == nil {
            AppNotice(message: "尚未读取该月账单。", systemImage: "info.circle").padding(.vertical, 10)
        } else {
            AppNotice(message: model.bills.isEmpty ? "所选月份没有已录入账单。" : "当前筛选条件下没有账单。",
                      systemImage: model.bills.isEmpty ? "tray" : "line.3.horizontal.decrease")
                .padding(.vertical, 10)
        }
    }

    @ViewBuilder private func billRow(_ bill: Bill) -> some View {
        if bill.status == .void {
            BillRow(bill: bill, showsDate: false)
        } else {
            Button { editor = .edit(bill) } label: { BillRow(bill: bill, showsDate: false) }
                .buttonStyle(AppRowButtonStyle())
                .swipeActions(edge: .leading) {
                    if bill.status == .pending {
                        Button("已扣款") { Task { await model.perform(.paid, on: bill) } }.tint(AppTheme.success)
                    } else {
                        Button("撤销已扣款") { Task { await model.perform(.undoPaid, on: bill) } }.tint(AppTheme.warning)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("作废", role: .destructive) { voiding = bill }
                }
        }
    }
}

struct DraftRow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    let draft: BillDraft

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(AppTheme.warningSurface)
                    Image(systemName: "tray.and.arrow.up.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.warning)
                }
                .frame(width: 52, height: 33)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.card(draft.input.cardId)?.name ?? "未知卡片")
                        .font(AppTypography.rowTitle)
                        .foregroundStyle(AppTheme.ink)
                    Text("\(draft.input.dueDate.shortLabel) · 本地草稿")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            StructuredAmountText(
                formatted: model.currencies.format(draft.input.amountMinor, currency: draft.input.currency),
                numberFont: AppTypography.rowAmount,
                currencyFont: AppTypography.badge,
                color: AppTheme.ink
            )
            .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil, alignment: .trailing)
        }
        .padding(.vertical, 7)
        .accessibilityElement(children: .combine)
    }
}
