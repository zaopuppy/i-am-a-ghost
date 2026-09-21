# Asset replacement

给替换视觉资源的 agent 用。对局规则、碰撞和手电命中不读网格；只改外观时走本文件。开始前先 `codegraph explore` 当前加载入口，再动文件。

用户交接只需要一句话：换哪一层、想要什么观感。不要向用户要 `tmp/` 里的候选包——该目录被 gitignore，未入库文件到不了 agent。新资源要么已经在仓库的耐久路径上，要么由 agent 自己生成或下载后再 inspect。

**触发**：换小孩/鬼 GLB、墙纸/地板纹理、家具模型或家具贴图。

**共享入口**：

| 层 | 入口 |
| --- | --- |
| 小孩、感应人偶、鬼 | `src/assets/ImportedAssets.ts` |
| 可选角色目录与逐模型适配 | `src/assets/CharacterCatalog.ts`、`docs/original-character-models.md` |
| 墙纸、地板、房间家具材质 | `src/assets/MaterialLibrary.ts` |
| 家具 GLTF 库 | `src/assets/EnvironmentAssets.ts` |
| 家具 ID、脚印、场景编译 | `src/game/HouseScene.ts` |
| 房屋摆放 | `assets/maps/m3-nine-room-house.scene.json` |
| 可选房屋 | `src/game/HouseCatalog.ts`、`assets/maps/ring-old-house.scene.json` |
| 许可台账 | `docs/ASSET_LICENSES.md` |

运行时墙是程序化盒体，不加载 `public/assets/models/kaykit-medieval/wall_straight.glb`。

## 1. 分类

把任务拆成独立分支，再按第 2 节拿到**仓库内**的源文件并 inspect。同一提交可以覆盖多条分支，每条分支单独做到它的完成条件。

| 用户说的 | 分支 |
| --- | --- |
| 换小孩、鬼、感应人偶模型 | [角色](#3-角色) |
| 换墙、墙纸、壁纸、地板纹理 | [墙与地面](#4-墙与地面) |
| 换家具、地毯、桌椅、柜子 | [家具](#5-家具) |
| 都换 | 三条都做，先角色，再墙，再家具 |

可选角色 GLB 同时喂给对局和开场 `OpeningScene`；感应人偶固定沿用 Rogue Kid。家具 ID `table_low`、`cabinet_medium_decorated`、`chair_A_wood`、`rug_oval_A` 也被开场直接实例化。删 ID 或改加载合同会同时打到对局和开场。

## 2. 源文件与 inspect

完成条件：每个要换的资源都有一条**已入库或即将写入耐久路径**的源；合同检查表已填；keep-contract / rewrite-contract 已选定；许可文本已找到。

用户不提供 intake 包。`tmp/` 只给 agent 自己的一次性下载/克隆，不能当交接目录。

源按下面顺序取，取到就停：

1. 用户点名了仓库里的路径（例如已提交的 `public/assets/models/...`）→ 用它。
2. 用户只要观感、没有文件 → agent 按对应 skill 生成或下载到 `tmp/`，验收后再搬进 `public/assets/`（或改代码里的 URL）。未搬进耐久路径的文件等于没换。
3. 两者都没有 → 停下来问要哪一层、什么风格，不要虚构已经有新 GLB。

对每个源文件列出：动画名、节点名、包围盒（米）、前方轴、贴图路径、许可证。用游戏同一套加载器核对，不要只看 DCC 里的名字：

```powershell
npx --yes @gltf-transform/cli inspect <repo-or-tmp-path>
```

节点名还要和 `ImportedAssets.findObjectByName` 的规则对：大小写不敏感的**整名相等**。脚节点是小腿子节点且 `name.toLowerCase().startsWith('foot')`。

选路径：

- **keep-contract**：新资源满足下方合同卡，只换文件和尺寸常量。
- **rewrite-contract**：骨骼、动画名、插槽、UV 图集或材质管线任一不同，先改代码再换文件。

许可：把原文放到资源旁，并改 `docs/ASSET_LICENSES.md`。`tests/server/asset-contract.test.ts` 目前用 CC0 文本做断言；新许可不是 CC0 时同步改测试。耐久资源必须带着许可文本一起入库。

### 角色合同卡

`createCharacterAssetInstance` 在缺 clip 时抛错；`GameWorld.installImportedActor` 会吞掉错误并留下胶囊/方块回退。开场加载失败则整段演出失败。

| 项 | 必须相等 |
| --- | --- |
| 小孩文件 | `public/assets/models/kaykit-adventurers/Rogue_Kid.glb` |
| 鬼文件 | `public/assets/models/kaykit-adventurers/Ghost.glb` |
| clip | `Idle_A`（循环）、`Running_A`（循环，后退时 `timeScale < 0`）、`Hit_A`（一次，clamp） |
| 骨骼 | `chest` `head` `upperarml` `upperarmr` `lowerarml` `lowerarmr` `wristr` `handr` **`handslotr`** `upperlegl` `upperlegr` `lowerlegl` `lowerlegr` |
| 脚 | 每条小腿下有 `foot*` 子节点 |
| 朝向 | 资源前方不是游戏 `+X`；加载后 `oriented.rotation.y = π/2` |
| 身高 | 按包围盒 Y 缩到小孩 `1.5`、鬼 `1.72`，XZ 居中，脚底贴 `y=0` |
| 手电 | parent 到 `handslotr`，本地变换为单位；`FLASHLIGHT_ARM_POSE` 把插槽对准角色 `+X` |
| 材质 | 小孩按槽位染色，感应人偶再混一层棕色；鬼写成半透明冷色，供显形淡出改 `opacity` |

四个可选模型的路径、身高、朝向和字节数现在集中在 `CharacterCatalog.ts`。更新模型后改目录、`ImportedAssets.ts` 的关节映射、`tests/server/asset-contract.test.ts` 和视觉基线。

### 墙合同卡

| 项 | 必须保持 |
| --- | --- |
| 几何 | `createWallpaperWallGeometry` 盒体，高 `2.8` |
| UV | 世界坐标对齐，瓷砖 `WALLPAPER_TILE_METERS = 1.2 × 1.4` |
| 贴图用途 | `wall.map` 与 `wall.emissiveMap` 同一张，`RepeatWrapping` |
| 可读性 | 墙色 `0xaeb7c6`、自发光 `0x293141` × `0.42` 之后，低频对比 ≥ `0.16` |

### 家具合同卡

| 项 | 必须保持 |
| --- | --- |
| ID 列表 | `FURNITURE_ASSET_IDS` 与磁盘 `public/assets/models/kaykit-furniture/<id>.gltf` 一一对应 |
| 二进制后缀 | glTF `buffers[].uri` 用 `.meshdata`，不用 `.bin` |
| 实例化 | `instantiate` 丢掉源材质，改挂 `materials.furniture[family]`，三套房间风格共享一张图集 |
| 图集 | `furniturebits_texture.png`，`flipY = false`，`NearestFilter` |
| 碰撞 | `FURNITURE_CATALOG[].collider` 是权威脚印；`null` 表示纯装饰 |
| 默认场景 | 34 件摆放，22 个移动障碍；编译 issues 必须为空 |

## 3. 角色

### 3.1 keep-contract

完成条件：新 GLB 的 clip 名、骨骼名、`handslotr`、脚节点都在；对局能切 `Idle_A`/`Running_A`/`Hit_A`；手电挂在 `handslotr` 且点燃后沿角色前方射出；感应人偶仍用小孩 GLB 的低饱和实例。

适用：KayKit Adventurers 2.0 同骨架换装，或已在 DCC 里把新模型 retarget 到现有骨架。

1. 把验收通过的 GLB 写到合同卡上的路径（或改 `KID_URL` / `GHOST_URL` 并更新全部引用）。
2. 更新 `fileBytes` 和许可台账。
3. 感应人偶固定使用 `Rogue_Kid.glb`；玩家小孩使用其所选模型。
4. 鬼文件同时喂给对局鬼和开场鬼。
5. 跑第 6 节。手电方向差一点时只调 `src/game/ChildAnimation.ts` 的 `FLASHLIGHT_ARM_POSE`，不要改权威朝向。

Retarget 检查：动画轨道绑定的是 KayKit 节点名，不是 Mixamo `mixamorig:*`。`Hit_A` 即使鬼对局不用，加载仍会要。

### 3.2 rewrite-contract

完成条件：新的 clip 映射、骨骼映射、朝向、举臂姿势、抓捕/灼烧/侧移/开场 IK 都按新休息姿势标定；缺资源时仍能回退；开场手部 IK 仍找得到手臂和手。

骨骼名、clip 名、休息姿势或前方轴与合同卡不同时走这里。覆盖文件而不改映射，会出现胶囊回退、手电停在 `aimPivot`、手臂拧转或侧移腿抽搐。

按顺序改：

1. `src/assets/ImportedAssets.ts`：路径、身高、`REQUIRED_CLIPS`、骨骼查找、`oriented.rotation.y`。材质覆盖：要保留原贴图就只 clone、不要改 `color`/`emissive`；鬼仍需可写 `opacity`，否则显形淡出失效。
2. `src/game/GameWorld.ts`：`installImportedActor` 的手电 parent；`playActorAnimation` 的 clip 名；`poseCapturedChild` / `poseImportedGhostCapture` / `poseImportedGhostBurn` 的局部轴。
3. `src/game/ChildAnimation.ts`：按新 `Idle_A` 休息姿势重标 `FLASHLIGHT_ARM_POSE`。点燃后 `tests/flashlight-walk-pose.spec.ts` 要求世界方向 `+X`（`raisedDirection[0] > 0.995`，Y/Z 接近 0）。
4. `src/game/ChildStrafeAnimation.ts`：大腿/小腿/脚；步幅 `STRIDE_DISTANCE = 0.6` 是世界米。
5. `src/game/OpeningScene.ts`：`joints.head` 点头、`rightHand`/`rightWrist` 手电、`rightLowerArm`/`rightUpperArm` 伸手 IK。
6. 测试里的 clip 名、`handslotr`、字节数、三角形数。

标定手电：`/?testState=child-playing`，手电开启，光束沿面对方向水平射出，枪口与 spotlight 原点重合。标定抓捕：`/?testState=capture`，鬼从背后环抱，小孩播放 `Hit_A` 再叠程序化肢体，头不要穿过身体。

头灯是挂在角色根上 `y = 1.5` 的程序化球，不跟头部骨骼。身高差很多时改 `HEADLAMP_HEIGHT`，不要把头灯焊到网格上。

权威小孩/鬼碰撞仍是圆。网格变大不会让人卡住，只会看起来穿模；要改体积去规则层，不改 GLB。

## 4. 墙与地面

完成条件：墙仍是盒体碰撞；墙纸按世界坐标平铺、相邻墙段相位连续；拉伸墙体只增加重复次数；手电和闪电仍把墙当遮挡；`tests/assets.spec.ts` 对 `wall_straight.glb` 的请求数为 0。

墙视觉在 `createWallpaperTexture()`（256×256 `DataTexture`），地板在 `createFloorPatternTexture()`。不要用 `wall_straight.glb` 当墙贴图方案。

### 4.1 继续程序化

改 `createWallpaperTexture` / `createFloorPatternTexture` 的像素。保持无缝（128 像素单元）和对比测试。墙材质的 `color`、`emissive`、`emissiveMap` 会再乘一次，调纹理时连这三项一起看。

### 4.2 换成图片墙纸

1. 无缝可平铺 PNG，建议 256 或 512，sRGB。放到例如 `public/assets/textures/wallpaper.png`。
2. 在 `createHouseMaterialKit` 用 `TextureLoader` 加载，或启动时同步读入后建 `Texture`。`wrapS/wrapT = RepeatWrapping`，`colorSpace = SRGBColorSpace`，`anisotropy = 4`。
3. 同一张贴图赋给 `wall.map` 和 `wall.emissiveMap`。
4. 保留 `createWallpaperWallGeometry` 的世界 UV 和 `WALLPAPER_TILE_METERS`。改瓷砖物理尺寸时同步改常量和 `tests/game/wallpaper-geometry.test.ts`。
5. 对比测试目前断言 `material.map instanceof THREE.DataTexture`。换图片后改成对 GPU 纹理采样，或在测试里用离屏 canvas 读像素；低频对比仍 ≥ `0.16`。
6. 房间地板是另一套：`roomFloors.living|sleep|old` 共用 `floorPattern`，用 `ART_COLORS` 染色。换木板/地毯纹理时同样 `RepeatWrapping`，并决定三套房间是共享一张还是分图。

门框、门槛、窗发光、墙描边是纯色程序化几何，不来自 GLB。要换它们的颜色改 `ART_COLORS`，不要塞进墙纸图。

## 5. 家具

完成条件：每个 `FURNITURE_ASSET_IDS` 都能 `instantiate`；默认场景 `compileHouseScene` 无 error；装饰件 `collider === null`；实体件脚印仍让出生点和电池点连通；三套房间风格可见；开场四件道具仍在。

### 5.1 管线

`loadFurnitureLibrary` 加载全部 `<id>.gltf` 和一张 `furniturebits_texture.png`。实例化时：

- `scene.clone(true)`
- 每个 mesh 的 material 换成 `materials.furniture[family]`
- `castShadow = false`，`receiveShadow = true`

源 GLTF 里的材质和贴图引用会被丢掉。只换 glTF、不换图集、不改 UV，新模型会套上旧 KayKit 渐变图集，看起来像贴错皮。

`.meshdata` 是故意的：本机下载管理器会劫持 `.bin`。新 glTF 的 `buffers[].uri` 继续用 `.meshdata`。

`FURNITURE_FILE_BYTES = 310_198` 是整个家具目录运行时字节合计。换完后重算并更新 `EnvironmentAssets.ts`、`docs/ASSET_LICENSES.md`、`tests/assets.spec.ts` 的 triangles/meshes。

### 5.2 同 ID 换模型

保持 17 个 ID 和场景 JSON 不动，只换网格。

1. 新模型 Y-up、脚底 y≈0、XZ 以自身中心为原点，单位米。
2. 量包围盒，写入 `FURNITURE_CATALOG` 的 `modelSize`。
3. 有碰撞的件：`collider` 是 XZ 脚印，通常略小于 `modelSize`。改了脚印必须 `npm run validate:map`，出生点、电池点、门洞安全区、房间内越界、家具重叠都要过。
4. 装饰件保持 `collider: null`：`rug_*`、`lamp_table`、`pictureframe_standing_A`、`lamp_standing`。给地毯加碰撞会卡住通道。
5. UV：
   - **继续图集**：把新模型 UV 编进同一张 `furniturebits_texture.png`（或替换该 PNG 并保证 17 件 UV 都落在新图集上）。
   - **每件独立贴图**：改 `instantiate`，clone 源材质而不是覆盖成 family 材质；同时决定三套 `RoomFamily` 色调怎么保留（现在是材质 `color` 乘图集）。
6. 更新开场用到的四件外观：`table_low`、`cabinet_medium_decorated`、`chair_A_wood`、`rug_oval_A`。

编辑器 `/?sceneEditor=1` 只改摆放，不改磁盘上的 GLTF。脚印变了若默认 JSON 越界，用编辑器重排后覆盖 `assets/maps/m3-nine-room-house.scene.json`，流程见 `docs/SCENE_EDITOR.md`。

### 5.3 新 ID 或删 ID

1. 改 `FURNITURE_ASSET_IDS` 和 `FURNITURE_CATALOG`（label、modelSize、collider）。
2. 磁盘文件名与 ID 相同。
3. 改默认场景 JSON 里的 `asset` 字段；未知 ID 编译为 `unknown-asset` error。
4. 改 `OpeningScene` 里写死的四件 ID。
5. 改 `tests/game/house-scene.test.ts` 里对装饰件和默认 34 件/22 障碍的断言。
6. `tests/assets.spec.ts` 断言 `environmentProps === 34` 和 `meshes: 17`。件数或种类变了就改这些数。

家具只挡移动，不当手电墙。脚印变大不会改照射，但会改可走区域和平衡模拟。

## 6. Close-out

完成条件：许可台账与磁盘一致；合同测试和视觉基线按**故意**的新外观更新；对局、开场、场景编辑器看到同一套新资源；权威碰撞未被网格误改。

### 许可与常量

- `docs/ASSET_LICENSES.md` 的路径、作者、许可、用途、intake 尺寸
- 资源旁 `LICENSE.txt`
- `ImportedAssets.ts` / `EnvironmentAssets.ts` 的 `fileBytes`
- `tests/server/asset-contract.test.ts` 的体积和许可正则

### 命令

先规则，再地图，再浏览器。视觉 snapshot 只在人工看过新画面后更新。

```powershell
npm run build
npm run test:rules
npm run validate:map
npx playwright test tests/assets.spec.ts tests/flashlight-walk-pose.spec.ts tests/opening.spec.ts tests/deterministic-states.spec.ts
npm run verify:visual
```

家具脚印变了再加：

```powershell
npm run test:balance
```

### 必看画面

| 入口 | 确认 |
| --- | --- |
| `/?testState=child-playing` | 小孩模型、手电从手槽射出、墙纸平铺、家具落地 |
| `/?testState=ghost-playing` | 鬼模型、灼烧时程序化肢体仍可读 |
| `/?testState=capture` | 抓捕环抱，小孩 `Hit_A` |
| `/?testState=low-battery` | 感应人偶是小孩模型的低饱和版 |
| 开场动画 | 三人小孩 + 鬼 + 四件家具 |
| `/?sceneEditor=1` | 目录、脚印、墙纸 UV 与对局一致 |

Playwright 基线在 `tests/deterministic-states.spec.ts-snapshots/`。换资源后旧 PNG 会失败；看过新画面再更新。

### 失败对照

| 现象 | 原因 |
| --- | --- |
| 胶囊/方块人 | clip 名不对或 GLB 加载抛错，走了 `installImportedActor` 回退 |
| 开场直接失败 | 角色或家具 Promise reject，开场不回退 |
| 模型在、手电浮在身前 | 没有 `handslotr`，手电仍在 `aimPivot` |
| 手电朝天/朝地、手臂拧花 | 休息姿势或骨骼轴变了，需重标 `FLASHLIGHT_ARM_POSE` |
| 侧移腿抽搐或脚钉死 | 缺 `foot*`，或腿骨层次与 KayKit 不同 |
| 人横着跑 | 前方轴与 `rotation.y = π/2` 叠加错了 |
| 家具贴图花、全是旧渐变 | 仍走图集覆盖，新 UV 没编进 `furniturebits_texture.png` |
| 出生点报错、通道堵住 | 改了 `collider` 却没重编译场景 |
| `wall_straight.glb` 请求 > 0 | 错误地开始加载候选墙 GLB |
| wallpaper 对比测试类型失败 | 换了图片纹理，测试仍要求 `DataTexture` |

权威层清单（网格替换碰不到这些，除非同时改了 catalog/地图）：`MatchEngine` 圆碰撞、手电照射、抓捕接触、闪电遮挡层、家具 `movementObstacles`。
