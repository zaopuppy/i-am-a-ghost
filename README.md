# I Am a Ghost

一款面向 PC、仅支持 2–5 人本机或局域网联机的 Three.js 非对称追逐游戏。

M0–M6 实现与自动 QA 已完成：当前版本可供 2–5 人在本机或局域网创建邀请码房间、随机分配鬼与小孩、完成五分钟对局并重新准备。服务端拥有移动、阻挡、抓取、照射、电池、计时与胜负；小孩客户端在鬼未被照中时拿不到鬼坐标。

## 本地运行

要求 Node.js 20.19 或更高版本。

```powershell
npm install
npm run dev
```

- Web：`http://127.0.0.1:5189`
- 房间服务健康检查：`http://127.0.0.1:5191/healthz`

局域网中的其他电脑可通过开发机的 IPv4 地址和端口 `5189` 访问页面。

## 操作与规则

- `E/S/D/F`：向上/左/下/右移动。
- 鼠标：朝向。
- `空格`：小孩按住打开手电；鬼按下发起一次抓取。
- 鬼抓到小孩三次获胜；鬼生命归零或五分钟倒计时归零则小孩获胜。
- 小孩低电时地图生成一块全角色可见的电池；头灯随鬼接近由慢闪、快闪变为常亮。

不需要账号或数据库；房间、昵称与重连凭据都只在当前进程/浏览器会话中存在。

## 验证

```powershell
npm run build
npm test
npm run test:balance
npm run inspect:canvas
```

`npm run inspect:canvas` 需要页面和房间服务已经运行；开发环境使用默认 `http://127.0.0.1:5189`。生产预览可运行 `npm run build`、`npm run preview`，再传入 `-- --url http://127.0.0.1:4189`。画布检查报告与截图写入忽略提交的 `artifacts/canvas-inspection/`。

视觉基线覆盖小孩照射、鬼全图、抓捕和结算：

```powershell
npx playwright test tests/deterministic-states.spec.ts --update-snapshots
npx playwright test tests/deterministic-states.spec.ts
```

## 设计与架构

- 游戏规则：[docs/2026-08-17_game-design-and-start-plan.md](docs/2026-08-17_game-design-and-start-plan.md)
- 开发计划：[docs/2026-08-17_development-plan.md](docs/2026-08-17_development-plan.md)
- 联机栈决策：[docs/adr/0001-reuse-socketio-authoritative-stack.md](docs/adr/0001-reuse-socketio-authoritative-stack.md)
- M6 自动试玩与 QA：[docs/2026-08-17_m6-playtest-tuning-and-qa-report.md](docs/2026-08-17_m6-playtest-tuning-and-qa-report.md)
- 第三方资产许可：[docs/ASSET_LICENSES.md](docs/ASSET_LICENSES.md)

工程基础选择性参考 `E:\workspace\2026-gamehack\apple-picking` 的 commit `b3dcb8d399961e87bad56c7a3424005b80e51adb`，不复制其玩法领域或全量状态广播策略。

当前是首轮局域网试玩版，不代表最终平衡或正式发布。自动机器人显示少人数局对鬼明显有利；下一轮应以 2–5 名真人的实际操作、误判与路线选择数据决定调整。
