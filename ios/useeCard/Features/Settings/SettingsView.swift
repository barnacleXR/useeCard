import SwiftUI

/// 个人中心（我的）：对齐“The Next Interface”现代规范，
/// 整合个人与服务名片、通用偏好（新建卡片默认币种）、本机提醒偏好与账号退出。
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var notificationsOn = NotificationScheduler.isEnabled
    @State private var daysBefore = 1
    @State private var reminderTime = DateOnly.today().date
    @State private var savingReminder = false
    @State private var savingCurrency = false
    @State private var scheduledCount: Int?
    @State private var error: String?
    @State private var currencyError: String?
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                // 1. 个人与服务名片（替代原本的卡包二级入口与重复的连接服务列表）
                if let server = model.server {
                    Section {
                        NavigationLink {
                            ServerConnectionDetailsView()
                        } label: {
                            HStack(spacing: 14) {
                                // 翡翠绿徽标头像
                                ZStack {
                                    Circle()
                                        .fill(AppTheme.accentSurface)
                                        .frame(width: 48, height: 48)
                                    Circle()
                                        .strokeBorder(AppTheme.accent.opacity(0.35), lineWidth: 0.75)
                                        .frame(width: 48, height: 48)
                                    Text(avatarLetter(for: server.username))
                                        .font(.system(size: 20, weight: .bold, design: .rounded))
                                        .foregroundStyle(AppTheme.accent)
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(server.username)
                                        .font(AppTypography.cardTitle)
                                        .foregroundStyle(AppTheme.ink)
                                        .lineLimit(1)

                                    HStack(spacing: 6) {
                                        Circle()
                                            .fill(model.isOffline ? AppTheme.warning : AppTheme.success)
                                            .frame(width: 7, height: 7)
                                        Text("\(server.serverName) · \(model.isOffline ? "离线模式" : "已同步")")
                                            .font(AppTypography.caption)
                                            .foregroundStyle(model.isOffline ? AppTheme.warning : AppTheme.muted)
                                            .lineLimit(1)
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                            .frame(minHeight: 52)
                        }
                        .appListRow()
                    }
                }

                // 2. 通用偏好（字体大小、新建卡片默认币种）
                Section {
                    NavigationLink {
                        FontSizeSettingView()
                    } label: {
                        HStack(spacing: 0) {
                            FormIconSlot(systemName: "textformat.size", tint: AppTheme.accent)
                            Text("字体大小")
                                .font(AppTypography.rowTitle)
                                .foregroundStyle(AppTheme.ink)
                            Spacer()
                            Text(model.fontSizeDescription)
                                .font(AppTypography.supporting)
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .appListRow()

                    HStack(spacing: 0) {
                        FormIconSlot(systemName: "coloncurrencysign.circle", tint: AppTheme.accent)
                        Picker("新建卡片默认币种", selection: defaultCurrencyBinding) {
                            ForEach(model.currencies.codes, id: \.self) { code in
                                Text(code).tag(code)
                            }
                        }
                        .font(AppTypography.rowTitle)
                        .disabled(savingCurrency || model.isOffline)

                        if savingCurrency {
                            ProgressView()
                                .controlSize(.small)
                                .tint(AppTheme.accent)
                                .padding(.leading, 8)
                        }
                    }
                    .appListRow()

                    if let currencyError {
                        AppNotice(message: currencyError, systemImage: "exclamationmark.circle", color: AppTheme.danger)
                            .appListRow()
                    }
                } header: {
                    AppEyebrow("通用偏好")
                } footer: {
                    Text("仅影响新建信用卡的默认币种，不修改已有卡片和历史账单。各币种独立汇总。")
                        .font(AppTypography.caption)
                }

                // 3. 本机提醒（高频偏好）
                Section {
                    Toggle("本机扣款提醒", isOn: $notificationsOn)
                        .tint(AppTheme.accent)
                        .disabled(savingReminder)
                        .appListRow()
                    Stepper("提前 \(daysBefore) 天", value: $daysBefore, in: 0...30)
                        .disabled(savingReminder)
                        .appListRow()
                    DatePicker("提醒时间（日本时间）", selection: $reminderTime, displayedComponents: .hourAndMinute)
                        .environment(\.timeZone, DateOnly.tokyo)
                        .disabled(savingReminder)
                        .appListRow()
                    Button { Task { await saveReminder() } } label: {
                        AppActionLabel(title: savingReminder ? "正在保存…" : "保存提醒设置", busy: savingReminder)
                    }
                    .buttonStyle(AppActionStyle(prominent: true, expands: true))
                    .disabled(savingReminder)
                    .appListRow()
                    if let error {
                        AppNotice(message: error, systemImage: "exclamationmark.circle", color: AppTheme.danger)
                            .appListRow()
                    }
                } header: {
                    AppEyebrow("扣款提醒")
                } footer: {
                    if let footer = reminderFooter {
                        Text(footer)
                            .font(AppTypography.caption)
                    }
                }

                // 4. 账户操作
                Section {
                    Button("退出登录", role: .destructive) { confirmSignOut = true }
                        .font(AppTypography.rowTitle)
                        .frame(minHeight: 44)
                        .appListRow()
                }
            }
            .appPage()
            .navigationTitle("")
            .onAppear(perform: loadPreferences)
            .onChange(of: model.me) { _, _ in
                if !savingReminder { loadPreferences() }
            }
            .onChange(of: notificationsOn) { _, on in Task { await toggleNotifications(on) } }
            .confirmationDialog("退出登录？", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("退出并清除本机数据", role: .destructive) { Task { await model.signOut() } }
            }
        }
    }

    private var defaultCurrencyBinding: Binding<String> {
        Binding(
            get: { model.defaultCurrency },
            set: { next in
                guard next != model.defaultCurrency, !savingCurrency else { return }
                Task { await saveDefaultCurrency(next) }
            }
        )
    }

    private func saveDefaultCurrency(_ currency: String) async {
        guard !savingCurrency else { return }
        savingCurrency = true
        currencyError = nil
        defer { savingCurrency = false }
        do {
            try await model.savePreferences(defaultCurrency: currency)
        } catch {
            currencyError = error.localizedDescription
        }
    }

    private func avatarLetter(for username: String) -> String {
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "U" }
        return String(first).uppercased()
    }

    private var reminderFooter: String? {
        guard let scheduledCount, scheduledCount > 0 else { return nil }
        var text = "当前已安排 \(scheduledCount) 条提醒。"
        if let plan = model.reminderPlan, plan.truncated {
            text += "因待提醒较多，已优先安排最近的 \(plan.items.count) 条。"
        }
        return text
    }

    private func loadPreferences() {
        guard let me = model.me else { return }
        daysBefore = me.reminderDaysBefore
        let parts = me.reminderTime.split(separator: ":").compactMap { Int($0) }
        var components = DateComponents(hour: parts.first ?? 9, minute: parts.count > 1 ? parts[1] : 0)
        components.calendar = DateOnly.calendar; components.timeZone = DateOnly.tokyo
        let today = DateOnly.today()
        components.year = today.year; components.month = today.month; components.day = today.day
        reminderTime = components.date ?? reminderTime
    }

    private func toggleNotifications(_ on: Bool) async {
        if on, !(await NotificationScheduler.requestAuthorization()) {
            error = "通知权限未开启，请在系统设置中允许 useeCard 发送通知。"
            notificationsOn = false
        }
        NotificationScheduler.isEnabled = on
        scheduledCount = await NotificationScheduler.sync(plan: model.reminderPlan, catalog: model.currencies)
    }

    private func saveReminder() async {
        guard !savingReminder else { return }
        savingReminder = true
        error = nil
        defer { savingReminder = false }
        let c = DateOnly.calendar.dateComponents([.hour, .minute], from: reminderTime)
        let time = String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
        do {
            try await model.savePreferences(reminderDaysBefore: daysBefore, reminderTime: time)
            scheduledCount = await NotificationScheduler.sync(plan: model.reminderPlan, catalog: model.currencies)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
