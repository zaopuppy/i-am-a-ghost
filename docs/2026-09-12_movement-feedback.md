# 移动反向响应与脚下方向反馈

用户确认优先改善快速反向，保留方向控制，并在第一版加入本地脚下箭头；门口自动纠偏留待试玩后决定。

## 行为

- 左侧摇杆的有效半径从控件宽度的 32% 缩短至 20%。当前 112 CSS 像素控件对应约 22.4 像素半径，保留 12% 半径的死区。
- 手指超出有效半径时，中心跟随超出的距离。持续拖远不会累积反向回程；仍需越过当前中心才反向。
- 右侧瞄准摇杆保持原有行程和中心行为，双指捕获及释放相互独立。
- 暖白色贴地箭头直接显示经过相机方向转换后的本地移动输入，不跟随身体转向缓动，也不等待网络确认。
- 箭头只绑定当前真人玩家的位置。无输入、暂停、抓捕动画、结束及清空对局时隐藏；保护时间内允许显示移动意图。
- 箭头保持地面平面的形状和位置，通过关闭深度测试保持在门框及家具重叠处可见；它表示操作意图，不保证该方向能够通行。

## 复现与验证

原始触摸复现：向右拖 180 像素，再向左回拉 48 像素，输入仍为满幅向右。修复后同样动作得到向左输入。

- `npm run build`：通过；仍提示主包超过 700 kB。
- `npm run test:rules`：168 项通过。
- `npx playwright test tests/child-controls.spec.ts tests/movement-feedback.spec.ts tests/solo-walk-cadence.spec.ts`：6 项通过。
- 调整箭头遮挡处理后，重新通过构建及两项 `movement-feedback` 浏览器测试。
- 浏览器覆盖真实触摸事件、短距离反向、独立双指与取消/失焦释放、桌面键盘反向、箭头暂停隐藏及恢复、行走动画连续性。
- 单元测试覆盖碰撞位置不变时箭头立即转向、本地角色归属、松手、抓捕、结束、保护时间及清空状态。
- 已查看 1280×720 桌面鬼玩家和 844×390 横屏小孩玩家截图；箭头在两种尺寸下可见，不新增文字或控件遮挡。触摸用例检查本次拖动后的摇杆边界位于视口内。未验证真机刘海安全区及 ArkWeb 手感。

截图由浏览器测试生成，位于 `test-results/movement-feedback-*/movement-arrow-*.png`，后续测试可能覆盖。

## 文件

`src/core/GameInput.ts` 处理摇杆；`src/game/MovementIndicator.ts` 封装箭头；`src/game/GameWorld.ts` 管理场景生命周期；`src/main.ts` 传入本帧移动意图。回归测试位于 `tests/child-controls.spec.ts`、`tests/movement-feedback.spec.ts` 和 `tests/game/movement-indicator.test.ts`。

## UI 参考与检查记录

以下参考均已读取，路径相对 `C:/Users/zhaoy/.agents/skills/threejs-game-ui-designer/`；无读取失败：

| 参考 | 已读取 |
| --- | --- |
| `references/ui-patterns.md` | 是 |
| `references/checklists/game-ui-quality.md` | 是 |
| `references/checklists/hud-readability.md` | 是 |
| `references/checklists/responsive-ui-fit.md` | 是 |
| `references/checklists/mobile-input.md` | 是 |

本次 UI 状态范围为移动、静止、暂停/恢复、抓捕、结束、保护时间和清空对局。加载、菜单排版、其他 HUD 及资源图像未调整。箭头使用原生几何，无新增图片资产。

门口碰撞规则及角色间阻挡没有改变。该修改解决输入反向回程，尚不能据此认定用户遇到的具体门口卡住问题已消除；下一次真机试玩应重点比较反向和贴门框微调。
