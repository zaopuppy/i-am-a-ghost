# 开场动画与动态标题接入

## 结果与范围

把[午夜捉迷藏契约](2026-09-12_midnight-hide-and-seek-pact.md)接入首次启动流程：自动播放约八秒的角色演出，结束后停留在动态标题，玩家点击开始才进入原大厅。当前演出静音，以触纸、关门、垂头、独立墙影、手电与退避表达背景。

本次不改对局规则，不接入局内契约纹样或结算动画。

## 实现

- `src/game/OpeningScene.ts`：独立 Three.js 展示场景、分镜、角色动作、手部 IK、手机构图；不拥有独立动画循环。
- `src/game/OpeningSequence.ts`：首次播放、已观看记录、跳过/重播、标题、键盘焦点、后台暂停与减少动态效果。演出按实际时间推进，避免受到对局步长上限影响而被拖长。
- `src/main.ts`：在现有渲染循环中切换演出与游戏场景；退出演出清空输入、恢复相机。房间链接、已有会话及开发场景入口绕过开场。
- `index.html` / `src/styles.css`：跳过、动态标题、开始与大厅重播入口；演出期间其他控件隐藏且设为 inert，读屏提供简短场景描述。
- `src/assets/ImportedAssets.ts`：失败的模型请求不再永久留在缓存中，支持网络恢复后重试。

关闭演出会释放其独占几何、材质与骨架资源，保留角色缓存中的共享几何和纹理。异步加载采用代次检查，跳过后到达的旧结果不能重新显示演出。

## 资源与渲染

复用 `Rogue_Kid.glb`、`Ghost.glb`、现有 KayKit 家具和 `MaterialLibrary`；新增门板、旧纸、手印、墙影和手电为代码几何。没有下载新资产，没有新增第三方许可证。开场场景按需加载，生产构建新增的 `OpeningScene` 分块约 10.16 kB（gzip 3.67 kB）。

沿用现有 ACES 色调映射与最高 2 倍 DPR；不新建 WebGLRenderer，不启用开场体积光后处理。手电光束采用透明网格，墙影采用独立几何以表现其先于身体行动。

开发版标题采样为 81 次绘制、31,973 个三角形，渲染器记录 65 个几何资源、28–35 个纹理资源；资源计数包含同一渲染器已加载的内容，随异步准备进度变化，不等同于开场独占内存。未据此宣称移动真机帧率达标。

## 验证记录

### 主动重复观看修复

用户反馈原重播方式无效，并要求普通玩家能够主动反复观看。已复现：在系统 `prefers-reduced-motion: reduce` 下点击原重播按钮，预期进入 `playing`，实际直接进入 `title`。复现命令为 `npx playwright test tests/opening-replay.spec.ts --output=tmp/opening-replay-red`，修复前该断言失败。

核对了动态效果设置、观看记录与房间入口三条路径：观看记录只用于首次进入，但原手动播放和自动播放共用减少动态效果分支；原按钮位于进入房间后隐藏的 `lobby-actions` 内，主循环也会退出任何有房间状态的演出。

手机正常点击测试还复现了第二个入口问题：开发版展开的 `lil-gui` 遮住观看按钮，Playwright 报告调试面板拦截指针。窄屏启动及缩窄窗口时现已默认收起调试面板；开发者仍可主动展开。测试不隐藏调试面板、不使用强制点击，直接验证普通点击可达。

修复后的普通玩家入口与行为：

- 首页标题下、房间等待页均显示「观看开场动画」，不依赖开发者工具或清空本地数据。
- 动画结束后与「开始游戏」并列显示「再看一遍」；可连续重播，复用已就绪场景，无需重新加载资源。
- 明确点击观看时完整播放；减少动态效果仍适用于首次自动开场，已观看记录不影响主动重播。
- 房间等待时可以观看并返回同一房间；一旦房间开始加载或对局，退出演出交还对局流程。
- 标题页的两个按钮都支持 Tab / Shift+Tab，Escape 退出；从房间观看退出后焦点回到观看按钮。

新增 `tests/opening-replay.spec.ts` 覆盖减少动态效果下主动播放、桌面和手机连续看三遍，以及保留原房间的观看/返回路径。原开场测试同步覆盖两个标题按钮的键盘导航。

修复验证：`npm run build` 通过；四项主动重播测试、两项手机联机布局测试通过，六项原开场测试也已通过。截图位于 `tmp/opening-replay-final/`。生产预览手机尺寸实际完成标题页重播两次、返回首页后主动观看及 Escape 退出，控制台和页面错误为零；证据位于 `tmp/opening-replay-preview/`。全程使用可见按钮正常点击，不清空观看记录、不强制点击被遮挡控件。

### 首版及回归检查

- `npm run build`：通过。仍有主分块超过 700 kB 的 Vite 提示。
- `npm run test:rules`：175 项通过。
- 开场浏览器覆盖：首次无交互播放并停留标题、跳过加载、刷新后不重复播放、重播与 Escape、手机竖屏/横屏、减少动态效果、房间链接绕过、资源失败后重试。
- 六项开场测试最终均通过；首次自动播放测试从导航提交时开始观察，避免等待页面 load 事件后错过已经自动播放的首镜头。证据位于 `tmp/opening-final-tests/` 与 `tmp/opening-autoplay-tests/`。
- 生产预览 `http://localhost:5190/`：桌面和手机均完成标题 → 大厅 → 单人对局 → 暂停 → 返回大厅；浏览器控制台和页面错误均为零。截图及 JSON 位于 `tmp/opening-verification/`，画布有效亮像素占比分别约 27.3% 与 35.5%。
- `tests/mobile-layout.spec.ts`：两个尺寸的联机角色选择检查通过。
- `tests/solo-mode.spec.ts`：手机设置、触控、暂停/恢复检查通过。桌面长流程通过进入离线对局、移动、暂停、重启和换阵营，随后等待三次抓捕结束超时；50 秒墙钟时间仅推进约 6 秒游戏时间，保留为未通过项，不宣称完整浏览器套件通过。
- `tests/tab-session-recovery.spec.ts`：使用 60 秒测试上限时通过房主断开后的接替与开始准备检查。
- `git diff --check`：通过。

旧游戏测试默认使用已观看开场的本地存储状态；首次访问由独立 `tests/opening.spec.ts` 用空存储测试。两个自行创建浏览器上下文的旧测试显式跳过开场。单人测试对诊断帧采用轮询，避免界面已切换而首个诊断帧尚未到达的竞争。

截图与临时证据保存在仓库 `tmp/` 及 Playwright 的 `test-results/` 中。镜头与按钮已经过桌面 1280×720、竖屏 390×844、横屏 707×440 的截图检查；墙影头部在关键分镜中完整显示，标题避开主要角色区域。

## 技能与阶段记录

本次为现有游戏的有限开场接入，不作全游戏 AAA 或发布完成声明。

| 项目 | 使用与结果 |
| --- | --- |
| 技能 | 已读取 `threejs-game-director`、`threejs-game-ui-designer`、`threejs-qa-release`。场景实现委派给独立工作代理，主代理完成入口、界面与浏览器验证。 |
| 重播诊断 | 已读取仓库 `.agents/skills/diagnosing-bugs/SKILL.md`，使用浏览器失败断言定位主动播放被减少动态效果设置跳过的问题，再覆盖连续重复观看。 |
| 导演参考 | 已读取 `threejs-game-director/references/phase-playbook.md`。 |
| 界面参考 | 已读取 `ui-patterns.md`、`game-ui-quality.md`、`hud-readability.md`、`responsive-ui-fit.md`、`mobile-input.md`。 |
| 图形参考 | 已读取 `visual-scorecard.md`、`implementation-blueprint.md`、`model-recipes.md`、`render-recipes.md`，以及 `procedural-model-quality.md`、`material-lighting-quality.md`、`performance-safe-visual-detail.md`。 |
| QA 参考 | 已读取 `qa-release-checklists.md`、`visual-verification.md`、`playtest-qa.md`、`release.md`。 |
| 素材生成 | 未采用：本次按已确认方案复用游戏现有角色与家具，辅助道具使用代码几何；不需要新的模型、图片或声音服务。未探测密钥、未宣称凭据缺失。 |
| 阶段 | 开场场景与界面完成；图形检查和针对性 QA 完成。对局系统、整体美术升级、部署不在本次范围。 |
| 视觉基线 | 使用行为断言、画布像素检查与人工截图检查；不修改既有对局基线，不新增依赖实时演出时刻的脆弱快照基线。 |
| 自动对局 | 规则套件包含既有确定性机器人测试；不增加平衡或发布级机器人测试。 |

以上参考文件均来自 `C:/Users/zhaoy/.agents/skills/` 下对应技能目录。
