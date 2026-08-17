# IDM 安全音效包修复

## 问题

游戏只打开页面时不会加载声音。首次按键或点击会解锁 Web Audio；当这次操作是“创建房间”时，看起来就像创建房间触发了下载。

原实现逐个 `fetch()` 五个 `.mp3`。安装 IDM 浏览器集成后，这些程序化请求被接管为 `204` 空响应，`decodeAudioData()` 随后以 `EncodingError` 失败。原有失败回退又为同一批地址创建了五个 `HTMLAudioElement`；Chrome 将它们标记为 `media` 请求，最终触发 IDM 下载提示。

MP3 文件本身没有损坏：ffprobe 能识别全部五个文件，Vite 直连也返回正确的 `200`、`audio/mpeg` 和文件长度。

## 方案

采用单文件音频资源包边界：

- `scripts/pack-audio.mjs` 将五个 MP3 原始字节编码到一个 `base64-audio-pack-v1` JSON 文件。
- 首次用户操作只请求 `assets/audio/kenney/sfx-pack.json`，然后在内存中恢复字节并调用 `decodeAudioData()`。
- `AudioContext.resume()` 现在会被等待完成，再开始解码。
- 删除 `HTMLAudioElement` 回退；音效包或单个样本失败时只记录失败数，不再重新暴露 MP3 媒体 URL。
- `npm run pack:audio` 可在音效变化后重新生成资源包；资产契约测试逐字节验证资源包没有过期。

原始 MP3 和 CC0 许可证继续保留，JSON 是这些原始资产的生成产物。

## 验收边界

浏览器回归测试从用户实际路径点击“创建房间”，要求：

- 页面打开后尚无音频请求。
- 首次操作后五个音效全部解码，失败数为零。
- 网络中只有一个 `sfx-pack.json` 普通 fetch。
- 不出现 `.mp3` 请求，不出现 `media` 请求。

真实 Chrome + IDM 环境复测时，创建房间后资源清单只新增 `sfx-pack.json`，类型为 `other`；`video/media` 数量保持为零，也没有浏览器 download 事件。
