import SwiftUI

/// 卡片与扣款账户管理中心
struct ManageCardsAndAccountsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum TabSegment: Int, CaseIterable, Identifiable {
        case cards = 0
        case accounts = 1
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .cards: return "信用卡"
            case .accounts: return "扣款账户"
            }
        }
    }

    @State private var selectedTab: TabSegment = .cards
    @State private var cardToEdit: Card?
    @State private var accountToEdit: Account?
    @State private var showingAddCard = false
    @State private var showingAddAccount = false
    @State private var cardToArchive: Card?
    @State private var accountToArchive: Account?
    @State private var archiving = false
    @State private var alertMessage: String?
    @State private var showsArchivedCards = false
    @State private var showsArchivedAccounts = false
    @State private var editMode: EditMode = .active

    private var activeCards: [Card] { model.cards.filter { !$0.isArchived } }
    private var archivedCards: [Card] { model.cards.filter { $0.isArchived } }
    private var activeAccounts: [Account] { model.accounts.filter { !$0.isArchived } }
    private var archivedAccounts: [Account] { model.accounts.filter { $0.isArchived } }

    var body: some View {
        VStack(spacing: 0) {
            // 顶部分段选择器与添加按钮
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    Picker("分类", selection: $selectedTab) {
                        Text("信用卡 (\(activeCards.count))").tag(TabSegment.cards)
                        Text("扣款账户 (\(activeAccounts.count))").tag(TabSegment.accounts)
                    }
                    .pickerStyle(.segmented)

                    addButton(isCompact: false)
                }
                HStack(spacing: 8) {
                    Picker("分类", selection: $selectedTab) {
                        Text("信用卡 (\(activeCards.count))").tag(TabSegment.cards)
                        Text("扣款账户 (\(activeAccounts.count))").tag(TabSegment.accounts)
                    }
                    .pickerStyle(.segmented)

                    addButton(isCompact: true)
                }
                VStack(spacing: 10) {
                    Picker("分类", selection: $selectedTab) {
                        Text("信用卡 (\(activeCards.count))").tag(TabSegment.cards)
                        Text("扣款账户 (\(activeAccounts.count))").tag(TabSegment.accounts)
                    }
                    .pickerStyle(.segmented)

                    addButton(isCompact: false)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(AppTheme.canvas)

            // 列表内容
            List {
                if selectedTab == .cards {
                    cardsContent
                } else {
                    accountsContent
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(AppTheme.canvas)
            .environment(\.editMode, $editMode)
            .animation(reduceMotion ? nil : AppTheme.snappySpring, value: selectedTab)
        }
        .appPage()
        .navigationTitle("卡片与账户")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingAddCard) {
            CardEditorSheet()
        }
        .sheet(item: $cardToEdit) { card in
            CardEditorSheet(editing: card)
        }
        .sheet(isPresented: $showingAddAccount) {
            AccountEditorSheet()
        }
        .sheet(item: $accountToEdit) { account in
            AccountEditorSheet(editing: account)
        }
        .confirmationDialog(
            "停用信用卡？",
            isPresented: Binding(get: { cardToArchive != nil }, set: { if !$0 { cardToArchive = nil } }),
            titleVisibility: .visible
        ) {
            if let card = cardToArchive {
                Button("停用「\(card.name)」", role: .destructive) {
                    Task { await archive(card: card) }
                }
            }
            Button("取消", role: .cancel) { cardToArchive = nil }
        } message: {
            Text("归档后不再用于新建账单，已有历史账单将继续保留并统计。")
        }
        .confirmationDialog(
            "停用扣款账户？",
            isPresented: Binding(get: { accountToArchive != nil }, set: { if !$0 { accountToArchive = nil } }),
            titleVisibility: .visible
        ) {
            if let account = accountToArchive {
                Button("停用「\(account.name)」", role: .destructive) {
                    Task { await archive(account: account) }
                }
            }
            Button("取消", role: .cancel) { accountToArchive = nil }
        } message: {
            Text("归档后不再用于新卡片绑定，已有账单将继续保留。")
        }
        .alert("提示", isPresented: Binding(get: { alertMessage != nil }, set: { if !$0 { alertMessage = nil } })) {
            Button("确定", role: .cancel) { alertMessage = nil }
        } message: {
            if let alertMessage { Text(alertMessage) }
        }
    }

    private func addButton(isCompact: Bool) -> some View {
        Button {
            if selectedTab == .cards {
                if activeAccounts.isEmpty {
                    alertMessage = "请先添加至少一个扣款账户，再添加信用卡。"
                } else {
                    showingAddCard = true
                }
            } else {
                showingAddAccount = true
            }
        } label: {
            HStack(spacing: isCompact ? 0 : 4) {
                Image(systemName: "plus")
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
                if !isCompact {
                    Text("添加")
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .frame(minWidth: isCompact ? 16 : nil)
        }
        .buttonStyle(AppActionStyle(tone: .accent, compact: true, horizontalPadding: isCompact ? 10 : 12))
        .accessibilityLabel(selectedTab == .cards ? "添加信用卡" : "添加扣款账户")
    }

    // MARK: - 信用卡列表

    @ViewBuilder
    private var cardsContent: some View {
        if activeCards.isEmpty {
            Section {
                VStack(spacing: 12) {
                    Image(systemName: "creditcard")
                        .font(.system(size: 36))
                        .foregroundStyle(AppTheme.muted)
                    Text("暂无有效信用卡")
                        .font(AppTypography.cardTitle)
                        .foregroundStyle(AppTheme.ink)
                    Text(activeAccounts.isEmpty ? "请先在上方切换至「扣款账户」添加银行账户" : "点击右上角「+」立即添加信用卡")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .appListRow()
            }
        } else {
            Section {
                ForEach(activeCards) { card in
                    cardRow(card)
                        .appListRow()
                        .contentShape(Rectangle())
                        .onTapGesture { cardToEdit = card }
                        .contextMenu {
                            Button {
                                cardToEdit = card
                            } label: {
                                Label("编辑信用卡", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                cardToArchive = card
                            } label: {
                                Label("停用信用卡", systemImage: "archivebox")
                            }
                        }
                }
                .onMove { indices, newOffset in
                    moveCards(from: indices, to: newOffset)
                }
            } header: {
                HStack {
                    AppEyebrow("有效信用卡 · \(activeCards.count)")
                    Spacer()
                    Text("按住右侧拖动排序")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted.opacity(0.7))
                }
            }
        }

        if !archivedCards.isEmpty {
            Section {
                DisclosureGroup(
                    isExpanded: $showsArchivedCards,
                    content: {
                        ForEach(archivedCards) { card in
                            archivedCardRow(card)
                                .appListRow()
                        }
                        .moveDisabled(true)
                    },
                    label: {
                        HStack {
                            Text("已停用信用卡 (\(archivedCards.count))")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                        }
                    }
                )
                .appListRow()
            }
        }
    }

    private func cardRow(_ card: Card) -> some View {
        HStack(spacing: 14) {
            // Mini 曜石卡面缩略
            CardArtworkView(
                name: card.name,
                issuer: card.issuer,
                last4: card.last4,
                brand: card.brand,
                assetId: card.iconAssetId,
                isLowFrequency: card.isLowFrequency,
                width: 68
            )

            // 卡片描述
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(card.name)
                        .font(AppTypography.cardTitle)
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)

                    if card.isLowFrequency {
                        ExpressivePill(title: "低频", tint: AppTheme.muted, fill: Color.white.opacity(0.08))
                    }
                }

                HStack(spacing: 8) {
                    if let account = model.account(card.defaultDebitAccountId) {
                        Label(account.name, systemImage: "landmark")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                            .lineLimit(1)
                    }

                    if let day = card.defaultDueDay {
                        Text("· 每月 \(day) 日")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func archivedCardRow(_ card: Card) -> some View {
        HStack(spacing: 12) {
            CardArtworkView(
                name: card.name,
                issuer: card.issuer,
                last4: card.last4,
                brand: card.brand,
                assetId: card.iconAssetId,
                isLowFrequency: card.isLowFrequency,
                width: 50
            )
            .opacity(0.4)

            VStack(alignment: .leading, spacing: 2) {
                Text(card.name)
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.muted)
                Text("已停用")
                    .font(AppTypography.caption)
                    .foregroundStyle(AppTheme.muted.opacity(0.6))
            }
            Spacer()
        }
    }

    // MARK: - 扣款账户列表

    @ViewBuilder
    private var accountsContent: some View {
        if activeAccounts.isEmpty {
            Section {
                VStack(spacing: 12) {
                    Image(systemName: "building.columns")
                        .font(.system(size: 36))
                        .foregroundStyle(AppTheme.muted)
                    Text("暂无扣款账户")
                        .font(AppTypography.cardTitle)
                        .foregroundStyle(AppTheme.ink)
                    Text("请点击右上角「+」添加银行扣款账户")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .appListRow()
            }
        } else {
            Section {
                ForEach(activeAccounts) { account in
                    accountRow(account)
                        .appListRow()
                        .contentShape(Rectangle())
                        .onTapGesture { accountToEdit = account }
                        .contextMenu {
                            Button {
                                accountToEdit = account
                            } label: {
                                Label("编辑账户", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                accountToArchive = account
                            } label: {
                                Label("停用账户", systemImage: "archivebox")
                            }
                        }
                }
                .onMove { indices, newOffset in
                    moveAccounts(from: indices, to: newOffset)
                }
            } header: {
                HStack {
                    AppEyebrow("有效扣款账户 · \(activeAccounts.count)")
                    Spacer()
                    Text("按住右侧拖动排序")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted.opacity(0.7))
                }
            }
        }

        if !archivedAccounts.isEmpty {
            Section {
                DisclosureGroup(
                    isExpanded: $showsArchivedAccounts,
                    content: {
                        ForEach(archivedAccounts) { account in
                            archivedAccountRow(account)
                                .appListRow()
                        }
                        .moveDisabled(true)
                    },
                    label: {
                        HStack {
                            Text("已停用账户 (\(archivedAccounts.count))")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                        }
                    }
                )
                .appListRow()
            }
        }
    }

    private func accountRow(_ account: Account) -> some View {
        let linkedCardsCount = model.cards.filter { $0.defaultDebitAccountId == account.id && !$0.isArchived }.count

        return HStack(spacing: 12) {
            FormIconSlot {
                EntityIcon(name: account.name, assetId: account.iconAssetId, size: 24)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(account.name)
                    .font(AppTypography.cardTitle)
                    .foregroundStyle(AppTheme.ink)

                HStack(spacing: 6) {
                    if !account.bankName.isEmpty {
                        Text(account.bankName)
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                    if !account.bankCode.isEmpty {
                        Text("(\(account.bankCode))")
                            .font(AppTypography.caption.monospacedDigit())
                            .foregroundStyle(AppTheme.muted)
                    }
                    Text("· 关联 \(linkedCardsCount) 张卡")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func archivedAccountRow(_ account: Account) -> some View {
        HStack(spacing: 12) {
            FormIconSlot(systemName: "landmark", tint: AppTheme.muted)
                .opacity(0.5)

            VStack(alignment: .leading, spacing: 2) {
                Text(account.name)
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.muted)
                Text("已停用")
                    .font(AppTypography.caption)
                    .foregroundStyle(AppTheme.muted.opacity(0.6))
            }
            Spacer()
        }
    }

    // MARK: - 排序与归档处理

    private func moveCards(from indices: IndexSet, to newOffset: Int) {
        let activeIds = activeCards.map(\.id)
        var updatedActive = activeIds
        updatedActive.move(fromOffsets: indices, toOffset: newOffset)

        let archivedIds = archivedCards.map(\.id)
        let finalIds = updatedActive + archivedIds

        Task {
            do {
                try await model.reorderCards(finalIds)
            } catch {
                alertMessage = "排序保存失败：\(error.localizedDescription)"
            }
        }
    }

    private func moveAccounts(from indices: IndexSet, to newOffset: Int) {
        let activeIds = activeAccounts.map(\.id)
        var updatedActive = activeIds
        updatedActive.move(fromOffsets: indices, toOffset: newOffset)

        let archivedIds = archivedAccounts.map(\.id)
        let finalIds = updatedActive + archivedIds

        Task {
            do {
                try await model.reorderAccounts(finalIds)
            } catch {
                alertMessage = "排序保存失败：\(error.localizedDescription)"
            }
        }
    }

    private func archive(card: Card) async {
        do {
            try await model.archiveCard(card)
            cardToArchive = nil
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func archive(account: Account) async {
        do {
            try await model.archiveAccount(account)
            accountToArchive = nil
        } catch {
            alertMessage = error.localizedDescription
        }
    }
}
