# HarmonyOS 正式发布签名指南

> 适用项目：`prototypes/harmony-gate-a` 及其他 Stage 模型 HarmonyOS 工程
>
> 核对日期：2026-08-21
>
> 结论依据：华为开发者官方文档、AppGallery Connect（AGC）官方帮助、本地 `devecocli` 官方文档与命令帮助。

## 一页结论

1. `devecocli signature generate` 是**调试/测试签名自动化**：它自动生成本地 `.p12`、`.csr`，向云端申请调试证书和测试/调试 Profile，并把签名信息写入工程配置。它不是正式发布证书申请命令；正式发布必须改用发布证书和发布 Profile，并使用手动 release signing。（本地官方文档：`devecocli docs read 开发指南/配置调试签名/ide-signing`；命令边界：`devecocli signature generate --help`；[华为“配置调试签名”](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)）
2. 该命令生成的 `.p12` 和 `.csr` **在技术上可延用到发布链路**：`.p12` 是密钥库，`.csr` 是使用其中公钥形成的证书请求；华为 FAQ 明确说明二者可在调试/发布场景共用。前提是团队确实掌握该密钥库、别名和密码并已安全备份。自动生成的 `.cer` 是调试证书、`.p7b` 是测试/调试 Profile，**不能用于正式发布**；证书和 Profile 的类型必须匹配。（本地官方文档：`devecocli docs read FAQ/应用市场服务_AppGallery_Kit/申请证书数量限制问题/faqs-appgallery-19`、`.../证书和Profile类型及使用场景/faqs-appgallery-81`；[华为签名材料定义](https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/harmonyos-sdk-config-agc-0000001101459188)）
3. 本项目已经用 `devecocli` 生成并验证了一套 `.p12`/`.csr`，因此当前推荐**复用这套密钥和 CSR**：在 AGC 申请“发布证书”得到新的 `.cer`，再为本应用申请“发布 Profile”得到新的 `.p7b`；不要重复生成密钥，也不要使用 `--force`。只有在现有密钥无法恢复、无法由受控环境使用，或团队决定改用云管理证书时，才另建发布密钥。[华为“发布应用”开发指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app)、[华为签名配置说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)
4. `--build-mode release` 只选择构建模式，**不会把调试证书自动变成发布证书**。发布构建必须同时满足：release 构建模式、`debuggable`/`debug` 为 `false` 或未配置、签名配置引用发布 `.cer` 与匹配的发布 `.p7b`。（本地官方 FAQ：`devecocli docs read FAQ/工程管理/使用发布证书打release包未成功的解决方案/faqs-project-management-27`；`devecocli build --help`）

## 四类文件分别是什么、哪些能发布

| 文件 | 内容和作用 | `devecocli signature generate` 产物能否进入发布链路 | 发布时的正确用法 |
|---|---|---|---|
| `.p12` | 密钥库，包含签名用公钥/私钥；是最关键的本地秘密材料 | **可以，但有条件**：它本身不区分调试/发布；必须掌握密钥库密码、Key Alias、Key Password，并确认可恢复 | 与向 AGC 提交的 CSR 属于同一密钥对；在 release signing 中作为 Store File |
| `.csr` | 证书签名请求，包含公钥和主体信息，不包含私钥 | **可以**：可上传 AGC 申请“发布证书” | 保留原始 CSR，后续发布证书续期时可继续使用相同公钥链路 |
| `.cer` | AGC 颁发的数字证书，明确区分调试证书和发布证书 | **不可以**：自动签名拿到的是调试证书 | 必须在 AGC 新申请并下载“发布证书” `.cer` |
| `.p7b` | Profile，绑定应用包名、证书、证书权限/ACL；调试类还包含设备列表，Release 的设备列表为空 | **不可以**：自动签名生成的是测试/调试 Profile | 必须为本应用、对应发布证书申请“发布 Profile” `.p7b` |

上述定义和 Profile 的包名、证书、权限及设备清单语义来自[华为官方签名材料说明](https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/harmonyos-sdk-config-agc-0000001101459188)；华为 FAQ 还明确：`.p12`/`.csr` 可跨应用及调试/发布共用，`.cer` 不可跨调试/发布类型共用，`.p7b` 既不能跨应用也不能跨调试/发布类型共用。（本地官方 FAQ：`faqs-appgallery-19`）

> 建议：虽然华为允许多个应用共用同一个 `.p12`/`.csr`，本项目仍宜使用独立的 release 密钥。这样其他应用或调试环境泄密时，不会同时危及本应用。发布签名一旦确定，应在后续更新中保持稳定，不要为每个版本重建密钥。

## 本项目当前状态（2026-08-21）

- 应用模块：`prototypes/harmony-gate-a`
- Bundle Name：`com.zero.gamehack.iamaghost`
- 已执行：`devecocli signature generate --product default --team-id <团队 ID>`
- 已生成：位于 `%USERPROFILE%\.ohos\config` 的 `.p12`、`.csr`、调试 `.cer` 和调试 `.p7b`
- 已验证：`devecocli build --product default --build-mode release` 可以完成构建和签名
- 尚未具备：AGC 颁发的**发布证书** `.cer` 与绑定本应用、该发布证书的**发布 Profile** `.p7b`

因此当前构建虽然使用 release 构建模式，签名身份仍是调试签名，不能上传邀请测试、公测或正式发布。下一步只需要在 AGC 完成本文第 2、3 步；下载发布 `.cer/.p7b` 后，用它们替换 release signing 中的 `certpath/profile`，继续沿用现有 `storeFile`、`storePassword`、`keyAlias` 和 `keyPassword`。签名配置含可用凭据，不提交 Git。

可用以下只读命令定位现有密钥与 CSR；命令不会显示密钥或密码正文：

```powershell
Get-ChildItem -LiteralPath "$env:USERPROFILE\.ohos\config" -File |
  Where-Object Extension -In '.p12', '.csr' |
  Select-Object Name, Length, LastWriteTime
```

## 推荐流程：传统本地发布签名

### 1. 创建并托管 release 密钥和 CSR

如果是其他项目首次创建发布密钥，在 DevEco Studio 中选择 **Build > Generate Key and CSR**：

1. 新建或选取 `.p12` Key Store；设置强 Store Password。
2. 创建 Key Alias 和 Key Password。
3. 生成 `.csr`。
4. 当场验证团队的受控备份中已经保存 `.p12`、`.csr`、Alias 以及两项密码；不要把任何密码写入本文、工单、聊天或 Git。

华为文档说明 `.p12` 保存公私钥，`.csr` 用于向 AGC 请求证书；DevEco 的手动签名流程也要求妥善记住 Key Store 密码和 Alias。创建本地 Key 时，Validity 宜设置为至少 25 年，以覆盖应用生命周期；这与 AGC 发布证书自身的 3 年有效期是两件事。[华为“发布应用”开发指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app)、[华为“配置调试签名”](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)；本地官方 FAQ：`faqs-appgallery-87`

本项目已经决定复用 `devecocli signature generate` 生成的 `.p12`/`.csr`，并已完成一次构建签名验证。仍需把密钥和凭据纳入可恢复的受控备份。不要重新执行带 `--force` 的自动生成命令，因为该选项会覆盖本地签名材料。`signature generate` 还会写工程签名配置，因此完成首次生成后，不应在 release 工作流中再次执行它。（`devecocli signature generate --help`）

### 2. 在 AGC 申请发布证书 `.cer`

1. 使用拥有“证书与 Profile”权限的账号登录 AGC；若看不到菜单，让账号持有者/管理员在“用户与访问”中授予最小必要权限。华为当前权限说明指出，只有被授予相应权限的成员才能访问“证书、APP ID和Profile > 证书/Profile”。[华为“管理团队账号”](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-manageaccount-0000002306610129)
2. 进入 **证书、APP ID和Profile > 证书 > 新增证书**。
3. 证书类型选择 **发布证书**，上传步骤 1 的 `.csr`，填写便于识别的证书名并提交。
4. 下载 AGC 颁发的 `.cer`，记录证书名称、指纹、颁发/失效日期及关联 CSR，但不要在普通文档中复制证书正文。

华为的发布证书流程要求上传 CSR 并明确选择“发布证书”；证书由 AGC 颁发。[华为 AGC“申请发布证书”](https://developer.huawei.com/consumer/cn/doc/app/agc-help-release-cert-0000002283336729)、[华为“发布应用”开发指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app)

### 3. 为本应用申请发布 Profile `.p7b`

1. 进入 **证书、APP ID和Profile > Profile > 添加**。
2. Profile 类型选择 **发布**，选择本应用以及刚申请的发布证书。
3. 仅按应用实际需要选择证书权限/ACL；如果包中声明受限开放权限，发布 Profile 必须包含对应 ACL，否则审核会被驳回并要求重签包。[华为“配置隐私说明”](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-release-app-privacy-desc-0000002313477969)
4. 提交后立即下载 `.p7b` 并归档。Profile 是应用专属材料；更换应用、证书或 ACL 后应重新生成匹配的 Profile。

当前 AGC 菜单入口及申请步骤见[华为 AGC“申请发布 Profile”](https://developer.huawei.com/consumer/cn/doc/app/agc-help-release-profile-0000002248341090)和[华为“管理团队账号”](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-manageaccount-0000002306610129)；Release Profile 不含调试设备清单，见[华为签名材料说明](https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/harmonyos-sdk-config-agc-0000001101459188)。

### 4. 在 DevEco Studio 配置 release signing

进入 **File > Project Structure > Project > Signing Configs**，为 release 产品使用独立的手动签名配置：

- 取消 **Automatically generate signature**。
- Store File：选择 release `.p12`。
- Store Password、Key Alias、Key Password：通过本机/CI 的安全凭据提供，不写入仓库文档。
- Sign Alg：使用 DevEco Studio 要求的 `SHA256withECDSA`。
- Profile File：选择步骤 3 的发布 `.p7b`。
- Certpath File：选择步骤 2 的发布 `.cer`。
- 确认对应 product 的 release 构建引用该 signing config；release 的 `debuggable`/`debug` 应为 `false` 或省略。

字段含义和手动配置入口来自[华为官方开发者文章的完整打包示例](https://developer.huawei.com/consumer/cn/blog/topic/03170961386142106)及[华为“配置调试签名”](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)；发布包不得处于可调试状态见本地官方 FAQ `faqs-project-management-27`。

命令行/CI 没有另一套证书格式：它仍读取工程的签名配置。官方 `build-profile.json5` 模型中，`app.signingConfigs[].material` 保存或引用 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`、`signAlg`、`profile`、`certpath`，具体 product 通过 `products[].signingConfig` 选择配置。[华为 `build-profile.json5` 配置说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/ide-hvigor-build-profile-V5) 本项目应由负责人通过 DevEco 或 CI 的受控配置完成这些映射；本文不写入真实值，也不修改当前文件。

> 本次研究没有修改 `build-profile.json5`。实际配置前应先决定：个人开发机使用 DevEco 的本地安全配置，CI 使用其密钥库/Secret 注入；两者都不要把真实密码、私钥正文或可直接解密的凭据提交到 Git。

### 5. 用命令行构建 release 包

签名配置完成后，在 HarmonyOS 工程目录执行：

```powershell
Set-Location prototypes/harmony-gate-a
devecocli build --product default --build-mode release
```

`devecocli build --help` 明确说明 `--product` 读取 `build-profile.json5` 中的产品名，`--build-mode` 选择构建模式且默认值是 `debug`。因此发布构建必须显式指定 `release`，并在构建前确认所选产品已绑定手动发布签名。构建出的正式 `.app` 再上传 AGC；AGC 会对正式包做合法性检测。[华为“发布应用”](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-release-0000002235870050)、[华为“上传软件包”](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-release-game-upload-pkg-0000002399249081)

不要用以下推理代替检查：

- “构建模式叫 release，所以证书一定是发布证书”——错误，二者是独立维度。
- “本地能安装，所以可以上架”——错误，调试/指定设备 Profile 的安装范围与正式发布不同。
- “`.cer` 和 `.p7b` 都是 AGC 下载的，所以可以混用”——错误，证书与 Profile 必须属于匹配类型、应用和证书关系。（本地官方 FAQ：`faqs-appgallery-81`）

## 备份、权限和轮换

### 必须备份什么

| 材料 | 备份级别 | 原因 |
|---|---|---|
| release `.p12` | 最高；加密、双份、异地或独立故障域 | 含私钥，决定后续版本的签名身份 |
| Store Password、Key Alias、Key Password | 最高；与文件分离保管 | 缺少任一项都可能无法继续签名 |
| 原始 `.csr` | 高 | 续签时复用原 CSR 可保持相同公钥；CSR 本身不含私钥 |
| 发布 `.cer`、`.p7b` | 中高；按版本和有效期归档 | 构建、审计、回滚和权限核对需要；Profile 与应用/证书/ACL 绑定 |
| 元数据 | 高 | 记录 APP ID、bundleName、证书/Profile 名称、指纹、有效期、负责人和轮换记录 |

建议至少保留两份可恢复的加密备份，并定期做“只验证能解锁/签名、不输出私钥正文”的恢复演练。人员离组时撤销其 AGC 和密钥库访问权，而不是立即废除仍在使用的发布证书。华为团队权限模型支持按角色单独授予证书/Profile 操作权限，应遵循最小权限。[华为“管理团队账号”](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-manageaccount-0000002306610129)

### 证书到期和正常轮换

传统发布证书有效期为 3 年。到期不会影响已经在架版本的继续安装/运行，但使用过期证书签出的新版本无法通过上传校验。华为建议复用原 `.csr` 和 `.p12` 申请新发布证书，再申请与新证书匹配的新发布 Profile；证书指纹会变化，因此还要同步更新备案信息以及所有依赖证书指纹的开放服务配置。（本地官方 FAQ：[`应用证书到期后的影响及处理方式`](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-appgallery-82)）

一个账号最多可保有 3 个有效的传统发布证书，一个应用最多可创建 100 个 Profile；已废除证书不占发布证书额度。证书不与单一应用绑定，但 Profile 与具体应用绑定。（本地官方 FAQ：`faqs-appgallery-19`）这也是为什么不应为每个版本无计划地新建证书。

推荐时间线：

1. 到期前 90～180 天盘点依赖该证书指纹的服务和备案信息。
2. 用原 `.csr` 申请新发布证书，生成匹配的新发布 Profile。
3. 在隔离的 release 配置中打包并完成 AGC 上传校验。
4. 更新证书指纹、备案及相关服务配置，保留旧材料供历史版本审计。
5. 只有确认新链路稳定且不存在仍需使用旧证书的发布任务后，再考虑废除旧证书。

废除证书会使基于该证书创建的 Profile 失效；重新生成发布 Profile 本身不会阻断同 APP ID 应用的升级，但新 Profile 必须随下一包重新签入。（本地官方 FAQ：`faqs-appgallery-82`、`faqs-appgallery-12`）

### 泄露或丢失时

- 怀疑 `.p12` 或密码泄露：立即停止发布，限制密钥与 AGC 权限，盘点受影响构建；由账号持有者/管理员在 AGC 废除受影响证书及其 Profile，申请新证书/Profile，更新指纹、备案和依赖服务，然后发布安全更新。废除不可恢复，操作前应确认精确目标。[华为云管理证书文档对“废除后 Profile 全部失效、不可恢复”的说明](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-cloud-cert-0000002572233173)同样说明了证书废除的高风险语义；传统证书轮换步骤见 `faqs-appgallery-82`。
- `.p12` 丢失但未泄露：不要仅靠重新下载 `.cer`/`.p7b` 期待恢复私钥；证书和 Profile 不包含可用于签名的私钥。先从加密备份恢复，否则应联系华为支持评估签名连续性方案。[华为签名材料定义](https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/harmonyos-sdk-config-agc-0000001101459188)
- `.cer`/`.p7b` 丢失：从 AGC 恢复或重新生成匹配 Profile，并立即归档。不要用其他应用或调试环境的同扩展名文件替代。（本地官方 FAQ：`faqs-appgallery-19`、`faqs-appgallery-81`）

## 可选方案：AGC 云管理证书

华为当前还提供“云管理证书”：DevEco Studio 26.0.0 Beta1 及以上版本在中国境内支持通过 **Build > Upload Product** 上传 Release `.app`，选择 AppGallery Connect、Testing Only，或在 Custom 中选择 Automatically manage signing；AGC 会在云端托管私钥并为上传包重签名，不依赖开发机保存本地私钥。云管理证书有效期为 1 年；在到期前 90 天内产生新签名请求会自动轮换，账号最多同时有 2 个云管理证书。[华为“查看或轮换云管理证书”](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-cloud-cert-0000002572233173)、[华为“发布应用”开发指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app)

这是一条独立于本文传统 `.p12` 手动签名的发布路线。它可降低本地私钥丢失风险，但会改变上传、CI 和灾备责任边界。本项目如果选择它，应先确认团队的上传方式和流水线均受支持，再形成单独的操作手册；不要在同一发布流水线中无记录地混用云管理证书和传统发布证书。

## 本项目执行清单

- [ ] 明确采用“传统本地发布签名”还是“云管理证书”，记录责任人。
- [x] 当前项目采用传统方案，复用 devecocli 已生成且构建验证通过的 `.p12`/`.csr`。
- [ ] 已把 `.p12`、`.csr` 和所需凭据纳入可恢复的受控备份。
- [ ] AGC 中申请的是**发布证书** `.cer`，不是调试证书。
- [ ] 为当前应用和该发布证书申请的是**发布 Profile** `.p7b`。
- [ ] Profile 的 ACL 与软件包实际受限权限一致。
- [ ] DevEco 中关闭自动调试签名，release signing 同时引用同一链路的 `.p12`、`.cer`、`.p7b`。
- [ ] `debuggable`/`debug` 为 `false` 或省略；命令显式使用 `--build-mode release`。
- [ ] 密钥和密码未进入 Git、日志、截图、文档或聊天；CI 从 Secret/密钥库注入。
- [ ] 对最终 `.app` 做上架自检并上传 AGC 验证，不用“本地安装成功”替代验证。
- [ ] 已设置证书到期提醒，并在台账中安排至少提前 90 天轮换。

## 官方来源与本地复核命令

主要在线来源：

- [华为 HarmonyOS：配置调试签名](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)
- [华为 HarmonyOS：发布应用](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app)
- [华为 AGC：开发基础知识（证书、Profile 文档目录）](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/development-fundamentals)
- [华为 AGC：申请发布证书](https://developer.huawei.com/consumer/cn/doc/app/agc-help-release-cert-0000002283336729)
- [华为 AGC：申请发布 Profile](https://developer.huawei.com/consumer/cn/doc/app/agc-help-release-profile-0000002248341090)
- [华为：签名材料与签名配置说明](https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/harmonyos-sdk-config-agc-0000001101459188)
- [华为：证书配置（含发布证书/Profile完整流程）](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V2/lowcode-configure-certificate-0000001608552336-V2)
- [华为 AGC：管理团队账号与证书/Profile权限](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-manageaccount-0000002306610129)
- [华为 AGC：查看或轮换云管理证书](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-cloud-cert-0000002572233173)
- [华为 AGC：配置隐私说明（发布 Profile ACL 一致性）](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-release-app-privacy-desc-0000002313477969)
- [华为 AGC：发布应用](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-release-0000002235870050)

可在本机复核的只读命令（不会生成或读取密钥正文）：

```powershell
devecocli signature generate --help
devecocli build --help
devecocli docs read 开发指南/配置调试签名/ide-signing
devecocli docs read FAQ/应用市场服务_AppGallery_Kit/证书和Profile类型及使用场景/faqs-appgallery-81
devecocli docs read FAQ/应用市场服务_AppGallery_Kit/申请证书数量限制问题/faqs-appgallery-19
devecocli docs read FAQ/应用市场服务_AppGallery_Kit/应用证书到期后的影响及处理方式/faqs-appgallery-82
devecocli docs read FAQ/应用市场服务_AppGallery_Kit/证书有效期和创建密钥时不一致/faqs-appgallery-87
devecocli docs read FAQ/应用市场服务_AppGallery_Kit/重新生成profile发布的应用_是否会影响安装之前发布的应用/faqs-appgallery-12
devecocli docs read FAQ/工程管理/使用发布证书打release包未成功的解决方案/faqs-project-management-27
```

## 边界说明

本次已执行 `devecocli signature generate` 并完成 release 模式构建验证；该命令生成了调试签名材料并更新了本机工程签名配置。未读取或输出 `.p12` 私钥、密码或证书正文，尚未在 AGC 申请发布证书/Profile，也未实际上传发布包。AGC 页面名称会随平台迭代调整；若界面与本文略有不同，应以同一官方概念——发布证书、发布 Profile、应用、证书和 ACL 的匹配关系——完成配置。
