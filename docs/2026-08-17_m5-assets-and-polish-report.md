# M5 资产、技术美术与音频报告

## 外部素材决策

凭据探测的原样输出：

```text
TRIPO_API_KEY=MISSING
GEMINI_API_KEY=MISSING
ELEVENLABS_API_KEY=MISSING
```

因此没有调用 Tripo、Gemini 或 ElevenLabs，也没有生成任务 ID。用户指定的 Apple Picking 仓库已经包含更合适的 CC0 KayKit/Kenney 素材，本阶段直接复用并保留许可证。

引用资料账本：

| 资料 | 已读 | 用途 |
| --- | --- | --- |
| `threejs-3d-generator/references/api-notes.md` | 是 | 确认无生成任务时不伪造任务或模型版本 |
| `threejs-3d-generator/references/threejs-integration.md` | 是 | GLTFLoader、骨骼克隆、尺度/碰撞分离、动画与指标 |
| `threejs-3d-generator/references/image-generator-workflows.md` | 是 | 确认本阶段不需要新增 2D 概念输入 |
| `threejs-audio-generator/references/audio-workflows.md` | 是 | 事件矩阵、用户手势解锁、会话静音与一次性触发 |
| AAA graphics implementation/render/technical-art/model references | 是 | 材质角色、光照、回退、诊断和资源预算 |

## 技术美术简报

- 方向：低多边形儿童角色与冷灰石墙形成清晰轮廓；暖色角色/电池/头灯是唯一高饱和信号，鬼保持无脚、冷色、漂浮的程序化剪影。
- Hero 表面：Rogue Kid、头灯 socket、短手电锥和程序化鬼；Support 表面：墙、深色房间地面、接触阴影和电池。
- 材质角色：`bodyPrimary`、`bodySecondary`、`trim`、`hazard`、`reward`、`shieldBoost`、`emissiveSignal`、`groundContact` 与明暗 decal 色集中在 `MaterialLibrary`。
- 光照：一盏 1024 阴影冷月光、一盏暖填充光、低强度半球光；无后处理 pass，DPR 上限 2。
- 预算：桌面目标 ≤300 draw calls、≤750k 三角面、≤300 geometries、≤60 textures；最多五个 Rogue Kid 克隆共享几何/纹理，碰撞仍使用规则引擎圆形代理。
- 回退：墙 GLB 失败保留程序化墙；角色 GLB/动画失败保留暖色 capsule/box；音频失败只记诊断，不阻止输入或开局。

## 资产与运行时结果

- Rogue Kid 通过 `SkeletonUtils.clone` 创建独立骨架；根据远端/本地位移切换 `Idle_A` / `Running_A`，抓取阶段使用 `Hit_A`。
- 四个槽位使用四种暖色 tint，人偶使用同模型的低饱和版本。角色碰撞完全不读取模型网格。
- 每个角色显式创建 `headlamp-socket` 并随头部骨骼动画；距离档位仍来自服务端。
- KayKit 直墙按每段 AABB 的长宽缩放，只替换视觉层；程序化墙始终是加载失败回退。
- 程序化鬼增加兜帽、衣领、双眼和三缕无脚尾焰，仍未引入骨骼或外部模型。

音频矩阵：

| 事件 | 文件 | 循环 | 分组 |
| --- | --- | --- | --- |
| 本地手电启动 | `pick-started.mp3` | 否 | sfx |
| 鬼抓取前摇 | `guard-pounce.mp3` | 否 | sfx |
| 抓到孩子 | `kid-captured.mp3` | 否 | sfx |
| 拾取电池 | `picked-01.mp3` | 否 | sfx |
| 对局结束 | `match-ended.mp3` | 否 | ui/sfx |

声音仅在首次键盘/指针手势后创建 `AudioContext` 并解码；事件已经按 match/event ID 去重，不会逐帧重复播放。界面提供本次会话内的静音按钮。没有鬼脚步声。

## 验收

- 正常浏览器联机测试等待墙、角色和五个声音全部加载，失败数为 0。
- 专门的资源失败测试拦截所有 GLB，确认程序化房屋仍渲染、房间服务仍可用且控制台无阻断错误。
- Node 测试验证二进制尺寸、五个声音路径和四份 CC0 许可证。
- 未声明 premium/AAA：当前环境仍以可读的低多边形室内为目标，后续仍可增加更丰富的房间陈设与事件 VFX。
