import Foundation
import Observation
import UIKit

/// App 全局状态。服务端是唯一权威数据源：在线写入，离线只读缓存，离线录入只能存草稿。
@MainActor
@Observable
final class AppModel {
    enum Phase { case launching, onboarding, ready }

    var phase: Phase = .launching
    private(set) var server: ActiveServer?
    private(set) var api: APIClient?

    // 数据
    var me: Me?
    var currencies = CurrencyCatalog.fallback
    var accounts: [Account] = []
    var cards: [Card] = []
    var month = MonthKey.current()
    var summary: FundingSummary?
    var bills: [Bill] = []
    var reviewMonth = MonthKey.current()
    var reviews: [Review] = []
    var reminderPlan: ReminderPlan?
    var drafts: [BillDraft] = []

    // 状态
    var lastSync: Date?
    var isOffline = false
    var isSyncing = false
    var alertMessage: String?

    var activeCards: [Card] { cards.filter { !$0.isArchived } }
    var activeAccounts: [Account] { accounts.filter { !$0.isArchived } }
    func card(_ id: String) -> Card? { cards.first { $0.id == id } }
    func account(_ id: String) -> Account? { accounts.first { $0.id == id } }
    var defaultCurrency: String { me?.defaultCurrency ?? "JPY" }

    // MARK: 启动

    func bootstrap() async {
        guard let saved = ServerStore.load(), let credentials = CredentialVault.load(scope: saved.scope) else {
            phase = .onboarding
            return
        }
        activate(saved, credentials: credentials)
        restoreSnapshot()
        phase = .ready
        await refresh()
    }

    private func activate(_ server: ActiveServer, credentials: DeviceCredentials) {
        self.server = server
        let scope = server.scope
        api = APIClient(baseURL: server.baseURL, credentials: credentials) { fresh in
            // 刷新令牌轮换后立即落盘；被吊销则删除。
            if let fresh { CredentialVault.save(fresh, scope: scope) } else { CredentialVault.delete(scope: scope) }
        }
        drafts = LocalStore.loadDrafts(scope: scope)
    }

    private func restoreSnapshot() {
        guard let scope = server?.scope, let snapshot = LocalStore.loadSnapshot(scope: scope) else { return }
        me = snapshot.me; currencies = snapshot.currencies; accounts = snapshot.accounts; cards = snapshot.cards
        month = snapshot.month; summary = snapshot.summary; bills = snapshot.bills
        reviewMonth = snapshot.reviewMonth; reviews = snapshot.reviews; reminderPlan = snapshot.reminderPlan
        lastSync = snapshot.syncedAt
    }

    // MARK: 连接与认证

    enum SignInMethod { case password(username: String, password: String), pairing(code: String) }

    func checkServer(_ raw: String) async throws -> (URL, ServerInfo) {
        let url = try APIClient.normalizeServerURL(raw)
        return (url, try await APIClient.serverInfo(at: url))
    }

    func signIn(baseURL: URL, info: ServerInfo, method: SignInMethod, deviceName: String) async throws {
        let tokens: DeviceTokens
        switch method {
        case let .password(username, password): tokens = try await APIClient.login(at: baseURL, username: username, password: password, deviceName: deviceName)
        case let .pairing(code): tokens = try await APIClient.pair(at: baseURL, code: code, deviceName: deviceName)
        }
        let server = ActiveServer(baseURL: baseURL, serverName: info.name, instanceId: tokens.instanceId, userId: tokens.user.id, username: tokens.user.username, deviceId: tokens.device.id)
        let credentials = DeviceCredentials(tokens: tokens)
        CredentialVault.save(credentials, scope: server.scope)
        ServerStore.save(server)
        resetData()
        activate(server, credentials: credentials)
        restoreSnapshot()
        phase = .ready
        await refresh()
    }

    /// 注销：吊销服务端设备会话，清除本账号的凭证、缓存、草稿与通知。
    func signOut() async {
        await api?.logout()
        if let scope = server?.scope { CredentialVault.delete(scope: scope); LocalStore.wipe(scope: scope) }
        await NotificationScheduler.removeAll()
        ServerStore.clear()
        server = nil; api = nil
        resetData()
        phase = .onboarding
    }

    private func resetData() {
        me = nil; currencies = .fallback; accounts = []; cards = []; summary = nil; bills = []; reviews = []
        reminderPlan = nil; drafts = []; lastSync = nil; isOffline = false
        month = .current(); reviewMonth = .current()
    }

    // MARK: 同步

    /// 进入前台、下拉刷新、写入成功后调用；失败时保留缓存并标记离线。
    func refresh() async {
        guard let api, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            async let meTask: Me = api.get("/me")
            async let currencyTask: [String: Int] = api.get("/currencies")
            async let accountsTask: [Account] = api.get("/accounts")
            async let cardsTask: [Card] = api.get("/cards")
            async let summaryTask: FundingSummary = api.get("/summary", query: ["dueMonth": month.string])
            async let billsTask: [Bill] = api.get("/bills", query: ["dueMonth": month.string])
            async let reviewsTask: [Review] = api.get("/reviews", query: ["reviewMonth": reviewMonth.string])
            async let planTask: ReminderPlan = api.get("/reminders/plan")
            let (me, digits, accounts, cards, summary, bills, reviews, plan) = try await (meTask, currencyTask, accountsTask, cardsTask, summaryTask, billsTask, reviewsTask, planTask)
            self.me = me; currencies = CurrencyCatalog(digits: digits); self.accounts = accounts; self.cards = cards
            self.summary = summary; self.bills = bills; self.reviews = reviews; reminderPlan = plan
            lastSync = Date(); isOffline = false
            saveSnapshot()
            await NotificationScheduler.sync(plan: plan, catalog: currencies)
        } catch {
            handle(error)
        }
    }

    /// 切换汇总/账单月份时只重新拉取该月数据。
    func changeMonth(by delta: Int) async {
        month = month.shifted(by: delta)
        await reloadMonth()
    }

    func reloadMonth() async {
        guard let api else { return }
        do {
            let requested = month
            async let summaryTask: FundingSummary = api.get("/summary", query: ["dueMonth": requested.string])
            async let billsTask: [Bill] = api.get("/bills", query: ["dueMonth": requested.string])
            let (freshSummary, freshBills) = try await (summaryTask, billsTask)
            // 连续切换月份时，较早发出的请求可能后返回；只采用当前月份的结果。
            guard requested == month else { return }
            summary = freshSummary; bills = freshBills
            isOffline = false
            saveSnapshot()
        } catch { handle(error) }
    }

    func changeReviewMonth(by delta: Int) async {
        reviewMonth = reviewMonth.shifted(by: delta)
        guard let api else { return }
        let requested = reviewMonth
        do {
            let fresh: [Review] = try await api.get("/reviews", query: ["reviewMonth": requested.string])
            guard requested == reviewMonth else { return }
            reviews = fresh; saveSnapshot()
        } catch { handle(error) }
    }

    func monthlyReport(_ month: MonthKey) async throws -> MonthlyReport {
        guard let api else { throw ClientError.sessionExpired }
        return try await api.get("/reports/monthly", query: ["dueMonth": month.string])
    }

    func billsForCard(_ cardId: String) async throws -> [Bill] {
        guard let api else { throw ClientError.sessionExpired }
        return try await api.get("/bills", query: ["cardId": cardId])
    }

    private func saveSnapshot() {
        guard let scope = server?.scope else { return }
        LocalStore.saveSnapshot(Snapshot(syncedAt: lastSync ?? Date(), me: me, currencies: currencies, accounts: accounts, cards: cards, month: month,
                                         summary: summary, bills: bills, reviewMonth: reviewMonth, reviews: reviews, reminderPlan: reminderPlan), scope: scope)
    }

    private func handle(_ error: Error) {
        switch error as? ClientError {
        case .offline?: isOffline = true
        case .sessionExpired?:
            alertMessage = ClientError.sessionExpired.errorDescription
            Task { await signOut() }
        default: alertMessage = error.localizedDescription
        }
    }

    // MARK: 写操作（失败直接抛给表单显示，不吞错误）

    func createBill(_ input: BillInput, idempotencyKey: String) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let _: Bill = try await api.send("POST", "/bills", body: input, idempotencyKey: idempotencyKey)
        await refresh()
    }

    func updateBill(_ bill: Bill, input: BillInput) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let body = BillUpdate(input: input, version: bill.version, confirmCurrencyChange: bill.currency != input.currency)
        let _: Bill = try await api.send("PATCH", "/bills/\(bill.id)", body: body)
        await refresh()
    }

    enum BillAction: String { case paid, undoPaid = "undo-paid", void }

    func perform(_ action: BillAction, on bill: Bill) async {
        guard let api else { return }
        do {
            let _: Bill = try await api.send("POST", "/bills/\(bill.id)/\(action.rawValue)", body: ["version": bill.version])
            await refresh()
        } catch { handle(error) }
    }

    func startReview() async {
        guard let api else { return }
        do { reviews = try await api.send("POST", "/reviews/\(reviewMonth.string)/start", body: Optional<String>.none); saveSnapshot() } catch { handle(error) }
    }

    func confirmReviews(_ items: [ReviewConfirmItem]) async throws {
        guard let api else { throw ClientError.sessionExpired }
        reviews = try await api.send("POST", "/reviews/\(reviewMonth.string)/confirm", body: ["items": items])
        saveSnapshot()
    }

    func addCardsToReview(_ cardIds: [String]) async {
        guard let api else { return }
        do { reviews = try await api.send("POST", "/reviews/\(reviewMonth.string)/cards", body: ["cardIds": cardIds]); saveSnapshot() } catch { handle(error) }
    }

    func savePreferences(reminderDaysBefore: Int? = nil, reminderTime: String? = nil, defaultCurrency: String? = nil) async throws {
        guard let api else { throw ClientError.sessionExpired }
        struct Body: Encodable { let reminderDaysBefore: Int?; let reminderTime: String?; let defaultCurrency: String? }
        let _: Preferences = try await api.send("PATCH", "/settings", body: Body(reminderDaysBefore: reminderDaysBefore, reminderTime: reminderTime, defaultCurrency: defaultCurrency))
        await refresh()
    }

    // MARK: 草稿

    func saveDraft(_ draft: BillDraft) {
        drafts.removeAll { $0.id == draft.id }
        drafts.insert(draft, at: 0)
        if let scope = server?.scope { LocalStore.saveDrafts(drafts, scope: scope) }
    }

    func deleteDraft(_ draft: BillDraft) {
        drafts.removeAll { $0.id == draft.id }
        if let scope = server?.scope { LocalStore.saveDrafts(drafts, scope: scope) }
    }

    func submitDraft(_ draft: BillDraft) async throws {
        try await createBill(draft.input, idempotencyKey: draft.idempotencyKey)
        deleteDraft(draft)
    }

    static var defaultDeviceName: String { UIDevice.current.name }
}
