# 不要被抓到 / I am a Ghost

一款面向 PC、仅支持 2–5 人本机或局域网联机的 Three.js 非对称追逐游戏。

M0–M6 实现与自动 QA 已完成：当前版本可供 2–5 人在本机或局域网创建邀请码房间、随机分配鬼与小孩、完成五分钟对局并重新准备。服务端拥有移动、阻挡、抓取、照射、电池、计时与胜负；小孩客户端在鬼未被照中时拿不到鬼坐标。

## 本地运行

要求 Node.js 20.19 或更高版本。

```powershell
npm install
npm run dev
```

一键停掉本机 Web（5189）、房间服务（5191）和生产预览（4189）：

```powershell
npm run stop
```

在跑 `npm run dev` 的终端里 `Ctrl+C` 也会同时结束两个进程。`npm run stop` 用于终端已经关掉、服务还占着端口的情况。

- Web：`http://127.0.0.1:5189`
- 房间服务健康检查：`http://127.0.0.1:5191/healthz`

局域网中的其他电脑可通过开发机的 IPv4 地址和端口 `5189` 访问页面。

## 鸿蒙 APP 原型

构建或运行鸿蒙原型时，除 Node.js 外还需要安装 DevEco Studio 对应的 HarmonyOS SDK，以及全局 DevEco CLI：

```powershell
npm install -g @deveco/deveco-cli@latest
```

在仓库根目录构建 HAP：

```powershell
npm run prototype:harmony:build
```

连接并配置好签名真机后，可以构建、安装并启动：

```powershell
npm run prototype:harmony:run
```

多真机、签名和故障排查说明见 [鸿蒙 Gate A 原型](prototypes/harmony-gate-a/README.md)；首次真机准备与签名边界见 [鸿蒙原生宿主研究](docs/2026-08-20_harmonyos-native-host-research.md)。

## 本地页面与参数

游戏是单页应用，没有其它路由。页面都是 `/`，用查询参数切换行为。

| 地址 | 说明 |
| --- | --- |
| `http://127.0.0.1:5189/` | 开发大厅。可创建/加入房间，开局后进入对局。开发模式下会显示「开发调试」面板。 |
| `http://127.0.0.1:5189/?room=ABC123` | 把 6 位房间码填进加入框。字母会自动转成大写。 |
| `http://127.0.0.1:5189/?testState=<name>` | **仅开发模式**。跳过联机，播放固定画面，用于截图和验收。生产构建会忽略该参数。 |
| `http://127.0.0.1:5189/?sceneEditor=1` | **仅开发模式**。打开房屋场景编辑器，可移动/旋转/增加家具并编辑房间和墙段。 |
| `http://127.0.0.1:5191/healthz` | 房间服务 JSON 健康检查。Vite 也会把 `/healthz` 代理到这里，所以 `http://127.0.0.1:5189/healthz` 同样可用。 |
| `http://127.0.0.1:4189/` | `npm run build` 后 `npm run preview` 的生产预览。房间服务仍要单独在 5191 运行（`npm run preview` 会一起拉起）。 |

`testState` 可选值：

| 参数 | 视角 | 画面 |
| --- | --- | --- |
| `child-playing` | 小孩 | 手电开着，鬼可见 |
| `child-hidden` | 小孩 | 鬼未显形，客户端拿不到鬼坐标 |
| `flashlight-off-range` | 小孩 | 手电开着，头灯全灭，鬼不可见 |
| `flashlight-wall` | 小孩 | 手电打在墙上，鬼不可见 |
| `ghost-playing` | 鬼 | 全屋俯视，能看见所有小孩和电池 |
| `low-battery` | 小孩 | 电量低，场上两块电池 |
| `capture` | 被抓的小孩 | 抓捕演出 |
| `protection` | 小孩 | 复位后的保护时间，鬼不可见 |
| `child-win` | 小孩 | 小孩阵营获胜结算 |
| `ghost-win` | 鬼 | 鬼获胜结算 |

示例：

```text
http://127.0.0.1:5189/?testState=ghost-playing
http://127.0.0.1:5189/?testState=capture
http://127.0.0.1:5189/?sceneEditor=1
http://127.0.0.1:5189/?room=AB12CD
```

房间服务端口可用环境变量改写（Web 开发代理仍指向 `127.0.0.1:5191`，改端口时需要同步改 Vite 配置）：

- `I_AM_A_GHOST_SERVER_HOST`（默认 `0.0.0.0`）
- `I_AM_A_GHOST_SERVER_PORT`（默认 `5191`）

## 操作与规则

- 鬼：`WASD` 或方向键移动；接触小孩后自动抓取，无需额外按键。
- 小孩：`WASD` 或方向键移动，角色与手电朝向最后一次有效移动方向；按住 `空格` 打开手电，光束只会照向角色正前方。
- 对局过程完全使用键盘操作，不提供鼠标瞄准或方向控制。
- 鬼被手电照中后进入灼烧状态，期间减速且无法抓取，只能移动逃离。
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
- 联机栈决策：[docs/adr/0001-use-socketio-authoritative-stack.md](docs/adr/0001-use-socketio-authoritative-stack.md)
- M6 自动试玩与 QA：[docs/2026-08-17_m6-playtest-tuning-and-qa-report.md](docs/2026-08-17_m6-playtest-tuning-and-qa-report.md)
- 场景编辑器：[docs/SCENE_EDITOR.md](docs/SCENE_EDITOR.md)
- 第三方资产许可：[docs/ASSET_LICENSES.md](docs/ASSET_LICENSES.md)

当前是首轮局域网试玩版，不代表最终平衡或正式发布。自动机器人显示少人数局对鬼明显有利；下一轮应以 2–5 名真人的实际操作、误判与路线选择数据决定调整。
