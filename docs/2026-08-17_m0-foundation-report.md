# 《I Am a Ghost》M0 Foundation 完成记录

- 日期：2026-08-17
- 里程碑：M0 架构门槛与仓库基线
- 结果：通过
- 下一里程碑：M1 确定性 `MatchEngine`

## 完成内容

- 接受 ADR-0001，技术路线改为选择性复用 Apple Picking 的 Socket.IO 权威联机基础。
- 同步更新游戏设计文档中的服务端、状态过滤和同步描述。
- 建立 TypeScript、Vite、Three.js、Socket.IO 和 Playwright 工具链。
- 建立单一 PC Web 入口，使用 Web 端口 `5189` 和房间服务端口 `5191`。
- 建立俯视 Three.js 灰盒舞台、正交镜头、统一渲染循环和 resize 处理。
- 建立 Socket.IO 最小连接与 `/healthz` 健康检查；尚未加入房间或玩法规则。
- 建立 `window.__THREE_GAME_DIAGNOSTICS__` 和测试钩子。
- 建立桌面 Playwright 烟雾测试与独立 canvas inspector。
- 没有复制参考工程的玩法代码、全量状态广播或运行时资产。

## QA 证据

```text
QA result: pass
Commands:
  npm run build
  npm test
  npm run inspect:canvas
URL: http://127.0.0.1:5189
Health: http://127.0.0.1:5191/healthz
Controls tested: 不适用；M0 明确不含玩法输入
Screenshot: artifacts/canvas-inspection/desktop-foundation.png（本地生成，不提交）
Console/page errors: 0
Canvas pixel check: 1280x720；min luma 7；max luma 240；range 233
Desktop/mobile viewports: 1280x720；首发仅 PC，未测试移动端
Renderer diagnostics: 12 calls；1262 triangles；12 geometries；1 texture
Visual test harness: 未建立截图基线；M0 呼吸光非确定，当前由像素烟雾测试覆盖
Physics diagnostics: 不适用
External asset evidence: 未接入外部资产
Audio evidence: 未接入音频
Issues found/fixed: Playwright 首轮过早在第 5 帧采样，改为等待第 10 帧后读取
Residual risks: 当前只是工程基线；房间、信息过滤、规则和真实多人链路从 M1/M2 开始验证
```

`inspect:canvas` 的无头 Chrome FPS 样本不是性能基准；M0 只用它证明渲染循环持续推进。正式 PC 60 FPS 预算在有实际玩法负载后测量。

## M0 退出门槛

- `npm run build` 通过。
- 灰盒页面和 `/healthz` 可访问。
- 浏览器能连接 Socket.IO 服务。
- Canvas 非空且有足够颜色变化。
- 源码与 UI 中没有参考工程的玩法领域残留。
