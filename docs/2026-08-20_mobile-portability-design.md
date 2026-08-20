# 《I Am a Ghost》鸿蒙原生迁移与桌面调试共存设计

- 日期：2026-08-20
- 更新：2026-08-21
- 状态：原型实现已获授权；开发准备、首轮真机矩阵与 `bundleName` 已确认，开始 Gate A
- 目标：最终以原生鸿蒙 APP 运行；由发起人的手机承担局域网房间主机；长期保留桌面开发、调试和自动化测试能力
- 非目标：当前授权只覆盖可丢弃的原型实现，不代表生产架构或发布方案已经定案，也不在技术验证前承诺 ArkWeb 已达到性能和稳定性门槛
- 相关研究：`docs/2026-08-20_harmonyos-native-host-research.md`

## 1. 已确认的产品约束

1. 最终玩家入口必须是安装在鸿蒙设备上的原生 APP，不是让玩家在浏览器中打开网页。
2. 只支持 HarmonyOS NEXT / HarmonyOS 6.0 及以上，不兼容旧 HarmonyOS 或 Android 兼容层；具体测试设备和 API level 随真机矩阵记录。
3. 创建房间的发起人手机同时是房间主机，运行权威对局和局域网监听；不存在公网或电脑房间服务器。
4. 所有玩家都在同一局域网内连接房间主机。
5. 对局只以横屏运行，建议允许横屏与反向横屏随持握方向切换。
6. 小孩使用左侧单摇杆移动并决定朝向，右侧按住按钮控制手电；鬼继续接触后自动抓捕。
7. 桌面端必须继续支持键盘、开发调参、场景编辑、确定性状态和自动化测试。
8. ArkUI 原生 HAP 内嵌 ArkWeb 运行本地 Three.js 满足原生交付要求，只要玩家打开 APP 即可直接游玩。
9. 房间主机 APP 一旦进入后台或锁屏，本房间立即结束；首版不提供后台恢复或主机迁移。
10. 当前原型目标机为 HUAWEI Pura X（VDE-AL00）；用户在系统界面确认其显示为 HarmonyOS 6.1，而 HDC 实测为 OpenHarmony 26.0.0.16、API 26、arm64-v8a。官方版本映射中 HarmonyOS 6.1.0/6.1.1 分别对应 API 23/24，API 26 对应 HarmonyOS 7，因此文档不把“6.1”和“API 26”写成官方等价关系。工程使用 API 26 编译和目标 SDK，并以 API 23 作为兼容基线；SoC 名称未通过已查询系统参数暴露，不作为原型启动阻塞项。
11. 当前交付物只是受控局域网原型，传输认证、加密、TLS/pinning 和对抗性威胁模型暂不进入范围；若转向对外分发或正式产品，必须重新打开安全设计。

## 2. 修订后的结论

原草案的“移动 Web 优先、必要时再套 Capacitor”不再成立。新架构必须同时解决两个独立问题：

- **鸿蒙游戏运行时**：如何承载现有 Three.js 表现，或迁移到官方支持 HarmonyOS NEXT 的游戏引擎。
- **手机房间主机**：如何在发起人手机上运行与渲染循环隔离的权威对局，并接受其他手机的局域网连接。

已接受 ArkWeb 为首选宿主；Cocos Creator 只在 ArkWeb 未通过小型技术验证时进入迁移评估：

### 候选 A：ArkUI 原生宿主 + ArkWeb 本地游戏页面

鸿蒙 HAP 由 ArkUI/ArkTS 提供生命周期、横屏、权限、局域网发现和监听；ArkWeb 加载打包在 APP 内的 Vite/Three.js 静态产物。游戏不是通过外部浏览器访问，但渲染和 HUD 仍运行在 ArkWeb 中。

优势是最大程度复用当前 Three.js、DOM HUD、Web Audio、场景编辑器和桌面 Playwright 链路。风险集中在 ArkWeb 的 WebGL/音频/本地资源兼容、真机性能，以及 ArkTS/native 局域网 transport 与 Web 游戏之间的高频 bridge。

### 候选 B：Cocos Creator 原生运行时

Cocos Creator 3.8.5 起官方支持发布到 HarmonyOS NEXT，较新 3.8 LTS 版本继续包含鸿蒙适配。使用它可以获得面向游戏的原生渲染、输入、生命周期和鸿蒙构建链。

代价是重写 Three.js `GameWorld`、Renderer、DOM HUD、Web Audio、场景编辑器与视觉测试适配。`MatchEngine`、地图数据、协议载荷和大部分规则测试有机会保留。Cocos 文档提供原生 `WebSocketServer`，但同时警告原生 Release 模式可能没有该全局对象，因此在目标鸿蒙 Release HAP 上验证前，不能把手机主机问题视为已解决。

### 已确认的选择顺序

先验证候选 A，因为它符合原生交付定义且保留的现有资产最多；若 ArkWeb 无法在目标机型稳定达到画质、帧时间或 bridge 要求，再评估候选 B。纯 ArkUI + XComponent/C++ 自研渲染只作为两条路线都失败后的备选，不进入首轮验证。

这不是最终架构决定。技术验证完成后，应新建 ADR；现有 `docs/adr/0001-use-socketio-authoritative-stack.md` 也需要被补充或取代，因为 Node.js + Socket.IO Server 不能直接视为鸿蒙 APP 内可用能力。

## 3. 房间主机不等于房主

这两个概念必须分开：

- **房间主机**是设备身份：发起人的手机拥有权威状态并对局域网监听。首版不做主机迁移；房间主机进程终止，房间也终止。
- **房主**是玩家权限：可以开始对局和调整允许的房间设置。它通常属于发起人，但权限转移不等于权威模拟迁移到另一台手机。

当前 `RoomManager.promoteHost()` 可以转移 `isHost` 权限，却不能转移服务器进程。迁移后不得用“提升房主”掩盖“房间主机已经消失”。

## 4. 目标架构

```text
                         ┌──────────────────────────────┐
                         │ Shared deterministic core    │
                         │ MatchEngine / projection /   │
                         │ room rules / wire messages   │
                         └──────────────┬───────────────┘
                                        │
                     ┌──────────────────┴──────────────────┐
                     │                                     │
        ┌────────────v────────────┐            ┌───────────v────────────┐
        │ Desktop development     │            │ Harmony native APP     │
        │ keyboard + debug tools  │            │ touch + landscape      │
        │ local host adapter      │            │ LAN host/join adapter  │
        └────────────┬────────────┘            └───────────┬────────────┘
                     │                                     │
                     └──────── same messages ──────────────┘
```

共享的不是某一个宿主，而是四类稳定语义：

1. 权威规则：`MatchEngine`、`ViewerProjection`、地图与调参数据。
2. 房间规则：加入、开始、准备、断线、重连、角色轮换和逐玩家投影。
3. 玩家意图与 wire messages：移动、朝向、动作、请求/响应和权威帧。
4. 可重复测试场景：规则测试、协议测试、确定性状态和性能指标定义。

宿主相关行为放在真实 seams 后面：输入、展示运行时、局域网 transport、发现、生命周期和持久化。

## 5. 房间核心必须从 Socket.IO 中提取

当前 `GameRoom` 与 `RoomManager` 直接依赖 Socket.IO 的 socket、room、emit 和 connection 事件，同时使用 `node:crypto` 与 `process.env`。这些 implementation 适合桌面 Node.js 服务器，但不是可直接放入鸿蒙应用的房间核心。

建议形成一个较深的 `HostedRoom` module：

- 拥有玩家集合、房主权限、对局生命周期、输入新鲜度、权威 tick、事件和逐玩家投影。
- 接受时钟、随机数和 peer transport，不自行创建 Node.js、ArkTS 或 Cocos 网络对象。
- 对外只处理连接、断开、请求消息和时间推进；调用方不需要知道 `MatchEngine` 或广播细节。
- 桌面测试与鸿蒙运行时通过同一个 interface 验证房间行为。

概念性 interface 如下，名称和粒度需要在实现前通过设计测试再定：

```typescript
interface HostedRoom {
  connect(peer: RoomPeer): void;
  receive(peerId: string, message: ClientMessage): void;
  disconnect(peerId: string): void;
  advance(nowMs: number): void;
  close(reason: HostCloseReason): void;
}
```

`RoomPeer` 只负责向一个连接发送消息。这样可保留两个真实 adapters：

- 桌面开发/测试 adapter。
- 鸿蒙局域网 adapter。

不应在鸿蒙侧重新实现一份房间规则，也不应让触控、ArkWeb 或 Cocos 对象进入 `HostedRoom`。

## 6. Transport 选择

### 为什么不能原样嵌入当前 Node.js 服务器

现有服务器入口依赖 Node HTTP server、Socket.IO Server、`node:crypto`、环境变量和 Node 进程生命周期。HarmonyOS 的 Node-API 是原生模块互操作 interface，不等于设备内置完整 Node.js runtime，也不能据此推断 npm 的 Socket.IO Server 可以直接运行。

可以自行移植/嵌入 Node.js，但这会引入工具链、ABI、包体、漏洞更新和商店审核风险，不作为首选。

### 建议统一消息语义，不强求统一 wire transport

HarmonyOS Network Kit 明确提供 `TCPSocketServer`、`TCPSocket`、Worker 和 mDNS。标准 WebSocket Server 可以通过 C++ 库或经验证的游戏引擎能力获得，但不是应当预设存在的 ArkTS 基础能力。

因此首选验证方向是共享显式消息 schema，由不同 transport adapter 承载：

```typescript
type WireMessage =
  | { type: 'request'; requestId: string; action: ClientAction }
  | { type: 'response'; requestId: string; result: ActionResult }
  | { type: 'room-state'; state: RoomState }
  | { type: 'match-frame'; frame: MatchFrameEnvelope }
  | { type: 'match-events'; events: MatchEventEnvelope };
```

客户端重连仍依赖已有 `playerId + rejoinToken`，不依赖 Socket.IO 的内部会话：

- 桌面日常开发暂时保留 Node + Socket.IO adapter，避免在鸿蒙路线未确定前破坏现有调试链。
- 鸿蒙首选 ArkTS `TCPSocketServer` / `TCPSocket` adapter，使用有长度前缀的消息帧；ArkWeb 与原生侧通过 `WebMessagePort` 传递 `ArrayBuffer`。
- 两种 adapter 必须通过同一组消息 schema、请求/响应、断线和黄金状态向量测试。
- 若必须让桌面浏览器不经过辅助程序直接加入手机房间，再验证 C++ 或 Cocos 的标准 WebSocket Server；也可只提供开发期 Node CLI/proxy。

不建议在 ArkTS TCP 上自行实现 Engine.IO + Socket.IO Server。是否最终保留双 transport，或统一迁移到标准 WebSocket，属于 ADR 级决定。

## 7. 局域网发现与加入

去掉中央服务器后，六位房间码只能验证“要加入哪个房间”，不能告诉客户端“主机 IP 和端口在哪里”。必须增加局域网发现机制。

HarmonyOS Network Kit 提供 mDNS 的服务注册、按类型发现、解析和丢失通知，因此具备生成房间列表所需的平台能力。这里的“附近”只是面向玩家的 UI 文案，技术含义是“当前同一局域网内可通过 mDNS 发现”，不表示物理距离，也不扫描周围设备。

已确认的发现与加入流程：

1. 房间主机监听系统分配或约定的局域网端口。
2. 房间主机调用 `addLocalService` 注册 `_iamaghost._tcp` 服务；service name 标识本次房间实例，attributes 只携带协议版本、构建版本、展示名称和人数等非秘密数据，不携带六位房间码、admission token 或重连 token。
3. 加入端通过 `createDiscoveryService` 订阅 `_iamaghost._tcp`，监听 `serviceFound` / `serviceLost`，再调用 `startSearchingMDNS`。
4. `serviceFound` 只代表发现候选服务；加入端必须调用 `resolveLocalService` 得到 IP、端口和 attributes，校验协议/build 后才加入“附近房间”列表，并按房间实例去重。
5. `serviceLost`、解析失败或网络切换时，从列表移除对应房间。选择一个房间只解决“连哪台主机”，六位房间码或其他 admission 流程仍单独执行。
6. 房间结束或 APP 失去前台时，房间主机先撤销 mDNS 服务并关闭 listener；加入端即使未及时收到 `serviceLost`，连接失败后也必须移除该条目。

大厅以“同一 Wi-Fi 房间列表 + 六位房间码”作为主入口。二维码是 mDNS 发现失败时的玩家后备入口；手工 `IP:port` 只保留给调试或救援场景，不进入儿童主流程。

实现时应把上述差异收进一个较深的房间发现 module。其 interface 只向大厅提供候选房间、解析/可达状态、移除事件和后备加入结果；mDNS、二维码与手工地址是该 seam 后面的 adapter。大厅和游戏页面不应处理 multicast、DNS-SD、原始 IP 或 AP isolation 细节。

mDNS 的能力边界：

- 只能保证尝试发现当前局域网内允许 multicast 的服务，不能跨不同子网、蜂窝网络或互联网发现。
- 路由器关闭 multicast 时，二维码或手工 `IP:port` 可作为发现失败的后备。
- AP isolation/客户端隔离会同时阻止设备间直连；这种情况下二维码和手工地址也无法绕过，只能提示玩家更换 Wi-Fi 或关闭隔离。
- 首版必须在目标 HarmonyOS 6+ 真机、家用路由器和手机热点上验证发现、解析、丢失通知与刷新延迟，不能仅凭 API 存在宣称所有网络可用。

局域网并不等于可信网络。主机仍需执行：

- 协议与构建版本检查。
- 最大连接数、消息大小和输入频率限制。
- 请求 ID 去重及非法消息丢弃。
- 随机重连 token，不把它放进 mDNS 广播。
- 不向小孩连接发送隐藏鬼数据。

## 8. 房间主机生命周期

房间主机手机同时渲染游戏、采集本地输入、推进权威模拟并服务最多四个远端连接。权威 tick 不能依赖渲染帧率，推荐在独立 Worker/线程中运行；具体机制由 ArkWeb 或 Cocos 技术验证决定。

已确认的首版中断语义：

- 房间主机进入后台、锁屏或发生导致 UIAbility 失去前台的系统打断时，立即停止权威对局并结束房间。
- 原生层停止接受新连接、撤销 mDNS、关闭 listener，并尽力向现有 peer 发送 `host-closed` 原因。
- 加入端收到通知或连接断开后进入明确的“房间主机已离开”结果页，不继续倒计时，也不尝试提升另一名房主来伪装主机迁移。
- 发起玩家重新打开 APP 后回到大厅；如需继续游玩，创建一个具有新房间实例、新 token 和新 advertisement 的房间。

不实现后台 socket 保活、checkpoint 后台恢复或主机迁移。前后台真机测试只验证及时终止与资源清理。

## 9. 鸿蒙展示运行时候选

### 9.1 ArkWeb 路线

原生 HAP 职责：

- UIAbility/AbilityStage 生命周期。
- `AUTO_ROTATION_LANDSCAPE` 或等价横屏策略。
- 安全区域、网络权限、mDNS、局域网 listener 和 bridge。
- 将 Vite `dist` 作为本地资源加载进 ArkWeb。

Web 游戏职责：

- Three.js 渲染、DOM HUD、Web Audio、`FramePresenter` 和本地玩家输入。
- 桌面与鸿蒙共享的玩家表现。
- 通过受限 bridge 请求创建/发现/加入房间，并收发规范化 wire messages。

需要注意 ArkWeb 本地资源存在 scheme/CORS 规则。技术验证必须采用最终计划的资源加载方式，而不是依赖开发机 HTTP server。

房间主机中的权威核心有两个 placement，按复用优先级验证：

1. **ArkWeb Web Worker**：`HostedRoom + MatchEngine` 继续使用现有 TypeScript/Vite 构建；ArkTS Worker 只拥有 TCP/mDNS，消息经 `WebMessagePort` 转发。它复用最多，但要验证本地 HAP 中的 Worker 模块加载、后台停止语义和 bridge 开销。
2. **ArkTS Worker**：把 `HostedRoom + MatchEngine` 编译到 ArkTS Worker，与原生 transport 同线程或相邻线程运行。它减少高频 bridge，但要处理 ArkTS 语法、并发与运行时差异。

两者都不能把权威 tick 放在 Three.js 渲染主线程。最终选择必须用相同 seed/input 黄金向量逐 tick 对比桌面结果。

### 9.2 Cocos Creator 路线

可直接保留：

- `MatchEngine` 及其测试数据，必要时做 Ark/JS runtime 语法适配。
- 房间核心与 wire message 的纯 TypeScript 部分。
- GLB 模型、贴图、音频原文件与地图数据。

必须迁移：

- Three.js 场景、材质、阴影和体积手电 implementation。
- DOM HUD 与触控控件。
- Web Audio implementation。
- 场景编辑器、相机调试和浏览器视觉测试 harness。

桌面调试仍然可以保留，但会变成 Cocos Creator 编辑器、Web Preview/桌面运行和共享规则测试，不再是当前 Three.js 页面原样保留。

### 9.3 自研 ArkUI/XComponent/C++ 渲染

能获得最高控制力，但相当于同时自研渲染宿主、资源管线、动画、UI 和网络。当前项目规模下收益不足，暂缓。

## 10. 输入、横屏与安全区域

已确认对局只横屏。原生窗口建议允许横屏与反向横屏自动切换，避免充电口或音量键位置迫使玩家固定握法。

规范化输入保持：

```typescript
interface PlayerIntent {
  movement: { x: number; z: number };
  actionHeld: boolean;
}
```

保留两个 adapters：

- `KeyboardInputAdapter`：桌面 WASD/方向键和空格。
- `TouchInputAdapter`：左侧单摇杆与右侧手电按钮。

由 `GameInput` module 负责单位圆限制、死区、`pointercancel`、窗口失焦、前后台切换和状态归零。触控 adapter 不直接发送网络消息。

手机 HUD 的底部左右区域专门留给操作控件；顶部压缩对局信息；FPS 默认隐藏。所有边缘控件使用鸿蒙窗口安全区域或 ArkWeb `env(safe-area-inset-*)` 的实测结果，不能继续使用当前固定像素安全区。

## 11. 桌面调试作为长期 profile

无论选择哪条鸿蒙路线，都必须提供以下能力：

| 能力 | desktop-dev | harmony-dev | harmony-release |
|---|---|---|---|
| 键盘输入 | 开 | 外接键盘可选 | 默认关 |
| 触控 profile | 强制模拟 | 开 | 开 |
| 房间主机 | 本机开发 adapter | 手机局域网 adapter | 手机局域网 adapter |
| 连接手机房间主机 | 必须 | 必须 | 必须 |
| 调参/诊断 | 完整 | 折叠面板或 DevTools | 默认隐藏 |
| 场景编辑 | 桌面专用 | 不要求 | 不包含 |
| 确定性状态 | 必须 | 调试构建必须 | 不包含 |
| 自动化测试 | 规则、协议、视觉、联机 | Hypium/真机冒烟补充 | 发布门禁 |

桌面调试必须能覆盖两种模式：

1. 桌面自己启动房间主机，快速跑规则和多客户端测试。
2. Node 协议测试客户端或开发期 proxy 加入鸿蒙手机主机，验证真实 mDNS/地址、消息 schema 和跨宿主一致性；只有选定标准 WebSocket Server 后，桌面浏览器才能直接连接手机。

## 12. 双路线技术验证门

在决定框架或大规模重构前，只做可丢弃 prototype，不接入正式玩法分支。

### Gate A：ArkWeb 最大复用验证

- 生成最小原生 HAP，ArkWeb 从包内加载 Vite 静态产物，不依赖外部浏览器或开发服务器。
- 渲染当前房屋、角色、动画、阴影与体积手电。
- 验证 WebGL、Web Audio、本地 GLB/JSON/audio 资源、DOM HUD、Pointer Events 和 DevTools。
- ArkTS Worker 使用 `TCPSocketServer` 启动局域网 listener，第二台设备可连接；`WebMessagePort` 以 `ArrayBuffer` 连续处理 30 Hz 输入和 20 Hz 帧，持续 15 分钟。
- 分别验证权威核心位于 ArkWeb Web Worker 和 ArkTS Worker 的最小链路，记录源码复用、帧延迟、线程阻塞与每 tick 一致性；满足门槛后只保留较深且更稳定的一种。
- 同时测 host 手机的 P95 帧时间、温度/降频、内存，以及退后台后房间终止、端口关闭和 mDNS 撤销。
- 原型 transport 允许使用明文帧，不实现 TLS、pinning、应用层加密或对抗性 admission；仍须保留协议/build 校验、消息长度与频率限制、输入范围验证和确定性断线清理，因为这些属于正确性与稳定性。

### 当前真机输入

- 设备：HUAWEI Pura X，型号 VDE-AL00，phone target。
- 系统界面版本：HarmonyOS 6.1（用户确认）。
- HDC 实测：`const.ohos.fullname=OpenHarmony-26.0.0.16`、API 26；安全补丁 2026-03-01。
- 官方版本映射：HarmonyOS 6.1.0 = API 23、HarmonyOS 6.1.1 = API 24、HarmonyOS 7 Developer Beta = API 26；因此上述两项分别记录，不推导为官方对应关系。
- SDK 策略：`compileSdkVersion` / `targetSdkVersion` 使用 API 26，`compatibleSdkVersion` 使用 HarmonyOS 6.1.0 对应的 API 23。
- 架构：`arm64-v8a`；硬件版本 HL1DJYM。
- 工具与连接：`hdc 3.2.0d` 和 `devecocli` 均已识别该 active device。
- `const.product.chipname`、`const.product.socmodel` 和 `const.product.board` 未暴露有效值；不根据商品资料猜测 SoC，Gate A 以实测性能为准。
- 不在文档中记录设备序列号。

### Gate B：Cocos Creator 原生验证

- 用 Cocos Creator 3.8.5+ 生成 HarmonyOS NEXT Debug 与 Release HAP。
- 导入一个现有 GLB、动画和地图片段，复现最小聚光灯/遮挡效果。
- 验证标准 WebSocket 客户端，并在 Release HAP 中验证 `WebSocketServer` 是否真实存在、可监听局域网且能接入五个 peer。
- 验证 ArkTS/JS bridge、横屏、安全区域、音频和前后台事件。
- 估算迁移 `GameWorld`、HUD、场景编辑器和视觉测试的工作量。

### 选择规则

- Gate A 达到目标机型性能并证明 listener/bridge 稳定：采用 ArkWeb 路线。
- Gate A 失败于不可修复的性能或平台能力，Gate B 通过：采用 Cocos 路线。
- 两者的局域网 server 能力都失败：评估 C++ 原生 WebSocket transport；不要退回公网服务器，因为它违反已确认产品约束。

## 13. 验收矩阵

最低自动化与真机矩阵：

| 场景 | 桌面 | 鸿蒙加入端 | 鸿蒙房间主机 |
|---|---:|---:|---:|
| 规则与投影确定性 | 必须 | 共用产物 | 共用产物 |
| 创建、发现、加入 | 必须 | 必须 | 必须 |
| 键盘/触控等价意图 | 必须 | 必须 | 必须 |
| 2–5 人对局 | 自动化 | 真机 | 真机 |
| 主机退后台后结束房间 | 模拟 | 必须提示 | 必须清理 |
| 网络切换/主机终止 | 模拟 | 必须提示 | 必须清理 |
| 高低画质与热稳定 | 浏览器基线 | 必须 | 同时承载 server 时必须 |
| 隐藏鬼信息不泄漏 | 必须 | 必须 | 必须 |

迁移完成的定义：

- 玩家通过鸿蒙原生 HAP 完成局域网创建、发现、加入、对局、结算和再来一局。
- 房间主机手机在渲染本地玩家画面的同时稳定服务最多四个远端玩家。
- 房间主机与房主的失败语义明确，主机终止不会错误地假装完成权限迁移。
- 桌面仍可运行共享规则测试、启动本地房间、加入真机房间并执行调试/自动化流程。
- 目标真机达到约定的帧时间、温度、内存和 15 分钟稳定性门槛。

## 14. 原型范围与开发准备已确认

产品层面的宿主、系统范围、横屏、操作、加入体验、房间主机退后台语义和原型安全边界都已确认；用户已经授权开始原型实现。

### 当前已经满足

- DevEco CLI 已安装并可用，开发者账号与个人团队状态可用。
- Pura X 真机已经通过 HDC 连接，可以作为 Gate A 的首台目标机。
- Windows 时区为 UTC+8，满足自动调试签名的本地时间要求。
- 原型所需的 `INTERNET` 与 `GET_NETWORK_INFO` 属于普通 system_grant 权限，只需在模块配置中声明，不需要开发者平台 ACL 或运行时弹窗。

### 可以后补

- 首次单机真机运行可使用“未关联注册应用”的自动调试签名，无需预先在 AppGallery Connect 创建应用，也无需手工准备证书、Profile 或登记 UDID。
- 在进入两台手机联机验证前，再固定 AppGallery Connect 应用、APP ID 和手动调试签名，并把所有测试机加入调试 Profile。
- 发布证书、发布 Profile、商店资料、备案与隐私材料均不阻塞当前原型。

### 工程身份已固定

- `bundleName` 是工程与签名身份的一部分，已确认使用 `com.zero.gamehack.iamaghost`；在关联 AppGallery Connect 应用和多机调试前不再更改。
- 可以创建工程和实现 Gate A；首次安装真机时再生成自动调试签名。

## 15. 暂缓或拒绝的方案

### Capacitor

Capacitor 官方目标平台不包含 HarmonyOS NEXT。社区移植即使存在，也不能在缺少维护、发布和原生 server 证据时成为本项目基线。拒绝作为主路线。

### 玩家通过浏览器打开移动 Web

违反已确认的原生 APP 入口要求。Web 构建只保留为桌面调试或 ArkWeb 内嵌资源，不作为玩家分发形态。

### 公网或电脑房间服务器

违反房间主机必须由发起人手机承担的产品约束，只能保留为桌面自动化 adapter，不能成为正式运行依赖。

### 在鸿蒙 APP 内直接运行现有 Node.js + Socket.IO

需要自行移植完整 Node runtime 并长期维护 native 依赖，且尚无项目级实机证据。暂缓；只有标准 WebSocket/native transport 验证失败后才重新评估。

## 16. 外部依据

- [HarmonyOS ArkWeb 简介](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/web-component-overview)：原生应用可用 Web 组件、JavaScriptProxy、DevTools 和 Web 自动化能力。
- [HarmonyOS Web 本地页面加载](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/web-page-loading)：本地资源可随应用加载，但需要处理 scheme、CORS、存储和网络权限。
- [HarmonyOS 前端页面调用应用侧函数](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/web-in-page-app-function-invoking)：ArkWeb 页面可通过 JavaScriptProxy 调用 ArkTS 应用侧能力。
- [HarmonyOS mDNS 管理](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/js-apis-net-mdns-V5)：提供局域网服务注册、发现和解析能力。
- [OpenHarmony Socket API](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-socket.md)：ArkTS Network Kit 提供 TCP client/server、TLS 和 UDP 能力，并建议网络工作使用 Worker/taskpool。
- [OpenHarmony 连续任务指南](https://github.com/openharmony/docs/blob/master/en/application-dev/task-management/continuous-task.md)：普通第三方应用的后台活动受限，没有可无条件用于后台局域网游戏服务器的通用常驻类型。
- [HarmonyOS 窗口旋转](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/window-rotation)：支持固定横屏与自动横屏旋转策略。
- [Node.js 平台支持等级](https://github.com/nodejs/node/blob/main/BUILDING.md)：OpenHarmony arm64 仍列为 Experimental，不能作为普通 HAP 可稳定嵌入完整 Node runtime 的证据。
- [Cocos Creator 发布到 HarmonyOS NEXT](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-openharmony.html)：Cocos Creator 3.8.5 起支持 HarmonyOS NEXT，3.8.6/3.8.7 继续提供性能和原生通信适配。
- [Cocos Creator WebSocket Server](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/websocket-server.html)：原生构建可选 WebSocket server feature，但文档明确提示 Release 模式可能不存在，必须实机验证。
- [Capacitor HarmonyOS 支持请求](https://github.com/ionic-team/capacitor/issues/7173)：官方仓库将 HarmonyOS 支持请求关闭为 `not planned`。

## 17. 文档演进

- 前序讨论阶段只记录已确认约束、候选设计和验证门，未修改业务代码、依赖或构建配置。
- 技术验证完成后，在本文记录证据与选择结果。
- 随后创建新的 ADR，记录鸿蒙运行时、手机房间主机和 wire transport 的最终选择，并标明是否取代 ADR-0001。
- 用户已于 2026-08-21 授权原型实现并确认 `bundleName=com.zero.gamehack.iamaghost`；开始 Gate A，但在 Gate A/H1/H2 证据完成前不把原型结构升级为正式迁移方案。
