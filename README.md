# 江南学习助手 v0.5.5

适配江南大学实验室安全平台的浏览器用户脚本。非学校官方项目。

本次完整发布包含源码、5099 道综合题库、20 个课程小节的 37 道考核题与答案，以及可直接安装的用户脚本。

**[安装最新版脚本](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant/releases/latest/download/jiangnan-safety-assistant.user.js)** · **[查看版本发布](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant/releases)**

## 功能

- **20 小节一键答题与提交**：按课程编号和完整题目匹配答案，依次打开小节、恢复选项、点击平台原生提交按钮；读到课程详情“考核 已通过”后才继续。已通过的小节会跳过；1 个归档时无配套考核的小节会跳过。可暂停、继续、导出处理记录。
- **考试辅助填入**：按完整题干、题型和选项文字查本地题库，支持单题及本页批量填入，默认保留已作答题，正式试卷交卷由使用者操作。
- **练习收录**：分类练习逐题读取平台正确反馈；模拟练习支持保存整卷题目及收录结果页明确显示的答案，保留来源与冲突。
- **独立本地存储**：个人题库使用 Tampermonkey GM 存储，支持 JSON/CSV 导入导出及分类索引；内置参考库不覆盖个人记录。
- **课程播放清单**：正常 1 倍速播放，视频自然结束后可继续下一门，课程完成与考核通过均以平台显示为准。

## 安装与升级

1. 在 Edge、Chrome 等兼容浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开上方安装链接；如果浏览器只下载文件，在 Tampermonkey 编辑器里粘贴 `.user.js` 全部内容并保存。
3. 登录 [江南实验室安全平台](https://jnlab.jiangnan.edu.cn/front/)，刷新页面，右下角助手应显示 `v0.5.5`。
4. 批量处理小节：进入“教育培训中心 → 学习中心”，点击助手的“一键答题并提交 20 个小节”，保持页面打开。

已有旧版时，先导出完整题库备份，再**更新原脚本**，保留原脚本的名称和命名空间，不先卸载。不要同时启用两个版本。

## 暂停和异常处理

题目或选项变化、按钮不唯一、课程名称不匹配、登录失效、手动切页和保存失败都会停止小节队列。已点击提交但未等到平台确认的小节会保留待核验状态，继续时先检查平台结果，不盲目重复提交。页面关闭后重新启动可能需等上一页面的队列锁过期（最多约 90 秒）。

批量功能处理内置清单，不会根据账号自动发现新课程；课程编号和页面结构变化后需要重新适配。无考核小节的跳过依据为收录快照，不表示其视频学习状态已完成。

## 题库数据

综合题库共 5099 题，其中 5094 题结构可匹配，20 题有来源冲突，另 5 题需要人工阅读。冲突题不自动填入。20 个小节共 37 题，收录日期为 2026-09-23，含 19 个有考核小节和 1 个无考核小节。

综合题库答案显示为参考答案；历史平台反馈也不能替代当前平台核验。数据来源、结构及许可范围见 [DATA.md](DATA.md)，个人导入格式见 [题库格式.md](题库格式.md)。

## 开发与构建

使用 Node.js 24 或更新版本：

```sh
npm ci --ignore-scripts
npm test
npm run build
node --check dist/jiangnan-safety-assistant.user.js
npm run demo
```

默认构建从仓库内 `data/reference-bank.json` 嵌入完整参考题库，课程题库在 `src/practice-bank.js`。输出为 `dist/jiangnan-safety-assistant.user.js`。源码下载后即可构建，不依赖维护者本机路径或备份。

可使用 `node scripts/build.mjs --bank 自定义参考快照.json`，或使用符合项目结构的 SQLite：`node scripts/build.mjs --sqlite 题库.sqlite`。本地演示位于 `http://127.0.0.1:8766`，仅使用浏览器生成的测试页面。

## 验证与已知限制

公开包运行 152 项自动测试，包含完整 20 小节模拟队列、三类选择题、题库迁移和考试填入。测试会模拟平台，不代表真实账号已完成 20 小节；本版尚未完成真实账号的整批验收。平台升级后兼容性也需重新核验。

脚本本身不读取账号密码或令牌，不主动上传题库；点击平台原生提交按钮会由平台发送实际作答记录。图片、公式、重复选项、未知题及冲突题不自动作答。使用者应遵守所在平台的使用和考核要求。

项目自研代码和文档使用 [MIT License](LICENSE)。随附第三方题目与答案保留原有权利，不因打包进脚本而取得 MIT 授权。反馈问题时请去掉账号、学号、Cookie 等个人信息。

<a id="support"></a>

## 自愿赞助

题库的整理、脚本的制作与适配，以及后续测试和维护，都花了不少时间和精力。如果这个项目帮你省下了时间，欢迎自愿赞助，请作者喝杯咖啡，也为后续维护添一份动力。

**赞助完全自愿，金额随意，不影响任何功能的使用。** 感谢每一份支持！不方便赞助也没关系，点一个 Star、反馈遇到的问题，或分享给有需要的人，同样是对项目的支持。

| 微信赞助 | 支付宝赞助 |
| :---: | :---: |
| <a href="https://raw.githubusercontent.com/Chuan-Cheng121518/jiangnan-safety-assistant/main/assets/sponsor/wechat.png"><img src="https://raw.githubusercontent.com/Chuan-Cheng121518/jiangnan-safety-assistant/main/assets/sponsor/wechat.png" alt="微信自愿赞助收款码" width="280"></a> | <a href="https://raw.githubusercontent.com/Chuan-Cheng121518/jiangnan-safety-assistant/main/assets/sponsor/alipay.jpg"><img src="https://raw.githubusercontent.com/Chuan-Cheng121518/jiangnan-safety-assistant/main/assets/sponsor/alipay.jpg" alt="支付宝自愿赞助收款码" width="280"></a> |

如果 README 中图片没有显示，可直接打开：[微信收款码原图](https://raw.githubusercontent.com/Chuan-Cheng121518/jiangnan-safety-assistant/main/assets/sponsor/wechat.png) · [支付宝收款码原图](https://raw.githubusercontent.com/Chuan-Cheng121518/jiangnan-safety-assistant/main/assets/sponsor/alipay.jpg)
