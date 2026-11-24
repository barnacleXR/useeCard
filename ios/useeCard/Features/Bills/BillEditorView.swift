import SwiftUI

/// 录入/编辑账单：Hero 金额舞台 + 智能预填流式录入（无强制确认门禁）。离线时可保存为草稿。
struct BillEditorView: View {
    enum Mode: Identifiable {
        case create, edit(Bill), draft(BillDraft)
        var id: String {
            switch self {
            case .create: return "create"
            case let .edit(bill): return bill.id
            case let .draft(draft): return draft.id.uuidString
            }
        }
    }

    private enum DueDateSource {
        case initial, prefilled, manual
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let mode: Mode

    @State private var cardId = ""
    @State private var accountId = ""
    @State private var currency = "JPY"
    @State private var currencyChosen = false
    @State private var amount = ""
    @State private var dueDate = DateOnly.today()
    @State private var statementMonth: MonthKey?
    @State private var dueDateSource: DueDateSource = .initial
    @State private var statementMonthTouched = false
    @State private var showExtraDetails = false
    @State private var note = ""
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var savedNotice: String?
    @State private var offerDraft = false
    @State private var confirmCurrency = false
    @State private var successSaveTrigger = 0
    @State private var showingAddCardSheet = false
    @State private var showingAddAccountSheet = false
    @State private var prefillTask: Task<Void, Never>?
    @FocusState private var amountFocused: Bool
    @FocusState private var noteFocused: Bool
    private var isKeyboardActive: Bool { amountFocused || noteFocused }
    @ScaledMetric(relativeTo: .largeTitle) private var amountScale: CGFloat = 1
    /// 同一次录入重试时沿用同一个幂等键，避免网络抖动造成重复账单。
    @State private var idempotencyKey = UUID().uuidString.lowercased()

    private var title: String {
        switch mode {
        case .create: return "录入账单"
        case .edit: return "编辑账单"
        case .draft: return "草稿"
        }
    }

    private var livePreviewAmount: String? {
        guard !amount.trimmingCharacters(in: .whitespaces).isEmpty,
              let minor = try? model.currencies.parse(amount, currency: currency) else { return nil }
        return model.currencies.format(minor, currency: currency)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let savedNotice {
                        AppGroup(fill: AppTheme.successSurface, border: AppTheme.success.opacity(0.25)) {
                            AppNotice(message: savedNotice, systemImage: "checkmark.circle.fill", color: AppTheme.success)
                                .padding(14)
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    amountHeroCard
                    paymentCard
                    detailsCard

                    if let error {
                        AppGroup(fill: AppTheme.dangerSurface, border: AppTheme.danger.opacity(0.3)) {
                            AppNotice(message: error, systemImage: "exclamationmark.circle.fill", color: AppTheme.danger)
                                .padding(14)
                        }
                    }

                    if case let .draft(draft) = mode {
                        Button(role: .destructive) {
                            do {
                                try model.deleteDraft(draft)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                        } label: {
                            Label("删除草稿", systemImage: "trash")
                        }
                        .buttonStyle(AppActionStyle(tone: .tonal(AppTheme.danger, AppTheme.dangerSurface), expands: true))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: savedNotice != nil)
                .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: showExtraDetails)
            }
            .disabled(busy)
            .appPage()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(busy)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("收起") {
                        amountFocused = false
                        noteFocused = false
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !isKeyboardActive {
                    AppActionBar {
                        Button { Task { await save() } } label: {
                            AppActionLabel(
                                title: busy ? "正在保存…" : isDraft ? "提交草稿" : "保存",
                                busy: busy,
                                tint: AppTheme.onAccent
                            )
                        }
                        .buttonStyle(AppActionStyle(tone: .accent, expands: true))
                        .disabled(!canSave)
                        if isCreate {
                            Button("保存并继续录入下一笔") { Task { await save(andContinue: true) } }
                                .buttonStyle(AppActionStyle(expands: true))
                                .disabled(!canSave)
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : AppTheme.snappySpring, value: isKeyboardActive)
            .onAppear(perform: load)
            .onDisappear { prefillTask?.cancel() }
            .onChange(of: cardId) { _, newValue in applyCardDefaults(newValue) }
            .interactiveDismissDisabled(busy)
            .alert("无法连接服务器", isPresented: $offerDraft) {
                Button("保存为草稿") { saveAsDraft() }
                Button("继续编辑", role: .cancel) {}
            } message: {
                Text("可以先存为草稿，联网后再提交。草稿不计入备款合计。")
            }
            .alert("修改币种", isPresented: $confirmCurrency) {
                Button("确认修改") {
                    Task { await save(currencyConfirmed: true) }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("币种改为 \(currency)，金额按 \(amount) 保存，系统不会换汇。")
            }
            .sensoryFeedback(.success, trigger: successSaveTrigger)
            .sheet(isPresented: $showingAddCardSheet) {
                CardEditorSheet()
            }
            .sheet(isPresented: $showingAddAccountSheet) {
                AccountEditorSheet()
            }
        }
    }

    private var amountHeroCard: some View {
        AppHeroCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    AppEyebrow("账单金额", color: AppTheme.heroMuted)
                    Spacer()
                    if let preview = livePreviewAmount {
                        ExpressivePill(
                            title: preview,
                            tint: Color(red: 0.25, green: 0.85, blue: 0.62),
                            fill: AppTheme.heroControlFill
                        )
                        .transition(.opacity)
                    }
                }

                // 币种胶囊横向快选，消除二级下拉切换摩擦
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(currencyOptions, id: \.self) { code in
                            let selected = currency == code
                            Button {
                                currency = code
                                currencyChosen = true
                                savedNotice = nil
                            } label: {
                                Text(code)
                                    .font(AppTypography.badge)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .foregroundStyle(selected ? AppTheme.onAccent : AppTheme.heroInk)
                                    .background(selected ? AppTheme.accent : AppTheme.heroControlFill, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                }
                .scrollIndicators(.hidden)

                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(currency)
                        .font(.system(size: min(20 * amountScale, 26), weight: .semibold, design: .rounded))
                        .foregroundStyle(AppTheme.heroMuted)
                    TextField("", text: $amount, prompt: Text("0").foregroundStyle(Color.white.opacity(0.28)))
                        .keyboardType(model.currencies.fractionDigits(currency) == 0 ? .numberPad : .decimalPad)
                        .focused($amountFocused)
                        .font(.system(size: min(38 * amountScale, 52), weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(AppTheme.heroInk)
                        .tint(AppTheme.accent)
                        .accessibilityLabel("银行账单金额")
                        .onChange(of: amount) { _, newValue in
                            if !newValue.isEmpty { savedNotice = nil }
                            error = nil
                        }
                    if !amount.isEmpty {
                        Button {
                            amount = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title3)
                                .foregroundStyle(AppTheme.heroMuted)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("清除金额")
                    }
                }
                .padding(.vertical, 4)
            }
            .padding(20)
        }
    }

    private var paymentCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            AppEyebrow("扣款信息")
                .padding(.horizontal, 4)
            AppGroup {
                // 信用卡选择（整行 60pt 高度与全宽均为可点击热区，符合 HIG 规范）
                if selectableCards.isEmpty {
                    Button {
                        showingAddCardSheet = true
                    } label: {
                        cardRowLabel
                    }
                    .buttonStyle(AppRowButtonStyle())
                } else {
                    Menu {
                        Picker("信用卡", selection: $cardId) {
                            if cardId.isEmpty {
                                Text("请选择信用卡").tag("")
                            }
                            ForEach(selectableCards) { card in Text(card.name).tag(card.id) }
                        }
                        Divider()
                        Button {
                            showingAddCardSheet = true
                        } label: {
                            Label("添加卡片", systemImage: "plus")
                        }
                    } label: {
                        cardRowLabel
                    }
                }

                AppDivider(leading: AppLayout.formTextKeyline)

                // 扣款账户选择（整行 60pt 高度与全宽均为可点击热区，符合 HIG 规范）
                if selectableAccounts.isEmpty {
                    Button {
                        showingAddAccountSheet = true
                    } label: {
                        accountRowLabel
                    }
                    .buttonStyle(AppRowButtonStyle())
                } else {
                    Menu {
                        Picker("扣款账户", selection: $accountId) {
                            if accountId.isEmpty {
                                Text("请选择扣款账户").tag("")
                            }
                            ForEach(selectableAccounts) { account in Text(account.name).tag(account.id) }
                        }
                        Divider()
                        Button {
                            showingAddAccountSheet = true
                        } label: {
                            Label("添加账户", systemImage: "plus")
                        }
                    } label: {
                        accountRowLabel
                    }
                }
                AppDivider(leading: AppLayout.formTextKeyline)

                // 实际扣款日（同样使用 38×38 光学槽位，三行文字左缘像素级对齐同一条垂直 Keyline）
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        FormIconSlot {
                            Image(systemName: "calendar")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                        }
                        Text("扣款日")
                            .font(AppTypography.rowTitle)
                            .foregroundStyle(AppTheme.ink)
                        Spacer(minLength: 8)
                        DatePicker("扣款日", selection: Binding(get: { dueDate.date }, set: {
                            dueDate = DateOnly(date: $0)
                            dueDateSource = .manual
                            savedNotice = nil
                        }), displayedComponents: .date)
                        .labelsHidden()
                        .environment(\.timeZone, DateOnly.tokyo)
                        .environment(\.calendar, DateOnly.calendar)
                    }

                    if dueDateSource == .prefilled || dueDate < .today() {
                        HStack(spacing: 8) {
                            if dueDateSource == .prefilled {
                                ExpressivePill(
                                    title: "已智能预填",
                                    systemImage: "sparkles",
                                    tint: AppTheme.success,
                                    fill: AppTheme.successSurface
                                )
                            }
                            if dueDate < .today() {
                                ExpressivePill(
                                    title: "早于今天 · 补录历史账单",
                                    systemImage: "clock.arrow.circlepath",
                                    tint: AppTheme.warning,
                                    fill: AppTheme.warningSurface
                                )
                            }
                        }
                        .padding(.leading, AppLayout.iconSlotSize + 12)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 60)
            }
        }
    }

    private var cardRowLabel: some View {
        HStack(spacing: 12) {
            FormIconSlot {
                if let selectedCard = model.card(cardId) {
                    CardFace(card: selectedCard, width: 28)
                } else {
                    Image(systemName: "creditcard.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            Text("信用卡")
                .font(AppTypography.rowTitle)
                .foregroundStyle(AppTheme.ink)
            Spacer(minLength: 8)
            if let selectedCard = model.card(cardId) {
                Text(selectedCard.name)
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
            } else if selectableCards.isEmpty {
                Text("+ 添加卡片")
                    .font(AppTypography.caption.weight(.medium))
                    .foregroundStyle(AppTheme.accent)
            } else {
                Text("请选择")
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.muted)
            }
            if selectableCards.isEmpty {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.accent)
            } else {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, minHeight: 60)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("信用卡: \(model.card(cardId)?.name ?? "未选择")")
        .accessibilityHint(selectableCards.isEmpty ? "连按两次以添加卡片" : "连按两次以选择信用卡")
    }

    private var accountRowLabel: some View {
        HStack(spacing: 12) {
            FormIconSlot {
                if let selectedAccount = model.account(accountId) {
                    EntityIcon(name: selectedAccount.name, assetId: selectedAccount.iconAssetId, size: 24)
                } else {
                    Image(systemName: "building.columns.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            Text("扣款账户")
                .font(AppTypography.rowTitle)
                .foregroundStyle(AppTheme.ink)
            Spacer(minLength: 8)
            if let selectedAccount = model.account(accountId) {
                Text(selectedAccount.name)
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
            } else if selectableAccounts.isEmpty {
                Text("+ 添加账户")
                    .font(AppTypography.caption.weight(.medium))
                    .foregroundStyle(AppTheme.accent)
            } else {
                Text("请选择")
                    .font(AppTypography.rowTitle)
                    .foregroundStyle(AppTheme.muted)
            }
            if selectableAccounts.isEmpty {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.accent)
            } else {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, minHeight: 60)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("扣款账户: \(model.account(accountId)?.name ?? "未选择")")
        .accessibilityHint(selectableAccounts.isEmpty ? "连按两次以添加账户" : "连按两次以选择扣款账户")
    }

    private var detailsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            AppEyebrow("归属月与备注")
                .padding(.horizontal, 4)
            AppGroup {
                // 归属月以紧凑自然语言展示，按需展开修改（同样采用 38×38 光学槽位）
                Button {
                    showExtraDetails.toggle()
                } label: {
                    HStack(spacing: 12) {
                        FormIconSlot {
                            Image(systemName: "calendar.badge.clock")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(AppTheme.muted)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("账单归属月")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.ink)
                            Text(statementSummaryText)
                                .font(AppTypography.caption)
                                .foregroundStyle(AppTheme.muted)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: showExtraDetails ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .frame(minHeight: 60)
                }
                .buttonStyle(AppRowButtonStyle())

                if showExtraDetails {
                    AppDivider(leading: AppLayout.formTextKeyline)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) {
                            statementMonthPicker
                            clearStatementMonth(isCompact: false)
                        }
                        HStack(spacing: 8) {
                            statementMonthPicker
                            clearStatementMonth(isCompact: true)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            statementMonthPicker
                            clearStatementMonth(isCompact: false)
                        }
                    }
                    .padding(.leading, AppLayout.formTextKeyline)
                    .padding(.trailing, 16)
                    .padding(.vertical, 12)
                }

                AppDivider(leading: AppLayout.formTextKeyline)

                HStack(alignment: .top, spacing: 12) {
                    FormIconSlot {
                        Image(systemName: "note.text")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                    TextField("备注（可选，例如分期说明或大额消费）", text: $note, axis: .vertical)
                        .focused($noteFocused)
                        .font(AppTypography.rowTitle)
                        .lineLimit(1...4)
                        .padding(.top, 8)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 60)
            }
        }
    }

    private var statementSummaryText: String {
        if let statementMonth {
            return statementMonthTouched ? "对应 \(statementMonth.label) 账期" : "对应 \(statementMonth.label) 账期 · 自动推算"
        }
        return "未指定（可选）"
    }

    private var statementMonthPicker: some View {
        MonthPickerButton(
            month: statementMonth ?? dueDate.monthKey,
            title: "账单归属月",
            displayTitle: statementMonth == nil ? "选择归属月" : nil,
            showsSteppers: statementMonth != nil
        ) { month in
            statementMonth = month
            statementMonthTouched = true
            savedNotice = nil
        }
    }

    @ViewBuilder private func clearStatementMonth(isCompact: Bool) -> some View {
        if statementMonth != nil {
            Button {
                statementMonth = nil
                statementMonthTouched = true
                savedNotice = nil
            } label: {
                HStack(spacing: isCompact ? 0 : 5) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .accessibilityHidden(true)
                    if !isCompact {
                        Text("清除")
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
                .frame(minWidth: isCompact ? 16 : nil)
            }
            .buttonStyle(AppActionStyle(compact: true, horizontalPadding: isCompact ? 10 : 12))
            .accessibilityLabel("清除账单归属月")
        }
    }

    private var canSave: Bool {
        !busy && !cardId.isEmpty && !accountId.isEmpty && !amount.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var currencyOptions: [String] {
        let supported = model.currencies.codes
        return supported.contains(currency) ? supported : supported + [currency]
    }

    private var isCreate: Bool { if case .create = mode { return true } else { return false } }
    private var isDraft: Bool { if case .draft = mode { return true } else { return false } }
    private var editingBill: Bill? { if case let .edit(bill) = mode { return bill } else { return nil } }
    private var selectableCards: [Card] { model.cards.filter { !$0.isArchived || $0.id == cardId } }
    private var selectableAccounts: [Account] { model.accounts.filter { !$0.isArchived || $0.id == accountId } }

    private func load() {
        guard !loaded else { return }
        loaded = true
        switch mode {
        case .create:
            currency = model.defaultCurrency
            dueDate = DateOnly.today()
            statementMonth = nil
            dueDateSource = .initial
            statementMonthTouched = false
            // 仅有一张活跃卡时直接预选，减少重复点击
            if selectableCards.count == 1, let only = selectableCards.first {
                cardId = only.id
            }
        case let .edit(bill):
            cardId = bill.cardId; accountId = bill.debitAccountId; currency = bill.currency
            amount = model.currencies.decimalString(bill.amountMinor, currency: bill.currency); dueDate = bill.dueDate
            statementMonth = bill.statementMonth.flatMap(MonthKey.init); note = bill.note
            dueDateSource = .manual; statementMonthTouched = true
        case let .draft(draft):
            cardId = draft.input.cardId; accountId = draft.input.debitAccountId; currency = draft.input.currency
            amount = draft.amountText; dueDate = draft.input.dueDate
            statementMonth = draft.input.statementMonth.flatMap(MonthKey.init); note = draft.input.note
            idempotencyKey = draft.idempotencyKey
            dueDateSource = .manual; statementMonthTouched = true
        }
    }

    /// 新建时选卡带入默认扣款账户、币种与未手动修改的日期预填；编辑时不改动已有值。
    private func applyCardDefaults(_ id: String) {
        if !id.isEmpty { savedNotice = nil }
        prefillTask?.cancel()
        guard case .create = mode, let card = model.card(id) else { return }
        accountId = card.defaultDebitAccountId
        if !currencyChosen && amount.isEmpty { currency = card.defaultCurrency }
        if dueDateSource != .manual {
            dueDate = .today()
            dueDateSource = .initial
        }
        if !statementMonthTouched { statementMonth = nil }
        guard dueDateSource != .manual || !statementMonthTouched else { return }
        prefillTask = Task {
            let prefill = try? await model.billPrefill(cardId: id)
            guard !Task.isCancelled, !busy, cardId == id, let prefill else { return }
            if dueDateSource != .manual {
                dueDate = prefill.dueDate
                dueDateSource = .prefilled
            }
            if !statementMonthTouched { statementMonth = MonthKey(prefill.statementMonth) }
        }
    }

    private func input() throws -> BillInput {
        BillInput(cardId: cardId, debitAccountId: accountId, amountMinor: try model.currencies.parse(amount, currency: currency),
                  currency: currency, dueDate: dueDate, statementMonth: statementMonth?.string, note: note)
    }

    private func save(currencyConfirmed: Bool = false, andContinue: Bool = false) async {
        guard canSave else { return }
        error = nil
        savedNotice = nil
        let value: BillInput
        do { value = try input() } catch { self.error = error.localizedDescription; return }
        if let bill = editingBill, bill.currency != currency, !currencyConfirmed {
            confirmCurrency = true
            return
        }
        busy = true
        defer { busy = false }
        do {
            switch mode {
            case .create: try await model.createBill(value, idempotencyKey: idempotencyKey)
            case let .edit(bill): try await model.updateBill(bill, input: value)
            case let .draft(draft):
                var updated = draft; updated.input = value; updated.amountText = amount
                try await model.submitDraft(updated)
            }
            successSaveTrigger += 1
            if andContinue && isCreate {
                prefillTask?.cancel()
                cardId = ""; accountId = ""; amount = ""; note = ""
                dueDate = .today()
                dueDateSource = .initial
                statementMonth = nil
                statementMonthTouched = false
                currency = model.defaultCurrency
                currencyChosen = false
                idempotencyKey = UUID().uuidString.lowercased()
                savedNotice = "已保存，可继续录入下一条"
            } else {
                dismiss()
            }
        } catch let clientError as ClientError where clientError.isOffline && editingBill == nil {
            offerDraft = true
        } catch {
            self.error = error.localizedDescription
            // 版本冲突：重新同步，用户看到服务器最新值后再编辑。
            if (error as? ClientError)?.isConflict == true { await model.refresh() }
        }
    }

    private func saveAsDraft() {
        guard canSave, let value = try? input() else { return }
        let id: UUID
        if case let .draft(draft) = mode { id = draft.id } else { id = UUID(uuidString: idempotencyKey) ?? UUID() }
        do {
            // 草稿成功写入本机后才关闭表单；失败时保留全部输入。
            try model.saveDraft(BillDraft(id: id, input: value, amountText: amount, createdAt: Date()))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
