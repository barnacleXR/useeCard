import SwiftUI

/// 服务器与设备会话详情（二级设置页面）
/// 将连接地址、实例 ID、同步状态与 Web 端高级后台集中管理，避免污染一级设置的高频操作。
struct ServerConnectionDetailsView: View {
    @Environment(AppModel.self) private var model
    @State private var syncing = false

    var body: some View {
        Form {
            if let server = model.server {
                // 实时同步状态
                Section {
                    HStack {
                        Label("连接状态", systemImage: "antenna.radiowaves.left.and.right")
                            .font(AppTypography.rowTitle)
                        Spacer()
                        HStack(spacing: 6) {
                            Circle()
                                .fill(model.isOffline ? AppTheme.warning : AppTheme.success)
                                .frame(width: 8, height: 8)
                            Text(model.isOffline ? "离线模式" : "已连接")
                                .font(AppTypography.caption.weight(.medium))
                                .foregroundStyle(model.isOffline ? AppTheme.warning : AppTheme.success)
                        }
                    }
                    .appListRow()

                    LabeledContent("最后同步", value: model.lastSync?.formatted(date: .abbreviated, time: .shortened) ?? "未同步")
                        .appListRow()

                    Button {
                        Task {
                            syncing = true
                            await model.refresh()
                            syncing = false
                        }
                    } label: {
                        AppActionLabel(title: syncing ? "正在同步…" : "立即同步数据", busy: syncing)
                    }
                    .buttonStyle(AppActionStyle(prominent: false, expands: true))
                    .disabled(syncing)
                    .appListRow()
                } header: {
                    AppEyebrow("同步与状态")
                }

                // 服务器节点参数
                Section {
                    LabeledContent("当前账号", value: server.username).appListRow()
                    LabeledContent("服务器名", value: server.serverName).appListRow()
                    LabeledContent("主机地址", value: server.baseURL.absoluteString).appListRow()
                    if let instanceId = model.me?.instanceId {
                        LabeledContent("实例 ID", value: instanceId).appListRow()
                    }
                    LabeledContent("设备名称", value: AppModel.defaultDeviceName).appListRow()
                    LabeledContent("接口协议", value: "v\(APIClient.apiVersion)").appListRow()
                } header: {
                    AppEyebrow("节点信息")
                }

                // Web 高级管理
                Section {
                    Link(destination: server.baseURL.appendingPathComponent("settings")) {
                        Label("打开 Web 控制台（备份与 OIDC）", systemImage: "safari")
                            .font(AppTypography.rowTitle)
                            .frame(minHeight: 44)
                    }
                    .appListRow()

                    Link(destination: server.baseURL.appendingPathComponent("audit")) {
                        Label("查看审计变更历史 (Web)", systemImage: "clock.arrow.circlepath")
                            .font(AppTypography.rowTitle)
                            .frame(minHeight: 44)
                    }
                    .appListRow()
                } header: {
                    AppEyebrow("高级管理中心")
                } footer: {
                    Text("数据导入导出、安全凭证与第三方通知配置可在浏览器 Web 端中操作。")
                        .font(AppTypography.caption)
                }
            }
        }
        .appPage()
        .navigationTitle("服务器与连接")
        .navigationBarTitleDisplayMode(.inline)
    }
}
