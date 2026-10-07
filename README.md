# Content OS

运行在本机的中文图文创作工具：素材管理 → 可选 AI 文案与审稿 → 网页编辑 → 卡通风格轮换 → 导出 PNG → 手动发布。当前版本：0.1.4-mvp（2026-10-07）。

本机编辑和出图流程已实际验证。当前 MVP 提供免费编辑、卡通排版和导出；可画自动创建、小红书自动发布、自动读数与反馈生成的入口已暂停。

## 启动

当前已验证 Windows，需要 Node.js 24+ 和本机 Microsoft Edge；图片导出通过 Edge 渲染，中文字体使用 Windows 自带的 Microsoft YaHei。macOS 和 Linux 尚未验证。

首次下载并安装依赖：

```powershell
git clone https://github.com/BSD-001/content-os.git
cd content-os
npm ci
```

也可以在 GitHub 下载 ZIP、解压后，在项目文件夹中打开终端运行 `npm ci`。

双击 [Start-ContentOS.cmd](Start-ContentOS.cmd)，会启动隐藏服务并打开系统默认浏览器。也可以在 PowerShell 中运行：

```powershell
node scripts/start.mjs
```

启动器选择系统可用端口，实际地址会打印出来并保存到 data/server-info.json；再次启动会核对 PID 和健康检查，复用正常服务。不要再固定访问旧的 8787 地址。

直接运行 `npm start` 可在终端查看服务日志，并通过打印的地址访问网页。首次启动会创建本机 `data/` 目录和空数据库，不包含开发者的账号数据或历史稿件。

## 使用

1. 切换账号，在“素材库”保存真实经历、笔记或参考文字。
2. 在“内容工作台”新建主题并勾选素材。可直接填写文字，也可启用 DeepSeek 后点击生成并审稿。
3. 编辑标题、正文、话题及每页卡片，支持增删页，保存文字不调用模型。
4. 点击“生成图片预览”，逐页检查。新稿按奶油手帐、漫画分镜、彩色贴纸轮换，同篇风格保持一致。
5. 点击“下载整篇 PNG（ZIP）”：包含按顺序编号的 1080×1440 图片和文案.txt。图片可单张下载，标题正文也可复制。
6. 本人在小红书手动上传并发布。MVP 不需要登录可画或小红书。

修改文字会清空旧预览与图片包；未保存的修改会阻止生成和下载旧图。文字放不下时提示缩短或拆页，不截断正文。PNG 是导出文件，可编辑文字保存在项目内。

手写、编辑和本地出图不需要 API 密钥。AI 调用需要使用者自己的 DeepSeek API 密钥，并按 API 用量收费；每次点击 AI 按钮会发送当前账号所选素材或本篇文案。密钥只在本机设置中填写，不要提交到 GitHub。

当前 AI 预算保护仍带有开发阶段的 5 元测试总上限，依赖预算基线与已核对的模型价格。新安装环境尚未提供完整的预算基线初始化流程，仅在设置中填写密钥不能直接完成 AI 配置；免费编辑和导出可以独立使用。预算价格超过 24 小时会阻止调用；启用或保存设置本身不会调用模型。

## 验证和资料

```powershell
npm run check
npm test
node scripts/check-mvp.mjs
```

MVP 隔离浏览器检查此前通过 24 项，既有离线回归通过 40 项。实际完成了保存、三套卡通 PNG 渲染和浏览器 ZIP 下载；没有调用收费 API 或操作真实平台。运行浏览器检查会在本机 `output/playwright/mvp/` 生成验收记录和测试图文包，这些生成文件不随源码分发。

- [卡通设计规范](docs/STYLE_GUIDE.md)
- [角色采用说明](docs/ROLE_ADAPTATION.md)

使用者的 SQLite 数据库、凭据和导出文件保存在本机 `data/` 中；密钥不回显。当前界面使用 `public/mvp.js`，当前浏览器验收入口为 `scripts/check-mvp.mjs`。旧平台模块及 `scripts/check-ui.mjs` 保留作历史实现，当前 MVP 已关闭对应操作入口。

`data/`、`output/`、`node_modules/`、`.tools/` 和本机 `.env` 已由 `.gitignore` 排除，不随源码上传。开发者的内部交接、运营记录、技能安装副本及个人稿件的一次性脚本也已排除。公开版本只包含通用代码、测试、使用说明和第三方参考素材。

## 开源许可

本项目采用 [MIT 许可证](LICENSE)，允许使用、修改、分发和商用；请保留版权及许可声明。第三方素材与依赖仍遵循各自的许可证。

## 第三方素材

- 六个参考角色来自 agency-agents，原作者 MIT 许可保存在 [vendor/agency-agents/LICENSE](vendor/agency-agents/LICENSE)。
- 卡通插画来自 Open Doodles / Pablo Stanley，使用 CC0，来源和许可说明见 [assets/cartoon/LICENSE.md](assets/cartoon/LICENSE.md)。
- 第三方依赖使用各自的许可证。
