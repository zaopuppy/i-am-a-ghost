# HarmonyOS 本地签名配置

本目录将可版本化的发布身份与本机私钥分开：

- `release/GameHack.cer`、`release/gamehackRelease.p7b` 可以提交 Git，不包含私钥。
- `local-signing.cjs` 包含 `.p12` 路径和本机加密凭据，已被 `.gitignore` 排除。
- `local-signing.example.cjs` 是无真实凭据的结构示例。
- 根 `hvigorfile.ts` 在构建时读取本地文件，并注入 `debug`、`release` 两个 signing config。

## 日常命令

```powershell
# 本地调试：复用现有调试签名，跳过华为登录及玩家验证
npm run prototype:harmony:local

# 构建本地调试包、安装并运行
npm run prototype:harmony:run

# 正式发布：发布签名、release 构建、完整华为验证
npm run prototype:harmony:build
# 等价命令
npm run prototype:harmony:release
```

发布产物固定在：

```text
prototypes/harmony-gate-a/build/outputs/release/harmony-gate-a-release-signed.app
```

本地调试产物位于 `entry/build/local/outputs/default/entry-default-signed.hap`。
本地与发布产物分目录保存，切换命令无需修改签名配置或重新申请 Profile。
两种包使用相同包名，安装时覆盖切换；安装命令不会主动卸载或清除数据。

本地跳过验证只在 `BuildProfile.PRODUCT_NAME === 'local'` 且 `BuildProfile.DEBUG` 为真时启用。
正式发布始终调用 `init`、`unionLogin` 和 `verifyLocalPlayer`；本地包不能用于测试华为账号能力。
当前本地调试 Profile 的应用身份与正式应用不同，因此要验证真实华为登录时，仍需使用匹配正式应用的调试 Profile 或应用市场测试包。

不要上传 `unsigned.app`，也不要把 `outputs/local` 或旧的 `outputs/default` 调试包用于发布。

## 新电脑恢复现有发布身份

1. 从受控备份恢复原 `.p12`、Store Password、Key Alias 和 Key Password。正常换电脑不要新建私钥。
2. 在 DevEco Studio 的 **File > Project Structure > Project > Signing Configs** 中手动配置这套材料，让 DevEco 生成适用于当前电脑的加密密码字段。
3. 确认生成后的 `build-profile.json5` 能看到非空 `signingConfigs`，并确认该文件除此之外没有需要保留的改动，再执行：

```powershell
npm run prototype:harmony:signing:capture
git restore -- prototypes/harmony-gate-a/build-profile.json5
npm run prototype:harmony:build
npm run prototype:harmony:release
```

捕获命令不会输出密码，只会创建被忽略的 `signing/local-signing.cjs`。如果目标已存在，先备份；确认要替换后使用：

```powershell
npm run prototype:harmony:signing:capture -- --force
```

也可以复制 `local-signing.example.cjs` 后手动填写。默认假设调试 `.cer/.p7b` 与 `.p12` 文件同名；否则填写示例中的 `debug` 路径。发布 `.cer/.p7b` 默认引用本目录中已提交的 `release/` 文件。

## 有意轮换或私钥丢失

只有在决定更换私钥时才执行：

```powershell
Set-Location prototypes/harmony-gate-a
devecocli signature generate --product default --team-id <团队 ID>
Set-Location ../..
npm run prototype:harmony:signing:capture -- --force
git restore -- prototypes/harmony-gate-a/build-profile.json5
```

之后必须用新 `.csr` 在 AGC 申请新的发布 `.cer` 和匹配的发布 `.p7b`，替换 `signing/release/` 中两个文件，再执行发布构建。新私钥不能搭配旧发布证书/Profile。

## CI

CI 将 `.p12` 和凭据保存在 Secret/密钥库中，在临时目录生成与 `local-signing.example.cjs` 相同结构的文件，并设置：

```powershell
$env:HARMONY_SIGNING_CONFIG = '<临时签名配置的绝对路径>'
npm run prototype:harmony:release
```

流水线结束后删除临时配置和 `.p12`。不要把 Secret、临时配置或私钥打印到日志。
