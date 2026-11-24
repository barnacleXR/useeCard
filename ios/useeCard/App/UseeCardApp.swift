import SwiftUI

@main
struct UseeCardApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .appDynamicTypeSize(model.effectiveDynamicTypeSize)
                .tint(AppTheme.accent)
                .preferredColorScheme(.dark)
                .task { await model.bootstrap() }
                // 回到前台时同步一次；不承诺后台实时同步。
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active, model.phase == .ready { Task { await model.refresh() } }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            switch model.phase {
            case .launching:
                ProgressView("正在连接…")
                    .transition(.opacity)
            case .onboarding:
                ConnectServerView()
                    .transition(reduceMotion ? .opacity : .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.96)), removal: .opacity))
            case .ready:
                MainTabView()
                    .transition(reduceMotion ? .opacity : .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.98)), removal: .opacity))
            }
        }
        .animation(reduceMotion ? nil : AppTheme.expressiveSpring, value: model.phase)
        .background(AppTheme.canvas.ignoresSafeArea())
        .appDynamicTypeSize(model.effectiveDynamicTypeSize)
        .alert("提示", isPresented: Binding(get: { model.alertMessage != nil }, set: { if !$0 { model.alertMessage = nil } })) {
            Button("好", role: .cancel) {}
        } message: {
            Text(model.alertMessage ?? "")
        }
    }
}

enum AppTab: String, Hashable, CaseIterable {
    case summary, bills, cards, calendar, profile

    var title: String {
        switch self {
        case .summary: return "汇总"
        case .bills: return "账单"
        case .cards: return "卡包"
        case .calendar: return "日历"
        case .profile: return "我的"
        }
    }
}

/// 五个入口：汇总、账单、卡包、日历、我的。系统 TabView 自带 Liquid Glass 标签栏。
struct MainTabView: View {
    @State private var tab: AppTab = .summary

    var body: some View {
        TabView(selection: $tab) {
            Tab(value: AppTab.summary) {
                SummaryView()
            } label: {
                tabLabel(AppTab.summary.title, .summary)
            }

            Tab(value: AppTab.bills) {
                BillsView()
            } label: {
                tabLabel(AppTab.bills.title, .bills)
            }

            Tab(value: AppTab.cards) {
                NavigationStack {
                    ManageCardsAndAccountsView()
                }
            } label: {
                tabLabel(AppTab.cards.title, .cards)
            }

            Tab(value: AppTab.calendar) {
                CalendarView()
            } label: {
                tabLabel(AppTab.calendar.title, .calendar)
            }

            Tab(value: AppTab.profile) {
                SettingsView()
            } label: {
                tabLabel(AppTab.profile.title, .profile)
            }
        }
        // 标签栏始终完整显示，滚动时不收起。
        .tabBarMinimizeBehavior(.never)
        .sensoryFeedback(.selection, trigger: tab)
    }

    private func tabLabel(_ title: String, _ item: AppTab) -> some View {
        Label {
            Text(title)
        } icon: {
            Image("tab-\(item.rawValue)\(tab == item ? "-selected" : "")")
                .renderingMode(.original)
        }
    }
}
