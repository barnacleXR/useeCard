# 通知配置

## 站内通知

设置 → 扣款提醒，可设置站内通知开关、提前 0–30 个自然日和日本时间。通知入口在右上角，支持已读、历史与分页。已读只影响通知，不会修改账单状态。

提醒按账户、实际扣款日、币种合并，只包含已录入待确认账单。后台每 30 秒检查，打开通知页也会核对最新账单。金额变化会更新内容并重新标为未读；改日期、已还、作废会使旧提醒失效并移入历史；撤销已还会重新激活提醒。扣款日过去后显示“待确认”，不判断银行是否逾期。

## Apprise 外部通知

设置 → 外部通知支持 Telegram、Email / SMTP、Discord、Bark、ntfy 与其他 Apprise 地址。每个通道可分别启用、停用、测试及移除。

通道默认关闭自动提醒。可先发不含账单数据的测试消息，验证后启用。启用后会向该目标发送当前符合条件的待确认账单，内容包含账户名称、扣款日、已录入笔数、金额和币种；不要配置无权接收这些信息的目标。外部通道与站内通知开关独立，沿用同一组提前天数与日本提醒时间。

凭证只提交给 useeCard 服务端及管理员配置的 Apprise 网关，保存后不返回浏览器，不写入审计和错误详情。地址保存在 SQLite 中，完整备份含这些凭证，需与密码数据库一样妥善保管；业务 JSON/CSV 导出不包含通道凭证。

### Docker Compose

在 `.env` 设置：

```dotenv
BASE_URL=https://card.example.com
COOKIE_SECURE=true
APPRISE_API_URL=http://apprise:8000/notify
```

启动带可选通知服务的部署：

```sh
docker compose --profile notifications up -d --build
```

Apprise 不开放宿主机端口，只有同一 Compose 网络的 useeCard 可以访问。关闭有状态配置与附件，不需要额外的 Apprise 配置数据库。镜像固定为官方镜像摘要；升级时请确认 `/notify` 接口兼容。

不需要外部通知时，保持 `APPRISE_API_URL` 为空，用普通 `docker compose up -d --build` 启动 useeCard 即可。

已有 Apprise 服务时，填写完整的无状态 `/notify` 地址（支持反向代理子路径）。若网关启用 Basic Auth，另设 `APPRISE_API_USERNAME`、`APPRISE_API_PASSWORD`。服务端地址仅由部署环境设置，前端通道表单填写接收目标，不修改网关地址。远程网关请使用 HTTPS。

### 常见通道

- Telegram：通过 BotFather 创建机器人，向机器人发 `/start`，填写 Bot Token 和接收 Chat ID。
- Email：填写 SMTP 服务器、端口、STARTTLS / SSL、用户名、应用专用密码和发件/收件邮箱。Microsoft 等不接受 SMTP 基本认证的服务需在“其他”中使用 Apprise 对应服务地址。
- Discord：在服务器整合设置中新建 Webhook，复制地址；表单转换为 Apprise 的 Discord 地址。
- Bark：填写 App 中的推送 Key。
- ntfy：填写 ntfy.sh 主题名；自托管 ntfy、其他身份认证可用“其他”完整地址。
- 其他：一次填写一个完整 Apprise 地址，支持更多服务及高级参数。地址格式与实际可用性以 Apprise 为准，建议先测试再保存或启用。

官方资料：[Apprise API](https://github.com/caronc/apprise-api)、[服务目录](https://appriseit.com/services/)、[Email](https://appriseit.com/services/email/)、[Telegram](https://appriseit.com/services/telegram/)、[Discord](https://appriseit.com/services/discord/)。

## 投递记录与恢复

每个通道、每个提醒版本只建立一条自动投递记录；金额变化产生新版本。发送前重新检查最新账单、通道开关和提醒状态，旧任务失效即取消。站内已读不阻止外部投递。

外部投递每 30 秒检查，每轮最多处理 10 条。网络超时为 10 秒；失败最多自动尝试 3 次，间隔 1 分钟、5 分钟。页面显示最近 50 条记录，可对仍有效的失败提醒手动重试；已失效的旧金额不再发送。测试消息失败后请再次点击测试。

“已发送”表示 Apprise 网关返回成功，不等于对方已阅读。网络超时或进程中断可能发生目标已收到而 useeCard 未收到响应的情况，重试可能重复投递，不能保证严格只送一次。

恢复备份期间暂停后台发送并等待正在进行的请求；恢复成功后默认停用全部外部通道、取消未完成投递，管理员核对后重新启用，避免备份里的旧授权立即向外发送。通知和通道记录随完整备份保留；当前恢复仅支持相同数据库结构版本。
