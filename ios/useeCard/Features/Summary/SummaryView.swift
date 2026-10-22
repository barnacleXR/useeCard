import SwiftUI

/// 汇总：知道哪天、哪个账户需要准备多少钱。各币种分别显示，从不跨币种相加。
struct SummaryView: View {
    @Environment(AppModel.self) private var model
    @State private var showEditor = false

    private var today: DateOnly { .today() }

    struct CurrencyTotal: Identifiable { let currency: String; let amount: Int; let count: Int; var id: String { currency } }

    private var totals: [CurrencyTotal] {
        var amounts: [String: Int] = [:]
        var counts: [String: Int] = [:]
        for account in model.summary?.accounts ?? [] {
            for group in account.byCurrency {
                let current = amounts[group.currency] ?? 0
                amounts[group.currency] = (try? CurrencyCatalog.add(current, group.pendingTotalMinor)) ?? current
                counts[group.currency, default: 0] += group.byDate.reduce(0) { $0 + $1.billCount }
            }
        }
        return model.currencies.codes.compactMap { code in
            amounts[code].map { CurrencyTotal(currency: code, amount: $0, count: counts[code] ?? 0) }
        }
    }

    private var overdue: [Bill] {
        ((model.summary?.historicalPending ?? []) + model.bills.filter { $0.status == .pending && $0.dueDate < today }).sorted { $0.dueDate < $1.dueDate }
    }

    private var upcoming: [Bill] {
        model.bills.filter { $0.status == .pending && $0.dueDate >= today }.sorted { $0.dueDate < $1.dueDate }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    SyncStatusBar()
                    if model.accounts.isEmpty {
                        ContentUnavailableView("还没有扣款账户", systemImage: "building.columns", description: Text("请先在 Web 管理中心添加银行账户和信用卡。"))
                    } else {
                        totalsSection
                        if !overdue.isEmpty { tiles("已过期待确认", overdue, overdue: true) }
                        tiles("即将扣款", upcoming, overdue: false)
                        accountsSection
                        reviewBanner
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 80)
            }
            .refreshable { await model.refresh() }
            .navigationTitle("备款汇总")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink { SettingsView() } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    NavigationLink { ReportView(month: model.month) } label: { Image(systemName: "chart.bar.doc.horizontal") }.accessibilityLabel("月报")
                    Button { showEditor = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("录入账单").disabled(model.activeCards.isEmpty)
                }
            }
            .safeAreaInset(edge: .bottom) { MonthSwitcher().padding(.bottom, 8) }
            .sheet(isPresented: $showEditor) { BillEditorView(mode: .create) }
        }
    }

    private var totalsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if totals.isEmpty {
                StatCard(title: "\(model.month.label) 待备款", value: "—", caption: "还没有已录入的待还账单")
            }
            ForEach(totals) { item in
                StatCard(title: "\(model.month.label) 待备款 · \(item.currency)", value: model.currencies.format(item.amount, currency: item.currency), caption: "已录入 \(item.count) 笔")
            }
        }
    }

    private func tiles(_ title: String, _ bills: [Bill], overdue: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title, tint: overdue ? .red : .secondary)
            if bills.isEmpty {
                Text("所选月份没有今天之后的待扣款账单。").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(bills) { bill in BillTile(bill: bill, overdue: overdue) }
                    }
                }
            }
        }
    }

    private var accountsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("按扣款账户备款")
            if model.summary?.accounts.isEmpty ?? true {
                Text("这个月还没有已录入的待还账单。这不代表已经检查全部卡片。").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(model.summary?.accounts ?? []) { group in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        EntityIcon(name: group.accountName, assetId: model.account(group.accountId)?.iconAssetId)
                        Text(group.accountName).font(.headline)
                    }
                    ForEach(group.byCurrency, id: \.currency) { currency in
                        Text(model.currencies.format(currency.pendingTotalMinor, currency: currency.currency)).font(.title2.bold().monospacedDigit())
                        ForEach(currency.byDate, id: \.dueDate) { day in
                            HStack {
                                Text(day.dueDate.shortLabel)
                                Text("· \(day.billCount) 笔").foregroundStyle(.secondary)
                                Spacer()
                                Text(model.currencies.format(day.amountMinor, currency: currency.currency)).monospacedDigit()
                            }
                            .font(.subheadline)
                        }
                    }
                }
                .padding()
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private var reviewBanner: some View {
        NavigationLink { ReviewsView() } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(model.reviewMonth.label) 月度检查").font(.headline)
                    Text(model.reviews.isEmpty ? "尚未开始，不会自动推断为零账单" : "\(model.reviews.filter { $0.status == .unreviewed }.count) 张卡尚未确认")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding()
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let caption: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title.bold().monospacedDigit()).minimumScaleFactor(0.6).lineLimit(1)
            Text(caption).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct SectionTitle: View {
    let text: String
    var tint: Color = .secondary
    init(_ text: String, tint: Color = .secondary) { self.text = text; self.tint = tint }
    var body: some View {
        Text(text).font(.caption.weight(.semibold)).textCase(.uppercase).tracking(1).foregroundStyle(tint)
    }
}

/// 横向小卡片：图标在上，日期与金额在下。
struct BillTile: View {
    @Environment(AppModel.self) private var model
    let bill: Bill
    let overdue: Bool
    var body: some View {
        let card = model.card(bill.cardId)
        VStack(alignment: .leading) {
            CardFace(card: card, fallbackName: bill.cardName, width: 56)
            Spacer()
            Text(bill.dueDate.shortLabel).font(.caption2).foregroundStyle(.secondary)
            Text(dueLabel).font(.caption2).foregroundStyle(overdue ? .red : .secondary)
            Text(model.currencies.format(bill.amountMinor, currency: bill.currency)).font(.subheadline.bold().monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(12)
        .frame(width: 140, height: 124, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
        .overlay { if overdue { RoundedRectangle(cornerRadius: 16).stroke(.red.opacity(0.35)) } }
        .accessibilityElement(children: .combine)
    }
    private var dueLabel: String {
        let days = DateOnly.today().days(until: bill.dueDate)
        return days == 0 ? "今天" : days == 1 ? "明天" : days < 0 ? "已过 \(-days) 天" : "\(days) 天后"
    }
}

/// 浮动的月份切换器：自定义浮动控件使用 Liquid Glass，多个玻璃元素放进同一容器。
/// plain 按钮只有可见像素可点，用 contentShape 让整个圆形都能点击。
struct MonthSwitcher: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                Button { Task { await model.changeMonth(by: -1) } } label: { Image(systemName: "chevron.left").frame(width: 36, height: 36).contentShape(Circle()) }
                    .glassEffect(.regular.interactive(), in: Circle())
                    .accessibilityLabel("上个月")
                Text(model.month.label).font(.subheadline.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, 16).frame(height: 36)
                    .glassEffect(.regular, in: Capsule())
                Button { Task { await model.changeMonth(by: 1) } } label: { Image(systemName: "chevron.right").frame(width: 36, height: 36).contentShape(Circle()) }
                    .glassEffect(.regular.interactive(), in: Circle())
                    .accessibilityLabel("下个月")
            }
        }
        .buttonStyle(.plain)
    }
}
