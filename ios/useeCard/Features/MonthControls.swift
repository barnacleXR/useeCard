import SwiftUI

/// 流动月份控制器：单手一触切换上月/下月，点击中间胶囊可一步跨年月跳转，告别 4 步弹窗阻断。
struct MonthPickerButton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let month: MonthKey
    var title = "扣款月份"
    var displayTitle: String? = nil
    var showsSteppers = true
    var showsTodayShortcut = false
    var onDarkHero = false
    var isLoading = false
    let onSelect: (MonthKey) -> Void
    @State private var showingPicker = false

    private var isCurrentMonth: Bool { month == .current() }
    private var primaryColor: Color { onDarkHero ? AppTheme.heroInk : AppTheme.ink }
    private var secondaryColor: Color { onDarkHero ? AppTheme.heroMuted : AppTheme.muted }
    private var controlFill: Color { onDarkHero ? AppTheme.heroControlFill : AppTheme.surfaceMuted }

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 0) {
                if showsSteppers {
                    stepButton(systemImage: "chevron.left", label: "上个月", delta: -1)
                }
                Button {
                    showingPicker = true
                } label: {
                    HStack(spacing: 6) {
                        if !showsSteppers {
                            Image(systemName: "calendar")
                                .font(.subheadline.weight(.medium))
                                .accessibilityHidden(true)
                        }
                        Text(displayTitle ?? month.label)
                            .font(AppTypography.groupEyebrow.monospacedDigit())
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                        if isLoading {
                            ProgressView()
                                .controlSize(.mini)
                                .tint(secondaryColor)
                                .frame(width: 10, height: 10)
                                .accessibilityLabel("正在加载")
                        } else {
                            Image(systemName: "chevron.down")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(secondaryColor)
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(.horizontal, showsSteppers ? 10 : 14)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(title)
                .accessibilityValue(displayTitle ?? month.label)
                .accessibilityHint("点按选择其他年月")

                if showsSteppers {
                    stepButton(systemImage: "chevron.right", label: "下个月", delta: 1)
                }
            }
            .foregroundStyle(primaryColor)
            .background(controlFill, in: Capsule())

            if showsTodayShortcut && !isCurrentMonth {
                Button("本月") {
                    onSelect(.current())
                }
                .buttonStyle(AppActionStyle(
                    tone: .tonal(primaryColor, controlFill),
                    compact: true,
                    horizontalPadding: 12
                ))
                .sensoryFeedback(.selection, trigger: isCurrentMonth)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.88).combined(with: .opacity))
                .accessibilityLabel("回到本月")
            }
        }
        .sensoryFeedback(.selection, trigger: month)
        .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: isCurrentMonth)
        .sheet(isPresented: $showingPicker) {
            MonthPickerSheet(title: title, month: month, onSelect: onSelect)
        }
    }

    private func stepButton(systemImage: String, label: String, delta: Int) -> some View {
        let target = month.shifted(by: delta)
        let allowed = (1...9999).contains(target.year)
        return Button {
            guard allowed else { return }
            onSelect(target)
        } label: {
            Image(systemName: systemImage)
                .font(.caption.weight(.bold))
                .frame(width: 38, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!allowed)
        .opacity(allowed ? 1 : 0.35)
        .accessibilityLabel(label)
    }
}

/// 一步直达年月网格面板：年份步进 + 3×4 月份磁贴，点选任意月份即刻生效。
private struct MonthPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let title: String
    let selectedMonth: MonthKey
    let onSelect: (MonthKey) -> Void
    @State private var displayYear: Int

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
    private let currentMonth = MonthKey.current()

    init(title: String, month: MonthKey, onSelect: @escaping (MonthKey) -> Void) {
        self.title = title
        self.selectedMonth = month
        self.onSelect = onSelect
        _displayYear = State(initialValue: month.year)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                yearHeader
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(1...12, id: \.self) { m in
                        monthTile(m)
                    }
                }
                if selectedMonth != currentMonth {
                    Button {
                        dismiss()
                        onSelect(currentMonth)
                    } label: {
                        Label("回到本月（\(currentMonth.label)）", systemImage: "arrow.uturn.backward")
                    }
                    .buttonStyle(AppActionStyle(tone: .tonal(AppTheme.accent, AppTheme.accentSurface), expands: true))
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .appPage()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    private var yearHeader: some View {
        HStack {
            Button {
                if displayYear > 1 { displayYear -= 1 }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .background(AppTheme.surface, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(displayYear <= 1)
            .accessibilityLabel("上一年")

            Spacer()

            Text("\(String(displayYear))年")
                .font(.title2.weight(.bold).monospacedDigit())
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : AppTheme.tickerSpring, value: displayYear)

            Spacer()

            Button {
                if displayYear < 9999 { displayYear += 1 }
            } label: {
                Image(systemName: "chevron.right")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .background(AppTheme.surface, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(displayYear >= 9999)
            .accessibilityLabel("下一年")
        }
        .foregroundStyle(AppTheme.ink)
        .sensoryFeedback(.selection, trigger: displayYear)
    }

    private func monthTile(_ month: Int) -> some View {
        let candidate = MonthKey(year: displayYear, month: month)
        let isSelected = candidate == selectedMonth
        let isTodayMonth = candidate == currentMonth

        return Button {
            dismiss()
            onSelect(candidate)
        } label: {
            VStack(spacing: 3) {
                Text("\(month)月")
                    .font(AppTypography.cardTitle.monospacedDigit())
                if isTodayMonth {
                    Text("本月")
                        .font(AppTypography.caption)
                        .foregroundStyle(isSelected ? AppTheme.onInk.opacity(0.76) : AppTheme.accent)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .foregroundStyle(isSelected ? AppTheme.onInk : AppTheme.ink)
            .background(
                isSelected ? AppTheme.ink : AppTheme.surface,
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay {
                if isTodayMonth && !isSelected {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(AppTheme.accent.opacity(0.55), lineWidth: 1.5)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(displayYear)年\(month)月\(isTodayMonth ? "，本月" : "")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

struct MonthLoadNotice: View {
    let state: MonthLoadState
    var onDarkHero = false
    let retry: (MonthKey) -> Void

    var body: some View {
        switch state {
        case .idle, .loading:
            EmptyView()
        case let .failed(month, message):
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    failure(month, message)
                    Spacer(minLength: 0)
                    retryButton(month)
                }
                VStack(alignment: .leading, spacing: 8) {
                    failure(month, message)
                    retryButton(month)
                }
            }
            .transition(.opacity)
        }
    }

    private func failure(_ month: MonthKey, _ message: String) -> some View {
        AppNotice(message: "未能读取\(month.label)。\(message)", systemImage: "exclamationmark.circle",
                  color: onDarkHero ? Color(red: 0.99, green: 0.78, blue: 0.35) : AppTheme.warning)
    }

    private func retryButton(_ month: MonthKey) -> some View {
        Button("重试") { retry(month) }
            .buttonStyle(AppActionStyle(
                tone: onDarkHero ? .tonal(AppTheme.heroInk, AppTheme.heroControlFill) : .subtle,
                compact: true
            ))
    }
}

struct DebitMonthHeader<Trailing: View>: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var trailing: (Bool) -> Trailing

    init(@ViewBuilder trailing: @escaping (_ isCompact: Bool) -> Trailing) {
        self.trailing = trailing
    }

    init(@ViewBuilder trailing: @escaping () -> Trailing) {
        self.trailing = { _ in trailing() }
    }

    init() where Trailing == EmptyView {
        self.trailing = { _ in EmptyView() }
    }

    private var isLoading: Bool {
        if case .loading = model.monthLoad { return true }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if Trailing.self == EmptyView.self {
                monthPicker
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 8) {
                        monthPicker
                        Spacer(minLength: 8)
                        trailing(false)
                    }
                    HStack(alignment: .center, spacing: 8) {
                        monthPicker
                        Spacer(minLength: 8)
                        trailing(true)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        monthPicker
                        trailing(false)
                    }
                }
                .animation(reduceMotion ? nil : AppTheme.snappySpring, value: model.month)
            }
            MonthLoadNotice(state: model.monthLoad, retry: select)
            SyncStatusBar()
        }
    }

    private var monthPicker: some View {
        MonthPickerButton(
            month: model.month,
            showsSteppers: true,
            showsTodayShortcut: true,
            isLoading: isLoading,
            onSelect: select
        )
    }

    private func select(_ month: MonthKey) {
        Task { await model.selectMonth(month) }
    }
}
