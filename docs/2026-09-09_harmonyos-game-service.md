# HarmonyOS 游戏服务接入

本次修复审核提出的缺少 `init`、`verifyLocalPlayer` 问题，并按官方 Checklist 补齐
`unionLogin` 和账号切换处理。入口位于原生层，适用于单人和局域网对局。

## 行为

- `EntryAbility` 的页面加载成功回调启动 `GameService`。
- 依次等待 `init`、`unionLogin`、`verifyLocalPlayer` 成功，才创建游戏 Web 组件。
- 仅使用华为账号，`thirdAccountInfos` 为空，验证传入 `thirdOpenId: ''`，不自报实名或成年状态。
- 取消登录、网络失败、实名或防沉迷验证失败均不进入游戏，提供手动重试和退出。
- 收到切换账号事件时销毁游戏 Web 组件、停止局域网连接，再以 `showLoginDialog: true`
  重新登录。旧的异步结果不能放行新会话。销毁 Ability 时注销监听。
- 不持久化华为玩家 ID，不向 Web 或局域网对端传递华为账号信息。

## 应用配置

`entry/src/main/module.json5` 已配置用户从 AGC 确认的两个值，均使用字符串保存：

- `app_id`: `6917614241235503569`
- `client_id`: `2021751839694824448`

在 AGC 核对游戏服务开通、发布证书 SHA-256 指纹以及官方要求的 APP ID 映射。
本次接入增加华为账号登录及实名、防沉迷网络调用；此前隐私审计中的纯局域网描述不再完整，
提交前需同步实际发布的隐私政策和 SDK 声明。

## 验证

自动化回归通过平台替身执行实际 `GameService.ets`，不复制业务实现：

```powershell
node --import tsx --test tests/game/HarmonyGameService.test.ts
npm run build
npm run prototype:harmony:release
```

平台替身不能验证华为云端登录、实名、防沉迷弹窗。仍需在具有对应签名指纹的真机包上验证：

1. 启动后出现服务隐私声明及华为账号登录，验证成功后才出现游戏。
2. 设备未登录账号时取消登录，确认不反复自动弹窗，可手动重试。
3. 断网、取消实名、未成年人不可玩时段均不能进入单人或局域网游戏。
4. 切换账号后原有对局退出，重新登录并验证。
5. 退出、重启及校验中关闭应用，不出现旧会话放行。

## 官方依据

- [接入华为账号登录](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/gameservice-gameplayer-huawei)
- [开发后自检](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/gameservice-check)
- [gamePlayer API](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/gameservice-gameplayer)

网页读取不可用的章节通过 `devecocli docs read` 获取本地官方文档。
