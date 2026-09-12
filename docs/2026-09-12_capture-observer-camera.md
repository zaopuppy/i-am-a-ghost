# 所有玩家可见的抓捕镜头

此前未被抓的小孩仍停留在自己的视角，尤其难以察觉远处 AI 小孩被抓。本次调整取代早期抓捕镜头设计中“其他小孩不切镜头”的约定。

- 任何活跃小孩（包括 AI 小孩）被抓时，所有玩家都进入抓捕镜头。
- 抓捕现场距离当前镜头目标超过 2 个世界单位时，先保持当前视野和角度平移，最多 0.35 秒后收紧为特写；接近目标时可以提前结束平移。
- 近处抓捕直接进入特写。演出结束后恢复玩家自己的视角。
- 鬼的位置仅在抓捕演出期间对其他小孩公开，演出结束后恢复原有可见性规则。
- 抓捕规则、演出时长和声音保持原有行为；感应娃娃不属于可抓捕的小孩。

## 验证

- `npm run build` 通过。
- `npm run test:rules`：175 项通过，包含远处 AI 小孩抓捕、演出期间可见性及镜头先平移后拉近的回归测试。
- `npx playwright test tests/capture-observer.spec.ts tests/capture-pose.spec.ts tests/camera-controls.spec.ts`：4 项通过。
- 已查看 1280×720 和 844×390 的旁观抓捕截图，确认现场、抓捕姿态和事件提示可见。
- `npm run prototype:harmony:run`：本地调试包构建、安装及启动成功。手机上的实际抓捕体验仍需试玩验证。

## 设计参考

使用 `threejs-gameplay-systems` 技能中的 `references/gameplay-workflows.md` 确定改动范围与回归验证；使用 `references/game-feel.md` 和 `references/checklists/game-feel.md` 检查事件反馈和镜头可读性。本次通过先定位事件、再突出动作来改善反馈，没有增加额外震屏或停顿。
