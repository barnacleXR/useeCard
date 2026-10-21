# useeCard 开发约定

- 中文文档、注释、错误信息；标识符保留英文。
- 不运行任何 iOS 构建、模拟器、真机、XCTest 或 UI 测试。
- 后端、Web、MCP、原生 API 契约可以测试。`npm test` 和 `npm run build` 不包含 iOS。
- 金额必须是 `amountMinor` 安全整数与显式 `currency`，禁止浮点运算、换汇或跨币种求和。
- `dueDate` 只接受用户实际填写的 date-only 日期，不计算银行日期或节假日。
- 月度检查独立于账单；未检查不能推断为零，无新增不能抵消任何账单。
- 所有入口最终调用同一个后端领域服务。写操作必须校验所有权、版本和权限。
- 凭证只存哈希；Web 会话、设备令牌、API Key、MCP 令牌互不通用。
- Web 基于 Soybean Admin v3/Vean UI，保留 `licenses/SoybeanAdmin-MIT.txt`。
- 仓库只保留可直接使用的代码与面向使用者的文档，不写开发过程记录。未实现功能不能伪装为可用入口。
