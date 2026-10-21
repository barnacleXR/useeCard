import SwiftUI

/// 个人设置：外观跟随系统；服务器与账号；提醒；连接信息。复杂管理在浏览器中的管理中心完成。
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var notificationsOn = NotificationScheduler.isEnabled
    @State private var daysBefore = 1
    @State private var reminderTime = DateOnly.today().date
    @State private var savingReminder = false
    @State private var scheduledCount: Int?
    @State private var error: String?
    @State private var confirmSignOut = false

    var body: some View {
        Form {
            if let server = model.server {
                Section("服务器") {
                    LabeledContent("名称", value: server.serverName)
                    LabeledContent("地址", value: server.baseURL.absoluteString)
                    LabeledContent("账号", value: server.username)
                    LabeledContent("最后同步", value: model.lastSync?.formatted(date: .abbreviated, time: .shortened) ?? "未同步")
                    if model.isOffline { Label("当前离线，显示的是缓存数据", systemImage: "wifi.slash").foregroundStyle(.orange) }
                    Link(destination: server.baseURL.appendingPathComponent("settings")) { Label("在浏览器打开管理中心", systemImage: "safari") }
                }
            }

            Section {
                Toggle("本机扣款提醒", isOn: $notificationsOn)
                Stepper("提前 \(daysBefore) 天", value: $daysBefore, in: 0...30)
                DatePicker("提醒时间（日本时间）", selection: $reminderTime, displayedComponents: .hourAndMinute)
                    .environment(\.timeZone, DateOnly.tokyo)
                Button(savingReminder ? "保存中…" : "保存提醒设置") { Task { await saveReminder() } }.disabled(savingReminder)
            } header: {
                Text("提醒")
            } footer: {
                Text(reminderFooter)
            }

            Section("外观") {
                Text("浅色/深色跟随系统设置，并遵循系统的“降低透明度”和“减弱动态效果”。").font(.footnote).foregroundStyle(.secondary)
            }

            if let error { Section { Text(error).foregroundStyle(.red) } }

            Section {
                Button("退出登录", role: .destructive) { confirmSignOut = true }
            } footer: {
                Text("退出会撤销本设备的登录，并清除本机缓存、草稿和提醒。更换服务器也需要先退出。")
            }
        }
        .navigationTitle("设置")
        .onAppear(perform: loadPreferences)
        .onChange(of: notificationsOn) { _, on in Task { await toggleNotifications(on) } }
        .confirmationDialog("退出登录？", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("退出并清除本机数据", role: .destructive) { Task { await model.signOut() } }
        }
    }

    private var reminderFooter: String {
        var text = "按“扣款账户＋日期＋币种”合并已录入的待还账单，由服务器生成计划后在本机排程。App 长时间未同步时提醒可能是旧计划。"
        if let plan = model.reminderPlan, plan.truncated { text += "待提醒较多，只安排了最近的 \(plan.items.count) 条。" }
        if let scheduledCount { text += "当前已安排 \(scheduledCount) 条。" }
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

    private func saveReminder() async {
        savingReminder = true; error = nil
        defer { savingReminder = false }
        let c = DateOnly.calendar.dateComponents([.hour, .minute], from: reminderTime)
        let time = String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
        do {
            try await model.savePreferences(reminderDaysBefore: daysBefore, reminderTime: time)
            scheduledCount = await NotificationScheduler.sync(plan: model.reminderPlan, catalog: model.currencies)
        } catch { self.error = error.localizedDescription }
    }

    private func toggleNotifications(_ on: Bool) async {
        if on, !(await NotificationScheduler.requestAuthorization()) {
            error = "通知权限未开启，请在系统设置中允许 useeCard 发送通知。"
            notificationsOn = false
            return
        }
        NotificationScheduler.isEnabled = on
        scheduledCount = await NotificationScheduler.sync(plan: model.reminderPlan, catalog: model.currencies)
    }
}
