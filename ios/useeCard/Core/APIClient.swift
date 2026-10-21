import Foundation

/// 设备凭证：访问令牌短期有效，刷新令牌每次刷新后轮换（服务端会吊销被重放的旧令牌）。
struct DeviceCredentials: Codable, Equatable {
    var accessToken: String
    var accessExpiresAt: Date
    var refreshToken: String

    init(tokens: DeviceTokens) {
        accessToken = tokens.accessToken
        refreshToken = tokens.refreshToken
        accessExpiresAt = ISO8601.parse(tokens.accessExpiresAt) ?? Date().addingTimeInterval(3000)
    }
    /// 离过期还有 60 秒以上才直接使用，避免请求途中过期。
    var isFresh: Bool { accessExpiresAt.timeIntervalSinceNow > 60 }
}

enum ISO8601 {
    static func parse(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }
}

enum ClientError: LocalizedError, Equatable {
    case invalidServerURL(String)
    case notUseeCard
    case unsupportedVersion(Int)
    case offline(String)
    case sessionExpired
    case server(status: Int, message: String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case let .invalidServerURL(reason): return reason
        case .notUseeCard: return "该地址不是 useeCard 服务器"
        case let .unsupportedVersion(v): return "服务器的 App 接口版本为 \(v)，请升级 App 或服务器"
        case let .offline(reason): return "无法连接服务器：\(reason)"
        case .sessionExpired: return "设备登录已失效，请重新登录或配对"
        case let .server(_, message): return message
        case let .decoding(reason): return "服务器返回的数据无法解析：\(reason)"
        }
    }
    var isOffline: Bool { if case .offline = self { return true } else { return false } }
    var isConflict: Bool { if case .server(409, _) = self { return true } else { return false } }
}

/// `/api/app/v1` 客户端。只携带设备 Bearer 令牌，不使用 Cookie。
/// actor 保证并发请求共用同一次令牌刷新。
actor APIClient {
    static let apiVersion = 1
    let baseURL: URL
    private var credentials: DeviceCredentials?
    private var refreshTask: Task<DeviceCredentials, Error>?
    private let onCredentialsChange: @Sendable (DeviceCredentials?) -> Void
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    init(baseURL: URL, credentials: DeviceCredentials?, onCredentialsChange: @escaping @Sendable (DeviceCredentials?) -> Void) {
        self.baseURL = baseURL
        self.credentials = credentials
        self.onCredentialsChange = onCredentialsChange
    }

    // MARK: 服务器地址与公开接口

    /// 规则见需求 14.3：默认补 https，去掉首尾空白和末尾斜杠；拒绝路径、非 http(s) 与内嵌账号密码。
    static func normalizeServerURL(_ raw: String) throws -> URL {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ClientError.invalidServerURL("请输入服务器地址") }
        if !text.contains("://") { text = "https://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        guard let components = URLComponents(string: text), let scheme = components.scheme?.lowercased(),
              let host = components.host, !host.isEmpty else { throw ClientError.invalidServerURL("服务器地址格式不正确") }
        guard scheme == "https" || scheme == "http" else { throw ClientError.invalidServerURL("只支持 https 或 http 地址") }
        guard components.user == nil, components.password == nil else { throw ClientError.invalidServerURL("地址不能包含用户名或密码") }
        guard components.path.isEmpty, components.query == nil, components.fragment == nil else {
            throw ClientError.invalidServerURL("请填写域名根地址，暂不支持子路径部署")
        }
        var clean = URLComponents()
        clean.scheme = scheme; clean.host = host; clean.port = components.port
        guard let url = clean.url else { throw ClientError.invalidServerURL("服务器地址格式不正确") }
        return url
    }

    static func serverInfo(at baseURL: URL) async throws -> ServerInfo {
        let info: ServerInfo = try await perform(request(baseURL, "GET", "/server-info"), decode: ServerInfo.self)
        guard info.service == "useecard" else { throw ClientError.notUseeCard }
        guard info.appApiVersion == apiVersion else { throw ClientError.unsupportedVersion(info.appApiVersion) }
        return info
    }

    static func login(at baseURL: URL, username: String, password: String, deviceName: String) async throws -> DeviceTokens {
        let body = ["username": username, "password": password, "deviceName": deviceName, "platform": "ios"]
        return try await perform(request(baseURL, "POST", "/auth/login", body: body), decode: DeviceTokens.self)
    }

    static func pair(at baseURL: URL, code: String, deviceName: String) async throws -> DeviceTokens {
        let body = ["code": code, "deviceName": deviceName, "platform": "ios"]
        return try await perform(request(baseURL, "POST", "/auth/pair", body: body), decode: DeviceTokens.self)
    }

    // MARK: 需要设备令牌的接口

    func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type = T.self) async throws -> T {
        try await send("GET", path, query: query, body: Optional<String>.none, as: type)
    }

    func send<T: Decodable, B: Encodable>(_ method: String, _ path: String, query: [String: String] = [:], body: B?, idempotencyKey: String? = nil, as type: T.Type = T.self) async throws -> T {
        let data = try await authorized(method, path, query: query, body: body, idempotencyKey: idempotencyKey)
        return try Self.decode(type, from: data)
    }

    /// 读取图标等二进制资源。
    func data(_ path: String) async throws -> Data {
        try await authorized("GET", path, query: [:], body: Optional<String>.none, idempotencyKey: nil)
    }

    /// 注销：吊销本设备会话；网络失败时由调用方继续清理本地数据。
    func logout() async {
        _ = try? await authorized("POST", "/auth/logout", query: [:], body: Optional<String>.none, idempotencyKey: nil)
        credentials = nil
    }

    private func authorized<B: Encodable>(_ method: String, _ path: String, query: [String: String], body: B?, idempotencyKey: String?) async throws -> Data {
        var token = try await validAccessToken()
        for attempt in 0..<2 {
            var req = try Self.request(baseURL, method, path, query: query, body: body)
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let idempotencyKey { req.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
            do {
                return try await Self.perform(req)
            } catch ClientError.server(401, _) where attempt == 0 {
                // 访问令牌被提前吊销或时钟偏差：强制刷新一次后重试。
                token = try await refreshedCredentials().accessToken
            }
        }
        throw ClientError.sessionExpired
    }

    private func validAccessToken() async throws -> String {
        guard let credentials else { throw ClientError.sessionExpired }
        if credentials.isFresh { return credentials.accessToken }
        return try await refreshedCredentials().accessToken
    }

    private func refreshedCredentials() async throws -> DeviceCredentials {
        if let refreshTask { return try await refreshTask.value }
        guard let refreshToken = credentials?.refreshToken else { throw ClientError.sessionExpired }
        let baseURL = self.baseURL
        let task = Task { () throws -> DeviceCredentials in
            let req = try Self.request(baseURL, "POST", "/auth/refresh", body: ["refreshToken": refreshToken])
            return DeviceCredentials(tokens: try await Self.perform(req, decode: DeviceTokens.self))
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let fresh = try await task.value
            credentials = fresh
            onCredentialsChange(fresh)
            return fresh
        } catch ClientError.server(401, _) {
            credentials = nil
            onCredentialsChange(nil)
            throw ClientError.sessionExpired
        }
    }

    // MARK: 底层请求

    private static func request(_ baseURL: URL, _ method: String, _ path: String, query: [String: String] = [:]) -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/app/v1" + path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        return req
    }

    private static func request<B: Encodable>(_ baseURL: URL, _ method: String, _ path: String, query: [String: String] = [:], body: B?) throws -> URLRequest {
        var req = request(baseURL, method, path, query: query)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    private static func perform(_ request: URLRequest) async throws -> Data {
        let result: (Data, URLResponse)
        do { result = try await session.data(for: request) }
        catch let error as URLError { throw ClientError.offline(error.localizedDescription) }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse else { throw ClientError.offline("无效响应") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerMessage.self, from: data).message) ?? "请求失败（HTTP \(http.statusCode)）"
            throw ClientError.server(status: http.statusCode, message: message)
        }
        return data
    }

    private static func perform<T: Decodable>(_ request: URLRequest, decode type: T.Type) async throws -> T {
        try decode(type, from: try await perform(request))
    }

    private static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw ClientError.decoding(String(describing: error)) }
    }
}
