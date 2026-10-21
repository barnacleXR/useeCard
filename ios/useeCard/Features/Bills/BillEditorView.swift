import SwiftUI

/// 录入/编辑账单：金额与实际扣款日以银行 App 为准。离线时可保存为草稿。
struct BillEditorView: View {
    enum Mode: Identifiable {
        case create, edit(Bill), draft(BillDraft)
        var id: String {
            switch self { case .create: return "create"; case let .edit(bill): return bill.id; case let .draft(draft): return draft.id.uuidString }
        }
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let mode: Mode

    @State private var cardId = ""
    @State private var accountId = ""
    @State private var currency = "JPY"
    @State private var amount = ""
    @State private var dueDate = DateOnly.today()
    @State private var note = ""
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var offerDraft = false
    @State private var confirmCurrency = false
    /// 同一次录入重试时沿用同一个幂等键，避免网络抖动造成重复账单。
    @State private var idempotencyKey = UUID().uuidString.lowercased()

    private var title: String {
        switch mode { case .create: return "录入账单"; case .edit: return "编辑账单"; case .draft: return "草稿" }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("信用卡", selection: $cardId) {
                        Text("选择信用卡").tag("")
                        ForEach(selectableCards) { card in Text(card.name).tag(card.id) }
                    }
                    Picker("扣款账户", selection: $accountId) {
                        Text("选择账户").tag("")
                        ForEach(selectableAccounts) { account in Text(account.name).tag(account.id) }
                    }
                }
                Section {
                    HStack {
                        Picker("币种", selection: $currency) { ForEach(model.currencies.codes, id: \.self) { Text($0).tag($0) } }
                            .labelsHidden().fixedSize()
                        TextField("银行账单金额", text: $amount)
                            .keyboardType(model.currencies.fractionDigits(currency) == 0 ? .numberPad : .decimalPad)
                            .font(.title3.monospacedDigit())
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("实际扣款日", selection: Binding(get: { dueDate.date }, set: { dueDate = DateOnly(date: $0) }), displayedComponents: .date)
                        .environment(\.timeZone, DateOnly.tokyo)
                } footer: {
                    Text(dueDate < .today() ? "扣款日早于今天：补录历史账单时可以继续保存。" : "以信用卡 App 显示的金额与扣款日为准，系统不推算日期或节假日。")
                }
                Section("备注") { TextField("可选", text: $note, axis: .vertical).lineLimit(1...4) }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                if case let .draft(draft) = mode {
                    Section {
                        Button("删除草稿", role: .destructive) { model.deleteDraft(draft); dismiss() }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isDraft ? "提交" : "保存") { Task { await save() } }.disabled(busy || cardId.isEmpty || accountId.isEmpty || amount.isEmpty)
                }
            }
            .onAppear(perform: load)
            .onChange(of: cardId) { _, newValue in applyCardDefaults(newValue) }
            .alert("无法连接服务器", isPresented: $offerDraft) {
                Button("保存为草稿") { saveAsDraft() }
                Button("继续编辑", role: .cancel) {}
            } message: {
                Text("可以先存为草稿（不会计入备款合计），联网后再提交。")
            }
            .alert("修改币种", isPresented: $confirmCurrency) {
                Button("确认修改") { Task { await save(currencyConfirmed: true) } }
                Button("取消", role: .cancel) {}
            } message: {
                Text("币种改为 \(currency)，金额按 \(amount) 保存，系统不会换汇。")
            }
        }
    }

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
        case let .edit(bill):
            cardId = bill.cardId; accountId = bill.debitAccountId; currency = bill.currency
            amount = model.currencies.decimalString(bill.amountMinor, currency: bill.currency); dueDate = bill.dueDate; note = bill.note
        case let .draft(draft):
            cardId = draft.input.cardId; accountId = draft.input.debitAccountId; currency = draft.input.currency
            amount = draft.amountText; dueDate = draft.input.dueDate; note = draft.input.note
            idempotencyKey = draft.idempotencyKey
        }
    }

    /// 新建时选卡带入默认扣款账户与币种；编辑时不改动已有值。
    private func applyCardDefaults(_ id: String) {
        guard case .create = mode, let card = model.card(id) else { return }
        accountId = card.defaultDebitAccountId
        currency = card.defaultCurrency
    }

    private func input() throws -> BillInput {
        BillInput(cardId: cardId, debitAccountId: accountId, amountMinor: try model.currencies.parse(amount, currency: currency),
                  currency: currency, dueDate: dueDate, statementMonth: editingBill?.statementMonth, note: note)
    }

    private func save(currencyConfirmed: Bool = false) async {
        error = nil
        let value: BillInput
        do { value = try input() } catch { self.error = error.localizedDescription; return }
        if let bill = editingBill, bill.currency != currency, !currencyConfirmed { confirmCurrency = true; return }
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
            dismiss()
        } catch let clientError as ClientError where clientError.isOffline && editingBill == nil {
            offerDraft = true
        } catch {
            self.error = error.localizedDescription
            // 版本冲突：重新同步，用户看到服务器最新值后再编辑。
            if (error as? ClientError)?.isConflict == true { await model.refresh() }
        }
    }

    private func saveAsDraft() {
        guard let value = try? input() else { return }
        let id: UUID
        if case let .draft(draft) = mode { id = draft.id } else { id = UUID(uuidString: idempotencyKey) ?? UUID() }
        model.saveDraft(BillDraft(id: id, input: value, amountText: amount, createdAt: Date()))
        dismiss()
    }
}
