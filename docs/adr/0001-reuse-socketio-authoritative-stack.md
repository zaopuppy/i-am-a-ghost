---
status: accepted
---

# 复用 Apple Picking 的 Socket.IO 权威联机栈

早期设计在没有现成联机基础设施的前提下选择了 Colyseus。勘察 E:\workspace\2026-gamehack\apple-picking 的 commit b3dcb8d399961e87bad56c7a3424005b80e51adb 后，发现它已经提供与本项目局域网目标高度一致的 Socket.IO 房间、固定步长权威模拟、输入序列、快照插值、客户端纠偏、重连和 Playwright 联机测试。因此决定选择性迁移这套联机栈，避免重新搭建同类基础设施。

## Considered Options

- 保留 Colyseus：按客户端过滤状态更直接，但需要重新实现参考工程已经具备的房间流程、客户端同步、诊断和测试。
- 整体复制 Apple Picking：启动最快，但会带入双席位、苹果规则、地图编辑器、全量 checkpoint 广播和大量无关资源。
- 选择性迁移 Socket.IO 权威栈：保留成熟的输入与房间基础设施，重写领域规则、2–5 人房间和每玩家状态投影。采用此方案。

## Consequences

- Socket.IO 只作为传输 adapter；规则继续由与 DOM、Three.js 和网络无关的权威模拟拥有。
- 不得原样复制 Apple Picking 向所有客户端广播完整 snapshot/checkpoint 的行为。完整 checkpoint 只留在服务器和规则测试中，小孩客户端必须收到过滤后的玩家视图。
- 房间广播需改为按玩家定向发送状态；鬼玩家可收到全局状态，小孩玩家仅收到被允许的角色、电池和头灯档位信息。
- 客户端预测从“重放完整对局”改为“只预测本地拥有角色”；隐藏鬼导致的碰撞差异由局域网中的服务端校正吸收。
- 同步更新 2026-08-17_game-design-and-start-plan.md 第 9–10 节中关于 Colyseus 的结论。
