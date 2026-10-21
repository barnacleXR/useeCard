# useeCard iOS

自托管 useeCard 的原生 SwiftUI 客户端，iPhone、iOS 26+，默认使用系统 Liquid Glass。


## 打开与运行

1. 用 Xcode 26 打开 `ios/useeCard.xcodeproj`。工程使用同步文件夹分组，新增到 `ios/useeCard/` 的 Swift 文件会自动加入目标。
2. 选中 **useeCard** target → Signing & Capabilities，选择自己的 Team；需要时修改 Bundle Identifier（默认 `com.example.useecard`，需改成自己的）。
3. 运行后输入服务器地址（例如 `card.example.com`，默认 HTTPS），再用 Web「设置 → iOS App 与设备」生成的配对码，或账号密码登录。
4. 本地开发连接局域网 HTTP 服务器时直接输入 `http://192.168.x.x:3000`；`Info.plist` 只开放 `NSAllowsLocalNetworking`，不会全局关闭 TLS 校验。

## 结构

| 目录 | 内容 |
|---|---|
| `useeCard/App` | 入口、根视图、标签页、`AppModel`（连接、同步、写入、草稿、注销） |
| `useeCard/Core/Money.swift` | 币种目录与金额：`Int` 最小货币单位，十进制字符串解析，不用 Double |
| `useeCard/Core/DateOnly.swift` | 按日本时间解释的日期与月份值类型 |
| `useeCard/Core/APIClient.swift` | `/api/app/v1` 客户端（actor）：Bearer 令牌、临期自动刷新、并发共用一次刷新、401 刷新重试 |
| `useeCard/Core/Storage.swift` | 活动服务器（UserDefaults）、设备凭证（钥匙串）、离线缓存与草稿（按实例＋用户隔离） |
| `useeCard/Core/NotificationScheduler.swift` | 按服务端提醒计划排程本地通知，每次同步先撤销旧提醒 |
| `useeCard/Features` | 连接、汇总、账单与录入、日历、月报、月度检查、设置 |
| `useeCard/Assets.xcassets` | 卡组织矢量图标（来源见 `licenses/README.md`）、App 图标（usee.sh 圆环，奢华黑金配色） |

## 行为约定

- 服务端是唯一权威数据源：在线写入；离线时显示最后一次同步的缓存并标注离线。
- 离线录入只能存为草稿，标注“未保存到服务器”，不计入备款合计；草稿 id 兼作幂等键，重复提交不会产生两笔账单。
- 版本冲突（409）时重新同步，用户看到服务器最新值后再编辑。
- 注销会撤销服务端设备会话，并清除本机凭证、缓存、草稿和提醒；更换服务器需要先注销。
- 汇总、月报、提醒都展示服务端按币种分组的结果，App 不重新计算财务汇总。
