# useeCard

个人自托管的信用卡备款管理。手动填写银行账单的金额、币种和实际扣款日，按扣款账户、日期与币种查看需要准备多少钱。不连接银行，不换汇，不跨币种求和。

- **备款汇总**：按账户、扣款日、币种汇总待扣款金额；逾期未确认的账单单独列出。
- **账单**：多币种（最小货币单位整数存储）、已扣款 / 撤销 / 作废、日历与月报。
- **月度检查**：逐卡核对；低频卡标记"本月无新增"，不生成零元账单。
- **提醒**：站内通知，可选 Apprise 外部通知（Telegram、Email、Discord、Bark、ntfy 等）。
- **数据**：业务 JSON / CSV 导出、在线完整备份、自动备份与恢复、操作记录。
- **登录**：本地账号密码，可选 OIDC 单点登录；浏览器会话管理。
- **接入**：iOS 原生 App（配对码登录）、只读 REST API（API Key）、MCP（供 Claude 等 AI 客户端，OAuth 授权）。

## 部署（Docker Compose）

```bash
cp .env.example .env
# 编辑 .env：把 BASE_URL 设为实例的实际 HTTPS 地址。
docker compose up --build -d
```

服务监听宿主机 `127.0.0.1:3090`，由你的反向代理转发 HTTPS。打开 `BASE_URL`，首次访问创建唯一的管理员账号（密码至少 12 位），然后添加扣款账户与信用卡。数据保存在数据卷 `/data`。

需要外部通知时用 `docker compose --profile notifications up --build -d` 启动随附的 Apprise，详见 [通知配置](docs/notifications.md)。

## 配置

| 变量 | 说明 |
|---|---|
| `BASE_URL` | 必填。实例的公开地址，例如 `https://card.example.com`。 |
| `COOKIE_SECURE` | 默认 `true`。仅在本机 HTTP 开发时设为 `false`。 |
| `APPRISE_API_URL` | 可选。Apprise 无状态 `/notify` 地址；`APPRISE_API_USERNAME` / `APPRISE_API_PASSWORD` 用于 Basic Auth。 |
| `OIDC_ISSUER` | 可选。设置即启用 OIDC 单点登录，见下文。 |
| `CCM_API_RATE_LIMIT` | 可选。只读 REST API 每个 Key 每分钟的请求上限，默认 120。 |
| `BACKUP_DIR` | 可选。备份目录，默认数据库所在目录下的 `backups/`（容器内为 `/data/backups`）。 |

## 单点登录（OIDC）

可接入任何提供发现文档的 OpenID Connect 提供方，例如 Pocket ID、Authelia、Authentik、Keycloak、Zitadel、Google。密码登录始终保留。

1. 在提供方创建客户端，回调地址填 `BASE_URL` + `/api/auth/oidc/callback`，例如 `https://card.example.com/api/auth/oidc/callback`。
2. 在 `.env` 设置并重启：

   | 变量 | 说明 |
   |---|---|
   | `OIDC_ISSUER` | 提供方地址，与其发现文档中的 `issuer` 完全一致，不带结尾 `/`。必须是 HTTPS（本机地址可用 HTTP）。 |
   | `OIDC_CLIENT_ID` | 客户端 ID。 |
   | `OIDC_CLIENT_SECRET` | 可选。提供方签发了密钥时填写；公共客户端只用 PKCE。 |
   | `OIDC_NAME` | 可选。登录按钮上显示的名称，默认为提供方域名。 |
   | `OIDC_SCOPES` | 可选。默认 `openid profile email`，必须包含 `openid`。 |
   | `OIDC_REDIRECT_URI` | 可选。默认由 `BASE_URL` 生成，必须与其同源。 |

3. 用密码登录 useeCard，进入 **设置 → 账号安全 → 单点登录（OIDC）**，点击"绑定"并在提供方完成登录。绑定后登录页出现"使用 … 登录"按钮。

未绑定的外部身份不能登录，也不会自动创建账号。配置有误时登录页不显示 OIDC 按钮，设置页会显示具体原因，服务器日志记录每次失败的原因。

## iOS App

SwiftUI 原生客户端（iOS 26+），用 Xcode 打开 `ios/useeCard.xcodeproj`，说明见 [ios/README.md](ios/README.md)。在 Web **设置 → iOS App 与设备** 生成配对码，App 中输入服务器地址与配对码即可登录。

## REST API

只读接口 `/api/v1`，在 **设置 → 外部 API** 创建 API Key（只显示一次），以 `Authorization: Bearer <key>` 调用。接口文档：`/api/v1/openapi.json`（OpenAPI 3.1）。

```bash
curl "https://card.example.com/api/v1/summary?dueMonth=2026-11" -H "Authorization: Bearer ccmk_..."
```

## MCP

MCP 端点为 `BASE_URL` + `/mcp`（Streamable HTTP），使用 OAuth 2.1 授权码 + PKCE，支持动态客户端注册。在 AI 客户端添加"自定义连接器 / 远程 MCP 服务器"并填入该地址，客户端会打开 useeCard 授权页，由你勾选权限；写入权限默认不勾选。已授权的连接与客户端在 **设置 → MCP 连接** 管理。AI 客户端须能通过 HTTPS 访问实例。

工具：查询账户、卡片、账单、备款汇总与月度检查；录入、修改、确认扣款、撤销与作废账单；标记月度检查。

Web 登录、iOS 设备令牌、API Key 与 MCP 令牌互不通用。

## 备份与恢复

在 **设置 → 数据导出与备份** 下载完整备份、设置自动备份或上传恢复，详见 [备份与恢复](docs/backup-restore.md)。不要直接复制运行中的数据库文件代替在线备份。

## 本地开发

需要 Node.js 24 与 npm。

```bash
npm ci
npm run build -w @ccm/shared
COOKIE_SECURE=false BASE_URL=http://localhost:5173 npm run dev:server
```

另一个终端运行 `npm run dev:client`，打开 http://localhost:5173。SQLite 默认保存在 `server/.data/ccm.db`。

```bash
npm test
npm run build
```

测试使用临时数据库，不包含 iOS。

## 目录

- `client`：Vue 3、Pinia、Vean UI 静态客户端。
- `server`：NestJS、SQLite、认证与业务服务。
- `shared`：校验契约、币种目录与金额解析。
- `ios`：SwiftUI 原生 App。
- `licenses`：第三方来源与许可证。

## 路线图与许可证

后续计划见 [ROADMAP.md](ROADMAP.md)。本项目以 [MIT](LICENSE) 许可发布；第三方组件的来源与许可证见 [licenses/README.md](licenses/README.md)。
