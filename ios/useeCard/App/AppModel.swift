import Foundation
import Observation
import UIKit
import SwiftUI

enum MonthLoadState: Equatable {
    case idle
    case loading(MonthKey)
    case failed(MonthKey, String)
}

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
    private(set) var month = MonthKey.current()
    var summary: FundingSummary?
    var bills: [Bill] = []
    private(set) var reviewMonth = MonthKey.current()
    var reviews: [Review] = []
    var reminderPlan: ReminderPlan?
    var drafts: [BillDraft] = []

    // 状态
    var lastSync: Date?
    var isOffline = false
    var isSyncing = false
    var alertMessage: String?
    private(set) var monthLoad: MonthLoadState = .idle
    private(set) var reviewMonthLoad: MonthLoadState = .idle
    private(set) var hasReviewData = false
    private(set) var isWritingReviews = false
    @ObservationIgnored private var monthRequest = UUID()
    @ObservationIgnored private var reviewRequest = UUID()
    @ObservationIgnored private var refreshRequest = UUID()
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var isSigningOut = false

    var activeCards: [Card] { cards.filter { !$0.isArchived } }
    var activeAccounts: [Account] { accounts.filter { !$0.isArchived } }
    func card(_ id: String) -> Card? { cards.first { $0.id == id } }
    func account(_ id: String) -> Account? { accounts.first { $0.id == id } }
    var defaultCurrency: String { me?.defaultCurrency ?? "JPY" }

    // MARK: - 字体偏好设置
    private static let followSystemFontSizeKey = "useecard.followSystemFontSize"
    private static let customFontSizeKey = "useecard.customFontSize"

    var isFollowSystemFontSize: Bool = (UserDefaults.standard.object(forKey: "useecard.followSystemFontSize") as? Bool) ?? true {
        didSet {
            UserDefaults.standard.set(isFollowSystemFontSize, forKey: Self.followSystemFontSizeKey)
        }
    }

    var customFontSize: AppFontSize = AppFontSize(rawValue: (UserDefaults.standard.object(forKey: "useecard.customFontSize") as? Int) ?? AppFontSize.standard.rawValue) ?? .standard {
        didSet {
            UserDefaults.standard.set(customFontSize.rawValue, forKey: Self.customFontSizeKey)
        }
    }

    var effectiveDynamicTypeSize: DynamicTypeSize? {
        isFollowSystemFontSize ? nil : customFontSize.dynamicTypeSize
    }

    var fontSizeDescription: String {
        if isFollowSystemFontSize {
            return "跟随系统"
        } else {
            return customFontSize.label
        }
    }

    func setFollowSystemFontSize(_ follow: Bool) {
        isFollowSystemFontSize = follow
    }

    func setCustomFontSize(_ size: AppFontSize) {
        isFollowSystemFontSize = false
        customFontSize = size
    }

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
        api = APIClient(baseURL: server.baseURL, credentials: credentials) { [weak self] fresh in
            // 刷新令牌轮换后立即落盘；被吊销则删除。
            guard let fresh else { CredentialVault.delete(scope: scope); return }
            do {
                try CredentialVault.save(fresh, scope: scope)
            } catch {
                // 本次运行仍可用内存中的新凭证；旧刷新令牌已失效，重启后可能需要重新登录。
                Task { @MainActor in self?.alertMessage = "登录凭证未能保存到钥匙串，重启 App 后可能需要重新登录。" }
            }
        }
        drafts = LocalStore.loadDrafts(scope: scope)
    }

    private func restoreSnapshot() {
        guard let scope = server?.scope, let snapshot = LocalStore.loadSnapshot(scope: scope) else { return }
        me = snapshot.me; currencies = snapshot.currencies; accounts = snapshot.accounts; cards = snapshot.cards
        month = snapshot.month
        if snapshot.summary?.dueMonth == snapshot.month,
           snapshot.bills.allSatisfy({ $0.dueDate.monthKey == snapshot.month }) {
            summary = snapshot.summary; bills = snapshot.bills
        }
        reviewMonth = snapshot.reviewMonth; reviews = snapshot.reviews; reminderPlan = snapshot.reminderPlan
        hasReviewData = true
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
        try CredentialVault.save(credentials, scope: server.scope)
        ServerStore.save(server)
        resetData()
        activate(server, credentials: credentials)
        restoreSnapshot()
        phase = .ready
        await refresh()
    }

    /// 注销：吊销服务端设备会话，清除本账号的凭证、缓存、草稿与通知。
    func signOut() async {
        guard let api, !isSigningOut else { return }
        isSigningOut = true
        defer { isSigningOut = false }
        refreshRequest = UUID()
        monthRequest = UUID()
        reviewRequest = UUID()
        let pendingRefresh = refreshTask
        await api.logout()
        await pendingRefresh?.value
        if let scope = server?.scope { CredentialVault.delete(scope: scope); LocalStore.wipe(scope: scope) }
        await NotificationScheduler.removeAll()
        ServerStore.clear()
        server = nil; self.api = nil
        resetData()
        phase = .onboarding
    }

    private func resetData() {
        me = nil; currencies = .fallback; accounts = []; cards = []; summary = nil; bills = []; reviews = []
        reminderPlan = nil; drafts = []; lastSync = nil; isOffline = false
        IconCache.shared.removeAll()
        month = .current(); reviewMonth = .current()
        monthLoad = .idle; reviewMonthLoad = .idle
        monthRequest = UUID(); reviewRequest = UUID(); refreshRequest = UUID()
        refreshTask = nil
        isWritingReviews = false; isSyncing = false; hasReviewData = false
    }

    // MARK: 同步

    /// 进入前台、下拉刷新、写入成功后调用；失败时保留缓存并标记离线。
    func refresh() async {
        guard let api, !isSigningOut else { return }
        let request = UUID()
        refreshRequest = request
        let previous = refreshTask
        isSyncing = true
        let task = Task {
            await previous?.value
            guard refreshRequest == request, self.api === api else { return }
            await refreshData(api, request: request)
        }
        refreshTask = task
        await task.value
        if refreshRequest == request {
            refreshTask = nil
            isSyncing = false
        }
    }

    private func refreshData(_ api: APIClient, request: UUID) async {
        let requestedMonth = month
        let requestedReviewMonth = reviewMonth
        let monthRevision = monthRequest
        let reviewRevision = reviewRequest
        do {
            async let meTask: Me = api.get("/me")
            async let currencyTask: [String: Int] = api.get("/currencies")
            async let accountsTask: [Account] = api.get("/accounts")
            async let cardsTask: [Card] = api.get("/cards")
            async let summaryTask: FundingSummary = api.get("/summary", query: ["dueMonth": requestedMonth.string])
            async let billsTask: [Bill] = api.get("/bills", query: ["dueMonth": requestedMonth.string])
            async let reviewsTask: [Review] = api.get("/reviews", query: ["reviewMonth": requestedReviewMonth.string])
            async let planTask: ReminderPlan = api.get("/reminders/plan")
            let (me, digits, accounts, cards, summary, bills, reviews, plan) = try await (meTask, currencyTask, accountsTask, cardsTask, summaryTask, billsTask, reviewsTask, planTask)
            guard refreshRequest == request, self.api === api, !Task.isCancelled else { return }
            self.me = me; currencies = CurrencyCatalog(digits: digits); self.accounts = accounts; self.cards = cards
            if monthRequest == monthRevision, month == requestedMonth, summary.dueMonth == requestedMonth,
               bills.allSatisfy({ $0.dueDate.monthKey == requestedMonth }) {
                self.summary = summary
                self.bills = bills
            }
            if reviewRequest == reviewRevision, reviewMonth == requestedReviewMonth, !isWritingReviews {
                self.reviews = reviews
                hasReviewData = true
            }
            reminderPlan = plan
            lastSync = Date(); isOffline = false
            saveSnapshot()
            await NotificationScheduler.sync(plan: plan, catalog: currencies)
        } catch {
            guard refreshRequest == request, self.api === api, !Task.isCancelled else { return }
            handle(error)
        }
    }

    /// 数据到齐再切换显示月份；重试期间保留上次成功的金额和明细。
    func selectMonth(_ requested: MonthKey) async {
        guard let api, !isSigningOut else { return }
        let request = UUID()
        monthRequest = request
        monthLoad = .loading(requested)
        do {
            async let summaryTask: FundingSummary = api.get("/summary", query: ["dueMonth": requested.string])
            async let billsTask: [Bill] = api.get("/bills", query: ["dueMonth": requested.string])
            let (freshSummary, freshBills) = try await (summaryTask, billsTask)
            guard monthRequest == request, self.api === api else { return }
            guard freshSummary.dueMonth == requested, freshBills.allSatisfy({ $0.dueDate.monthKey == requested }) else {
                monthLoad = .failed(requested, "服务器返回的扣款月份与请求不一致。")
                return
            }
            month = requested; summary = freshSummary; bills = freshBills
            monthLoad = .idle
            isOffline = false
            saveSnapshot()
        } catch {
            guard monthRequest == request, self.api === api else { return }
            monthLoad = .failed(requested, error.localizedDescription)
            handleMonthLoadError(error)
        }
    }

    func selectReviewMonth(_ requested: MonthKey) async {
        guard let api, !isSigningOut, !isWritingReviews else { return }
        let request = UUID()
        reviewRequest = request
        reviewMonthLoad = .loading(requested)
        do {
            let fresh: [Review] = try await api.get("/reviews", query: ["reviewMonth": requested.string])
            guard reviewRequest == request, self.api === api else { return }
            reviewMonth = requested; reviews = fresh
            hasReviewData = true
            reviewMonthLoad = .idle
            isOffline = false
            saveSnapshot()
        } catch {
            guard reviewRequest == request, self.api === api else { return }
            reviewMonthLoad = .failed(requested, error.localizedDescription)
            handleMonthLoadError(error)
        }
    }

    private func handleMonthLoadError(_ error: Error) {
        switch error as? ClientError {
        case .offline?, .sessionExpired?: handle(error)
        default: break
        }
    }

    func monthlyReport(_ month: MonthKey) async throws -> MonthlyReport {
        guard let api else { throw ClientError.sessionExpired }
        return try await api.get("/reports/monthly", query: ["dueMonth": month.string])
    }

    func billsForCard(_ cardId: String) async throws -> [Bill] {
        guard let api else { throw ClientError.sessionExpired }
        return try await api.get("/bills", query: ["cardId": cardId])
    }

    func billPrefill(cardId: String) async throws -> BillPrefill {
        guard let api else { throw ClientError.sessionExpired }
        return try await api.get("/bills/prefill", query: ["cardId": cardId])
    }

    private func saveSnapshot() {
        guard let scope = server?.scope, summary != nil, hasReviewData else { return }
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
        do { try await writeReviews("start", body: Optional<String>.none) } catch { handle(error) }
    }

    func confirmReviews(_ items: [ReviewConfirmItem]) async throws {
        try await writeReviews("confirm", body: ["items": items])
    }

    func addCardsToReview(_ cardIds: [String]) async {
        do { try await writeReviews("cards", body: ["cardIds": cardIds]) } catch { handle(error) }
    }

    private func writeReviews<Body: Encodable>(_ action: String, body: Body) async throws {
        guard let api, !isSigningOut else { throw ClientError.sessionExpired }
        guard !isWritingReviews else {
            throw ClientError.server(status: 409, message: "正在保存月度检查，请稍后重试。")
        }
        if case .loading = reviewMonthLoad {
            throw ClientError.server(status: 409, message: "正在读取检查月份，请稍后重试。")
        }
        let request = UUID()
        reviewRequest = request
        let requested = reviewMonth
        isWritingReviews = true
        defer { if reviewRequest == request { isWritingReviews = false } }
        let fresh: [Review] = try await api.send("POST", "/reviews/\(requested.string)/\(action)", body: body)
        guard reviewRequest == request, self.api === api else { return }
        reviews = fresh
        hasReviewData = true
        saveSnapshot()
    }

    func savePreferences(reminderDaysBefore: Int? = nil, reminderTime: String? = nil, defaultCurrency: String? = nil) async throws {
        guard let api else { throw ClientError.sessionExpired }
        struct Body: Encodable { let reminderDaysBefore: Int?; let reminderTime: String?; let defaultCurrency: String? }
        let _: Preferences = try await api.send("PATCH", "/settings", body: Body(reminderDaysBefore: reminderDaysBefore, reminderTime: reminderTime, defaultCurrency: defaultCurrency))
        await refresh()
    }

    // MARK: - 卡片与扣款账户管理

    func createAccount(_ input: AccountInput) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let _: Account = try await api.send("POST", "/accounts", body: input)
        await refresh()
    }

    func updateAccount(_ account: Account, input: AccountInput) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let body = AccountUpdate(input: input, version: account.version)
        let _: Account = try await api.send("PATCH", "/accounts/\(account.id)", body: body)
        await refresh()
    }

    func archiveAccount(_ account: Account) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let _: OKResponse = try await api.send("POST", "/accounts/\(account.id)/archive", body: Optional<String>.none)
        await refresh()
    }

    func reorderAccounts(_ ids: [String]) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let updated: [Account] = try await api.send("POST", "/accounts/order", body: ReorderInput(ids: ids))
        self.accounts = updated
        saveSnapshot()
    }

    func createCard(_ input: CardInput) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let _: Card = try await api.send("POST", "/cards", body: input)
        await refresh()
    }

    func updateCard(_ card: Card, input: CardInput) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let body = CardUpdate(input: input, version: card.version)
        let _: Card = try await api.send("PATCH", "/cards/\(card.id)", body: body)
        await refresh()
    }

    func archiveCard(_ card: Card) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let _: OKResponse = try await api.send("POST", "/cards/\(card.id)/archive", body: Optional<String>.none)
        await refresh()
    }

    func reorderCards(_ ids: [String]) async throws {
        guard let api else { throw ClientError.sessionExpired }
        let updated: [Card] = try await api.send("POST", "/cards/order", body: ReorderInput(ids: ids))
        self.cards = updated
        saveSnapshot()
    }

    // MARK: - 资产抓取与下载

    struct AssetResponse: Codable {
        let id: String
        let mime: String
        let size: Int
        let source: String
        let sourceUrl: String?
    }

    func fetchAsset(from url: String) async throws -> String {
        guard let api else { throw ClientError.sessionExpired }
        let asset: AssetResponse = try await api.send("POST", "/assets/fetch", body: ["url": url])
        return asset.id
    }

    func fetchSiteIcon(domain: String) async throws -> String {
        guard let api else { throw ClientError.sessionExpired }
        let asset: AssetResponse = try await api.send("POST", "/assets/site-icon", body: ["domain": domain])
        return asset.id
    }

    // MARK: - 金融机构检索

    func searchBanks(query: String = "") async -> [BankEntry] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if let api, !isOffline {
            do {
                let results: [BankEntry] = try await api.get("/banks", query: trimmed.isEmpty ? [:] : ["q": trimmed])
                if !results.isEmpty {
                    return results
                }
            } catch {
                // 离线或服务异常时使用本地预设清单
            }
        }
        return BankEntry.searchLocal(query: trimmed)
    }

    // MARK: 草稿

    /// 先落盘再更新内存，写入失败时列表保持原样，调用方据此提示用户。
    func saveDraft(_ draft: BillDraft) throws {
        var next = drafts.filter { $0.id != draft.id }
        next.insert(draft, at: 0)
        try persistDrafts(next)
    }

    func deleteDraft(_ draft: BillDraft) throws {
        try persistDrafts(drafts.filter { $0.id != draft.id })
    }

    func submitDraft(_ draft: BillDraft) async throws {
        try await createBill(draft.input, idempotencyKey: draft.idempotencyKey)
        do {
            try deleteDraft(draft)
        } catch {
            // 账单已在服务器创建成功，不能再报“提交失败”，只提示本机草稿残留。
            alertMessage = "账单已提交，但本机草稿未能删除，请在账单页手动删除该草稿。"
        }
    }

    private func persistDrafts(_ next: [BillDraft]) throws {
        guard let scope = server?.scope else { throw ClientError.sessionExpired }
        try LocalStore.saveDrafts(next, scope: scope)
        drafts = next
    }

    static var defaultDeviceName: String { UIDevice.current.name }
}
