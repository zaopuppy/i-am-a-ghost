# “不要被抓到”品牌资产

中文名：**不要被抓到**  
英文名：**I am a Ghost**

## 视觉方向

品牌视觉采用“儿童友好的轻惊悚捉迷藏”：深靛蓝表现夜间房屋，暖金色表现小孩的手电光，柔和的象牙白幽灵负责形成一眼可辨的主体。图标不包含文字，避免在 216 px 和桌面小图标场景中失去可读性。

## 交付文件

- `app-icon-1024.png`：鸿蒙启动器图标母版，1024×1024 PNG。
- `app-market-icon-1024.png`：应用市场图标，1024×1024 PNG，低于 3 MB。
- `app-market-icon-216.webp`：同一市场图标的 216×216 WEBP 备用导出，低于 100 KB。

鸿蒙工程使用 `app-icon-1024.png` 的副本作为 AppScope、Ability 和启动窗口图标。平台负责最终的图标蒙版，因此源图不烘焙圆角。

## 生成记录

生成方式：OpenAI 内置 `imagegen`。

启动器图标最终提示词：

> Create an original square premium mobile-game launcher icon for the family-friendly asymmetric hide-and-seek game “不要被抓到” / “I am a Ghost”. Show a charming rounded ivory ghost peeking from a dark midnight-indigo doorway while a warm golden flashlight beam narrowly misses it. Use bold vector-like silhouettes, subtle painted depth, a soft cinematic glow, and a central 70% safe area. It must remain readable at 48 px. Use no text, letters, numbers, trademarks, watermark, gore, skulls, photorealism, busy detail, external frame, or baked rounded-corner mask.

应用市场图标最终提示词：

> Using the launcher icon as the visual-identity reference, create a distinct square storefront icon for “不要被抓到” / “I am a Ghost”. Show the same friendly ivory ghost above a simplified top-down haunted-house floor plan while a warm golden flashlight cone sweeps through the rooms and nearly finds it. Match the midnight navy, indigo, amber-gold, and ivory palette; keep the important details within a central 76% safe area and readable at 216 px. Use no text, letters, numbers, trademarks, watermark, gore, frightening face, clutter, external frame, or baked rounded-corner mask.
