# 《I Am a Ghost》HarmonyOS 原生宿主与手机房间主机研究记录

- 日期：2026-08-20
- 更新：2026-08-21
- 状态：研究记录；原型范围与首轮真机矩阵已确认，运行时和传输仍待真机验证；不是 ADR，原型实现已由用户另行授权
- 适用目标：HarmonyOS NEXT / HarmonyOS 6.0+ 原生 HAP；不支持旧版 HarmonyOS，不依赖 Android 兼容层
- 已确认约束：ArkUI HAP + 内嵌 ArkWeb 满足原生交付要求，打开 APP 即可进入游戏；发起人的手机承担局域网权威房间服务器；房间主机 APP 退后台或锁屏即结束房间；同一 Wi-Fi 房间列表 + 六位房间码是主加入入口，二维码是发现失败时的后备；目标机为 HUAWEI Pura X，HDC 实测返回 API 26，但官方版本映射是 HarmonyOS 6.1.0=API 23、6.1.1=API 24、HarmonyOS 7=API 26，不能再把“6.1/API 26”写成同一官方版本；当前只做受控局域网原型，暂不设计传输安全；对局横屏；小孩使用左摇杆和右侧按住手电按钮
- 本文边界：只核验平台能力和候选技术路线，不修改代码、配置或依赖

## 1. 结论先行

1. **现有 Vite/Three.js 客户端最直接的原生鸿蒙宿主是自研的轻量 ArkUI 壳 + ArkWeb `Web` 组件。** `Web` 可以加载 HAP 内 `rawfile` 的本地 HTML，并提供 JavaScript、网络、DevTools 和 ArkTS/网页双向通信能力。它能最大限度保留桌面浏览器客户端，但 Three.js/WebGL 2 的实机兼容性、性能和长时间稳定性仍必须用目标手机验证。
2. **Capacitor 不能作为正式鸿蒙路线。** Capacitor 的官方平台和仓库只有 iOS、Android、Web/PWA；其 HarmonyOS 支持请求被关闭为 `not planned`。社区自行移植不能算官方支持。
3. **手机房间主机是本次迁移的最大架构变化。** 当前服务端依赖 `node:http`、`socket.io` 和完整 Node.js 运行时。HarmonyOS 的 Node-API 是 ArkTS/JS 与 C/C++ 的桥，不是 Node.js 运行时。Node.js 上游目前把 OpenHarmony arm64 列为 Experimental，且不发布官方 OpenHarmony 二进制；这不足以证明普通 HAP 能原样捆绑并稳定运行当前 Node + Socket.IO 服务。
4. **官方平台能力足以在手机上实现局域网服务，但不等于能无改动运行现有服务。** ArkTS Network Kit 提供 TCP/UDP、TCP 服务端、TLS 服务端、网络变化监听和 mDNS。可行路线是把权威规则与传输 adapter 分开：桌面继续使用 Node + Socket.IO；鸿蒙使用 ArkTS/C++ 的原生传输和 mDNS，网页客户端通过 ArkWeb bridge 访问原生网络层。
5. **现成框架没有同时解决“复用现有 Three.js”和“手机内权威服务器”。** Taro Harmony Hybrid、uni-app x 可以提供鸿蒙 Web 容器，但比直接写薄 ArkUI 壳多一层框架；Cocos Creator、LayaAir、团结引擎明确支持 HarmonyOS/OpenHarmony 游戏发布，但都属于换引擎重写，应只作为 ArkWeb 性能不达标后的兜底。

当前最值得继续讨论的基线是：

```text
desktop-dev
  Vite/Three.js UI ── Socket.IO adapter ── Node authoritative host

harmony-production
  ArkUI shell
    ├─ ArkWeb: 同一份 Vite/Three.js 表现客户端
    ├─ WebMessagePort / JavaScript bridge
    └─ ArkTS/C++ native transport
         ├─ 加入者：TCP client
         └─ 房间主机：TCP server + mDNS + authoritative room
```

这里的关键不是维护两套玩法，而是允许桌面和鸿蒙拥有不同的传输 adapter，同时只维护一套权威规则、协议语义和客户端表现。

## 2. 证据等级

- **事实**：来源明确承诺或 API/源码直接存在。
- **工程推断**：由已知 API 能力推导出的可行组合，尚未在本项目真机证明。
- **未知**：官方资料不足，必须通过最小原型或上架流程验证。

后文不会把“有相关 API”写成“本项目已经可运行”。

## 3. 复用 Vite/Three.js 的原生宿主

### 3.1 ArkUI `Web` / ArkWeb：首选验证路线

**事实**：ArkUI `Web` 组件能用 `$rawfile('index.html')` 或 `resource://rawfile/` 加载 HAP 内的本地网页；使用在线资源时需声明 `ohos.permission.INTERNET`。[Huawei `Web` 组件 API](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-basic-components-web)

**事实**：ArkWeb 可显式开启 JavaScript、DOM Storage、图片和网络资源访问，并提供 DevTools 排查页面问题。[ArkWeb 页面加载与调试](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/web-page-loading)

**事实**：华为文档把 ArkWeb 描述为基于 Chromium 的 Web 引擎，并列出了不同 HarmonyOS 版本对应的内核版本；当前文档中 HarmonyOS 4.1–5.1 对应 M114，HarmonyOS 6.0/6.1 对应 M132。[ArkWeb 简介](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/web-component-overview)

**事实**：网页与 ArkTS 可以通过 `javaScriptProxy()` / `registerJavaScriptProxy()` 相互调用；也可以通过 `WebMessagePort` 建立支持 `string` 和 `ArrayBuffer` 的双向数据通道。[前端调用应用侧函数](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/web-in-page-app-function-invoking)、[应用侧与网页数据通道](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/web-app-page-data-channel)

**工程推断**：ArkWeb 是目前唯一能直接保留 DOM、Canvas、Web Audio 和 Three.js `WebGLRenderer` 运行模型的官方宿主。原生壳只需要负责横屏、沉浸式、安全区、生命周期、网络权限、设备发现和原生网络桥。

**未知**：Three.js 当前 `WebGLRenderer` 依赖 WebGL 2，[Three.js 官方文档](https://threejs.org/docs/pages/WebGLRenderer.html)并不保证每台鸿蒙设备的 ArkWeb GPU 驱动、扩展、压缩纹理、上下文恢复和持续性能。本项目还使用阴影、体积手电、音频和 GLB；这些必须在目标真机上逐项验证，不能仅凭“内核是 Chromium”判定完成。

本地产物还有一个已知装配风险：ArkWeb 会限制 `file://` / `resource://` 下的跨源资源请求。Vite 产物需要使用相对资源路径，或由原生侧用请求拦截/自定义 URL 映射本地资源；华为的页面加载指南给出了通过 `onInterceptRequest` 映射本地资源的方案。[ArkWeb 本地资源加载说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/web-page-loading)

因此，`base: './'` 是否足够、动态 import、GLB、音频和 Worker 是否都能从 `rawfile` 正常加载，是第一个原型的验收项，而不是现在修改 Vite 配置的理由。

### 3.2 XComponent：原生引擎画布，不是 Three.js 容器

**事实**：XComponent 向原生 C/C++ 暴露 `NativeWindow`，官方典型用法是在其中建立 EGL/OpenGL ES surface 或承载媒体/游戏画面。[OpenHarmony XComponent 开发指导](https://gitee.com/openharmony/docs/blob/54a84aefd5b06fd937a20063d39ee73444b41344/zh-cn/application-dev/ui/napi-xcomponent-guidelines.md)、[OpenHarmony EGL 示例](https://gitee.com/openharmony/docs/blob/0bc3576c347edc0e7bc4daa9d175edbef2f2d85c/zh-cn/application-dev/graphics/native-image-guidelines.md)

**工程结论**：Three.js 需要浏览器 `HTMLCanvasElement`/`OffscreenCanvas` 与 `WebGL2RenderingContext`。把画面切到 XComponent 意味着迁移到 C++/原生渲染器或另一游戏引擎，不是把当前 canvas 换一个宿主参数。

XComponent 应只在 ArkWeb 真机验证失败后进入讨论。它能换来更直接的 GPU 控制，但代价是重做渲染、资源、输入、音频和大量桌面浏览器调试资产。

## 4. Capacitor 与候选框架的官方支持程度

### 4.1 Capacitor

**事实**：Capacitor v8 官方文档的原生平台导航只有 iOS、Android 和 Web/PWA；插件实现语言也只说明 Swift、Java/Kotlin 与 Web。官方仓库同样只包含 `ios`、`android` 和 Web core。[Capacitor 官方文档](https://capacitorjs.com/docs)、[Capacitor 官方仓库](https://github.com/ionic-team/capacitor)

**事实**：Capacitor 官方仓库中的 HarmonyOS 支持请求被维护者关闭为 `not planned`。[ionic-team/capacitor #7173](https://github.com/ionic-team/capacitor/issues/7173)

结论：Capacitor 不是鸿蒙官方支持方案，主设计中“后续加入 Capacitor”的表述不再适用于已确认的最终平台；本研究记录不直接修改主设计。

### 4.2 现成框架

| 方案 | 官方支持事实 | 对本项目的实际含义 |
|---|---|---|
| 直接 ArkUI + ArkWeb | 华为官方组件，可加载 `rawfile`、调试并与 ArkTS 通信 | 最薄、最透明，最适合保留现有 Vite/Three.js；原生网络和生命周期仍需自己实现 |
| Taro Harmony Hybrid | Taro 官方称其运行时仍是 WebView，在 H5 基础上用原生壳和 JSBridge 扩展能力；从 Taro 3.6.24 起支持。[Taro Harmony Hybrid](https://docs.taro.zone/en/docs/harmony-hybrid/) | 可参考其壳工程，但主要解决 Taro 小程序/H5 API 迁移；不解决手机房间主机，也不比直接 ArkWeb 明显更省事 |
| uni-app x | DCloud 官方从 4.61 起支持 HarmonyOS NEXT，编译到 ArkTS；其 `web-view` 组件在 HarmonyOS 4.61 起可承载本地或网络网页。[uni-app x 鸿蒙指南](https://doc.dcloud.net.cn/uni-app-x/app-harmony/)、[uni-app x `web-view`](https://doc.dcloud.net.cn/uni-app-x/component/web-view.html) | 能做壳，但引入 HBuilderX/UTS/uni-app 项目模型；已有 Vite 工程没有明显收益，且仍需自写原生房间主机 |
| Cocos Creator | 3.8.5 起官方支持发布 HarmonyOS NEXT。[Cocos Creator HarmonyOS NEXT](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-harmonyos-next.html) | 正式游戏引擎路线，但必须从 Three.js 迁移场景、表现和工具，不是包装器 |
| LayaAir | 3.2.0 起官方支持发布 HarmonyOS NEXT。[LayaAir HarmonyOS NEXT](https://layaair.com/3.3/doc-en/released/Harmony/readme.html) | 同样属于换引擎，不直接复用当前 Three.js 客户端 |
| 团结引擎 | Unity 中国官方列出 OpenHarmony 构建、HAP、XComponent/ArkUI 集成与 UAAL。[团结引擎帮助中心](https://unity.cn/tuanjie/help-center) | 原生图形兜底候选，但需把项目迁移到 Unity/C# 生态；也不会自动解决当前 Node/Socket.IO 房间主机服务 |
| Flutter OpenHarmony | Flutter 上游没有直接支持计划；OpenHarmony-SIG 维护独立适配。[Flutter 官方 issue](https://github.com/flutter/flutter/issues/150536)、[OpenHarmony-SIG Flutter](https://gitee.com/openharmony-sig/flutter_flutter/blob/bbf8ff712c7ec87299c20907645079001b5544fc/README.en.md) | 不复用 Three.js，且支持责任不在 Flutter 上游，不应为了本项目引入 |
| Avalonia | 官方支持平台未列 HarmonyOS，未列平台归 Tier 3。[Avalonia 支持平台](https://docs.avaloniaui.net/docs/supported-platforms) | 无官方鸿蒙支持证据 |
| Qt for OpenHarmony | OpenHarmony-SIG 有 Alpha v6 发布资料，目标为较早 OpenHarmony/API 10。[Qt for OpenHarmony releases](https://gitee.com/openharmony-sig/qt/releases) | Alpha/旧平台且需要重写，不适合作为首选 |

这里没有“装上某个跨端框架就可以原样运行 Socket.IO 服务端”的证据。前端壳与手机房间主机必须分别决策。

## 5. 手机作为局域网权威服务器

### 5.1 当前服务为什么不能直接假定可搬上手机

当前仓库的 [`server/createGameServer.ts`](../server/createGameServer.ts) 直接导入 `node:http` 和 `socket.io`，在 HTTP server 上安装 Socket.IO；[`server/index.ts`](../server/index.ts) 读取 `process.env`、监听 `0.0.0.0:5191` 并处理进程信号。`RoomManager` 和 `GameRoom` 又依赖 Socket.IO 的 socket、room、ack 与定向广播语义。

**事实**：HarmonyOS Node-API 是基于 Node-API 规范的 ArkTS/JS 与 C/C++ 互操作机制；官方架构中的 JS 执行环境是 ArkCompiler ArkTS Runtime。它不是 `node` 可执行文件，也不提供 `node:http`、`process` 或 npm 服务端生态。[HarmonyOS Node-API 简介](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/napi-introduction-V5)

**事实**：Node.js 上游当前把 `OpenHarmony | arm64 | >= 5.0` 列为 **Experimental**；上游对 Experimental 的定义是可能无法编译或测试不通过、不阻断发布，而且官方二进制列表没有 OpenHarmony。上游同时建议生产应用只运行在 Tier 1 或 Tier 2 平台。[Node.js `BUILDING.md`](https://github.com/nodejs/node/blob/main/BUILDING.md)

**事实**：OpenHarmony 源码树包含 Node/libwebsockets 等第三方组件，但“源码树中存在”不等于“普通 HarmonyOS NEXT HAP SDK 提供可分发的完整 Node runtime”。例如 OpenHarmony 的 libwebsockets 构建中能看到 HTTP/WebSocket 服务端源码，[OpenHarmony `third_party_libwebsockets`](https://gitee.com/openharmony/third_party_libwebsockets/blob/master/BUILD.gn)；未找到华为官方面向普通应用的“把 Node + Socket.IO 服务打进 HAP”指南。

结论：原样运行当前服务端不是已否定的物理可能性，但只能作为高风险技术验证，不能作为设计前提。

### 5.2 官方已经提供的服务端基础能力

**事实**：Network Kit 的 ArkTS socket 模块支持 UDP、TCP、TLS，并从 API 10 起提供 `TCPSocketServer`，可 `listen`、接受连接和取得本地地址；相关 socket 操作要求 `ohos.permission.INTERNET`。官方还建议把网络操作放在 Worker 或 taskpool，避免阻塞 UI 线程。[OpenHarmony Socket API](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-socket.md)

**事实**：`ohos.permission.INTERNET` 是 normal、`system_grant` 权限，可由普通应用在模块配置中声明，不需要运行时用户授权。[OpenHarmony 权限定义](https://gitee.com/openharmony/security_access_token/blob/master/services/accesstokenmanager/permission_definitions.json)

**事实**：Network Kit 的 mDNS 能在局域网添加、删除、发现和解析服务，服务信息包含类型、名称、host、port 和自定义属性；初始 API 从 API 10 起提供。[OpenHarmony mDNS API](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-mdns.md)

**事实**：Network Kit 能取得活动网络、网卡、link address 和路由，并监听 `netAvailable`、`netLost`、`netCapabilitiesChange` 与 `netConnectionPropertiesChange`。获取这些信息需要 `ohos.permission.GET_NETWORK_INFO`。[OpenHarmony 网络连接 API](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-connection.md)

这些能力足以构建原生局域网房间主机，但需要更换传输层或补齐 HTTP/WebSocket/Socket.IO 服务端语义。

### 5.3 可选技术路径

| 路径 | 规则复用 | 传输复用 | 官方成熟度 | 主要风险 | 当前判断 |
|---|---:|---:|---:|---|---|
| A. 在 HAP 内嵌完整 Node + 当前 Socket.IO server | 高 | 高 | Node/OpenHarmony 仍是 Experimental；无普通 HAP 官方集成指南 | 构建、HAP 分发、启动模型、体积、后台、native addon 和商店审核均未知 | 只做时间盒原型，不承诺产品路线 |
| B. ArkTS `TCPSocketServer`，所有鸿蒙客户端由原生 TCP adapter 联机，ArkWeb 只通过 bridge 收发游戏消息 | 中到高 | 低 | TCP server、Worker、bridge、mDNS 都是官方 API | 需要移除移动端 Socket.IO wire protocol；`MatchEngine`/协议源码需通过 ArkTS 语法与并发审核 | **最稳的官方能力组合，首选讨论** |
| C. HAP 内 C/C++ WebSocket server，ArkWeb 直接用标准 WebSocket 连接 | 中到高 | 中 | NDK、XComponent/Node-API 与 native socket 有官方支持；具体 WebSocket server 库需确认可随 HAP 链接 | C++ 库移植、Node-API bridge、HTTP Upgrade、TLS 和 ABI 维护 | 若必须让桌面浏览器直接连手机，可验证 |
| D. 在 ArkTS TCP 上自行实现 Engine.IO + Socket.IO server | 高 | 表面高 | 无官方 Socket.IO server 实现 | 协议复杂、维护价值低、容易与客户端版本漂移 | 不建议 |
| E. 换 Cocos/Laya/团结引擎 | 低 | 低 | 引擎有官方鸿蒙发布路径 | 整体重写，且仍要解决 P2P 房间主机协议 | 仅图形性能兜底 |

路径 B 的具体含义是：

- 鸿蒙端 Web 页面不直接创建 Socket.IO 连接；它把 `create-room`、`join-room`、`input-frame` 等项目消息交给原生 transport adapter。
- 加入者的 ArkTS 原生层使用 `TCPSocket`；房间主机原生层使用 `TCPSocketServer`。
- `WebMessagePort` 使用 `ArrayBuffer` 传二进制帧，避免把每个 60 Hz 输入/快照都走字符串 JSON bridge；格式仍需先以正确性为主，再做性能优化。
- 桌面浏览器继续使用当前 Socket.IO adapter 和 Node server，保留零摩擦调试。
- 移动与桌面必须共享消息 schema、版本、权威规则和黄金测试向量；不能各写一套 `MatchEngine` 后仅靠人工同步。

路径 B 还有一个尚未证明的关键点：`MatchEngine` 虽然不依赖 DOM/Three.js/Socket.IO，但 ArkTS 只保留大部分 TypeScript 语法并增加静态限制。[ArkTS 官方介绍](https://developer.huawei.com/consumer/en/arkts/) 因此需要单独验证它能否作为共享源码编译到 ArkTS Worker；若不能，应先缩窄不兼容语法，而不是复制规则实现。

### 5.4 桌面调试如何继续成立

建议把“桌面调试”拆成两个层次：

1. **日常玩法与表现调试**：桌面 Vite + Node + Socket.IO 完全保留，键盘、Playwright、场景编辑器和调试 GUI 不受鸿蒙工具链拖累。
2. **鸿蒙传输/房间主机验证**：由真机 HAP 和一个 Node CLI 协议测试客户端验证；如必须让桌面浏览器加入手机房间，可额外做开发期 PC proxy，把浏览器 Socket.IO 转成手机的自有 TCP 协议，或选择路径 C 的标准 WebSocket server。开发 proxy 不进入生产架构。

这比强迫所有桌面开发都经过 DevEco Studio 更能保留现有效率，但它要求协议 conformance tests 证明两种 adapter 语义一致。

## 6. 局域网发现、监听与地址分享

### 6.1 能否显示“附近房间列表”

**结论：可以。** HarmonyOS NEXT / HarmonyOS 6.0+ 原生 HAP 可以用系统 mDNS API 发现指定服务类型，并在 ArkUI 中维护一个动态“附近房间”列表；它不需要浏览器参与。但这里的“附近”是**当前本地网络中能被 mDNS 看见**，不是地理距离、蓝牙距离或一个由系统直接返回的完整房间数组。

**事实**：`@ohos.net.mdns` 从 API 10 起提供局域网服务的添加、发现、解析和移除；`createDiscoveryService(context, serviceType)` 按服务类型创建发现对象，`startSearchingMDNS()` 开始在 LAN 上搜索，`serviceFound` / `serviceLost` 分别报告服务出现和移除。[OpenHarmony mDNS API 参考](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-mdns.md)、[OpenHarmony mDNS 开发指南](https://github.com/openharmony/docs/blob/master/en/application-dev/network/net-mdns.md)

**API level 事实**：`addLocalService`、`createDiscoveryService`、`resolveLocalService`、`startSearchingMDNS`、`serviceFound` 和 `serviceLost` 均从 API 10 起可用于普通应用；从 API 11 起支持元服务。命名类型 `DiscoveryEventInfo` 从 API 11 起提供。HarmonyOS 6+ 高于这些最低版本，但仍应以目标手机是否提供 `SystemCapability.Communication.NetManager.MDNS` 为准。

**工程推断**：系统提供事件流，房间列表由 APP 自己维护，而不是调用一次 API 获得稳定快照。房主用 `addLocalService` 发布 `_iamaghost._tcp`；加入者先订阅 `serviceFound` / `serviceLost`，再调用 `startSearchingMDNS()`；UI 依据事件增删项目，并在网络变化或重新开始搜索时重建列表。

**不可保证**：空列表不等于局域网里一定没有房间。它也可能表示 multicast 被网络设备过滤、两台设备不在同一 mDNS 可达域、房主正在切网/退后台，或服务解析超时。因此，“附近房间”只能作为快捷入口，不能作为唯一加入方式。

### 6.2 API 实际返回什么，何时必须解析

`LocalServiceInfo` 的字段约束如下：[OpenHarmony `LocalServiceInfo`](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-mdns.md#localserviceinfo)

| 字段 | API 类型保证 | 对房间列表的含义 |
|---|---|---|
| `serviceType` | 必填；格式为 `_<name>._tcp` 或 `_<name>._udp` | 固定使用项目自己的类型，例如 `_iamaghost._tcp`，避免把其他服务列进来 |
| `serviceName` | 必填 | 可先作为列表展示名和同一服务类型内的事件匹配键；不要放玩家真名或稳定设备标识 |
| `port` | 可选，范围 0–65535 | 房主发布可连接服务时应提供；加入者不能假定 `serviceFound` 已经带有可用端口 |
| `host` | 可选 `NetAddress` | 加入者连接需要；官方特别注明，添加/移除服务时传入的 host 地址不生效，不能靠它强行指定公告网卡 |
| `serviceAttribute` | 可选 `ServiceAttribute[]` | DNS-SD TXT 属性；key 最长 9 个字符，value 是字节数组，不是任意字符串对象 |

各 API / 事件的工程用法应固定为：

1. **房主发布**：监听 socket 成功并取得实际端口后再调用 `addLocalService(context, serviceInfo)`。Promise/callback 返回已添加的 `LocalServiceInfo`。TXT 只放短小的非秘密元数据，例如协议版本、build 兼容版本、展示名、人数和随机房间实例 ID；不放六位房间码、admission token 或其他凭据。
2. **开始搜索**：`startSearchingMDNS()` 本身返回 `void`；`discoveryStart` / `discoveryStop` 回调收到 `DiscoveryEventInfo`，其中 `serviceInfo` 必填、`errorCode` 可选。这两个事件表示搜索状态，不是房间结果。
3. **发现服务**：`serviceFound` 收到 `LocalServiceInfo`，但 `port`、`host`、`serviceAttribute` 在类型定义中均为可选。官方 API 参考明确写明发现后需要调用 `resolveLocalService` 解析，并在示例中直接把 `serviceFound` 数据交给它。[`serviceFound` 与解析示例](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-mdns.md#onservicefound)
4. **解析服务**：`resolveLocalService` 成功后返回 `LocalServiceInfo`，用于取得连接所需的 host、port 和 TXT；它可能以错误 `2204006` 超时。列表可以先显示“正在解析”，只有得到有效 host/port 并通过协议版本检查后才启用“加入”。
5. **服务消失**：`serviceLost` 也只承诺返回 `LocalServiceInfo`，表示服务被移除；可选字段仍不能当作必有。列表删除应依赖发现阶段保存的服务身份，而不应要求丢失事件再次带回 IP/port。[`serviceLost`](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-mdns.md#onservicelost)

**事实与边界**：`resolveLocalService` 对“管理自己发布的本地服务”在指南里写作可选；但对“从 `serviceFound` 得到可连接房间地址”而言，API 参考明确要求解析。首版因此应把 resolve 视为加入流程的必经步骤，而不是依赖某些设备上 `serviceFound` 偶然附带的可选字段。

**当前 OpenHarmony 源码事实（不是跨版本 API 契约）**：浏览结果内部的端口初值是 `-1`，地址和 TXT 初值为空；JS 事件对象构造器又会把当前 port 和 host 对象写入回调。因此 `serviceFound` 在某些实现中不一定“省略”这些可选字段，也可能出现 `port: -1`、空地址等占位值，且发现事件不附带 TXT。解析阶段才查询 SRV、TXT 和地址记录。[浏览结果默认值](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/services/mdnsmanager/include/mdns_protocol_impl.h#L62-L74)、[JS 发现回调对象构造](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/frameworks/js/napi/mdns/src/mdns_callback_observer.cpp#L145-L184)、[resolve 查询 SRV/TXT](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/services/mdnsmanager/src/mdns_protocol_impl.cpp#L486-L510) 因而工程上只把 `serviceFound` 的 `(serviceType, serviceName)` 当作已发现身份；任何 host/port 都必须以 resolve 结果并经实际连接验证为准。

**`serviceLost` 语义边界**：公开契约只称它为“服务被移除”事件，没有承诺原因或触发时限。当前 OpenHarmony 实现可能在收到移除公告、缓存离线检查失败，甚至调用方停止发现并清理当前缓存时发出该事件。[当前实现的离线检查](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/services/mdnsmanager/src/mdns_protocol_impl.cpp#L263-L284)、[停止发现时清理回调](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/services/mdnsmanager/src/mdns_protocol_impl.cpp#L1039-L1062) 因此它只应让附近列表项失效；已经建立的对局是否断开必须由游戏传输连接和心跳判断，不能把 `serviceLost` 解释成“房主主动结束房间”。

### 6.3 网络范围：按本地链路设计，不能承诺跨网段

**事实**：官方文档把 mDNS 的作用范围写为 LAN，并要求设备先连接 Wi-Fi；OpenHarmony 当前实现使用 UDP 5353、IPv4 组播地址 `224.0.0.251` 和 IPv6 组播地址 `ff02::fb`，在处于 UP 且支持 multicast 的非 loopback、非 point-to-point 网卡上加入组播组。[OpenHarmony mDNS socket 实现](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/services/mdnsmanager/src/mdns_socket_listener.cpp#L42-L60)、[IPv4/IPv6 组播入组](https://github.com/openharmony/communication_netmanager_ext/blob/d24bf41f331b2fb3421ff303d77663cec15cfc79/services/mdnsmanager/src/mdns_socket_listener.cpp#L88-L170)

**工程推断**：产品应把可靠范围定义为“两台设备位于同一个允许 mDNS multicast 与端到端 TCP 的本地链路/广播域”。华为/OpenHarmony API 文档只说 LAN，没有承诺“只要 SSID 相同就可发现”，也没有提供跨子网发现开关。

以下情况**不可保证**：

- 不同子网、VLAN 或访客网络默认不能指望互相发现；只有网络管理员额外部署 mDNS reflector/repeater 时才可能跨域，而这不属于 HarmonyOS API 的承诺。即使公告被转发，房间 TCP 端口仍必须有实际路由和防火墙可达性。
- AP/client isolation 可能同时阻断 multicast 和终端之间的单播。二维码或手输 `IP:port` 只能绕过“mDNS 公告没到达”，不能绕过客户端隔离；这种网络上应明确提示无法联机。
- 企业 WLAN、个人热点、mesh、VPN 和省电/切网策略对 multicast 的处理可能不同。必须用目标手机和实际网络矩阵验证，不能把“同一 Wi-Fi”当作验收条件的充分证明。

因此列表 UI 应提供“重新搜索”，并始终保留二维码/手输地址；但后备入口成功前仍要做一次实际连接探测。

### 6.4 权限：当前没有文档化的独立“本地网络”弹窗

**事实**：当前 mDNS API 参考为上述接口标注了 `SystemCapability.Communication.NetManager.MDNS` 和 API level，但没有列出额外的 Required permissions 或 `user_grant` 授权。[OpenHarmony mDNS API 参考](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-mdns.md)

**事实**：真正监听/连接 TCP 或 UDP socket 的 API 要求在 HAP 中声明 `ohos.permission.INTERNET`；如果还要读取 `ConnectionProperties.linkAddresses`、活动网络或监听网络属性变化，则声明 `ohos.permission.GET_NETWORK_INFO`。[OpenHarmony Socket API](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-socket.md)、[OpenHarmony 网络连接 API](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-connection.md)

**事实**：华为当前“开放权限（系统授权）”清单把 `INTERNET`、`GET_NETWORK_INFO`、`GET_WIFI_INFO` 都列为 normal / `system_grant`；这种权限由应用声明后在安装时由系统授予。该公开清单没有 Android/iOS 式名为 `LOCAL_NETWORK` / “本地网络”的独立用户授权项。[华为开放权限清单（更新于 2026-07-28）](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/permissions-for-all)

**工程结论**：按当前 HarmonyOS 6+ 官方公开文档，实现 mDNS 附近列表与局域网 TCP 不需要设计一次 iOS 风格的“允许发现本地网络设备吗”运行时授权流程；需要做的是在模块清单声明 `INTERNET`，并在读取/监听网络信息时声明 `GET_NETWORK_INFO`。仅使用 mDNS 不应为了保险额外申请 `GET_WIFI_INFO`；只有产品确实读取 Wi-Fi 状态、SSID 或使用 P2P 时才申请。

**未知/版本边界**：官方文档没有单独权限，不等于可以对未来 HarmonyOS 版本或所有厂商设备作永久保证。实现前仍应以目标 HarmonyOS 6.x SDK 的 API reference/权限校验和真机首次启动行为复核；若后续官方新增本地网络隐私授权，应按目标 SDK 更新设计。

### 6.5 已确认的房间发现与加入流程

1. 发起玩家进入“创建房间”，原生层才启动监听 socket；优先请求系统分配端口，避免固定端口冲突。
2. 从 Wi-Fi 网络的 `ConnectionProperties.linkAddresses` 选择可达的 IPv4/IPv6 地址，并排除 loopback、蜂窝网和无效地址。
3. 监听成功后注册 `_iamaghost._tcp`；TXT 只公布协议版本、build version、展示名、人数和随机房间实例 ID 等非秘密数据，不公布六位房间码、admission token 或其他凭据。
4. 加入者订阅发现/丢失事件后开始搜索；`serviceFound` 先建立候选项，resolve 成功且实际连接探测通过后才显示为可加入。
5. 同屏显示房间码、mDNS 名称、`IP:port` 和二维码。加入者优先使用附近列表，也允许扫二维码或手输地址。当前原型的二维码只需包含 `IP:port`、房间实例和六位房间码；它只能绕过发现失败，不能绕过 AP/client isolation、路由或防火墙阻断。正式产品化时再重新设计二维码凭据。
6. 房间结束、房间主机终止、应用退后台或网络变化时，先停止接受新连接，再撤销 mDNS，最后关闭 socket 并清除短期密钥。

### 6.6 网络变化

官方网络事件说明：Wi-Fi 切到蜂窝网时会先收到 `netLost`，再收到新网络的 `netAvailable`；连接属性变化也有独立事件。[Network Kit 网络变化事件](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-network-kit/js-apis-net-connection.md)

对房间主机来说，局域网 IP 一旦变化，旧连接和 mDNS advertisement 都不能视为仍有效。首版建议明确：

- 房间主机丢失当前 Wi-Fi 或地址改变：立即暂停/结束房间，通知本机玩家，关闭旧 listener。
- 不尝试把进行中的权威状态无缝迁移到新 IP；这需要额外的 host migration 协议，不属于“重连”。
- 加入者短暂掉线仍使用现有 rejoin token 语义，但只能重连到同一房间主机实例。

## 7. 前后台、锁屏与系统限制

**事实**：OpenHarmony 会限制后台应用活动；没有匹配长时任务的应用会被挂起或回收。连续任务必须属于系统列出的实际业务类型，通知会展示给用户，用户删除通知会终止任务；系统还会检查申报类型和实际负载是否一致。[OpenHarmony Continuous Task 指南](https://github.com/openharmony/docs/blob/master/en/application-dev/task-management/continuous-task.md)

**事实**：`WIFI_INTERACTION` 连续任务只对系统应用开放；`DATA_TRANSFER` 的官方描述是非 hosting 的上传/下载，并要求持续更新进度；`TASK_KEEPING` 在手机上需要受限 ACL 权限。没有一个普通第三方手机应用可以无条件宣称为“通用后台局域网游戏服务器”。

**事实**：华为的后台硬件资源规范要求没有申请相应长时任务的应用在进入后台后主动断开 TCP/UDP socket。[后台硬件资源使用规范](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/standard-background-hardware-V5)

首版的产品规则已经确认：**发起玩家必须保持房间主机 APP 在前台横屏运行；APP 退后台、锁屏或因系统事件导致 UIAbility 失去前台时，立即结束房间。** 不设置返回宽限，不恢复原房间，也不通过伪装成音频播放、数据传输等长时任务保活。

生命周期语义固定为：

- `onBackground` 触发后，立即停止权威对局、停止接受连接、撤销 mDNS、关闭 listener，并尽力向已连接玩家发送 `host-closed`。
- 加入者收到通知或检测到断线后显示“房间主机已离开，房间已结束”，不得自动推举新房间主机。
- 原房间主机回到前台后返回大厅；再次创建时使用新的房间实例、端口、token 和 mDNS advertisement。
- 对局中是否保持屏幕常亮仍需结合真机功耗、发热和系统能力验证，但它不能改变“失去前台即结束”的规则。

## 8. 局域网安全边界

本项目当前交付物被明确限定为受控局域网原型，传输安全暂不进入范围。原型允许使用明文 TCP/自有帧，不要求 TLS、APP pinning、应用层 AEAD、高熵 admission token 或对抗性威胁模型；六位房间码只承担加入体验，不宣称为安全凭据。

以下要求即使在原型中仍保留，因为它们同时属于正确性、稳定性和隐藏信息隔离：

- 新连接先协商协议/build version，再允许创建 player session。
- 对每个连接限制握手次数、消息尺寸、消息速率和并发数；沿用并加强 `parseClientInputFrame` 的范围验证。
- listener 只在房间活动时存在，不开放诊断/调试命令；生产包禁用 `set-debug-tuning`。
- mDNS service name 不包含玩家真名或稳定设备标识。
- 不向小孩连接发送隐藏鬼数据；房间结束后清理连接和临时会话状态。

如果原型未来转为对外分发或正式产品，必须重新打开本节，并在实现前从以下路线中做出有威胁模型支撑的选择：

1. **明文 TCP + token**：实现最简单，只防误入和部分主动连接，不能防同一 WLAN 上的被动窃听/篡改。
2. **TLS server + APP pinning**：平台有 TLS server 基础 API，但局域网 IP 没有公共 CA 证书，需解决房间主机临时证书、公钥通过二维码分发和 pinning；尚需原型。
3. **二维码 PSK + 应用层 AEAD**：用二维码短期密钥派生会话密钥，能避开局域网证书问题，但必须使用平台密码库和经过评审的标准协议组合，不能自行发明加密算法。

本轮接受明文只适用于当前原型，不能被后续 ADR 继承为生产安全结论。

## 9. 必须先做的时间盒原型（仍未授权执行）

### 原型 H1：ArkWeb 客户端宿主

- 把一次 Vite build 的静态产物放入 `rawfile`，不改玩法代码。
- 验证入口、动态模块、GLB、音频、字体、Worker、localStorage 和 source map。
- 在至少一台目标 HarmonyOS NEXT 手机验证 WebGL 2、必要扩展、context lost/restore。
- 横屏运行 15 分钟，记录 P95 帧时间、内存、发热、降频与音频中断。

通过门槛：能完成一局本地确定性演示；没有资源路径阻塞；最低画质达到后续约定的帧时间门槛。

### 原型 H2：手机监听与两机联通

- ArkTS Worker 启动 `TCPSocketServer`，第二台鸿蒙手机通过 `TCPSocket` 连接。
- ArkWeb 与 ArkTS 用 `WebMessagePort` 双向传 `ArrayBuffer`。
- 使用明文原型帧，不把 TLS、pinning、AEAD 或 admission token 作为通过条件。
- 注册/发现 mDNS，同时验证二维码 `IP:port` 后备。
- 测试普通家用路由器、手机热点和开启 AP isolation 的网络。

通过门槛：两机能发现/直连、交换有序帧、检测断线；UI 线程无明显卡顿；停止房间后端口和 mDNS 都撤销。

### 原型 H3：权威规则共享

- 尝试把纯规则 `MatchEngine` 与协议验证编译到 ArkTS Worker。
- 用同一组确定性 seed/input vectors 比较 Node 与 ArkTS 每 tick 输出。
- 记录所有 ArkTS 不兼容语法和运行时差异。

通过门槛：不是“看起来一样”，而是约定的权威状态和玩家投影逐帧一致。

### 原型 H4：Node 直嵌可行性（可选、独立止损）

- 只验证普通 HAP 是否能合法捆绑/启动 Node/OpenHarmony 构建，并加载 `node:http` + Socket.IO 最小服务。
- 同时验证产物体积、启动时延、真机崩溃、前后台、签名和应用市场工具检查。
- 设定严格时间盒；任一环节依赖私有 SDK、系统权限或无法解释的可执行文件启动方式，就停止该路线。

该原型通过也只会把路径 A 从“未知”提升为“候选”，不会自动成为产品方案；Node 上游仍把 OpenHarmony 标为 Experimental。

## 10. 对现有设计的影响、已确认决策与待验证项

主设计已按本研究与本轮讨论更新为：

- 最终发布目标是 HarmonyOS NEXT / HarmonyOS 6.0+ 原生 HAP，不兼容旧版 HarmonyOS 或 Android。
- ArkUI + ArkWeb 已被接受为原生交付形态和首选宿主；用户打开 APP 即可进入游戏，不需要外部浏览器。
- 房间服务不再位于公网或局域网电脑，而位于发起人的手机。
- 房间主机 APP 退后台或锁屏时立即结束房间，不保活、不恢复、不迁移房间主机。
- 当前 ADR 0001 的 Node + Socket.IO 决策继续服务桌面开发；鸿蒙生产 transport 尚待原型验证，验证完成后再用新 ADR 确认 adapter 边界。
- 原生壳不是可选增强，而是负责生命周期、发现和房间主机网络能力的产品组成。

以下产品决策已经关闭：

1. 接受 ArkUI + ArkWeb 作为首选宿主；Cocos/Laya/团结等换引擎方案仅在 ArkWeb 真机性能或兼容性验证失败后重新评估。
2. 只支持 HarmonyOS NEXT / HarmonyOS 6.0+。
3. 房间主机 APP 一旦失去前台就立即结束房间。
4. 首版以“同一 Wi-Fi 房间列表 + 六位房间码”为主加入入口，二维码作为 mDNS 发现失败时的后备；手工地址仅用于调试或救援。
5. 当前只做受控局域网原型，传输安全暂不进入范围；正式产品化时重新决策。
6. 原型目标机已由 HDC/DevEco CLI 识别：HUAWEI Pura X（VDE-AL00），HDC 实测系统参数为 OpenHarmony 26.0.0.16、API 26、arm64-v8a、硬件版本 HL1DJYM。官方版本映射是 HarmonyOS 6.1.0=API 23、6.1.1=API 24、HarmonyOS 7=API 26；因此只把 API 26 记为该测试机实测值，不再把它与 HarmonyOS 6.1 写成同一官方版本。已查询参数未暴露 SoC 名称，不将其作为原型阻塞项。

仍需通过时间盒原型确定：

1. ArkTS TCP + bridge 能否在目标机上满足原型稳定性；若失败，再验证 C/C++ 标准 WebSocket server。该结果决定鸿蒙 adapter，而桌面仍保留 Node + Socket.IO adapter。
2. Pura X 目标真机上的 ArkWeb 性能、兼容性、功耗，以及 mDNS/listener/bridge 的实际行为。

在得到明确实现授权前，不应开始改客户端、服务端、Vite 配置或依赖；原型验证完成后再决定是否需要面向产品化的 ADR。

## 11. 真机开发准备与签名

本节只回答“普通 HAP 第一次在真机上运行之前必须准备什么”。结论适用于普通三方应用；系统应用、企业应用、受限 ACL 权限和应用市场发布另有要求。

### 11.1 先纠正版本口径

**事实**：华为当前版本表将 HarmonyOS 6.1.0 标为 `6.1.0(23)`，将 HarmonyOS 6.1.1 标为 `6.1.1(24)`；华为 2026 年 6 月发布的是 HarmonyOS 7（API 26）Developer Beta。因此，不能把“HarmonyOS 6.1 / API 26”当作官方固定映射。[HarmonyOS 版本说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/changelogs-600)列出了 6.1.0(23) 和 6.1.1(24)，[HarmonyOS 7（API 26）官方招募说明](https://developer.huawei.com/consumer/cn/activity/developerbeta/harmonyos-developer-beta-7-1)则明确把 API 26 归入 HarmonyOS 7。

**工程要求**：创建工程前以真机实际返回的 API version 为准。当前开发环境和目标机实测可使用 API 26 作为 `compileSdkVersion` / `targetSdkVersion`，但为了覆盖项目约定的 HarmonyOS 6.1.0 最低基线，`compatibleSdkVersion` 应设为 `6.1.0(23)`；若最终决定最低只支持 6.1.1，才可提高到 `6.1.1(24)`。可用 `hdc shell param get const.ohos.apiversion` 只读核验每台真机。当前目标机曾同时显示“6.1”产品版本信息和 API 26 系统参数；该组合只记录为目标机实测状态，不外推为官方版本映射。

### 11.2 “能编译”与“能装到真机”是两道门槛

| 动作 | 华为账号/实名 | 签名 | AGC 应用 | 真机 UDID |
| --- | --- | --- | --- | --- |
| 离线创建工程、编辑代码、使用已安装 SDK/Hvigor 编译未签名产物 | 不需要 | 不需要 | 不需要 | 不需要 |
| 模拟器或预览器运行 | 不需要因真机签名而登录 | 可不签名 | 不需要 | 不需要 |
| 普通真机安装/运行 | 取决于取得签名材料的方式 | **必须** | 自动未关联签名可不预建；手动签名需要注册应用 | 自动签名无需手工预注册；手动 debug Profile 必须包含设备 |
| 应用市场发布 | **需要开发者账号及相应认证** | **发布签名必须** | **需要** | 发布 Profile 不以调试设备列表为前提 |

**事实**：本地构建配置中的 `signingConfigs` 和产品的 `signingConfig` 都是可选项，说明编译/打包本身不以登录账号为前提；但华为明确规定，只有签名过的应用才允许安装到真实设备，模拟器/预览器才是未签名例外。[`build-profile.json5` 配置参考](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/ide-hvigor-build-profile-V5)、[HarmonyOS 开发入门：签名文件](https://developer.huawei.com/consumer/cn/develop-novice-guide/)、[模拟器调试说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V2/ide_debug_emulator-0000001115721921-V2)。

因此，`hdc install` 只是把安装请求交给设备的包管理器，**不是签名绕过工具**。华为的 HDC 文档支持 `hdc install example.hap`，但真实设备仍执行签名/Profile 校验；未签名 HAP 不能靠 HDC 安装到普通商业真机。[HDC 安装命令](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/hdc)、[OpenHarmony 安装错误码 17700011：签名校验失败](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-ability-kit/errorcode-bundle.md#17700011-bundle-installation-failure-due-to-signature-verification-failure)。

### 11.3 自动签名与手动签名

#### 首次单机验证：未关联注册应用的自动签名

**事实**：当前 DevEco Studio 的“配置调试签名”提供“未关联注册应用”的自动签名方式。连接目标设备后，在 `Signing Configs` 勾选 `Automatically generate signature`；如果尚未登录，需要先 `Sign In`。此流程不要求开发者事先手工创建 AGC 项目/应用，也不要求手工申请调试证书、手工注册 UDID 或手工申请调试 Profile；DevEco Studio 会生成本地 `.p12`、`.csr`、`.cer` 和 `.p7b` 调试材料，并根据所连设备生成可安装的调试签名。它只适合调试，未关联应用也不能借此在 DevEco Studio 中开通依赖注册应用的开放能力。[配置调试签名](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)。

从 DevEco Studio 6.0.0 Beta5 起，自动签名还提供“关联注册应用”方式。选择这一方式时，需要先有已注册应用；IDE 仍可代办调试签名材料和设备信息，不等于发布签名。[配置调试签名](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)。

**账号结论**：

- 仅创建/编译工程不要求登录，也没有实名认证门槛。
- 自动签名页面明确要求未登录时先 `Sign In`。华为开发者服务协议把“开发者账号”定义为完成在线实名认证的华为账号，因此项目准备应把“可登录的已实名开发者账号”视为自动签名的先决条件。[华为开发者服务协议，第 1.4、2.1 条](https://developer.huawei.com/consumer/cn/devservice/ServiceAgreement/)。
- **公开资料未逐字说明**普通华为账号未实名时，“未关联注册应用”的自动签名会在具体哪一步、以哪个错误码被拒绝。不能把这一实现细节写成已经实测；但它不改变本项目应提前完成实名认证的保守要求。

#### 多设备联调或稳定身份：手动 debug 签名

**事实**：手动签名需要本地密钥库 `.p12` 和 CSR、AGC 签发的调试证书 `.cer`、注册应用/APP ID，以及绑定证书和调试设备的 debug Profile `.p7b`。每台测试手机的 UDID 都必须加入 Profile；UDID 可在开启调试连接后用 `hdc shell bm get --udid` 获取。已有 Profile 增加设备后必须更新并重新下载/配置。[AGC 签名材料与手动流程](https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/harmonyos-sdk-config-agc-0000001101459188)、[修改 Profile 绑定设备](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-provision-api-update-provision-0000002469198766)。

手动签名至少需要在 AGC 注册应用并取得 APP ID。是否还要单独建立/关联 AGC“项目”，取决于当前 AGC 入口和要使用的项目级云能力；**普通 HAP 的签名核心约束是注册应用、证书、Profile 和设备列表，不应把开通某个云 Kit 的项目步骤误写成所有本地 HAP 的额外前提。**

官方建议以下场景使用手动签名：跨设备调试、跨应用交互、断网调试、多开发者共享同一密钥，以及任何要求 `appIdentifier` 或证书指纹保持稳定的场景。[配置调试签名：自动与手动签名适用场景](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)、[OpenHarmony 应用包 FAQ：`appIdentifier`](https://github.com/openharmony/docs/blob/master/en/application-dev/quick-start/common-problem-of-application.md#what-is-appidentifier)。这意味着本项目可以用自动签名完成第一台手机的宿主验证，但开始多手机局域网联调前应切换到稳定的手动 debug 签名。

### 11.4 手机与 HDC 的首次连接步骤

真机侧必须由持有设备的用户完成以下操作：

1. 在“设置 > 关于手机”连续点击版本号，启用开发者模式。
2. 在开发人员选项中打开 USB 调试；若使用无线调试，也需在此打开对应开关。
3. 使用可传数据的 USB 线连接电脑，并选择文件传输模式（具体菜单会随系统版本变化）。
4. 手机弹出调试授权时选择信任；固定开发机建议选择 `Always trust`。如果拒绝或弹窗超时，可重新开关 USB/无线调试，或用 `hdc kill -r` 重启 HDC 服务后重新授权。
5. 电脑用 `hdc list targets` 检查设备状态；必须为已连接/可用，而不是 `Unauthorized`。

这些步骤及授权状态由[当前 HDC 官方文档](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/hdc)说明；旧版但仍属华为官方的[Phone/Tablet 真机运行指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V2/run_phone_tablat-0000001064774652-V2)还明确列出开启开发者模式、USB 调试、文件传输和“是否允许 USB 调试”弹窗。

**本机现状记录（不含账号或设备标识）**：开发工具已处于登录状态，目标手机已能被 HDC 识别为活动设备。这只说明账号和连接前置条件基本具备，不代表某个尚未创建的工程已经获得有效签名。

### 11.5 `bundleName` 与 `appIdentifier` 何时必须固定

**事实**：`bundleName` 是 `app.json5` 的必填字段，用于标识应用唯一性，所以创建工程时就必须先填一个合法值。[`app.json5` 配置文件](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/app-configuration-file)。设备安装与覆盖更新都校验 `bundleName` 一致；改名后的包不能作为原包的正常更新。[应用安装与更新一致性校验](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/install-and-update-consistency-verification)。

工程初建时可以先使用明确标记为临时的 bundleName，但应在以下最早时点之前冻结正式值：创建/关联正式 AGC 应用、申请稳定的手动 Profile、开始需要保留设备数据的多机联调、接入以应用身份为键的开放能力。之后再改，工程上应按“新应用”处理：重新注册应用/生成 Profile、卸载或并存安装，旧应用沙箱数据不会自动迁移。最后一句是由安装身份和应用沙箱隔离规则得到的**工程推断**，不是华为提供的自动迁移承诺。

**事实**：`appIdentifier` 在签名时生成并写入 Profile，不是 `app.json5` 中由开发者随意填写的替代包名。未关联应用的自动签名在换设备或重新签名时可能生成不同 `appIdentifier`；需要它稳定时应使用手动签名。`appId` 则由 bundleName、下划线和签名证书公钥编码组成。[OpenHarmony 应用包 FAQ](https://github.com/openharmony/docs/blob/master/en/application-dev/quick-start/common-problem-of-application.md#what-is-appidentifier)。

覆盖更新时，官方规则是 `appId` 与 `appIdentifier` 任一相同即可，因此单独变化 `appIdentifier` 不必然导致更新失败；但依赖它的跨应用白名单、App Linking 或共享能力会失去原身份，这是为什么多机/跨应用阶段不能继续依赖随机自动签名身份。[应用安装与更新一致性校验](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/install-and-update-consistency-verification)。

### 11.6 本项目当前两个网络权限

`ohos.permission.INTERNET` 与 `ohos.permission.GET_NETWORK_INFO` 都是 `normal` 等级、`system_grant` 授权方式的开放权限。对普通 HAP，只需在对应模块的 `module.json5 > requestPermissions` 中声明；安装时由系统授权，不需要 `requestPermissionsFromUser` 运行时弹窗，也不需要为这两个权限单独申请 ACL/Profile 权限。[开放权限（系统授权）清单](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/permissions-for-all)、[申请应用权限](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/request-app-permissions)。

这不代表以后新增的权限也都如此。若后续加入相机扫码、相册、麦克风或受限开放能力，必须按各权限的 `user_grant` / ACL 规则重新评估，不能套用本节结论。

### 11.7 必须、可后补、仅发布需要

#### 第一次单机真机 Run 之前必须

- 安装与目标 API 兼容的 DevEco Studio/HarmonyOS SDK，并用真机实际 API version 校验 `compatibleSdkVersion`。
- 本地工程有合法的 `bundleName`；此时可以是临时值，但需清楚改名代价。
- 手机开启开发者模式和 USB 调试，完成首次 HDC 信任授权，`hdc list targets` 能看到可用设备。
- HAP 使用有效调试签名和包含目标设备的 debug Profile。推荐首轮使用“未关联注册应用”的自动签名。
- 若用自动签名，用户需能登录开发者账号并联网完成签名材料生成；本项目按已实名账号准备。
- 在需要网络能力的模块声明 `INTERNET` 和 `GET_NETWORK_INFO`。

#### 可以在首轮真机宿主验证之后补

- AGC 正式应用/APP ID，以及最终产品 `bundleName` 的冻结；但必须在多设备联调、稳定身份或开放能力接入前完成。
- 手动 debug 证书/Profile 和其余测试机的 UDID 注册。
- 证书/Profile 的团队保管、轮换和密钥交接流程。
- 无线 HDC；USB 调试足以完成第一次运行。

#### 仅发布/上架需要

- 发布证书、release Profile、正式 `.app` 打包与 AppGallery Connect 上架资料。
- 发布阶段的受限权限审核、隐私声明、内容分级、备案及其他商店合规材料。

### 11.8 离线工作与必须由用户完成的工作

在用户尚未处理账号或手机之前，开发侧可以离线完成：工程骨架、ArkUI/ArkWeb 页面和桥接接口、横屏配置设计、`module.json5` 普通权限声明、资源组织、Hvigor 编译检查、桌面端继续调试。前提是 DevEco SDK 和依赖已经下载到本机。若已经取得 `.p12/.cer/.p7b` 手动材料，也可以离线签名；官方把“断网调试”列为应使用手动签名的场景，由此可推断签名材料齐备后的本地签名和 USB 安装不依赖再次访问 AGC。

必须由用户在账号/设备侧完成或明确授权的事项是：开发者账号登录与实名认证、AGC 应用/证书/Profile 的账号操作、真机开发者模式与 USB 调试开关、首次 HDC 信任弹窗、手动签名时读取并注册各设备 UDID，以及最终发布身份和密钥保管决策。自动签名能减少 AGC 手工步骤，不能代替这些账号和物理设备授权。

**当前决策**：`bundleName` 已固定为 `com.zero.gamehack.iamaghost`。第一次真机 Run 前让 DevEco 工具链对已连接手机执行“未关联注册应用”的自动签名；单机 ArkWeb 宿主跑通后，建立 AGC 应用/APP ID，并在多手机局域网联调前切换到稳定的手动 debug Profile。用户已经授权原型实现；本轮尚未创建工程或生成签名材料。
