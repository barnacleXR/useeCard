import Foundation
import UserNotifications

/// 按服务端提醒计划排程本地通知；App 端不重新计算金额。
/// 每次同步先撤销本 App 的全部待发提醒再重排，所以已还、作废、改日期后旧通知会消失。
enum NotificationScheduler {
    private static let prefix = "useecard.reminder."
    static let enabledKey = "useecard.notifications.enabled"

    static var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    static func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    /// 返回实际排程的条数。
    @discardableResult
    static func sync(plan: ReminderPlan?, catalog: CurrencyCatalog) async -> Int {
        let center = UNUserNotificationCenter.current()
        await removeAll()
        guard isEnabled, let plan else { return 0 }
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return 0 }
        let now = Date()
        var scheduled = 0
        for item in plan.items {
            let time = item.notifyTime.split(separator: ":").compactMap { Int($0) }
            var components = DateComponents(year: item.notifyDate.year, month: item.notifyDate.month, day: item.notifyDate.day,
                                            hour: time.first ?? 9, minute: time.count > 1 ? time[1] : 0)
            components.timeZone = DateOnly.tokyo
            components.calendar = DateOnly.calendar
            guard let fireDate = components.date, fireDate > now else { continue }
            let content = UNMutableNotificationContent()
            let days = item.notifyDate.days(until: item.dueDate)
            content.title = "\(item.accountName) 需要备款"
            content.body = "\(days == 0 ? "今天" : days == 1 ? "明天" : item.dueDate.shortLabel)扣款 \(catalog.format(item.amountMinor, currency: item.currency))（已录入 \(item.billCount) 笔）"
            content.sound = .default
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let request = UNNotificationRequest(identifier: prefix + item.key, content: content, trigger: trigger)
            do { try await center.add(request); scheduled += 1 } catch { continue }
        }
        return scheduled
    }

    static func removeAll() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }
}
