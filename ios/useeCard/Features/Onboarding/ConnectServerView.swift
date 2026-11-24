import SwiftUI

/// 首次打开：输入服务器地址 → 检查服务身份与接口版本 → 配对码或账号密码 → 下载数据。
/// 连接自托管服务器：输入地址后用配对码或账号密码换取设备令牌（不使用长期 API Key）。
struct ConnectServerView: View {
    @Environment(AppModel.self) private var model
    enum Method: String, CaseIterable, Identifiable { case pairing = "配对码", password = "账号密码"; var id: String { rawValue } }

    @State private var address = ""
    @State private var checked: (url: URL, info: ServerInfo)?
    @State private var method: Method = .pairing
    @State private var code = ""
    @State private var username = ""
    @State private var password = ""
    @State private var deviceName = AppModel.defaultDeviceName
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let checked {
                    verifiedServer(checked)
                    credentialsSection
                } else {
                    addressSection
                }
                if let error {
                    Section {
                        AppNotice(message: error, systemImage: "exclamationmark.circle", color: AppTheme.danger)
                            .appListRow()
                    }
                }
            }
            .disabled(busy)
            .appPage()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("连接 useeCard")
            .safeAreaInset(edge: .bottom) {
                AppActionBar {
                    if let checked {
                        Button { Task { await signIn(checked.url, checked.info) } } label: {
                            AppActionLabel(title: busy ? "正在连接…" : "连接", busy: busy)
                        }
                        .buttonStyle(AppActionStyle(prominent: true, expands: true))
                        .disabled(busy || !canSubmit)
                    } else {
                        Button { Task { await check() } } label: {
                            AppActionLabel(title: busy ? "正在检查…" : "检查服务器", busy: busy)
                        }
                        .buttonStyle(AppActionStyle(prominent: true, expands: true))
                        .disabled(busy || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
    }

    private var addressSection: some View {
        Section {
            TextField("card.example.com", text: $address)
                .font(AppTypography.rowTitle)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("服务器地址")
                .submitLabel(.go)
                .onSubmit { Task { await check() } }
                .onChange(of: address) { _, _ in error = nil }
                .appListRow()
        } header: {
            AppEyebrow("服务器地址")
        } footer: {
            Text("填写自托管 useeCard 的域名，默认使用 HTTPS。暂不支持子路径部署。")
                .font(AppTypography.caption)
        }
    }

    private func verifiedServer(_ checked: (url: URL, info: ServerInfo)) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Label(checked.info.name, systemImage: "checkmark.seal.fill")
                    .font(AppTypography.cardTitle)
                    .foregroundStyle(AppTheme.success)
                Text(checked.url.absoluteString)
                    .font(AppTypography.supporting)
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(.vertical, 6)
            .appListRow()
            Button("更换服务器地址") {
                self.checked = nil
                code = ""
                username = ""
                password = ""
                error = nil
            }
            .buttonStyle(AppActionStyle(compact: true))
            .appListRow()
        } header: {
            AppEyebrow("已验证的服务器")
        }
    }

    private var credentialsSection: some View {
        Section {
            Picker("登录方式", selection: $method) {
                ForEach(Method.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: method) { _, _ in error = nil }
            .appListRow()
            if method == .pairing {
                TextField("XXXX-XXXX", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(.title2, design: .monospaced, weight: .semibold))
                    .accessibilityLabel("配对码")
                    .appListRow()
            } else {
                TextField("用户名", text: $username)
                    .font(AppTypography.rowTitle)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .appListRow()
                SecureField("密码", text: $password)
                    .font(AppTypography.rowTitle)
                    .textContentType(.password)
                    .appListRow()
            }
            TextField("设备名称", text: $deviceName)
                .font(AppTypography.rowTitle)
                .appListRow()
        } header: {
            AppEyebrow("登录方式")
        } footer: {
            Text(method == .pairing
                 ? "在 Web 端「设置 → iOS App 与设备」生成配对码，10 分钟内有效，只能使用一次。"
                 : "密码只用于换取本设备的登录凭证，App 不会保存密码。")
                .font(AppTypography.caption)
        }
    }

    private var canSubmit: Bool {
        guard !deviceName.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        return method == .pairing ? code.filter { $0.isLetter || $0.isNumber }.count >= 8 : !username.isEmpty && !password.isEmpty
    }

    private func check() async {
        guard !busy, !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        busy = true; error = nil
        defer { busy = false }
        do { let (url, info) = try await model.checkServer(address); checked = (url, info) }
        catch { self.error = error.localizedDescription }
    }

    private func signIn(_ url: URL, _ info: ServerInfo) async {
        guard !busy, canSubmit else { return }
        busy = true; error = nil
        defer { busy = false }
        let name = deviceName.trimmingCharacters(in: .whitespaces)
        do {
            switch method {
            case .pairing: try await model.signIn(baseURL: url, info: info, method: .pairing(code: code), deviceName: name)
            case .password: try await model.signIn(baseURL: url, info: info, method: .password(username: username, password: password), deviceName: name)
            }
            password = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}
