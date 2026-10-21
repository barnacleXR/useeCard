import SwiftUI

@main
struct UseeCardApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
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

    var body: some View {
        Group {
            switch model.phase {
            case .launching: ProgressView("正在连接…")
            case .onboarding: ConnectServerView()
            case .ready: MainTabView()
            }
        }
        .alert("提示", isPresented: Binding(get: { model.alertMessage != nil }, set: { if !$0 { model.alertMessage = nil } })) {
            Button("好", role: .cancel) {}
        } message: {
            Text(model.alertMessage ?? "")
        }
    }
}

enum AppTab: Hashable { case summary, bills, calendar }

/// 三个入口：汇总、账单、日历。系统 TabView 在 iOS 26 上自带 Liquid Glass 标签栏。
struct MainTabView: View {
    @State private var tab: AppTab = .summary

    var body: some View {
        TabView(selection: $tab) {
            Tab("汇总", systemImage: "yensign.circle", value: AppTab.summary) { SummaryView() }
            Tab("账单", systemImage: "list.bullet.rectangle", value: AppTab.bills) { BillsView() }
            Tab("日历", systemImage: "calendar", value: AppTab.calendar) { CalendarView() }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}
