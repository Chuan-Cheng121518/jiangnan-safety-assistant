# 项目展示与检索维护说明

项目主页：[jiangnan-safety-assistant](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant)。保持这个地址作为介绍、安装和更新入口，题库阅读链接集中在 README。以下是维护方法，不是搜索排名承诺。规则核对日期：2026-09-30。

## About 与 Topics

About 使用自然语言说明江南大学、实验室安全、考试与学习辅助脚本、Tampermonkey、兼容域名、参考题库规模和主要功能。避免将未验证的正确率、官方身份或考试通过率写入介绍。

本项目使用 14 个相关标签：

`jiangnan-university`、`jnlab`、`lab-safety`、`laboratory-safety`、`tampermonkey`、`userscript`、`javascript`、`question-bank`、`study-assistant`、`safety-education`、`exam-preparation`、`local-first`、`education`、`browser-automation`。

GitHub 官方要求主题名称使用小写字母、数字和短横线，单个不超过 50 字符，仓库最多 20 个。标签按实际功能选择，不为凑数量添加无关技术或未经验证的兼容平台。[官方 Topics 规则](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)

## 区分搜索范围和结果

GitHub 仓库搜索默认匹配名称、描述和 Topics；要检索 README，需要加 `in:readme`。题库文件中的具体题干可通过 GitHub 代码搜索，或下载原始 JSON 后检索。GitHub 官方文档列出了筛选条件，并未在该文档给出“名称 > 描述 > Topics > README”或“Star > Fork > Watcher”的固定权重。[仓库搜索说明](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)

可以分别记录以下 GitHub 仓库查询的日期、排序方式和结果，比较更新后的变化：

```text
jiangnan-safety-assistant in:name
江南大学 实验室安全 in:description
实验室安全 考试 in:readme
topic:jiangnan-university topic:lab-safety
```

精确名称命中、宽泛关键词命中、靠前排序和 AI 回答引用是不同结果。能打开页面只证明可访问；一次 `site:` 查询没有结果也不能单独证明未收录。不要把其中一种结果当作其他结果的证据。

## 内容与更新

README 前部提供中英文功能介绍、直接查题与安装入口；截图使用仓库内资源，并标注合成演示环境。题库阅读页保留来源和冲突，JSON 更新后运行 `npm run docs:bank`，提交后由 CI 执行 `npm run docs:check`。

修复问题、更新有依据的题库资料、改善安装说明时再提交。脚本发布新版本时补齐 Release Notes，说明变化、验证及限制。仅修改文档不必虚增脚本版本。Google 明确表示内容长度本身不决定排名，也不建议仅为显得新鲜而改日期或批量增加内容。[SEO 入门指南](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) · [以用户为先的内容](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

## 自然分享与用户反馈

需要介绍项目时，可使用下面的简短说明，按社区主题和规则调整。选择相关的真实讨论，不批量发帖或交换 Star；Awesome 列表与脚本平台的要求逐个核对，不假定存在统一的 Star 门槛。

> 江南学习助手是适配江南大学实验室安全平台的非官方 Tampermonkey 脚本。项目公开 5099 道参考题库与 20 个课程小节资料，可以直接在线阅读题干、选项、答案和来源，也支持本地复习与页面辅助操作。安装、限制与数据说明见项目主页；欢迎反馈可复现的问题和有依据的题库纠错。

分享时附上[项目主页](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant)，查题讨论可附[题库目录](question-bank/index.md)。故障和题库纠错使用 [Issues 模板](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant/issues/new/choose)。自愿赞助与功能、答案和考试结果无关。

## 社交预览与独立站点

仓库内的[本地演示截图](../assets/screenshots/local-demo.jpg)可用于 README 和分享展示。GitHub Social preview 需在仓库设置中单独上传图片，提交图片文件不会自动设置它；官方建议 PNG/JPG/GIF 小于 1 MB，最佳尺寸为 1280×640。[社交预览说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)

当前以 GitHub 仓库页作为介绍页。若以后需要控制网页标题、站点地图或 Search Console，可另建自己能编辑 HTML 的 GitHub Pages 站点，并为其验证所有权。拥有仓库不等于拥有 `github.com` 域名或能编辑仓库页的 HTML 头部，因此不能直接照搬普通网站的验证步骤。Search Console 需要验证，才可使用相关管理功能；本次未提交 Search Console 验证或索引请求。[Google 所有权验证要求](https://support.google.com/webmasters/answer/9008080?hl=zh-Hans)

可读页面能为抓取提供清楚的文本和链接，但是否收录、何时更新、在哪个查询中展示仍由搜索服务决定。Google 对 AI 搜索功能没有另加特殊的文件或结构化标记要求，正常的技术可访问性与有用内容仍是基础。[Google AI 搜索功能说明](https://developers.google.com/search/docs/appearance/ai-features)
