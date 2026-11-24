import SwiftUI

/// 信用卡新增与编辑表单
struct CardEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    let editing: Card?

    @State private var name: String
    @State private var issuer: String
    @State private var last4: String
    @State private var defaultDebitAccountId: String
    @State private var defaultCurrency: String
    @State private var defaultDueDay: Int?
    @State private var frequency: String
    @State private var brand: String
    @State private var iconAssetId: String?
    @State private var note: String

    @State private var cardImageUrl: String = ""
    @State private var isFetchingImage = false
    @State private var imageError: String?

    @State private var saving = false
    @State private var errorMessage: String?
    @State private var saveSuccessTrigger = 0
    @State private var showingArchiveConfirmation = false
    @State private var didApplyDefaults = false

    init(editing: Card? = nil) {
        self.editing = editing
        _name = State(initialValue: editing?.name ?? "")
        _issuer = State(initialValue: editing?.issuer ?? "")
        _last4 = State(initialValue: editing?.last4 ?? "")
        _defaultDebitAccountId = State(initialValue: editing?.defaultDebitAccountId ?? "")
        _defaultCurrency = State(initialValue: editing?.defaultCurrency ?? "JPY")
        _defaultDueDay = State(initialValue: editing?.defaultDueDay)
        _frequency = State(initialValue: editing?.frequency ?? "regular")
        _brand = State(initialValue: editing?.brand ?? "")
        _iconAssetId = State(initialValue: editing?.iconAssetId)
        _note = State(initialValue: editing?.note ?? "")
    }

    private var isEditMode: Bool { editing != nil }

    var body: some View {
        NavigationStack {
            Form {
                // 顶部拟真实体卡面实时渲染舞台
                Section {
                    VStack(spacing: 12) {
                        CardArtworkView(
                            name: name,
                            issuer: issuer,
                            last4: last4,
                            brand: brand,
                            assetId: iconAssetId,
                            isLowFrequency: frequency == "low",
                            width: 270
                        )
                        .padding(.vertical, 8)
                    }
                    .frame(maxWidth: .infinity)
                    .appListRow()
                }

                // 卡片身份信息
                Section {
                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "creditcard", tint: AppTheme.accent)
                        TextField("卡片名称（如：三井住友 NL）", text: $name)
                            .font(AppTypography.rowTitle)
                            .autocorrectionDisabled()
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "building.2", tint: AppTheme.accent)
                        TextField("发卡机构（如：SMBC / 招商银行）", text: $issuer)
                            .font(AppTypography.rowTitle)
                            .autocorrectionDisabled()
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "number", tint: AppTheme.accent)
                        TextField("卡号后 4 位（选填，如：8821）", text: $last4)
                            .font(AppTypography.rowTitle)
                            .keyboardType(.numberPad)
                            .autocorrectionDisabled()
                            .onChange(of: last4) { _, newValue in
                                if newValue.count > 4 {
                                    last4 = String(newValue.prefix(4))
                                }
                            }
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "shield.lefthalf.filled", tint: AppTheme.accent)
                        Picker("卡组织品牌", selection: $brand) {
                            ForEach(CardBrand.allCases) { item in
                                Text(item.label).tag(item.rawValue)
                            }
                        }
                        .font(AppTypography.rowTitle)
                    }
                    .appListRow()
                } header: {
                    AppEyebrow("卡片信息")
                }

                // 卡面图片（网址拉取与清除）
                Section {
                    if iconAssetId != nil {
                        HStack {
                            Label("已应用自定义卡面", systemImage: "photo.badge.checkmark")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.accent)
                            Spacer()
                            Button("清除卡面", role: .destructive) {
                                withAnimation(AppTheme.snappySpring) {
                                    self.iconAssetId = nil
                                }
                            }
                            .font(AppTypography.caption.weight(.medium))
                        }
                        .appListRow()
                    }

                    HStack(spacing: 8) {
                        FormIconSlot(systemName: "link", tint: AppTheme.accent)
                        TextField("卡面图片网址 (https://...)", text: $cardImageUrl)
                            .font(AppTypography.rowTitle)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        Button {
                            Task { await fetchCardImage() }
                        } label: {
                            if isFetchingImage {
                                ProgressView()
                                    .tint(AppTheme.accent)
                                    .frame(width: 44)
                            } else {
                                Text("拉取")
                                    .font(AppTypography.caption.weight(.semibold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(AppTheme.accent.opacity(0.18))
                                    .foregroundStyle(AppTheme.accent)
                                    .clipShape(Capsule())
                            }
                        }
                        .disabled(isFetchingImage || cardImageUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .appListRow()

                    if let imageError {
                        Text(imageError)
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.danger)
                            .appListRow()
                    }
                } header: {
                    AppEyebrow("卡面图片")
                } footer: {
                    Text("输入图片地址由服务器安全下载并保存为卡面。请使用官方展示卡面，切勿上传含完整卡号或安全码的照片。")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
                }

                // 扣款与默认规则
                Section {
                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "landmark", tint: AppTheme.accent)
                        Picker("默认扣款账户", selection: $defaultDebitAccountId) {
                            if defaultDebitAccountId.isEmpty {
                                Text("请选择扣款账户").tag("")
                            }
                            ForEach(availableAccounts) { account in
                                Text(account.name).tag(account.id)
                            }
                        }
                        .font(AppTypography.rowTitle)
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "coloncurrencysign.circle", tint: AppTheme.accent)
                        Picker("默认币种", selection: $defaultCurrency) {
                            ForEach(availableCurrencies, id: \.self) { c in
                                Text(c).tag(c)
                            }
                        }
                        .font(AppTypography.rowTitle)
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "calendar", tint: AppTheme.accent)
                        Picker("每月扣款日", selection: Binding(
                            get: { defaultDueDay ?? 0 },
                            set: { defaultDueDay = $0 == 0 ? nil : $0 }
                        )) {
                            Text("未设置").tag(0)
                            ForEach(1...31, id: \.self) { day in
                                Text("每月 \(day) 日").tag(day)
                            }
                        }
                        .font(AppTypography.rowTitle)
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "gauge.with.needle", tint: AppTheme.accent)
                        Picker("使用频率", selection: $frequency) {
                            ForEach(CardFrequency.allCases) { freq in
                                Text(freq.label).tag(freq.rawValue)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    .appListRow()

                    HStack(alignment: .top, spacing: 0) {
                        FormIconSlot(systemName: "note.text", tint: AppTheme.accent)
                        TextField("备注（选填）", text: $note, axis: .vertical)
                            .font(AppTypography.rowTitle)
                            .lineLimit(2...4)
                    }
                    .appListRow()
                } header: {
                    AppEyebrow("扣款与出账规则")
                }

                if let errorMessage {
                    Section {
                        AppNotice(message: errorMessage, systemImage: "exclamationmark.circle.fill", color: AppTheme.danger)
                            .appListRow()
                    }
                }

                if isEditMode {
                    Section {
                        Button(role: .destructive) {
                            showingArchiveConfirmation = true
                        } label: {
                            HStack {
                                Spacer()
                                Label("停用此信用卡", systemImage: "archivebox")
                                    .font(AppTypography.rowTitle)
                                    .foregroundStyle(AppTheme.danger)
                                Spacer()
                            }
                        }
                        .appListRow()
                    } footer: {
                        Text("停用后此卡片将归档，不会在新建账单中出现，已有的历史账单将继续保留。")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }
            .appPage()
            .navigationTitle(isEditMode ? "编辑信用卡" : "添加信用卡")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }
                        .foregroundStyle(AppTheme.muted)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await save() }
                    } label: {
                        if saving {
                            ProgressView().tint(AppTheme.accent)
                        } else {
                            Text("保存")
                                .fontWeight(.semibold)
                                .foregroundStyle(canSave ? AppTheme.accent : AppTheme.muted)
                        }
                    }
                    .disabled(!canSave || saving)
                }
            }
            .confirmationDialog(
                "停用信用卡？",
                isPresented: $showingArchiveConfirmation,
                titleVisibility: .visible
            ) {
                if let editing {
                    Button("停用「\(editing.name)」", role: .destructive) {
                        Task {
                            dismiss()
                            try? await Task.sleep(nanoseconds: 150_000_000)
                            try? await model.archiveCard(editing)
                        }
                    }
                }
                Button("取消", role: .cancel) { showingArchiveConfirmation = false }
            } message: {
                Text("归档后不再用于新建账单，已有历史账单将继续保留并统计。")
            }
            .onAppear {
                if !didApplyDefaults {
                    didApplyDefaults = true
                    if !isEditMode {
                        defaultCurrency = model.defaultCurrency
                    }
                }
                if defaultDebitAccountId.isEmpty, let first = availableAccounts.first {
                    defaultDebitAccountId = first.id
                }
            }
            .sensoryFeedback(.success, trigger: saveSuccessTrigger)
        }
    }

    private func fetchCardImage() async {
        let trimmed = cardImageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isFetchingImage = true
        imageError = nil
        do {
            let assetId = try await model.fetchAsset(from: trimmed)
            withAnimation(AppTheme.expressiveSpring) {
                self.iconAssetId = assetId
                self.cardImageUrl = ""
            }
        } catch {
            imageError = "下载失败：\(error.localizedDescription)"
        }
        isFetchingImage = false
    }

    private var availableAccounts: [Account] {
        model.accounts.filter { !$0.isArchived || $0.id == editing?.defaultDebitAccountId }
    }

    private var availableCurrencies: [String] {
        var list = model.currencies.codes
        if !defaultCurrency.isEmpty, !list.contains(defaultCurrency) {
            list.append(defaultCurrency)
        }
        return list.isEmpty ? ["JPY", "CNY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW"] : list
    }

    private var canSave: Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty { return false }
        if defaultDebitAccountId.isEmpty { return false }
        let trimmedLast4 = last4.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLast4.isEmpty && (trimmedLast4.count != 4 || !trimmedLast4.allSatisfy(\.isNumber)) {
            return false
        }
        return true
    }

    private func save() async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorMessage = "请输入卡片名称"
            return
        }
        guard !defaultDebitAccountId.isEmpty else {
            errorMessage = "请选择默认扣款账户"
            return
        }
        let trimmedLast4 = last4.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLast4.isEmpty && (trimmedLast4.count != 4 || !trimmedLast4.allSatisfy(\.isNumber)) {
            errorMessage = "卡号后 4 位须为 4 位数字"
            return
        }

        saving = true
        errorMessage = nil

        let input = CardInput(
            name: trimmedName,
            issuer: issuer.trimmingCharacters(in: .whitespacesAndNewlines),
            last4: trimmedLast4,
            defaultDebitAccountId: defaultDebitAccountId,
            defaultCurrency: defaultCurrency,
            defaultDueDay: defaultDueDay,
            frequency: frequency,
            brand: brand,
            iconAssetId: iconAssetId,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines)
        )

        do {
            if let editing {
                try await model.updateCard(editing, input: input)
            } else {
                try await model.createCard(input)
            }
            saveSuccessTrigger += 1
            try? await Task.sleep(nanoseconds: 150_000_000)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            saving = false
        }
    }
}
