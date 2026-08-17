# 《I Am a Ghost》开发计划

- 日期：2026-08-17
- 状态：M0–M6 实现与自动 QA 已完成；真人平衡试玩仍待组织
- 设计依据：docs/2026-08-17_game-design-and-start-plan.md
- 当前范围：按里程碑推进；M0 只建立工程基线，不复制玩法代码或资源

## 1. 结论先行

以 TypeScript、Vite、Socket.IO、Playwright 和既有局域网权威同步模式为工程基线；玩法领域、地图、席位模型和渲染场景均由本项目独立实现。

最先验证的不是正式房屋或角色资产，而是下面这条最小链路：

    两个浏览器加入同一房间
      -> 客户端只发送 ESDF 移动朝向和空格意图
      -> 服务器推进权威规则和角色阻挡
      -> 鬼客户端收到全局玩家视图
      -> 小孩客户端收不到隐藏鬼坐标
      -> 照射后鬼才进入全部小孩的玩家视图

如果这条链路不成立，继续制作房屋、美术和音效没有价值。

## 2. 仓库勘察

### 当前仓库

当前 i-am-a-ghost 没有应用代码或包清单，只有：

- 已确认的游戏设计与启动计划。
- 本仓库安装的开发技能。
- CodeGraph 索引目录和技能锁文件。

因此不存在需要兼容的旧运行时，也没有必要先做迁移层。

### 可用工程基线

参考工程已经实现：

- TypeScript、Vite、Three.js 和严格构建。
- Node.js + Socket.IO 的本机/局域网房间服务。
- 六位房间码、房间清理、版本检查和健康检查。
- 每房间 60 tick/s 固定步长权威模拟。
- 约 30 Hz 输入发送和 20 Hz 状态广播。
- 输入序号、过期输入保护、事件 ID 和事件去重。
- 客户端快照插值、预测、权威纠偏和模拟网络延迟。
- 双标签联机、所有权、收敛、重连、输入和视觉测试。
- Canvas 像素采样、GPU 信息、渲染预算和确定性测试钩子。
- 可用的 KayKit/Kenney 运行时资产及许可台账。

参考工程的重要限制：

- 房间固定为两个席位，而本项目需要 2–5 名真人和随机角色。
- 完整 snapshot 与 checkpoint 会广播给全部客户端，会泄露隐藏鬼坐标。
- 客户端预测会重放完整对局，依赖完整规则状态；本项目的小孩客户端不能这样做。
- GameSnapshot、协议、HUD、音频和渲染均包含旧玩法领域类型。
- 地图编辑器、旧地图生成器和本地同键盘模式不属于本项目范围。

## 3. 架构修订门槛

原设计文档选择 Colyseus，是因为当时假设团队没有成熟的 Socket.IO 游戏同步层。进一步勘察确认现有技术栈已经覆盖所需的房间与同步能力，因此该前提不再成立。

本计划推荐接受 docs/adr/0001-use-socketio-authoritative-stack.md：

- 使用 Socket.IO，而不是 Colyseus。
- 复用房间和同步基础设施，不复用全量状态广播。
- 自定义按玩家过滤的状态帧。
- 完整 checkpoint 只存在于服务器和规则测试。
- 小孩客户端只做本地角色预测，不模拟隐藏鬼。

这项修订已被接受，设计文档的技术架构章节已同步更新。

## 4. 目标数据流

    键盘
      -> InputRouter
      -> ClientSession
      -> Socket.IO client adapter
      -> Socket.IO server adapter
      -> RoomCoordinator
      -> MatchEngine
      -> viewer-specific frame/events
      -> ClientSession
      -> GamePresentation / HUD / Audio

规则更新顺序固定为：

    输入清洗
      -> 抓取边沿与手电持续状态
      -> 角色移动
      -> 墙体及真人角色阻挡
      -> 头灯档位
      -> 光束遮挡、显形、伤害和减速
      -> 抓取命中
      -> 电池生成与拾取
      -> 抓捕结算或复位
      -> 倒计时与胜负
      -> 玩家视图和事件投影

同 tick 内鬼生命归零优先于第三次抓捕，必须以规则测试固定。

## 5. 深模块与 seams

### MatchEngine

**职责**：拥有完整权威对局、固定步长、随机数、碰撞、照射、抓捕、电池、复位、倒计时和胜负。

**外部 interface**：

- advance(commandsByPlayer) -> tick result
- viewFor(viewer) -> viewer frame
- checkpoint() / restore(checkpoint)，仅服务器与规则测试使用

**隐藏的复杂度**：

- 四个小孩槽位与感应人偶填充。
- 墙体及最多五名真人的实体阻挡。
- 光束对墙体和鬼的判定。
- 显形、头灯档位及事件过滤。
- 抓捕动画、计时暂停、复位和保护时间。
- 电池随机、保留及同 tick 胜负顺序。

MatchEngine 的 interface 是主要规则测试面。Three.js、Socket.IO、DOM 和 Web Audio 不得进入其 implementation。

### RoomCoordinator

**职责**：拥有房间生命周期、临时昵称、房主、真人玩家、随机鬼、准备、再来一局、角色轮换、断线和重连。

**seam**：房间动作 interface 与 Socket.IO transport adapter 之间。

至少保留两个 adapters：

- 生产用 Socket.IO adapter。
- 房间生命周期测试使用的内存 adapter。

这样 Socket.IO 负责传输，不拥有游戏规则。

### ClientSession

**职责**：隐藏输入序号、发送频率、事件去重、快照时间线、本地角色预测和服务端纠偏。

**外部 interface**：

- tick(localCommand)
- getView(renderTime)
- replaceSession(session)
- getDiagnostics()
- dispose()

ClientSession 只处理当前玩家被允许看到的 ViewerFrame，不接受完整权威 checkpoint。

### HouseMap

**职责**：提供单层房屋的墙体、开口、房间、出生点、电池点、碰撞代理和光线遮挡线段，并验证关键区域可达。

首版只需要一个手工地图和一个加载/校验 implementation，不为未来的地图编辑器提前设计公开 seam。

### GamePresentation

**职责**：消费 ViewerFrame 和权威事件，维护 Three.js 房屋、角色、光束、感应灯、相机、VFX、HUD 和音频。

首版只有一个 Three.js implementation，不单独制造抽象 interface。确定性测试通过 MatchEngine，视觉和输入通过浏览器测试。

## 6. 建议目录

    index.html
    package.json
    vite.config.ts
    playwright.config.ts
    server/
      index.ts
      RoomCoordinator.ts
      AuthoritativeRoom.ts
      socketAdapter.ts
      types.ts
    src/
      main.ts
      core/
        Loop.ts
        Renderer.ts
        InputRouter.ts
        Diagnostics.ts
      game/
        config.ts
        types.ts
        MatchEngine.ts
        MatchCheckpoint.ts
        MovementCollision.ts
        LightGeometry.ts
        HouseMap.ts
        maps/first-house.ts
      net/
        protocol.ts
        ClientSession.ts
        SnapshotTimeline.ts
        OwnedActorPrediction.ts
      render/
        GamePresentation.ts
        HouseView.ts
        ChildView.ts
        GhostView.ts
        FlashlightView.ts
      systems/
        CameraSystem.ts
        Hud.ts
        AudioSystem.ts
        VfxSystem.ts
        DebugPanel.ts
      assets/
        AudioManifest.ts
        ModelManifest.ts
      styles.css
    tests/
      game-rules.spec.ts
      view-security.spec.ts
      server-simulation.spec.ts
      room-lifecycle.spec.ts
      network-smoothing.spec.ts
      multiplayer.spec.ts
      input-controls.spec.ts
      visual.spec.ts
    scripts/
      inspect-threejs-canvas.mjs
    public/assets/
    docs/

文件名是计划目标，不要求在第一个提交一次性建齐。

## 7. 工程基线清单

### 可近似原样迁移

| 基线模块 | 用途 | 接入注意 |
|---|---|---|
| package.json 的工具链与 scripts | Vite、TypeScript、Playwright、并行启动 | 改项目名、端口和依赖；暂不加入 lil-gui 之外的无用依赖 |
| vite.config.ts / tsconfig.json / playwright.config.ts | 构建和浏览器测试基线 | 改入口与端口，移除编辑器页面配置 |
| src/core/Loop.ts | 60 FPS 渲染循环 | 保持与 60 Hz 规则 tick 分离 |
| src/core/Renderer.ts 的 createRenderer | WebGL、色彩空间、tone mapping、阴影 | 相机投影尺寸依赖旧地图配置的部分需要重写 |
| server/index.ts 的 HTTP、healthz 和关闭流程 | 局域网房间进程 | 环境变量改为 I_AM_A_GHOST_SERVER_* |
| RoomManager 的房间码生成、空房清理模式 | 邀请房和内存生命周期 | 重写两席位限制、开始条件和房主逻辑 |
| 输入序号、事件 ID、过期输入保护 | 权威命令和一次性事件 | ActorId/SeatId 全部替换为玩家与角色 ID |
| scripts/inspect-threejs-canvas.mjs | 非空画布、GPU 和预算证据 | 预算改为仅桌面，状态钩子改为本游戏名称 |
| Playwright 配置与测试辅助模式 | 系统 Chrome、单 worker、多页面测试 | 删除手机项目，仅保留 PC 视口和局域网用例 |
| src/utils/random.ts / dispose.ts | 确定性随机与资源释放 | 确认无旧玩法领域依赖后迁移 |

### 迁移后重写核心逻辑

| 基线模块 | 保留的形状 | 必须重写 |
|---|---|---|
| GameDriver / OnlineGameDriver | tick、视图、诊断、会话替换 | 完整 checkpoint 预测、席位所有权和旧玩法快照 |
| SnapshotInterpolation | 时间线和插值思想 | 改为 ViewerFrame 与动态玩家集合 |
| AuthoritativeGameRoom | 固定步累积器、输入合并、事件去重 | 2–5 人、房主、随机鬼、每玩家定向帧、断线变人偶 |
| GameSimulation | 与渲染分离的确定性规则模块 | 全部旧玩法领域规则 |
| MovementCollision | XZ 平面、圆形角色、简化代理 | 房屋墙段、真人对真人阻挡和狭窄开口稳定解算 |
| InputRouter | held/pressed 分离、blur 清理 | ESDF 移动与朝向、按住/按下两种空格语义 |
| Hud / AudioSystem / VfxSystem | 事件驱动表现和池化 | 鬼血、电量、抓捕、显形、电池及新事件名称 |
| ImportedKidView | Rogue 模型加载、骨骼 clone、动画切换 | 删除旧玩法附件与状态；增加四种暖色与头灯 socket |

### 不迁移

- src/editor/ 与 editor.html。
- 旧地图生成器、地图迁移和无关世界场景。
- 旧玩法实体、投递区与双席位状态。
- 本地同键盘单机入口；本项目没有单机版。
- Nature Pack 和完整 KayKit 世界资源库。
- dist、node_modules、artifacts、test-results、playwright-report 和其他仓库的 .git。

## 8. 资源复用

### 首轮可用候选

| 资源 | 参考路径 | 计划用途 | 许可证 |
|---|---|---|---|
| Rogue_Kid.glb | public/assets/models/kaykit-adventurers/Rogue_Kid.glb | 四名小孩，共享几何/纹理并克隆材质配色 | KayKit CC0 |
| KayKit Adventurers LICENSE | 同目录 LICENSE.txt | 随资源一起迁移 | 必须保留 |
| house.glb | public/assets/models/kaykit-medieval/house.glb | 风格参考或外围房屋装饰，不作为整栋室内碰撞 | KayKit CC0 |
| wall_straight / wall_corner 等 | kaykit-medieval/world-kit | 后续房屋墙体视觉候选 | KayKit CC0 |
| kid-captured.mp3 | public/assets/audio/kenney | 抓捕占位音效 | Kenney CC0 |
| guard-pounce.mp3 | public/assets/audio/kenney | 鬼抓取前摇/抓空占位音效 | Kenney CC0 |
| picked-01/02.mp3 | public/assets/audio/kenney | 电池拾取占位音效 | Kenney CC0 |
| match-ended.mp3 | public/assets/audio/kenney | 对局结束占位音效 | Kenney CC0 |

### 资源规则

- 灰盒阶段先使用程序化胶囊/球体鬼，确保“无脚、漂浮”读得清楚；不要把 Knight 当作鬼。
- 只复制实际使用的运行时文件和对应 LICENSE，不复制完整素材包。
- 第一次引入资源时创建 docs/ASSET_LICENSES.md，记录上游来源、作者、许可证、文件大小、三角面、动画和修改方式。
- 视觉模型永远不直接作为权威碰撞体。
- Rogue 小孩需要删除旧玩法附件，并验证 Idle_A、Running_A、Hit_A；PickUp 不作为首版必需动画。
- 正式鬼资产、房屋套件和完整音频属于灰盒验证后的独立阶段。

## 9. 玩家视图与安全规则

禁止 room-wide 广播完整状态帧。AuthoritativeRoom 必须逐玩家生成并发送帧。

### 鬼玩家视图

- 全部真人玩家与感应人偶位置。
- 全屋电池位置。
- 房间、墙体和所有公开比赛状态。
- 不包含各小孩的精确手电剩余电量。

### 小孩玩家视图

- 自己和其他小孩玩家的允许状态。
- 当前镜头内的感应人偶和电池。
- 自己/可见人偶的头灯档位，但没有由档位反推的鬼坐标。
- 鬼未显形时不存在 ghost position 字段，也不能从事件、checkpoint、碰撞诊断或调试钩子旁路读取。
- 任一光束命中鬼时，所有小孩帧包含鬼的位置和显形状态。
- 失去照射后不再发送新坐标；客户端只对最后位置做约 0.25 秒淡出。

### 测试要求

- 用结构断言验证隐藏帧没有鬼坐标，而不是只验证模型 visible=false。
- 检查事件载荷，避免抓取、头灯或碰撞事件附带隐藏位置。
- 生产模式不暴露服务器 checkpoint 或全局诊断。
- 屏外电池若按设计不可定位，小孩帧也不应长期携带其精确坐标。

## 10. 开发里程碑

### M0：架构门槛与仓库基线

**目标**：确认 Socket.IO 修订，建立可构建、可测试、没有旧玩法领域残留的最小工程。

**完成状态（2026-08-17）**：已完成。验证记录见 `docs/2026-08-17_m0-foundation-report.md`；下一工作包为 M1，不在 M0 中提前实现玩法。

**工作**：

- 接受或拒绝 ADR-0001；接受后同步更新设计文档。
- 建立 package、Vite、TypeScript、Playwright、Loop、Renderer、server 进程和 canvas inspector 基线。
- 改名、环境变量、sessionStorage key、端口和页面标题。
- 使用 Web 5189、房间服务 5191，避免与本机其他开发服务冲突，最终可再调整。
- 保留一个 index.html，不创建本地单机和地图编辑器入口。
- 建立最小 healthz、空 canvas、测试钩子和构建命令。

**退出门槛**：

- npm run build 通过。
- 空灰盒页面和 healthz 可访问。
- 代码与 UI 中没有旧项目领域残留。

### M1：确定性 MatchEngine

**目标**：不依赖浏览器或网络，证明完整规则顺序。

**完成状态（2026-08-17）**：已完成。验证记录见 `docs/2026-08-17_m1-match-engine-report.md`；下一工作包为 M2 的双客户端权威链路与信息过滤。

**工作**：

- 定义角色、四个小孩槽位、感应人偶、命令、权威状态、事件和玩家视图类型。
- 建立一个简化房屋数据：墙体、开口、中央鬼出生点、四个外围槽位和电池候选点。
- 实现固定 60 Hz 移动、ESDF 移动朝向和真人圆形阻挡。
- 实现手电长度/角度、墙体遮挡、伤害、减速和多人递减。
- 实现抓取前摇/冷却、三次抓捕、全员复位、保护时间和时钟暂停。
- 实现头灯档位、电池生成/拾取/保留、五分钟超时和同 tick 胜负优先级。
- 建立 checkpoint，仅供服务端与规则测试。

**退出门槛**：

- 规则测试覆盖移动、墙体、真人堵口、感应人偶不阻挡。
- 覆盖照射、显形、鬼减速、抓取、三次抓捕、复位和保护。
- 覆盖低电电池、场上最多一个、复位保留。
- 覆盖五分钟小孩胜、鬼血归零、同 tick 小孩优先。
- 相同种子和输入带产生相同 checkpoint。

### M2：两客户端权威与信息过滤

**目标**：两个浏览器在一个极简房间中移动，并证明隐藏信息没有离开服务器。

**完成状态（2026-08-17）**：已完成。验证记录见 `docs/2026-08-17_m2-authoritative-room-report.md`。

**工作**：

- 重构房间为真人玩家集合，不使用固定 guards/kid 席位。
- 自动生成临时昵称和邀请链接。
- 最少两名真人；房主开始后随机选择一名鬼，其余为小孩玩家。
- 空缺小孩槽位生成感应人偶。
- 客户端只发送拥有角色的移动、朝向和空格意图。
- 服务端按玩家定向生成 ViewerFrame；禁止 room-wide 完整状态广播。
- 初期可以只用 20 Hz 权威帧和插值，先证明正确性与保密性，再增加本地预测。

**退出门槛**：

- 本机双标签能加入、开始和移动。
- 服务端拒绝控制其他玩家、提交位置或重复输入序号。
- 小孩客户端未显形时没有鬼坐标或完整 checkpoint。
- 鬼客户端能看到所有真人和感应人偶。
- 照射切换会正确增加/移除全部小孩玩家视图中的鬼。

### M3：完整灰盒对局

**目标**：实现设计文档中的整局闭环，不要求正式资产。

**完成状态（2026-08-17）**：已完成。验证记录见 `docs/2026-08-17_m3-playable-greybox-report.md`。

**工作**：

- 制作 8–10 房间、两条环路、1–2 个死胡同的完整灰盒房屋。
- 实现小孩跟随镜头、鬼全屋镜头、常显墙体和黑暗房间。
- 实现真人角色阻挡、窄开口、头灯、光束和电池表现。
- 实现 HUD：时间、鬼血、0/3 抓捕和个人电量。
- 实现抓捕动画、暂停计时、复位、短倒数和保护反馈。
- 实现结算、返回大厅、重新准备和鬼轮换。
- 加入占位 VFX 和程序化/CC0 占位音效。

**退出门槛**：

- 双标签完成一整局。
- 鬼三次抓捕、小孩照空鬼血和五分钟超时均能真实触发。
- 玩家能解释抓取失败、手电无效、电池出现和复位的原因。
- PC 画布非空、控制台无错误、无穿墙或永久重叠。

### M4：2–5 真人与局域网韧性

**目标**：从技术双人闭环扩展到目标人数，并改善本地控制手感。

**完成状态（2026-08-17）**：已完成。验证记录见 `docs/2026-08-17_m4-network-resilience-report.md`。

**工作**：

- 支持 2–5 真人加入和准备。
- 实现小孩掉线立即变感应人偶、30 秒内恢复控制。
- 实现鬼掉线无结果返回大厅。
- 实现角色轮换记录和所有真人再次准备。
- 将 ClientSession 改为只预测本地拥有角色，远端状态插值。
- 对隐藏鬼造成的预测碰撞差异做平滑服务端校正。
- 保留输入过期、事件去重、版本检查和网络诊断。

**退出门槛**：

- 局域网五名真人完成一整局。
- 2、3、4、5 人房均可开始，空槽位数量正确。
- 重连不会重复角色、事件、伤害或抓捕。
- 堵口时本地预测没有不可接受的抖动或永久分叉。

### M5：参考资产接入与可读性

**目标**：在玩法闭环成立后，接入最小可用的风格化资产。

**完成状态（2026-08-17）**：已完成。验证记录见 `docs/2026-08-17_m5-assets-and-polish-report.md`。

**工作**：

- 迁移 Rogue_Kid 和对应 CC0 许可证。
- 让四名小孩共享模型资源并拥有清晰暖色区分。
- 在头部 socket 安装感应灯，验证各档位和减少闪烁设置。
- 评估 KayKit 墙体/小屋子集，只作为视觉层，不改变碰撞。
- 迁移实际使用的 Kenney 音频和许可记录。
- 保留程序化鬼直到正式鬼资产方向单独确认。

**退出门槛**：

- 资产加载失败有明显诊断或灰盒回退。
- 模型缩放、朝向、动画、材质克隆和释放正确。
- 鬼、小孩、感应灯、电池和墙体在俯视镜头下可读。
- 更新 docs/ASSET_LICENSES.md，并记录文件大小、三角面、材质、纹理和动画。

### M6：试玩、调参与 QA

**目标**：用真人数据判断设计，而不是用感觉提前缩放人数数值。

**完成状态（2026-08-17）**：自动机器人预检、单轴候选复测和完整 QA 已完成，见 `docs/2026-08-17_m6-playtest-tuning-and-qa-report.md`；自动数据不冒充真人数据，正式平衡结论仍待真人局。

**工作**：

- 分别测试 1–4 名真人小孩。
- 记录设计文档第 12 节的胜负、结束时间、首次抓捕、照射、电池和堵口数据。
- 只调整一个轴后重新测试：速度、光束、伤害、电量、抓取或地图点位。
- 添加确定性测试场景和浏览器视觉状态。
- 运行构建、规则、多人、视觉和 canvas 检查。

**退出门槛**：

- 通过灰盒验收清单。
- 没有未解释的隐藏信息泄漏、软锁、控制卡死或永久碰撞重叠。
- 记录各人数的平衡问题和下一轮建议，不把“首轮可玩”称为最终平衡或发布完成。

## 11. 测试矩阵

| 测试文件 | 最低覆盖 |
|---|---|
| game-rules.spec.ts | 光束、伤害、抓取、复位、电池、倒计时、胜负顺序 |
| view-security.spec.ts | 不同 viewer 的字段白名单、隐藏鬼、屏外电池和事件载荷 |
| server-simulation.spec.ts | 固定 tick、输入过期、checkpoint 恢复、确定性 |
| room-lifecycle.spec.ts | 2–5 人、房主、随机鬼、人偶填充、轮换、离开和重连 |
| network-smoothing.spec.ts | 20 Hz 帧、插值、本地预测、校正和事件去重 |
| multiplayer.spec.ts | 双标签真实输入、所有权、显形传播、断线和状态收敛 |
| input-controls.spec.ts | ESDF 移动朝向、按住手电、单次抓取、blur 清理 |
| visual.spec.ts | 两种镜头、黑暗、HUD、感应灯、光束、结算和非空画布 |

建议保持 Playwright 单 worker，避免多个无头 WebGL 上下文争抢 GPU。

## 12. 工作包与提交边界

建议保持每个工作包可独立构建和验证：

1. **foundation**：工具链、空入口、server healthz、测试骨架。
2. **domain**：CONTEXT 类型落地、HouseMap、MatchEngine 与规则测试。
3. **visibility**：viewer-specific frames、安全测试和定向 Socket.IO 帧。
4. **rooms**：2–5 人大厅、房主、角色分配、人偶和重连。
5. **presentation**：房屋、角色、两种镜头、黑暗、HUD 和输入。
6. **gameplay**：手电、头灯、抓取、电池、复位和完整胜负。
7. **network-feel**：本地预测、远端插值、纠偏和网络诊断。
8. **assets**：Rogue/KayKit/Kenney 子集与许可台账。
9. **qa**：多人数试玩、视觉状态、canvas 指标和最终灰盒报告。

不要在同一个工作包中同时迁移全部参考代码、重写规则和接入正式资产。

## 13. 风险登记

| 风险 | 应对 |
|---|---|
| 引入无关的旧玩法领域残留 | M0 以术语搜索和构建作为硬门槛 |
| 完整 checkpoint 泄露鬼坐标 | checkpoint 仅服务器持有；独立 view-security 测试 |
| 自预测需要隐藏鬼状态 | 只预测本地角色；隐藏碰撞由权威校正 |
| 五人狭窄阻挡导致抖动或卡死 | 压力测试自定义圆形碰撞；失败时再引入 Rapier |
| Socket.IO room-wide broadcast 误发全局状态 | 状态帧逐 socket 定向发送，事件也按 viewer 投影 |
| 双席位假设扩散 | 协议先采用 playerId/role/actorId，再接入大厅 UI |
| 先做完整地图导致网络风险暴露太晚 | M2 使用极简房间先验证权威和保密性 |
| 资源整包迁移污染仓库 | 只复制实际使用文件和 LICENSE，禁止完整素材包 |
| 无屏外电池提示导致无聊搜索 | 先记录低电到拾取时间，优先调整合法点位 |
| 不同人数同数值严重失衡 | 先收集分人数数据，再决定是否缩放 |

## 14. 验证命令目标

实现阶段最终应提供等价命令：

| 命令 | 目的 |
|---|---|
| npm run dev | 同时启动 Web 和局域网房间服务 |
| npm run build | TypeScript 严格检查和生产构建 |
| npm test | 完整 Playwright 规则、网络和浏览器测试 |
| npm run verify:visual | PC 画布、HUD 和关键状态视觉检查 |
| npm run inspect:canvas | 截图、像素、GPU 和渲染预算诊断 |

手机端不在范围内，因此不要求移动视口或触控输入通过。

## 15. 计划台账

### Skill-loading ledger

- Three.js Game Director：已加载，用于阶段路由和完成门槛。
- Three.js Gameplay Systems：已加载，用于首个可玩切片、固定步规则和关卡计划。
- Codebase Design：已加载，用于深模块、interface、seam 和 adapter 设计。
- Domain Modeling：已加载，用于 CONTEXT.md 和 ADR。
- AAA Graphics、Game UI、Debug/Profile、QA/Release：已在 M3–M6 使用并完成相应检查。
- 3D/Image/Audio Generator：已用于资源来源决策与凭据探测；凭据缺失时按 skill 规则复用用户提供的 CC0 资源，没有生成新资源。

### Reference ledger

- 已读取：threejs-game-director/references/phase-playbook.md。
- 已读取：threejs-gameplay-systems/references/gameplay-workflows.md。
- 已读取：threejs-gameplay-systems/references/game-design-level-design.md。
- 已读取：threejs-gameplay-systems/references/physics-engine-selection.md。
- 已读取：codebase-design/DEEPENING.md。
- 已读取：domain-modeling 的 CONTEXT 与 ADR 格式。
- 已读取并执行：game feel、正式 UI、AAA 视觉、资源接入、debug/profile、视觉测试与 release QA 的相关参考和检查清单。

### Phase ledger

- Discovery and playable contract：完成，证据为设计文档、CodeGraph 勘察和本计划。
- Gameplay systems：完成，证据为 M1–M4 报告与规则/浏览器测试。
- External asset sourcing：完成最小 CC0 子集，证据为 M5 报告和 `docs/ASSET_LICENSES.md`。
- AAA graphics：完成当前试玩版的程序化视觉与技术美术检查，不声称 AAA 成品。
- UI：完成 PC 大厅、HUD、反馈与结算状态。
- Debug/profile：完成生产预览 GPU、画布、资源和渲染预算采集。
- QA/release：完成首轮自动 QA；不声称最终平衡或正式发布。

## 16. 实施结论

ADR-0001 已接受并完成实施。M0–M6 均有独立提交和验证报告；下一步不是继续增加系统，而是组织 2–5 名真人完成平衡试玩并用同一指标表复测。
