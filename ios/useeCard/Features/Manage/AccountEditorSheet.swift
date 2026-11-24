import SwiftUI

/// 扣款账户（银行账户）新增与编辑表单
struct AccountEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    let editing: Account?

    @State private var name: String
    @State private var bankName: String
    @State private var bankCode: String
    @State private var iconAssetId: String?
    @State private var note: String

    @State private var showingBankPicker = false
    @State private var autoFetchingBankName: String? = nil

    @State private var iconInput: String = ""
    @State private var isFetchingIcon: Bool = false
    @State private var iconError: String?

    @State private var saving = false
    @State private var errorMessage: String?
    @State private var saveSuccessTrigger = 0
    @State private var showingArchiveConfirmation = false

    init(editing: Account? = nil) {
        self.editing = editing
        _name = State(initialValue: editing?.name ?? "")
        _bankName = State(initialValue: editing?.bankName ?? "")
        _bankCode = State(initialValue: editing?.bankCode ?? "")
        _iconAssetId = State(initialValue: editing?.iconAssetId)
        _note = State(initialValue: editing?.note ?? "")
    }

    private var isEditMode: Bool { editing != nil }

    /// 匹配到的预置日本银行信息（若有）
    private var matchedBank: BankEntry? {
        let trimmedCode = bankCode.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedCode.isEmpty {
            return BankEntry.defaultJapaneseBanks.first { $0.code == trimmedCode }
        }
        let trimmedName = bankName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty {
            return BankEntry.defaultJapaneseBanks.first { $0.displayName == trimmedName || $0.name == trimmedName }
        }
        return nil
    }

    /// 快捷选择常用日本银行列表
    private var popularShortcuts: [BankEntry] {
        let codes = ["0009", "0005", "0001", "9900", "0036", "0033", "0010", "0034", "0040"]
        return codes.compactMap { code in
            BankEntry.defaultJapaneseBanks.first { $0.code == code }
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                // 顶部拟真账户徽章预览
                Section {
                    HStack(spacing: 16) {
                        EntityIcon(
                            name: name.isEmpty ? "银行" : name,
                            assetId: iconAssetId,
                            size: 56
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                        )

                        VStack(alignment: .leading, spacing: 4) {
                            Text(name.isEmpty ? "账户名称" : name)
                                .font(AppTypography.cardTitle)
                                .foregroundStyle(AppTheme.ink)
                                .lineLimit(1)

                            HStack(spacing: 6) {
                                if !bankName.isEmpty {
                                    Text(bankName)
                                        .font(AppTypography.caption)
                                        .foregroundStyle(AppTheme.muted)
                                }
                                if !bankCode.isEmpty {
                                    Text("代码: \(bankCode)")
                                        .font(AppTypography.caption.monospacedDigit())
                                        .foregroundStyle(AppTheme.muted)
                                }
                                if bankName.isEmpty && bankCode.isEmpty {
                                    Text("银行扣款账户")
                                        .font(AppTypography.caption)
                                        .foregroundStyle(AppTheme.muted)
                                }
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 8)
                    .appListRow()
                }

                // 所属银行选择与常用快捷入口
                Section {
                    Button {
                        showingBankPicker = true
                    } label: {
                        HStack(spacing: 12) {
                            FormIconSlot(systemName: "building.columns.fill", tint: AppTheme.accent)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(bankName.isEmpty ? "选择日本金融机构" : bankName)
                                        .font(AppTypography.rowTitle)
                                        .foregroundStyle(bankName.isEmpty ? AppTheme.muted : AppTheme.ink)

                                    if matchedBank?.domain != nil {
                                        ExpressivePill(
                                            title: "官网图标",
                                            systemImage: "sparkles",
                                            tint: AppTheme.accent,
                                            fill: AppTheme.accentSurface
                                        )
                                    }
                                }

                                if !bankCode.isEmpty {
                                    Text("机构代码: \(bankCode)")
                                        .font(AppTypography.caption.monospacedDigit())
                                        .foregroundStyle(AppTheme.muted)
                                } else {
                                    Text("支持按名称、假名或代码快速选择并自动抓取官方图标")
                                        .font(AppTypography.caption)
                                        .foregroundStyle(AppTheme.muted)
                                }
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.muted.opacity(0.4))
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(AppRowButtonStyle())
                    .appListRow()

                    // 常用银行快捷胶囊
                    VStack(alignment: .leading, spacing: 8) {
                        Text("常用日本银行快捷选择")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(popularShortcuts) { bank in
                                    let isSelected = bankCode == bank.code || bankName == bank.displayName
                                    Button {
                                        applyBank(bank)
                                    } label: {
                                        HStack(spacing: 5) {
                                            if isSelected {
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 10, weight: .bold))
                                            }
                                            Text(bank.shortName)
                                                .font(AppTypography.badge)
                                        }
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .foregroundStyle(isSelected ? AppTheme.onAccent : AppTheme.ink)
                                        .background(
                                            isSelected ? AppTheme.accent : AppTheme.surfaceMuted,
                                            in: Capsule()
                                        )
                                        .overlay(
                                            Capsule().strokeBorder(isSelected ? Color.clear : Color.white.opacity(0.08), lineWidth: 1)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }

                                Button {
                                    showingBankPicker = true
                                } label: {
                                    HStack(spacing: 4) {
                                        Image(systemName: "magnifyingglass")
                                            .font(.system(size: 11, weight: .semibold))
                                        Text("全部…")
                                            .font(AppTypography.badge)
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .foregroundStyle(AppTheme.muted)
                                    .background(AppTheme.surfaceMuted.opacity(0.6), in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.vertical, 6)
                    .appListRow()
                } header: {
                    AppEyebrow("所属银行")
                }

                // 核心表单
                Section {
                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "textformat", tint: AppTheme.accent)
                        TextField("账户名称（如：三井住友 主账户）", text: $name)
                            .font(AppTypography.rowTitle)
                            .autocorrectionDisabled()
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "building.columns", tint: AppTheme.accent)
                        TextField("金融机构名称（如：三井住友銀行）", text: $bankName)
                            .font(AppTypography.rowTitle)
                            .autocorrectionDisabled()
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "number", tint: AppTheme.accent)
                        TextField("金融机构代码（4 位数字，选填）", text: $bankCode)
                            .font(AppTypography.rowTitle)
                            .keyboardType(.numberPad)
                            .autocorrectionDisabled()
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
                    AppEyebrow("账户基础信息")
                }

                // 银行图标抓取
                Section {
                    if iconAssetId != nil {
                        HStack {
                            Label(
                                matchedBank?.domain != nil ? "已应用官方银行图标" : "已应用自定义银行图标",
                                systemImage: "photo.badge.checkmark"
                            )
                            .font(AppTypography.rowTitle)
                            .foregroundStyle(AppTheme.accent)
                            Spacer()
                            Button("清除图标", role: .destructive) {
                                withAnimation(AppTheme.snappySpring) {
                                    self.iconAssetId = nil
                                }
                            }
                            .font(AppTypography.caption.weight(.medium))
                        }
                        .appListRow()
                    } else if isFetchingIcon, let bankTitle = autoFetchingBankName {
                        HStack(spacing: 10) {
                            ProgressView()
                                .tint(AppTheme.accent)
                            Text("正在自动抓取 \(bankTitle) 官方高清图标…")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.vertical, 4)
                        .appListRow()
                    } else if let matched = matchedBank, let domain = matched.domain {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(matched.displayName) 官方图标")
                                    .font(AppTypography.rowTitle)
                                    .foregroundStyle(AppTheme.ink)
                                Text("域名: \(domain)")
                                    .font(AppTypography.caption)
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Spacer()
                            Button {
                                Task { await fetchIconFromDomain(domain, bankDisplayName: matched.displayName) }
                            } label: {
                                if isFetchingIcon {
                                    ProgressView().tint(AppTheme.accent)
                                } else {
                                    Text("立即获取")
                                        .font(AppTypography.caption.weight(.semibold))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(AppTheme.accent.opacity(0.18))
                                        .foregroundStyle(AppTheme.accent)
                                        .clipShape(Capsule())
                                }
                            }
                            .disabled(isFetchingIcon)
                        }
                        .appListRow()
                    }

                    HStack(spacing: 8) {
                        FormIconSlot(systemName: "globe", tint: AppTheme.accent)
                        TextField("官网域名（如 smbc.co.jp）或图片网址", text: $iconInput)
                            .font(AppTypography.rowTitle)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        Button {
                            Task { await fetchIcon() }
                        } label: {
                            if isFetchingIcon && autoFetchingBankName == nil {
                                ProgressView()
                                    .tint(AppTheme.accent)
                                    .frame(width: 44)
                            } else {
                                Text("抓取")
                                    .font(AppTypography.caption.weight(.semibold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(AppTheme.accent.opacity(0.18))
                                    .foregroundStyle(AppTheme.accent)
                                    .clipShape(Capsule())
                            }
                        }
                        .disabled(isFetchingIcon || iconInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .appListRow()

                    if let iconError {
                        Text(iconError)
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.danger)
                            .appListRow()
                    }
                } header: {
                    AppEyebrow("银行图标")
                } footer: {
                    Text("选择日本银行将自动通过服务器从官网抓取高清官方图标；亦可手动输入其他银行官网域名或图片网址。")
                        .font(AppTypography.caption)
                        .foregroundStyle(AppTheme.muted)
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
                                Label("停用此扣款账户", systemImage: "archivebox")
                                    .font(AppTypography.rowTitle)
                                    .foregroundStyle(AppTheme.danger)
                                Spacer()
                            }
                        }
                        .appListRow()
                    } footer: {
                        Text("停用后此账户将归档，不再用于新卡片绑定，已有关联账单仍将继续保留。")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }
            .appPage()
            .navigationTitle(isEditMode ? "编辑扣款账户" : "添加扣款账户")
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
                "停用扣款账户？",
                isPresented: $showingArchiveConfirmation,
                titleVisibility: .visible
            ) {
                if let editing {
                    Button("停用「\(editing.name)」", role: .destructive) {
                        Task {
                            dismiss()
                            try? await Task.sleep(nanoseconds: 150_000_000)
                            try? await model.archiveAccount(editing)
                        }
                    }
                }
                Button("取消", role: .cancel) { showingArchiveConfirmation = false }
            } message: {
                Text("归档后不再用于新卡片绑定，已有历史账单将继续保留。")
            }
            .sensoryFeedback(.success, trigger: saveSuccessTrigger)
            .sheet(isPresented: $showingBankPicker) {
                BankPickerSheet(
                    selectedBankCode: bankCode,
                    onSelect: { bank in
                        applyBank(bank)
                    },
                    onClear: {
                        withAnimation(AppTheme.snappySpring) {
                            bankCode = ""
                        }
                    }
                )
            }
        }
    }

    private func applyBank(_ bank: BankEntry) {
        withAnimation(AppTheme.snappySpring) {
            self.bankName = bank.displayName
            self.bankCode = bank.code
            let currentName = self.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if currentName.isEmpty || BankEntry.defaultJapaneseBanks.contains(where: { $0.displayName == currentName || $0.name == currentName || currentName == "银行" }) {
                self.name = bank.displayName
            }
        }
        if let domain = bank.domain {
            self.iconInput = domain
            if iconAssetId == nil {
                Task {
                    await fetchIconFromDomain(domain, bankDisplayName: bank.displayName)
                }
            }
        }
    }

    private func fetchIconFromDomain(_ domain: String, bankDisplayName: String? = nil) async {
        isFetchingIcon = true
        iconError = nil
        autoFetchingBankName = bankDisplayName
        defer {
            isFetchingIcon = false
            autoFetchingBankName = nil
        }
        do {
            let assetId = try await model.fetchSiteIcon(domain: domain)
            withAnimation(AppTheme.expressiveSpring) {
                self.iconAssetId = assetId
                self.iconInput = ""
            }
        } catch {
            iconError = "抓取官方图标失败：\(error.localizedDescription)"
        }
    }

    private func fetchIcon() async {
        let trimmed = iconInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isFetchingIcon = true
        iconError = nil
        do {
            let assetId: String
            if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
                assetId = try await model.fetchAsset(from: trimmed)
            } else {
                let cleanDomain = trimmed.replacingOccurrences(of: "^https?://", with: "", options: .regularExpression)
                    .components(separatedBy: "/").first ?? trimmed
                assetId = try await model.fetchSiteIcon(domain: cleanDomain)
            }
            withAnimation(AppTheme.expressiveSpring) {
                self.iconAssetId = assetId
                self.iconInput = ""
            }
        } catch {
            iconError = "抓取失败：\(error.localizedDescription)"
        }
        isFetchingIcon = false
    }

    private var canSave: Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty { return false }
        let trimmedCode = bankCode.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedCode.isEmpty && (trimmedCode.count != 4 || !trimmedCode.allSatisfy(\.isNumber)) {
            return false
        }
        return true
    }

    private func save() async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorMessage = "请输入账户名称"
            return
        }
        let trimmedCode = bankCode.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedCode.isEmpty && (trimmedCode.count != 4 || !trimmedCode.allSatisfy(\.isNumber)) {
            errorMessage = "金融机构代码须为 4 位数字"
            return
        }

        saving = true
        errorMessage = nil

        let input = AccountInput(
            name: trimmedName,
            bankName: bankName.trimmingCharacters(in: .whitespacesAndNewlines),
            bankCode: trimmedCode,
            iconAssetId: iconAssetId,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines)
        )

        do {
            if let editing {
                try await model.updateAccount(editing, input: input)
            } else {
                try await model.createAccount(input)
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
