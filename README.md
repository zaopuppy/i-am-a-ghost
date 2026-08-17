# I Am a Ghost

一款面向 PC、仅支持 2–5 人本机或局域网联机的 Three.js 非对称追逐游戏。

当前完成 M0 foundation：仓库包含可构建的 Three.js 客户端、Socket.IO 局域网服务、健康检查、浏览器烟雾测试和画布诊断。当前页面不是可玩版本；规则从 M1 的确定性 `MatchEngine` 开始实现。

## 本地运行

要求 Node.js 20.19 或更高版本。

```powershell
npm install
npm run dev
```

- Web：`http://127.0.0.1:5189`
- 房间服务健康检查：`http://127.0.0.1:5191/healthz`

局域网中的其他电脑可通过开发机的 IPv4 地址和端口 `5189` 访问页面。

## 验证

```powershell
npm run build
npm test
npm run inspect:canvas
```

画布检查报告与截图写入忽略提交的 `artifacts/canvas-inspection/`。

## 设计与架构

- 游戏规则：[docs/2026-08-17_game-design-and-start-plan.md](docs/2026-08-17_game-design-and-start-plan.md)
- 开发计划：[docs/2026-08-17_development-plan.md](docs/2026-08-17_development-plan.md)
- 联机栈决策：[docs/adr/0001-reuse-socketio-authoritative-stack.md](docs/adr/0001-reuse-socketio-authoritative-stack.md)

工程基础选择性参考 `E:\workspace\2026-gamehack\apple-picking` 的 commit `b3dcb8d399961e87bad56c7a3424005b80e51adb`，不复制其玩法领域或全量状态广播策略。
