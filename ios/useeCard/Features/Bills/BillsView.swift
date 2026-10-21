import SwiftUI

/// 账单：所选月份的账单（按实际扣款日），以及未提交到服务器的草稿。
struct BillsView: View {
    @Environment(AppModel.self) private var model
    @State private var editor: BillEditorView.Mode?
    @State private var voiding: Bill?

    var body: some View {
        NavigationStack {
            List {
                if !model.drafts.isEmpty {
                    Section {
                        ForEach(model.drafts) { draft in
                            Button { editor = .draft(draft) } label: { DraftRow(draft: draft) }
                                .swipeActions { Button("删除", role: .destructive) { model.deleteDraft(draft) } }
                        }
                    } header: {
                        Text("草稿 · 未保存到服务器")
                    } footer: {
                        Text("草稿不计入备款合计。联网后打开草稿并提交。")
                    }
                }
                Section {
                    if model.bills.isEmpty {
                        Text("这个月还没有账单。").foregroundStyle(.secondary)
                    }
                    ForEach(model.bills.sorted { ($0.dueDate, $0.cardName) < ($1.dueDate, $1.cardName) }) { bill in
                        Button { if bill.status != .void { editor = .edit(bill) } } label: { BillRow(bill: bill) }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .leading) {
                                if bill.status == .pending {
                                    Button("已扣款") { Task { await model.perform(.paid, on: bill) } }.tint(.green)
                                } else if bill.status == .paid {
                                    Button("撤销已扣款") { Task { await model.perform(.undoPaid, on: bill) } }.tint(.orange)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                if bill.status != .void { Button("作废", role: .destructive) { voiding = bill } }
                            }
                    }
                } header: {
                    HStack { Text(model.month.label); Spacer(); SyncStatusBar() }
                }
            }
            .refreshable { await model.refresh() }
            .navigationTitle("账单")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editor = .create } label: { Image(systemName: "plus") }
                        .accessibilityLabel("录入账单").disabled(model.activeCards.isEmpty)
                }
            }
            .safeAreaInset(edge: .bottom) { MonthSwitcher().padding(.bottom, 8) }
            .sheet(item: $editor) { mode in BillEditorView(mode: mode) }
            .confirmationDialog("作废这笔账单？", isPresented: Binding(get: { voiding != nil }, set: { if !$0 { voiding = nil } }), titleVisibility: .visible, presenting: voiding) { bill in
                Button("作废", role: .destructive) { Task { await model.perform(.void, on: bill) } }
            } message: { _ in
                Text("历史记录会保留，并从备款汇总中排除。")
            }
        }
    }
}

struct DraftRow: View {
    @Environment(AppModel.self) private var model
    let draft: BillDraft
    var body: some View {
        HStack {
            Image(systemName: "tray.and.arrow.up").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.card(draft.input.cardId)?.name ?? "未知卡片").font(.body.weight(.semibold))
                Text("\(draft.input.dueDate.shortLabel) · 草稿").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(model.currencies.format(draft.input.amountMinor, currency: draft.input.currency)).monospacedDigit().foregroundStyle(.secondary)
        }
    }
}
