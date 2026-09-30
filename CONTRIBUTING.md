# 参与江南学习助手维护

感谢帮助完善安装体验、页面兼容性和参考题库。先查阅[已有反馈](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant/issues)，避免重复；使用[反馈模板](https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant/issues/new/choose)可一次提供所需信息。

## 脚本故障

请提供脚本版本、浏览器与 Tampermonkey 版本、页面所在栏目、操作步骤、预期与实际结果。截图只保留相关区域，遮挡姓名、学号等个人信息，不上传账号密码、Cookie 或令牌。不要为了复现问题重复提交正式试卷。

## 题库纠错

综合题库提供题目标识，课程题库提供课程代码和小节题号；附上完整题干、选项、当前参考答案及纠错依据。历史反馈与新反馈冲突时，应保留两方来源和时间，不能直接把旧记录改为“已确认”。仅提供有权分享的资料，来源及权利说明见 [DATA.md](DATA.md)。

阅读页由 `data/reference-bank.json` 和 `data/course-practice.json` 生成，请先修改数据，再运行 `npm run docs:bank`；不要只改生成的 Markdown 页面。课程运行时题库也需要同步更新 `src/practice-bank.js`，并核对所属课程、题干、选项与答案。

## 提交代码或文档

1. Fork 仓库，在分支中完成一项清晰的改动。
2. 使用 Node.js 24，运行 `npm ci --ignore-scripts`。代码变更运行 `npm test`、`npm run build` 和 `node --check dist/jiangnan-safety-assistant.user.js`。
3. 题库变更还需运行 `npm run docs:bank`、`npm run docs:check`；检查来源、冲突与阅读页链接。
4. 在 Pull Request 中说明问题、修改结果和验证方法。展示使用合成测试数据，并明确区分模拟验证与真实平台验证。

文档修改无需为了“活跃度”重复构建或刷提交；实际修复、可核验的资料更新和清楚的说明更有帮助。请勿承诺题库正确率、考试通过率或搜索排名。
