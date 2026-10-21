import SwiftUI

/// 紧凑月历：只占上方一部分，下方留给所选日期的账单明细。
struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var selected: DateOnly?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
    private var activeBills: [Bill] { model.bills.filter { $0.status != .void } }
    /// 周一为一周第一天。
    private var cells: [DateOnly?] {
        let days = model.month.days
        guard let first = days.first else { return [] }
        return Array(repeating: nil, count: (first.weekday + 6) % 7) + days.map { Optional($0) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LazyVGrid(columns: columns, spacing: 4) {
                        ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { Text($0).font(.caption2).foregroundStyle(.secondary) }
                        ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                            if let day { dayCell(day) } else { Color.clear.frame(height: 36) }
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    if let selected {
                        let items = activeBills.filter { $0.dueDate == selected }
                        if items.isEmpty { Text("这一天没有账单。").foregroundStyle(.secondary) }
                        ForEach(items) { BillRow(bill: $0) }
                    } else {
                        Text("选择日期查看明细").foregroundStyle(.secondary)
                    }
                } header: {
                    Text(selected?.shortLabel ?? model.month.label)
                }
            }
            .refreshable { await model.refresh() }
            .navigationTitle("扣款日历")
            .safeAreaInset(edge: .bottom) { MonthSwitcher().padding(.bottom, 8) }
            .onChange(of: model.month) { _, _ in selected = nil }
        }
    }

    private func dayCell(_ day: DateOnly) -> some View {
        let count = activeBills.filter { $0.dueDate == day }.count
        let isSelected = selected == day
        return Button { selected = day } label: {
            VStack(spacing: 2) {
                Text("\(day.day)").font(.subheadline.weight(day == .today() ? .bold : .regular).monospacedDigit())
                Circle().fill(count > 0 ? Color.accentColor : .clear).frame(width: 5, height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(isSelected ? Color.accentColor.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(day.shortLabel)\(count > 0 ? "，\(count) 笔账单" : "")")
    }
}

/// 月报：只按实际扣款月份统计，各币种分别列出。
struct ReportView: View {
    @Environment(AppModel.self) private var model
    @State var month: MonthKey
    @State private var report: MonthlyReport?
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if let report {
                if report.byCurrency.isEmpty { Text("这个月没有有效账单。").foregroundStyle(.secondary) }
                ForEach(report.byCurrency) { group in
                    Section("\(group.currency) · \(group.billCount) 笔") {
                        LabeledContent("合计", value: model.currencies.format(group.totalMinor, currency: group.currency)).font(.headline)
                        LabeledContent("待确认扣款", value: model.currencies.format(group.pendingMinor, currency: group.currency))
                        LabeledContent("已确认扣款", value: model.currencies.format(group.paidMinor, currency: group.currency))
                    }
                }
                if !report.bills.isEmpty {
                    Section("明细") { ForEach(report.bills) { BillRow(bill: $0) } }
                }
            } else if error == nil {
                ProgressView()
            }
        }
        .navigationTitle("\(month.label) 月报")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { month = month.shifted(by: -1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("上个月")
                Button { month = month.shifted(by: 1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel("下个月")
            }
        }
        .task(id: month) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        error = nil
        do { report = try await model.monthlyReport(month) } catch { self.error = error.localizedDescription }
    }
}
