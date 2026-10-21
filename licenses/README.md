# 第三方来源

Web 布局基于 Soybean Admin v3 提交 `6bbcb8dd3e556670e54c9840141373341cf80e85` 的 `src/layouts/default.vue` 与 `src/app.vue` 适配，复用 SAppShell/SConfigProvider/SThemeModeSwitch 组合和 UnoCSS 配置模式。完整 MIT 许可证见同目录 `SoybeanAdmin-MIT.txt`。

Vean UI、Vue、NestJS 等依赖遵循各自 npm 包内许可证。Wallos 仅参考产品布局，未复制源代码；未复制 TREK 的 AGPL 代码。

## 图标与数据

- `client/public/brands/*.svg`：卡组织图标，来自 [aaronfagan/svg-credit-card-payment-icons](https://github.com/aaronfagan/svg-credit-card-payment-icons) 的 `flat-rounded` 目录，Apache-2.0，许可证见 `svg-credit-card-payment-icons-Apache-2.0.txt`。图标所示品牌为各卡组织的商标。
- `server/src/data/banks.json`：全国金融机构清单（代码、名称、假名、罗马字），来自 [zengin-code/source-data](https://github.com/zengin-code/source-data)，其 README 声明以 MIT 许可提供；原始数据出处为该项目注明的 ykaku.net 银行检索。
- 银行图标不随代码分发：由各实例在用户选择后从银行官网抓取，保存在该实例自己的数据库中。
- 日本银行图标的取得方式参考 Wallos 的 logo 搜索与本地保存思路（`endpoints/logos/*.php`），独立实现，未复制其代码。
