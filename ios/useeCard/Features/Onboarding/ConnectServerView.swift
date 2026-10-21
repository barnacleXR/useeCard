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
                Section {
                    TextField("card.example.com", text: $address)
                        .keyboardType(.URL).textContentType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: address) { _, _ in checked = nil }
                        .onSubmit { Task { await check() } }
                    if let checked {
                        Label("\(checked.info.name) · \(checked.url.host() ?? "")", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    } else {
                        Button { Task { await check() } } label: { busy ? AnyView(ProgressView()) : AnyView(Text("检查服务器")) }
                            .disabled(busy || address.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("服务器地址")
                } footer: {
                    Text("填写自托管 useeCard 的域名，默认使用 HTTPS。暂不支持子路径部署。")
                }

                if let checked {
                    Section {
                        Picker("登录方式", selection: $method) { ForEach(Method.allCases) { Text($0.rawValue).tag($0) } }
                            .pickerStyle(.segmented)
                        if method == .pairing {
                            TextField("XXXX-XXXX", text: $code)
                                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                                .font(.title3.monospaced())
                        } else {
                            TextField("用户名", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                            SecureField("密码", text: $password).textContentType(.password)
                        }
                        TextField("设备名称", text: $deviceName)
                    } footer: {
                        Text(method == .pairing ? "在 Web 端「设置 → iOS App 与设备」生成配对码，10 分钟内有效，只能使用一次。" : "密码只用于换取本设备的登录凭证，App 不会保存密码。")
                    }
                    Section {
                        Button {
                            Task { await signIn(checked.url, checked.info) }
                        } label: {
                            HStack {
                                Spacer()
                                if busy { ProgressView() } else { Text("连接").bold() }
                                Spacer()
                            }
                        }
                        .disabled(busy || !canSubmit)
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("连接 useeCard")
        }
    }

    private var canSubmit: Bool {
        guard !deviceName.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        return method == .pairing ? code.filter { $0.isLetter || $0.isNumber }.count >= 8 : !username.isEmpty && !password.isEmpty
    }

    private func check() async {
        busy = true; error = nil
        defer { busy = false }
        do { let (url, info) = try await model.checkServer(address); checked = (url, info) }
        catch { self.error = error.localizedDescription }
    }

    private func signIn(_ url: URL, _ info: ServerInfo) async {
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
