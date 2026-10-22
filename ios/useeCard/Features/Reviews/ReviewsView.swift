import SwiftUI

/// 月度检查：逐卡核对，不用填零。“无新增”只是本轮检查结论，不抵消已有待还账单。
struct ReviewsView: View {
    @Environment(AppModel.self) private var model
    @State private var selection = Set<String>()
    @State private var editMode: EditMode = .inactive
    @State private var showLowFrequency = false
    @State private var linking: Review?
    @State private var error: String?
    @State private var confirmUnlink = false

    private var visible: [Review] { model.reviews.filter { showLowFrequency || $0.frequency != "low" } }
    private var missingCards: [Card] {
        model.reviews.isEmpty ? [] : model.activeCards.filter { card in !model.reviews.contains { $0.cardId == card.id } }
    }

    var body: some View {
        List(selection: $selection) {
            Section {
                HStack {
                    Button { Task { await model.changeReviewMonth(by: -1) } } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44).contentShape(Rectangle()) }
                    Spacer()
                    Text(model.reviewMonth.label).font(.headline)
                    Spacer()
                    Button { Task { await model.changeReviewMonth(by: 1) } } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44).contentShape(Rectangle()) }
                }
                .buttonStyle(.borderless)
            } footer: {
                Text("检查月份与扣款月份相互独立；可以关联任意月份录入的账单。")
            }

            if model.reviews.isEmpty {
                Section { Button("创建本月检查清单") { Task { await model.startReview() } } }
            } else {
                if !missingCards.isEmpty {
                    Section {
                        Button("将 \(missingCards.map(\.name).joined(separator: "、")) 加入本轮") { Task { await model.addCardsToReview(missingCards.map(\.id)) } }
                    } footer: { Text("这些卡在清单创建后新增，未加入本轮检查。") }
                }
                Section {
                    ForEach(visible) { review in
                        HStack {
                            let card = model.card(review.cardId)
                            CardFace(card: card, fallbackName: review.cardName, width: 44)
                            Text(review.cardName)
                            Spacer()
                            Text(review.status == .reviewed ? "已核对 \(review.billIds.count) 笔" : review.status.label)
                                .font(.caption).foregroundStyle(review.status == .unreviewed ? Color.secondary : Color.green)
                        }
                        .tag(review.id)
                        .swipeActions { Button("关联账单") { linking = review }.tint(.accentColor) }
                    }
                } header: {
                    HStack {
                        Text("\(model.reviews.filter { $0.status == .unreviewed }.count) 张未确认")
                        Spacer()
                        let lowCount = model.reviews.filter { $0.frequency == "low" }.count
                        if lowCount > 0 {
                            Button(showLowFrequency ? "折叠低频卡" : "展开低频卡（\(lowCount)）") { showLowFrequency.toggle() }.font(.caption)
                        }
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .environment(\.editMode, $editMode)
        .navigationTitle("月度检查")
        .toolbar {
            // 直接切换本视图的 editMode 状态；toolbar 不一定继承 List 上的 editMode 环境值。
            if !model.reviews.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(editMode == .active ? "完成" : "多选") {
                        editMode = editMode == .active ? .inactive : .active
                        if editMode == .inactive { selection.removeAll() }
                    }
                }
            }
            if editMode == .active {
                ToolbarItem(placement: .bottomBar) {
                    Button("所选 \(selection.count) 张无新增账单") {
                        if selectedItems.contains(where: { !$0.billIds.isEmpty }) { confirmUnlink = true } else { Task { await markNoNew(unlink: false) } }
                    }
                    .disabled(selection.isEmpty)
                }
            }
        }
        // 折叠低频卡时取消其勾选，避免批量确认看不见的卡。
        .onChange(of: showLowFrequency) { _, open in if !open { selection = selection.filter { id in visible.contains { $0.id == id } } } }
        .confirmationDialog("所选卡片已关联账单", isPresented: $confirmUnlink, titleVisibility: .visible) {
            Button("解除关联并标记无新增", role: .destructive) { Task { await markNoNew(unlink: true) } }
        } message: { Text("实际账单仍保留，只解除与本轮检查的关联。") }
        .sheet(item: $linking) { review in ReviewLinkSheet(review: review) }
        .refreshable { await model.refresh() }
    }

    private var selectedItems: [Review] { model.reviews.filter { selection.contains($0.id) } }

    private func markNoNew(unlink: Bool) async {
        error = nil
        do {
            try await model.confirmReviews(selectedItems.map { ReviewConfirmItem(id: $0.id, version: $0.version, status: "no_new", billIds: [], unlinkConfirmed: unlink) })
            selection.removeAll(); editMode = .inactive
        } catch { self.error = error.localizedDescription }
    }
}

/// 为一张卡勾选本轮已核对的账单；候选不受扣款月份限制。
struct ReviewLinkSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let review: Review
    @State private var candidates: [Bill]?
    @State private var selected = Set<String>()
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List(selection: $selected) {
                if let candidates {
                    if candidates.isEmpty { Text("这张卡还没有有效账单，请先录入。").foregroundStyle(.secondary) }
                    ForEach(candidates) { BillRow(bill: $0).tag($0.id) }
                } else {
                    ProgressView()
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("\(review.cardName) · 关联账单")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("确认 \(selected.count) 笔") { Task { await save() } }.disabled(selected.isEmpty) }
            }
            .task {
                selected = Set(review.billIds)
                do { candidates = try await model.billsForCard(review.cardId).filter { $0.status != .void } }
                catch { self.error = error.localizedDescription; candidates = [] }
            }
        }
    }

    private func save() async {
        do {
            try await model.confirmReviews([ReviewConfirmItem(id: review.id, version: review.version, status: "reviewed", billIds: Array(selected), unlinkConfirmed: false)])
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
