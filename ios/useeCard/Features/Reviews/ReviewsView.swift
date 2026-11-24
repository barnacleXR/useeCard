import SwiftUI

/// 检查月份独立于扣款月份。「无新增」只记录本轮检查结果。
struct ReviewsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selection = Set<String>()
    @State private var selecting = false
    @State private var showLowFrequency = false
    @State private var showCompleted = true
    @State private var linking: Review?
    @State private var error: String?
    @State private var confirmUnlink = false
    @State private var confirmBulkNoNew = false
    @State private var successFeedbackTrigger = 0

    private var visible: [Review] {
        model.reviews.filter { showLowFrequency || $0.frequency != "low" }
    }

    private var pendingReviews: [Review] {
        visible.filter { $0.status == .unreviewed }
    }

    private var completedReviews: [Review] {
        visible.filter { $0.status != .unreviewed }
    }

    private var missingCards: [Card] {
        model.activeCards.filter { card in !model.reviews.contains { $0.cardId == card.id } }
    }

    private var totalCount: Int { model.reviews.count }
    private var completedCount: Int { model.reviews.filter { $0.status != .unreviewed }.count }
    private var unreviewedCount: Int { totalCount - completedCount }
    private var lowCount: Int { model.reviews.filter { $0.frequency == "low" }.count }
    private var selectedItems: [Review] { visible.filter { selection.contains($0.id) } }

    /// 可一键安全标为“无新增”的待确认卡片（尚未关联账单）
    private var quickNoNewTargets: [Review] {
        pendingReviews.filter { $0.billIds.isEmpty }
    }

    private var locked: Bool {
        if case .loading = model.reviewMonthLoad { return true }
        return model.isWritingReviews
    }

    var body: some View {
        List {
            headerSection
            if model.reviews.isEmpty {
                startSection
            } else {
                if !missingCards.isEmpty, !selecting { missingCardsSection }
                if lowCount > 0 { lowFrequencyToggleSection }
                if selecting {
                    allCardsSelectingSection
                } else {
                    pendingSection
                    if !completedReviews.isEmpty {
                        completedSection
                    }
                }
            }
            if let error {
                Section {
                    AppNotice(message: error, systemImage: "exclamationmark.circle", color: AppTheme.danger)
                        .appListRow()
                }
            }
        }
        .listStyle(.insetGrouped)
        .appPage()
        .navigationTitle("月度检查")
        .toolbar {
            if !model.reviews.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(selecting ? "完成" : "多选") {
                        withAnimation(reduceMotion ? nil : AppTheme.snappySpring) {
                            selecting.toggle()
                            selection.removeAll()
                        }
                    }
                    .disabled(locked)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if selecting {
                AppActionBar {
                    Button {
                        if selectedItems.contains(where: { !$0.billIds.isEmpty }) {
                            confirmUnlink = true
                        } else {
                            Task { await markNoNew(items: selectedItems, unlink: false, exitSelection: true) }
                        }
                    } label: {
                        AppActionLabel(title: "将 \(selectedItems.count) 张卡标记为无新增",
                                       busy: model.isWritingReviews)
                    }
                    .buttonStyle(AppActionStyle(prominent: true, expands: true))
                    .disabled(selectedItems.isEmpty || locked)
                }
            }
        }
        .onChange(of: model.reviewMonth) { _, _ in
            selection.removeAll()
            selecting = false
            error = nil
        }
        .onChange(of: visible.map(\.id)) { _, ids in
            selection.formIntersection(ids)
        }
        .confirmationDialog("所选卡片已关联账单", isPresented: $confirmUnlink, titleVisibility: .visible) {
            Button("解除关联并标记无新增", role: .destructive) {
                Task { await markNoNew(items: selectedItems, unlink: true, exitSelection: true) }
            }
        } message: {
            Text("实际账单仍保留，只解除与本轮检查的关联。")
        }
        .confirmationDialog("将剩余 \(quickNoNewTargets.count) 张待确认卡标为无新增？", isPresented: $confirmBulkNoNew, titleVisibility: .visible) {
            Button("确认全部标为无新增") {
                Task { await markNoNew(items: quickNoNewTargets, unlink: false, exitSelection: false) }
            }
        } message: {
            Text("仅影响当前可见且尚未关联账单的待确认卡片，不会删除已有账单。")
        }
        .sheet(item: $linking) { review in ReviewLinkSheet(review: review) }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: successFeedbackTrigger)
    }

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                MonthPickerButton(
                    month: model.reviewMonth,
                    title: "检查月份",
                    showsSteppers: true,
                    showsTodayShortcut: true,
                    onSelect: select
                )
                .disabled(model.isWritingReviews)

                if totalCount > 0 {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(completedCount) / \(totalCount)")
                                .font(.system(.title, design: .rounded, weight: .bold).monospacedDigit())
                                .foregroundStyle(AppTheme.ink)
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: completedCount)
                            Text("张卡已确认")
                                .font(AppTypography.supporting)
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            if unreviewedCount == 0 {
                                ExpressivePill(
                                    title: "本轮已完成",
                                    systemImage: "checkmark.seal.fill",
                                    tint: AppTheme.success,
                                    fill: AppTheme.successSurface
                                )
                            } else {
                                ExpressivePill(
                                    title: "待核对 \(unreviewedCount)",
                                    tint: AppTheme.warning,
                                    fill: AppTheme.warningSurface
                                )
                            }
                        }
                        ProgressView(value: Double(completedCount), total: Double(totalCount))
                            .tint(AppTheme.accent)
                            .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: completedCount)
                            .accessibilityHidden(true)
                    }
                } else {
                    Text(progressTitle)
                        .font(AppTypography.cardTitle)
                        .foregroundStyle(AppTheme.ink)
                }

                MonthLoadNotice(state: model.reviewMonthLoad, retry: select)
                SyncStatusBar()
            }
            .padding(.vertical, 8)
            .appListRow()
        }
    }

    private var progressTitle: String {
        if !model.hasReviewData { return "尚未读取检查清单" }
        if model.reviews.isEmpty { return "本轮尚未开始" }
        return "\(unreviewedCount) 张卡尚未确认"
    }

    @ViewBuilder private var startSection: some View {
        if model.hasReviewData {
            Section {
                if model.activeCards.isEmpty {
                    AppNotice(message: "添加信用卡后即可创建检查清单。", systemImage: "creditcard")
                        .appListRow()
                } else {
                    Button { Task { await model.startReview() } } label: {
                        AppActionLabel(title: "创建本月检查清单", busy: model.isWritingReviews)
                    }
                    .buttonStyle(AppActionStyle(prominent: true, expands: true))
                    .disabled(locked)
                    .appListRow()
                }
            }
        } else if model.isSyncing {
            Section {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("正在读取月度检查…")
                        .font(AppTypography.supporting)
                        .foregroundStyle(AppTheme.muted)
                }
                .appListRow()
            }
        }
    }

    private var missingCardsSection: some View {
        Section {
            Button {
                Task { await model.addCardsToReview(missingCards.map(\.id)) }
            } label: {
                Label("将 \(missingCards.count) 张新增卡片加入本轮", systemImage: "plus.circle.fill")
            }
            .buttonStyle(AppActionStyle(tone: .tonal(AppTheme.accent, AppTheme.accentSurface), expands: true))
            .disabled(locked)
            .appListRow()
        } footer: {
            Text("清单创建后新增的卡片：\(missingCards.map(\.name).joined(separator: "、"))")
                .font(AppTypography.caption)
        }
    }

    private var lowFrequencyToggleSection: some View {
        Section {
            Toggle(isOn: $showLowFrequency.animation(reduceMotion ? nil : AppTheme.snappySpring)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("显示低频卡（\(lowCount) 张）")
                        .font(AppTypography.rowTitle)
                    Text("平时较少消费的卡片默认折叠，按需展开核对")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .tint(AppTheme.accent)
            .appListRow()
        }
    }

    /// 聚焦人工决策：仅展示当前待确认的卡片，并支持单卡直达“无新增 / 关联账单”与一键全标。
    private var pendingSection: some View {
        Section {
            if pendingReviews.isEmpty {
                AppNotice(
                    message: lowCount > 0 && !showLowFrequency
                        ? "高频卡片已全部确认完成。如需检查低频卡，请打开上方开关。"
                        : "本轮所有可见卡片都已完成核对！",
                    systemImage: "checkmark.circle.fill",
                    color: AppTheme.success
                )
                .padding(.vertical, 6)
                .appListRow()
            } else {
                if quickNoNewTargets.count >= 2 {
                    Button {
                        confirmBulkNoNew = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "sparkles")
                            Text("将其余 \(quickNoNewTargets.count) 张一键标为无新增")
                        }
                    }
                    .buttonStyle(AppActionStyle(tone: .tonal(AppTheme.accent, AppTheme.accentSurface), expands: true))
                    .disabled(locked)
                    .appListRow()
                }

                ForEach(pendingReviews) { review in
                    reviewActionRow(review, isPending: true).appListRow()
                }
            }
        } header: {
            AppEyebrow("待确认（\(pendingReviews.count)）", color: pendingReviews.isEmpty ? AppTheme.success : AppTheme.warning)
        }
    }

    private var completedSection: some View {
        Section {
            Button {
                withAnimation(reduceMotion ? nil : AppTheme.snappySpring) {
                    showCompleted.toggle()
                }
            } label: {
                HStack {
                    Text(showCompleted ? "收起已完成卡片" : "展开查看已完成卡片（\(completedReviews.count)）")
                        .font(AppTypography.groupEyebrow)
                        .foregroundStyle(AppTheme.muted)
                    Spacer()
                    Image(systemName: showCompleted ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .buttonStyle(AppRowButtonStyle())
            .appListRow()

            if showCompleted {
                ForEach(completedReviews) { review in
                    reviewActionRow(review, isPending: false).appListRow()
                }
            }
        } header: {
            AppEyebrow("已完成（\(completedReviews.count)）", color: AppTheme.success)
        }
    }

    private var allCardsSelectingSection: some View {
        Section {
            ForEach(visible) { review in
                let isSelected = selection.contains(review.id)
                Button {
                    if isSelected { selection.remove(review.id) } else { selection.insert(review.id) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted)
                            .accessibilityHidden(true)
                        identity(review)
                    }
                }
                .buttonStyle(AppRowButtonStyle())
                .accessibilityAddTraits(isSelected ? .isSelected : [])
                .disabled(locked)
                .appListRow()
            }
        } header: {
            AppEyebrow("选择要批量标记的卡片")
        }
    }

    private func reviewActionRow(_ review: Review, isPending: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                identity(review)
                Spacer(minLength: 0)
                if !isPending {
                    Button("调整") { linking = review }
                        .buttonStyle(AppActionStyle(compact: true, horizontalPadding: 12))
                        .accessibilityLabel("调整\(review.cardName)关联的账单")
                        .disabled(locked)
                }
            }

            if isPending {
                HStack(spacing: 8) {
                    Button {
                        linking = review
                    } label: {
                        Label("关联账单", systemImage: "link")
                    }
                    .buttonStyle(AppActionStyle(prominent: true, expands: true, compact: true))
                    .accessibilityLabel("关联\(review.cardName)的账单")
                    .disabled(locked)

                    Button {
                        Task { await markNoNew(items: [review], unlink: false, exitSelection: false) }
                    } label: {
                        Text("无新增")
                    }
                    .buttonStyle(AppActionStyle(expands: true, compact: true))
                    .accessibilityLabel("将\(review.cardName)标记为无新增")
                    .disabled(locked)
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func identity(_ review: Review) -> some View {
        HStack(spacing: 11) {
            CardFace(card: model.card(review.cardId), fallbackName: review.cardName, width: 46)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(review.cardName)
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.ink)
                Text(review.status == .reviewed ? "已核对 \(review.billIds.count) 笔账单" : review.status.label)
                    .font(AppTypography.caption)
                    .foregroundStyle(review.status == .unreviewed ? AppTheme.warning : AppTheme.success)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func select(_ month: MonthKey) {
        Task { await model.selectReviewMonth(month) }
    }

    private func markNoNew(items: [Review], unlink: Bool, exitSelection: Bool) async {
        guard !locked, !items.isEmpty else { return }
        error = nil
        do {
            try await model.confirmReviews(items.map {
                ReviewConfirmItem(id: $0.id, version: $0.version, status: "no_new", billIds: [],
                                  unlinkConfirmed: unlink)
            })
            if exitSelection {
                selection.removeAll()
                selecting = false
            }
            successFeedbackTrigger += 1
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// 候选账单可来自任意扣款月份，勾选在确认前保留于面板内。
struct ReviewLinkSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let review: Review
    @State private var candidates: [Bill]?
    @State private var selected = Set<String>()
    @State private var error: String?
    @State private var readFailed = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                if let candidates {
                    if candidates.isEmpty && !readFailed {
                        AppNotice(message: "这张卡尚未录入有效账单。", systemImage: "tray").appListRow()
                    }
                    ForEach(candidates) { bill in candidateRow(bill).appListRow() }
                } else {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在读取账单…")
                            .font(AppTypography.supporting)
                            .foregroundStyle(AppTheme.muted)
                    }
                    .appListRow()
                }
                if let error {
                    AppNotice(message: error, systemImage: "exclamationmark.circle", color: AppTheme.danger)
                        .appListRow()
                }
                if readFailed {
                    Button("重试") { Task { await load() } }
                        .buttonStyle(AppActionStyle(compact: true))
                        .appListRow()
                }
            }
            .listStyle(.insetGrouped)
            .appPage()
            .navigationTitle("\(review.cardName) · 关联账单")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(busy)
                }
            }
            .safeAreaInset(edge: .bottom) {
                AppActionBar {
                    Button { Task { await save() } } label: {
                        AppActionLabel(title: "确认关联 \(selected.count) 笔", busy: busy)
                    }
                    .buttonStyle(AppActionStyle(prominent: true, expands: true))
                    .disabled(busy || selected.isEmpty || candidates == nil || readFailed)
                }
            }
            .interactiveDismissDisabled(busy)
            .task { await load() }
        }
    }

    private func candidateRow(_ bill: Bill) -> some View {
        let isSelected = selected.contains(bill.id)
        return Button {
            if isSelected { selected.remove(bill.id) } else { selected.insert(bill.id) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted)
                    .accessibilityHidden(true)
                BillRow(bill: bill)
            }
        }
        .buttonStyle(AppRowButtonStyle())
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .disabled(busy)
    }

    private func load() async {
        error = nil
        readFailed = false
        candidates = nil
        do {
            let bills = try await model.billsForCard(review.cardId).filter { $0.status != .void }
            guard !Task.isCancelled else { return }
            selected = Set(review.billIds).intersection(bills.map(\.id))
            candidates = bills
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
            readFailed = true
            candidates = []
        }
    }

    private func save() async {
        guard !busy, !selected.isEmpty, candidates != nil, !readFailed else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await model.confirmReviews([
                ReviewConfirmItem(id: review.id, version: review.version, status: "reviewed",
                                  billIds: selected.sorted(), unlinkConfirmed: false)
            ])
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
