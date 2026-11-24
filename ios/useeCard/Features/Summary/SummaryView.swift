import SwiftUI

/// 各币种分别显示，金额摘要仅包含所选扣款月份。
struct SummaryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var editor: BillEditorView.Mode?
    @State private var paidFeedbackTrigger = 0

    private struct CurrencyTotal: Identifiable {
        let currency: String
        var amount: Int? = 0
        var count = 0
        var id: String { currency }
    }

    private var totals: [CurrencyTotal] {
        var totals: [String: CurrencyTotal] = [:]
        for account in model.summary?.accounts ?? [] {
            for group in account.byCurrency {
                var total = totals[group.currency] ?? CurrencyTotal(currency: group.currency)
                total.amount = total.amount.flatMap { try? CurrencyCatalog.add($0, group.pendingTotalMinor) }
                total.count += group.byDate.reduce(0) { $0 + $1.billCount }
                totals[group.currency] = total
            }
        }
        let codes = model.currencies.codes
        let extraCodes = totals.keys.filter { !codes.contains($0) }.sorted()
        return (codes + extraCodes).compactMap { totals[$0] }
    }

    private var overdue: [Bill] {
        let today = DateOnly.today()
        return ((model.summary?.historicalPending ?? []) + model.bills)
            .filter { $0.status == .pending && $0.dueDate < today }
    }

    private var upcoming: [Bill] {
        let today = DateOnly.today()
        return model.bills.filter { $0.status == .pending && $0.dueDate >= today }
    }

    private var isMonthLoading: Bool {
        if case .loading = model.monthLoad { return true }
        return model.isSyncing && model.summary == nil
    }

    /// 距离所选月份内最近一笔待扣款的天数提示（情境微感知）。
    private var nextDueBadge: (text: String, urgent: Bool)? {
        let today = DateOnly.today()
        guard let next = upcoming.map(\.dueDate).min() else { return nil }
        let days = today.days(until: next)
        if days == 0 { return ("今日有扣款", true) }
        if days == 1 { return ("明日扣款", true) }
        if days <= 3 { return ("\(days) 天后扣款", true) }
        return ("最近 \(next.month)月\(next.day)日", false)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Tier 0 (危机置顶)：存在逾期未确认账单时置顶警示表面
                    if !overdue.isEmpty {
                        overdueHeroSection
                            .transition(
                                reduceMotion ? .opacity : .asymmetric(
                                    insertion: .opacity.combined(with: .offset(y: -8)),
                                    removal: .opacity
                                )
                            )
                    }

                    // Tier 1 (主视觉核心)：曜石黑卡待备款总额 Hero 卡
                    overview

                    // Tier 2 (核心行动看板)：月度检查直接提拔到黑卡下方，成为第一行动入口
                    reviewEntry

                    // Tier 3 (资金调度执行)：按扣款账户备款
                    if let summary = model.summary, !summary.accounts.isEmpty {
                        accountsSection(summary.accounts)
                            .transition(
                                reduceMotion ? .opacity : .asymmetric(
                                    insertion: .opacity.combined(with: .offset(y: 8)),
                                    removal: .opacity
                                )
                            )
                    } else if model.summary != nil, model.accounts.isEmpty {
                        AppGroup {
                            AppNotice(message: "请先在 Web 管理中心添加扣款账户和信用卡。",
                                      systemImage: "building.columns")
                                .padding(16)
                        }
                        .transition(
                            reduceMotion ? .opacity : .asymmetric(
                                insertion: .opacity.combined(with: .offset(y: 8)),
                                removal: .opacity
                            )
                        )
                    }

                    // Tier 4 (明细备查)：即将扣款账单明细
                    if model.summary != nil {
                        upcomingSection
                            .transition(
                                reduceMotion ? .opacity : .asymmetric(
                                    insertion: .opacity.combined(with: .offset(y: 8)),
                                    removal: .opacity
                                )
                            )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .animation(reduceMotion ? nil : AppTheme.snappySpring, value: model.month)
                .animation(reduceMotion ? nil : AppTheme.snappySpring, value: overdue.isEmpty)
                .animation(reduceMotion ? nil : AppTheme.snappySpring, value: totals.isEmpty)
                .animation(reduceMotion ? nil : AppTheme.snappySpring, value: model.summary?.accounts.isEmpty)
            }
            .appPage()
            .refreshable { await model.refresh() }
            .navigationTitle("")
            .sheet(item: $editor) { mode in BillEditorView(mode: mode) }
            .sensoryFeedback(.success, trigger: paidFeedbackTrigger)
        }
    }

    private var overdueHeroSection: some View {
        AppGroup(fill: AppTheme.dangerSurface, shape: AppTheme.heroShape, border: AppTheme.danger.opacity(0.28)) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(AppTheme.danger)
                        .accessibilityHidden(true)
                    Text("逾期未确认")
                        .font(AppTypography.sectionHeader)
                        .foregroundStyle(AppTheme.danger)
                    Spacer()
                    ExpressivePill(
                        title: "\(overdue.count) 笔",
                        tint: AppTheme.danger,
                        fill: AppTheme.danger.opacity(0.14)
                    )
                }
                .padding(.horizontal, 18)
                .padding(.top, 16)

                ForEach(overdue) { bill in
                    if bill.id != overdue.first?.id {
                        Divider().overlay(AppTheme.danger.opacity(0.16)).padding(.horizontal, 18)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button { editor = .edit(bill) } label: {
                            BillRow(bill: bill, showsDate: true, showsStatus: false)
                        }
                        .buttonStyle(AppRowButtonStyle())

                        HStack {
                            Text("原定 \(bill.dueDate.shortLabel) 扣款")
                                .font(AppTypography.caption)
                                .foregroundStyle(AppTheme.danger)
                            Spacer()
                            Button {
                                Task {
                                    await model.perform(.paid, on: bill)
                                    paidFeedbackTrigger += 1
                                }
                            } label: {
                                Label("确认已扣款", systemImage: "checkmark")
                            }
                            .buttonStyle(AppActionStyle(
                                tone: .tonal(AppTheme.accent, AppTheme.surface),
                                compact: true,
                                horizontalPadding: 12
                            ))
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 6)
                }
            }
            .padding(.bottom, 14)
        }
    }

    /// 曜石黑卡主视觉：深邃金属黑底 + 纯白 40pt 主金额 + 清透翡翠绿录入 CTA。
    private var overview: some View {
        AppHeroCard {
            VStack(alignment: .leading, spacing: 18) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 8) {
                        monthPicker
                        Spacer(minLength: 8)
                        addBillButton(isCompact: false)
                    }
                    HStack(alignment: .center, spacing: 8) {
                        monthPicker
                        Spacer(minLength: 8)
                        addBillButton(isCompact: true)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        monthPicker
                        addBillButton(isCompact: false)
                    }
                }
                .animation(reduceMotion ? nil : AppTheme.snappySpring, value: model.month)

                MonthLoadNotice(state: model.monthLoad, onDarkHero: true, retry: selectMonth)
                SyncStatusBar()

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        AppEyebrow("待备款总额", color: AppTheme.heroMuted)
                        Spacer(minLength: 0)
                        if let badge = nextDueBadge {
                            ExpressivePill(
                                title: badge.text,
                                systemImage: badge.urgent ? "bell.badge.fill" : "calendar",
                                tint: badge.urgent ? Color(red: 0.99, green: 0.78, blue: 0.35) : AppTheme.heroInk,
                                fill: AppTheme.heroControlFill
                            )
                            .transition(reduceMotion ? .opacity : .scale(scale: 0.85).combined(with: .opacity))
                        }
                    }
                    .animation(reduceMotion ? nil : AppTheme.snappySpring, value: nextDueBadge?.text)

                    // 主金额展示：数字变动加载动画与平滑咬合落位（零布局颠簸）
                    let primaryCurrency = totals.first?.currency ?? model.defaultCurrency
                    let primaryTotal = totals.first
                    VStack(alignment: .leading, spacing: 6) {
                        TickerHeroAmountView(
                            currency: primaryCurrency,
                            amountMinor: primaryTotal?.amount,
                            isLoading: isMonthLoading,
                            catalog: model.currencies,
                            baseSize: 40,
                            color: AppTheme.heroInk
                        )

                        if isMonthLoading {
                            HStack(spacing: 6) {
                                ProgressView()
                                    .controlSize(.mini)
                                    .tint(AppTheme.heroMuted)
                                Text("正在核算待备款…")
                                    .font(AppTypography.caption)
                                    .foregroundStyle(AppTheme.heroMuted)
                            }
                            .transition(.opacity)
                        } else if let total = primaryTotal, total.count > 0 {
                            Text("\(total.count) 笔待扣款")
                                .font(AppTypography.caption)
                                .foregroundStyle(AppTheme.heroMuted)
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: total.count)
                                .transition(.opacity)
                        } else {
                            HStack(spacing: 5) {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.caption)
                                    .foregroundStyle(Color(hex: 0x22C58B))
                                Text("所选月份资金充足 · 无待备款")
                                    .font(AppTypography.caption)
                                    .foregroundStyle(AppTheme.heroMuted)
                            }
                            .transition(.opacity)
                        }
                    }
                    .animation(reduceMotion ? nil : AppTheme.snappySpring, value: isMonthLoading)

                    // 多币种次要金额展示
                    if totals.count > 1 && !isMonthLoading {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(Array(totals.dropFirst().enumerated()), id: \.element.id) { index, item in
                                Divider().overlay(AppTheme.heroDivider)
                                currencyTotal(item, isPrimary: false)
                            }
                        }
                        .transition(reduceMotion ? .opacity : .asymmetric(insertion: .opacity.combined(with: .offset(y: 6)), removal: .opacity))
                    }
                }
            }
            .padding(20)
        }
    }

    private var monthPicker: some View {
        MonthPickerButton(
            month: model.month,
            showsSteppers: true,
            showsTodayShortcut: true,
            onDarkHero: true,
            isLoading: isMonthLoading,
            onSelect: selectMonth
        )
    }

    private func selectMonth(_ month: MonthKey) {
        Task { await model.selectMonth(month) }
    }

    private func addBillButton(isCompact: Bool) -> some View {
        Button { editor = .create } label: {
            HStack(spacing: isCompact ? 0 : 5) {
                Image(systemName: "plus")
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
                if !isCompact {
                    Text("录入")
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .frame(minWidth: isCompact ? 16 : nil)
        }
        .buttonStyle(AppActionStyle(tone: .accent, horizontalPadding: 14))
        .disabled(model.activeCards.isEmpty)
        .accessibilityLabel("录入账单")
    }

    private func currencyTotal(_ item: CurrencyTotal, isPrimary: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let amount = item.amount {
                let formatted = model.currencies.format(amount, currency: item.currency)
                if isPrimary {
                    HeroAmountText(formatted: formatted, baseSize: 40, color: AppTheme.heroInk)
                } else {
                    StructuredAmountText(
                        formatted: formatted,
                        numberFont: AppTypography.sectionAmount,
                        currencyFont: AppTypography.groupEyebrow,
                        color: AppTheme.heroInk
                    )
                }
            } else {
                AppNotice(message: "\(item.currency) 合计超出可显示范围",
                          systemImage: "exclamationmark.circle", color: Color(red: 0.99, green: 0.78, blue: 0.35))
            }
            Text("\(item.count) 笔待扣款")
                .font(AppTypography.caption)
                .foregroundStyle(AppTheme.heroMuted)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: item.count)
        }
        .accessibilityElement(children: .combine)
    }

    private func accountsSection(_ accounts: [FundingSummary.AccountGroup]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            AppSectionTitle("")
            ForEach(accounts) { account in
                AppGroup {
                    HStack(spacing: 12) {
                        EntityIcon(name: account.accountName, assetId: model.account(account.accountId)?.iconAssetId, size: 38)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.accountName)
                                .font(AppTypography.cardTitle)
                            let totalBills = account.byCurrency.flatMap(\.byDate).reduce(0) { $0 + $1.billCount }
                            Text("\(totalBills) 笔待扣款")
                                .font(AppTypography.caption)
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .padding(16)

                    ForEach(account.byCurrency, id: \.currency) { group in
                        AppDivider()
                        VStack(alignment: .leading, spacing: 12) {
                            StructuredAmountText(
                                formatted: model.currencies.format(group.pendingTotalMinor, currency: group.currency),
                                numberFont: AppTypography.sectionAmount,
                                currencyFont: AppTypography.groupEyebrow,
                                color: AppTheme.ink
                            )
                            VStack(spacing: 8) {
                                ForEach(group.byDate, id: \.dueDate) { day in
                                    let layout = typeSize.isAccessibilitySize
                                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
                                    layout {
                                        Text("\(day.dueDate.shortLabel) · \(day.billCount) 笔")
                                            .font(AppTypography.supporting)
                                            .foregroundStyle(AppTheme.muted)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        StructuredAmountText(
                                            formatted: model.currencies.format(day.amountMinor, currency: group.currency),
                                            numberFont: AppTypography.groupEyebrow.monospacedDigit(),
                                            currencyFont: AppTypography.caption,
                                            color: AppTheme.ink
                                        )
                                        .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil, alignment: .trailing)
                                    }
                                    .accessibilityElement(children: .combine)
                                }
                            }
                        }
                        .padding(16)
                    }
                }
                .foregroundStyle(AppTheme.ink)
            }
        }
    }

    private var upcomingSection: some View {
        let today = DateOnly.today()
        return VStack(alignment: .leading, spacing: 12) {
            AppSectionTitle("即将扣款")
            Group {
                if upcoming.isEmpty {
                    AppGroup {
                        AppNotice(message: "所选月份没有即将扣款的已录入账单。", systemImage: "calendar")
                            .padding(16)
                    }
                    .transition(
                        reduceMotion ? .opacity : .asymmetric(
                            insertion: .opacity.combined(with: .offset(y: 8)),
                            removal: .opacity
                        )
                    )
                } else {
                    VStack(spacing: 12) {
                        ForEach(BillDayGroup.groups(for: upcoming)) { day in
                            let daysLeft = today.days(until: day.id)
                            AppGroup {
                                HStack(spacing: 8) {
                                    AppEyebrow(day.id.shortLabel, color: AppTheme.ink)
                                    Spacer()
                                    if daysLeft == 0 {
                                        ExpressivePill(title: "今天", tint: AppTheme.warning, fill: AppTheme.warningSurface)
                                    } else if daysLeft == 1 {
                                        ExpressivePill(title: "明天", tint: AppTheme.warning, fill: AppTheme.warningSurface)
                                    } else if daysLeft > 1 && daysLeft <= 7 {
                                        ExpressivePill(title: "\(daysLeft) 天后", tint: AppTheme.muted, fill: AppTheme.surfaceMuted)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                                .padding(.bottom, 6)

                                ForEach(day.bills) { bill in
                                    if bill.id != day.bills.first?.id { AppDivider() }
                                    Button { editor = .edit(bill) } label: {
                                        BillRow(bill: bill, showsDate: false)
                                            .padding(.horizontal, 16)
                                            .padding(.vertical, 4)
                                    }
                                    .buttonStyle(AppRowButtonStyle())
                                }
                            }
                        }
                    }
                    .transition(
                        reduceMotion ? .opacity : .asymmetric(
                            insertion: .opacity.combined(with: .offset(y: 8)),
                            removal: .opacity
                        )
                    )
                }
            }
        }
        .animation(reduceMotion ? nil : AppTheme.snappySpring, value: upcoming.map(\.id))
    }

    private var reviewEntry: some View {
        let total = model.reviews.count
        let done = model.reviews.filter { $0.status != .unreviewed }.count
        let outstanding = total - done
        let isComplete = total > 0 && outstanding == 0

        return AppGroup(
            fill: AppTheme.surfaceElevated,
            shape: AppTheme.groupShape,
            border: outstanding > 0 ? AppTheme.accent.opacity(0.35) : AppTheme.surfaceBorder
        ) {
            NavigationLink { ReviewsView() } label: {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(isComplete ? AppTheme.accentSurface : AppTheme.surfaceMuted)
                            Image(systemName: isComplete ? "checkmark.circle.fill" : "checklist")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(isComplete ? AppTheme.accent : AppTheme.ink)
                        }
                        .frame(width: 40, height: 40)
                        .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text("月度检查")
                                    .font(AppTypography.cardTitle)
                                    .foregroundStyle(AppTheme.ink)
                                if isComplete {
                                    Image(systemName: "checkmark.seal.fill")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.accent)
                                }
                            }
                            Text(reviewDescription)
                                .font(AppTypography.supporting)
                                .foregroundStyle(AppTheme.muted)
                        }

                        Spacer(minLength: 8)

                        if outstanding > 0 {
                            ExpressivePill(
                                title: "待确认 \(outstanding)",
                                systemImage: "sparkles",
                                tint: AppTheme.accent,
                                fill: AppTheme.accentSurface
                            )
                        } else if isComplete {
                            ExpressivePill(
                                title: "已对齐",
                                tint: AppTheme.accent,
                                fill: AppTheme.accentSurface
                            )
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.muted)
                            .accessibilityHidden(true)
                    }

                    if total > 0 {
                        VStack(alignment: .leading, spacing: 6) {
                            ProgressView(value: Double(done), total: Double(total))
                                .tint(AppTheme.accent)
                                .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: done)
                                .accessibilityHidden(true)

                            HStack {
                                Text("\(model.reviewMonth.label) 对账进度")
                                    .font(AppTypography.caption)
                                    .foregroundStyle(AppTheme.muted)
                                Spacer()
                                Text("\(done) / \(total) 张卡已确认")
                                    .font(AppTypography.caption.weight(.medium).monospacedDigit())
                                    .foregroundStyle(AppTheme.ink)
                                    .contentTransition(.numericText())
                            }
                        }
                    }
                }
                .padding(16)
            }
            .buttonStyle(AppRowButtonStyle())
        }
    }

    private var reviewDescription: String {
        let period = model.reviewMonth.label
        if !model.hasReviewData { return "\(period) · 尚未读取检查清单" }
        if model.reviews.isEmpty { return "\(period) · 尚未开始" }
        let outstanding = model.reviews.filter { $0.status == .unreviewed }.count
        if outstanding == 0 { return "\(period) · 已全部核对完成" }
        return "\(period) · \(outstanding) 张卡尚未确认"
    }
}

/// 模拟点钞机翻滚的科技感大号金额加载动效：
/// 在数据加载阶段快速轮播翻滚数字，数据到达后平滑咬合减速落位，消除突兀文字菊花与布局抖动。
struct TickerHeroAmountView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let currency: String
    let amountMinor: Int?
    let isLoading: Bool
    let catalog: CurrencyCatalog
    var baseSize: CGFloat = 40
    var color: Color = AppTheme.heroInk
    @ScaledMetric(relativeTo: .largeTitle) private var scale: CGFloat = 1

    @State private var tickerNumber: String = "0"
    @State private var timerTask: Task<Void, Never>?

    private var targetFormatted: String {
        let amount = amountMinor ?? 0
        return catalog.format(amount, currency: currency)
    }

    private var split: (prefix: String?, number: String) {
        let parts = targetFormatted.split(separator: " ", maxSplits: 1)
        if parts.count == 2 {
            return (String(parts[0]), String(parts[1]))
        }
        return (nil, targetFormatted)
    }

    var body: some View {
        let parts = split
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let prefix = parts.prefix {
                Text(prefix)
                    .font(.system(size: min(baseSize * 0.48 * scale, 28), weight: .semibold, design: .rounded))
                    .foregroundStyle(color.opacity(0.60))
            }
            Text(isLoading && !reduceMotion ? tickerNumber : parts.number)
                .font(.system(size: min(baseSize * scale, 56), weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(color)
                .minimumScaleFactor(0.68)
                .lineLimit(1)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: isLoading ? tickerNumber : parts.number)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(targetFormatted)
        .onAppear {
            tickerNumber = parts.number
            syncTicker(loading: isLoading)
        }
        .onDisappear {
            timerTask?.cancel()
        }
        .onChange(of: isLoading) { _, loading in
            syncTicker(loading: loading)
        }
        .onChange(of: parts.number) { _, newNum in
            if !isLoading {
                tickerNumber = newNum
            }
        }
    }

    private func syncTicker(loading: Bool) {
        timerTask?.cancel()
        if loading && !reduceMotion {
            timerTask = Task { @MainActor in
                let candidates = ["1,850", "3,420", "6,800", "12,450", "28,600", "5,120", "9,360"]
                var index = 0
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 75_000_000)
                    guard !Task.isCancelled else { break }
                    tickerNumber = candidates[index % candidates.count]
                    index += 1
                }
            }
        } else {
            tickerNumber = split.number
        }
    }
}
