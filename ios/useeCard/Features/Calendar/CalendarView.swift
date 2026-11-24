import SwiftUI

/// 日历和汇总共享实际扣款月份，日期热力展示资金密度，支持点选日期直达明细与编辑。
struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selected: DateOnly?
    @State private var editingBill: Bill?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

    private var billsByDay: [DateOnly: [Bill]] {
        Dictionary(grouping: model.bills.filter { $0.status != .void }, by: \.dueDate)
    }

    private var cells: [DateOnly?] {
        let days = model.month.days
        guard let first = days.first else { return [] }
        return Array(repeating: nil, count: (first.weekday + 6) % 7) + days.map { Optional($0) }
    }

    private var activeDay: DateOnly? {
        if let selected, selected.monthKey == model.month { return selected }
        return defaultSelectedDay()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    DebitMonthHeader()
                    calendar
                    selectedDaySection
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .appPage()
            .refreshable { await model.refresh() }
            .navigationTitle("")
            .onAppear {
                if selected == nil { selected = defaultSelectedDay() }
            }
            .onChange(of: model.month) { _, _ in
                withAnimation(reduceMotion ? nil : AppTheme.snappySpring) {
                    selected = defaultSelectedDay()
                }
            }
            .onChange(of: model.bills) { _, _ in
                if selected == nil {
                    withAnimation(reduceMotion ? nil : AppTheme.snappySpring) {
                        selected = defaultSelectedDay()
                    }
                }
            }
            .sheet(item: $editingBill) { bill in
                BillEditorView(mode: .edit(bill))
            }
            .sensoryFeedback(.selection, trigger: activeDay)
        }
    }

    /// 优先选中本月“今天”，否则自动定位到本月第一个有账单的日期，避免初始空白。
    private func defaultSelectedDay() -> DateOnly? {
        let today = DateOnly.today()
        if today.monthKey == model.month {
            return today
        }
        return billsByDay.keys.sorted().first ?? model.month.firstDay
    }

    private var calendar: some View {
        let dailyBills = billsByDay
        let peakCount = dailyBills.values.map(\.count).max() ?? 1

        return AppGroup(shape: AppTheme.heroShape) {
            VStack(spacing: 10) {
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { weekday in
                        Text(weekday)
                            .font(AppTypography.badge)
                            .foregroundStyle(AppTheme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                            .accessibilityHidden(true)
                    }
                    ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                        if let day = cell {
                            dayCell(day, bills: dailyBills[day] ?? [], peakCount: peakCount)
                        } else {
                            Color.clear.frame(height: 52).accessibilityHidden(true)
                        }
                    }
                }

                // 轻量图例，帮助识别资金热力与状态
                HStack(spacing: 14) {
                    legendItem(color: AppTheme.warning, text: "待扣款")
                    legendItem(color: AppTheme.success, text: "已结清")
                    Spacer()
                    let activeDaysCount = dailyBills.count
                    if activeDaysCount > 0 {
                        Text("本月 \(activeDaysCount) 个扣款日")
                            .font(AppTypography.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 4)
            }
            .padding(12)
        }
    }

    private func legendItem(color: Color, text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(text).font(AppTypography.caption).foregroundStyle(AppTheme.muted)
        }
        .accessibilityHidden(true)
    }

    private var selectedDaySection: some View {
        let currentDay = activeDay
        let dayBills = currentDay.flatMap { billsByDay[$0] } ?? []

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                AppSectionTitle(currentDay?.shortLabel ?? "当日明细")
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : AppTheme.snappySpring, value: currentDay)
                Spacer()
                if !dayBills.isEmpty {
                    ExpressivePill(title: "\(dayBills.count) 笔", tint: AppTheme.ink, fill: AppTheme.surfaceMuted)
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.85).combined(with: .opacity))
                }
            }

            Group {
                if !dayBills.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        // 当日分币种小计条
                        let dayTotals = dayCurrencyTotals(dayBills)
                        if !dayTotals.isEmpty {
                            ScrollView(.horizontal) {
                                HStack(spacing: 8) {
                                    ForEach(dayTotals, id: \.currency) { item in
                                        StructuredAmountText(
                                            formatted: model.currencies.format(item.amount, currency: item.currency),
                                            numberFont: AppTypography.rowAmount,
                                            currencyFont: AppTypography.badge,
                                            color: AppTheme.ink
                                        )
                                        .padding(.horizontal, 13)
                                        .padding(.vertical, 8)
                                        .background(AppTheme.surface, in: Capsule())
                                        .overlay { Capsule().strokeBorder(AppTheme.divider, lineWidth: 1) }
                                    }
                                }
                            }
                            .scrollIndicators(.hidden)
                        }

                        AppGroup {
                            ForEach(dayBills) { bill in
                                if bill.id != dayBills.first?.id { AppDivider() }
                                Button { editingBill = bill } label: {
                                    BillRow(bill: bill, showsDate: false)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 4)
                                }
                                .buttonStyle(AppRowButtonStyle())
                            }
                        }
                    }
                    .transition(
                        reduceMotion ? .opacity : .asymmetric(
                            insertion: .opacity.combined(with: .offset(y: 8)),
                            removal: .opacity
                        )
                    )
                } else if model.summary == nil {
                    AppGroup {
                        AppNotice(message: "尚未读取该月账单。", systemImage: "info.circle")
                            .padding(16)
                    }
                    .transition(
                        reduceMotion ? .opacity : .asymmetric(
                            insertion: .opacity.combined(with: .offset(y: 8)),
                            removal: .opacity
                        )
                    )
                } else {
                    AppGroup {
                        AppNotice(message: "这一天没有已录入的有效账单。", systemImage: "tray")
                            .padding(16)
                    }
                    .transition(
                        reduceMotion ? .opacity : .asymmetric(
                            insertion: .opacity.combined(with: .offset(y: 8)),
                            removal: .opacity
                        )
                    )
                }
            }
            .id(currentDay)
        }
        .animation(reduceMotion ? nil : AppTheme.snappySpring, value: activeDay)
    }

    private func dayCurrencyTotals(_ bills: [Bill]) -> [(currency: String, amount: Int)] {
        var totals: [String: Int] = [:]
        for bill in bills {
            totals[bill.currency] = (try? CurrencyCatalog.add(totals[bill.currency] ?? 0, bill.amountMinor)) ?? totals[bill.currency] ?? 0
        }
        return model.currencies.codes.compactMap { code in
            totals[code].map { (code, $0) }
        }
    }

    private func dayCell(_ day: DateOnly, bills: [Bill], peakCount: Int) -> some View {
        let isSelected = activeDay == day
        let isToday = day == .today()
        let count = bills.count
        let pendingCount = bills.filter { $0.status == .pending }.count
        let hasPending = pendingCount > 0
        let isHeavyDay = count >= 2 || (peakCount >= 2 && count == peakCount && count > 0)

        let cellBackground: Color = {
            if isSelected { return AppTheme.ink }
            if hasPending { return isHeavyDay ? AppTheme.warning.opacity(0.18) : AppTheme.warningSurface }
            if count > 0 { return AppTheme.successSurface }
            if isToday { return AppTheme.surfaceMuted }
            return .clear
        }()

        let indicatorColor: Color = {
            if isSelected { return AppTheme.onInk }
            return hasPending ? AppTheme.warning : AppTheme.success
        }()

        return Button {
            withAnimation(reduceMotion ? nil : AppTheme.snappySpring) {
                selected = day
            }
        } label: {
            VStack(spacing: 4) {
                Text("\(day.day)")
                    .font(.system(.subheadline, design: .rounded, weight: isSelected || isToday || count > 0 ? .bold : .regular).monospacedDigit())
                    .lineLimit(1)

                if count == 0 {
                    Color.clear.frame(height: 12)
                } else if count == 1 {
                    Circle()
                        .fill(indicatorColor)
                        .frame(width: 6, height: 6)
                        .frame(height: 12)
                        .accessibilityHidden(true)
                } else {
                    // 多笔高峰日以紧凑笔数胶囊可视化，一眼识别资金峰值
                    Text("\(count)笔")
                        .font(.system(size: 10, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(isSelected ? AppTheme.ink : indicatorColor)
                        .padding(.horizontal, 5)
                        .frame(height: 14)
                        .background(
                            isSelected ? AppTheme.onInk.opacity(0.9) : indicatorColor.opacity(0.16),
                            in: Capsule()
                        )
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(isSelected ? AppTheme.onInk : AppTheme.ink)
            .background(cellBackground, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay {
                if isToday && !isSelected {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(AppTheme.ink.opacity(0.35), lineWidth: 1.5)
                }
            }
            .contentShape(Rectangle())
            .animation(reduceMotion ? nil : AppTheme.snappySpring, value: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(day.shortLabel)\(isToday ? "，今天" : "")，\(count) 笔账单\(pendingCount > 0 ? "，\(pendingCount) 笔待扣款" : "")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// 月报独立浏览，保留最近一次成功读取的报表，直到新月份读取完成。
struct ReportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State var month: MonthKey
    @State private var report: MonthlyReport?
    @State private var loadState: MonthLoadState = .idle
    @State private var request = UUID()

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    MonthPickerButton(
                        month: month,
                        title: "月报月份",
                        showsSteppers: true,
                        showsTodayShortcut: true,
                        onSelect: select
                    )
                    MonthLoadNotice(state: loadState, retry: select)
                }
                .padding(.vertical, 6)
                .appListRow()
            }
            if let report {
                if report.byCurrency.isEmpty {
                    Section {
                        AppNotice(message: "所选月份没有有效账单。", systemImage: "tray").appListRow()
                    }
                }
                ForEach(report.byCurrency) { group in
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                AppEyebrow("月度合计")
                                Spacer()
                                ExpressivePill(title: "\(group.billCount) 笔", tint: AppTheme.ink, fill: AppTheme.surfaceMuted)
                            }
                            HeroAmountText(
                                formatted: model.currencies.format(group.totalMinor, currency: group.currency),
                                baseSize: 34,
                                color: AppTheme.ink
                            )
                            if group.totalMinor > 0 {
                                progressBar(paid: group.paidMinor, total: group.totalMinor)
                                    .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: group.paidMinor)
                            }
                        }
                        .padding(.vertical, 8)
                        .appListRow()

                        amountRow("待确认扣款", group.pendingMinor, group.currency, tint: AppTheme.warning).appListRow()
                        amountRow("已确认扣款", group.paidMinor, group.currency, tint: AppTheme.success).appListRow()
                    } header: {
                        AppSectionTitle(group.currency)
                    }
                }
                ForEach(BillDayGroup.groups(for: report.bills)) { day in
                    Section {
                        ForEach(day.bills) { BillRow(bill: $0, showsDate: false).appListRow() }
                    } header: {
                        AppEyebrow(day.id.shortLabel, color: AppTheme.ink)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .appPage()
        .navigationTitle("月报")
        .task {
            if report == nil, loadState == .idle { await load(month) }
        }
        .refreshable { await load(month) }
    }

    private func progressBar(paid: Int, total: Int) -> some View {
        let ratio = min(max(Double(paid) / Double(max(total, 1)), 0), 1)
        let percent = Int((ratio * 100).rounded())
        return VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.warningSurface)
                    Capsule()
                        .fill(AppTheme.success)
                        .frame(width: proxy.size.width * ratio)
                }
            }
            .frame(height: 8)
            Text("已确认扣款 \(percent)%")
                .font(AppTypography.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .accessibilityElement(children: .combine)
    }

    private func amountRow(_ title: String, _ amount: Int, _ currency: String, tint: Color) -> some View {
        let value = model.currencies.format(amount, currency: currency)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    Circle().fill(tint).frame(width: 7, height: 7).accessibilityHidden(true)
                    Text(title).font(AppTypography.rowTitle).fixedSize()
                }
                Spacer()
                StructuredAmountText(formatted: value, numberFont: AppTypography.rowAmount, currencyFont: AppTypography.badge, color: AppTheme.ink)
                    .fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Circle().fill(tint).frame(width: 7, height: 7).accessibilityHidden(true)
                    Text(title).font(AppTypography.rowTitle)
                }
                StructuredAmountText(formatted: value, numberFont: AppTypography.rowAmount, currencyFont: AppTypography.badge, color: AppTheme.ink)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func select(_ month: MonthKey) {
        Task { await load(month) }
    }

    private func load(_ requested: MonthKey) async {
        let id = UUID()
        request = id
        loadState = .loading(requested)
        do {
            let fresh = try await model.monthlyReport(requested)
            guard request == id else { return }
            guard !Task.isCancelled else {
                loadState = .idle
                return
            }
            guard fresh.dueMonth == requested else {
                loadState = .failed(requested, "服务器返回的月报月份与请求不一致。")
                return
            }
            month = requested
            report = fresh
            loadState = .idle
        } catch {
            guard request == id else { return }
            loadState = Task.isCancelled ? .idle : .failed(requested, error.localizedDescription)
        }
    }
}
