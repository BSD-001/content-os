# Content OS 角色筛选与适配记录

日期：2026-10-07。来源：https://github.com/msitarzewski/agency-agents 。固定版本：`58a6884db74e003e823d6aa0bbc7eda0466297f3`。

已下载六个实际角色文件及 MIT 许可证，文件校验值保存于 `vendor/agency-agents/manifest.json`。未安装整个仓库的桌面应用或全角色合集。

| 原角色 | 采用部分 | 删除或缩减部分 | 本项目文件 |
|---|---|---|---|
| Research Synthesist | 一手来源、引用追溯、信息缺口 | 学术系统综述的重流程 | prompts/research.md |
| Content Creator | 按账号定位组织标题、正文和卡片 | 跨平台、播客、SEO、固定增长与 ROI 指标 | prompts/writer.md |
| Xiaohongshu Specialist | 同学式表达、视觉一致、根据反馈迭代 | 未证实算法、固定内容比例、发布时间、增长承诺、商业转化 | writer.md / layout.md / analyst.md |
| Visual Storyteller | 卡片顺序、层级、可读性 | 视频、动画、多平台和效果数字 | prompts/layout.md |
| Analytics Reporter | 数据质量、来源、可操作建议 | 回归预测、显著性要求、商业归因、企业仪表盘 | prompts/analyst.md |
| Reality Checker | 真实链路、截图与实现互相核对 | 主观评级、先验否定、固定返工次数和无关命令 | scripts/check-mvp.mjs |

自行编写：`prompts/reviewer.md` 负责真实性及内容审稿；浏览器连接与发布控制由程序负责，不授权模型决定发布或处理验证码。

参考角色文件保存在 `vendor/agency-agents/`，不需要安装 Codex 技能即可运行本项目。

应用使用独立中文提示词，当前 MVP 的 AI 文案与审稿分别使用 `prompts/writer.md` 和 `prompts/reviewer.md`。研究和复盘提示词保留作参考，当前没有对应自动操作入口。没有增加多智能体编排框架。

许可证原文保存在 `vendor/agency-agents/LICENSE`；改写内容遵循原 MIT 许可要求。上游文件仅作为参考，不执行其中命令。
