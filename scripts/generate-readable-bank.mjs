import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = {single: '单选题', multiple: '多选题', boolean: '判断题'};
const PAGE_SIZE = 100;
const NOTICE = '答案为历史收录的参考资料，未在本次生成中重新核验。来源冲突、重复选项及原文错误均保留；请结合当前平台反馈核对。';
const ORIGIN = '[数据来源与权利说明](../../../DATA.md) · [项目首页](../../../README.md)';

// Escape source text as visible Markdown; do not interpret source HTML or links.
export function text(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\\x60*_[\]{}()#!|])/g, '\\$1').replace(/\r\n?|\n/g, '<br>');
}
const lines = value => value.join('\n') + '\n';
const pageName = page => 'reference-' + String(page + 1).padStart(2, '0') + '.md';
const link = (id, pages, prefix = '') => prefix + pages.get(id) + '#题目-' + id;
const add = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

function renderRecord(record, index, sources, manual) {
  const result = ['', '### 收录记录 ' + index, '',
    '**题型**：' + text(TYPES[record.type] ?? record.type), '',
    '**题干**：' + text(record.stem), '', '**选项（按来源顺序）**', '',
    ...record.options.map((option, i) => '- ' + String.fromCharCode(65 + i) + '. ' + text(option)),
    '', '**状态**：' + (manual ? '需人工核对' : record.conflict ? '答案存在来源冲突' : '参考答案，待当前平台核验'),
    '', '**' + (record.conflict ? '本来源记录的答案（存在冲突）' : '本来源记录的参考答案') + '**', '',
    ...record.answers.map(answer => '- ' + text(answer))];
  if (!record.answers.length) result.push('来源未提供答案。');
  if (manual) result.push('', '**需核对原因**：' + text(record.issue));
  result.push('', '**来源证据**', '');
  const evidence = manual
    ? [{sourceId: record.sourceId, recordIds: [record.recordId], originalStatus: null}]
    : record.evidence;
  for (const item of evidence) {
    assert.ok(sources.has(item.sourceId), '未知来源 ' + item.sourceId);
    result.push('- ' + text(sources.get(item.sourceId)) + '（来源标识：' + text(item.sourceId)
      + '；记录编号：' + item.recordIds.join('、')
      + '；原始状态：' + text(item.originalStatus ?? '未标注') + '）');
  }
  if (record.explanations?.length) result.push('', '**原始说明 / 历史反馈**', '',
    ...record.explanations.map(explanation => '- ' + text(explanation)));
  return result;
}

export function buildReadableBank(reference, courseBank) {
  assert.equal(reference.format, 'jnsa-reference-bank');
  assert.equal(courseBank.format, 'jnsa-course-practice-bank');
  const sources = new Map(reference.sources.map(source => [source.id, source.label]));
  const groups = new Map();
  for (const [manual, records] of [[false, reference.records], [true, reference.manualRecords]]) {
    for (const record of records) {
      assert.ok(Number.isSafeInteger(record.questionId) && record.questionId > 0);
      assert.ok(Array.isArray(record.options) && Array.isArray(record.answers));
      add(groups, record.questionId, {record, manual});
    }
  }
  const ids = [...groups.keys()].sort((a, b) => a - b);
  const conflicts = ids.filter(id => groups.get(id).some(({record}) => record.conflict));
  const manualIds = ids.filter(id => groups.get(id).some(({manual}) => manual));
  assert.equal(ids.length, reference.questionCount);
  assert.equal(conflicts.length, reference.conflictQuestionCount);
  assert.equal(ids.filter(id => groups.get(id).some(entry => !entry.manual)).length, reference.includedQuestionCount);
  const evidenceIds = [...reference.records.flatMap(r => r.evidence.flatMap(e => e.recordIds)),
    ...reference.manualRecords.map(r => r.recordId)];
  assert.equal(evidenceIds.length, reference.sourceRecordCount);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length, '来源编号重复');
  assert.equal(courseBank.courses.length, courseBank.courseCount);
  assert.equal(courseBank.courses.reduce((sum, c) => sum + c.questions.length, 0), courseBank.questionCount);
  const pages = new Map(ids.map((id, index) => [id, pageName(Math.floor(index / PAGE_SIZE))]));
  const output = new Map();
  const emit = (path, content) => {
    assert.ok(!output.has(path), '重复输出路径 ' + path);
    output.set(path, lines(content));
  };
  const pageIndex = [];
  for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
    const page = offset / PAGE_SIZE;
    const subset = ids.slice(offset, offset + PAGE_SIZE);
    const navigation = ['[总目录](../index.md)'];
    if (page > 0) navigation.push('[上一页](' + pageName(page - 1) + ')');
    if (offset + PAGE_SIZE < ids.length) navigation.push('[下一页](' + pageName(page + 1) + ')');
    const content = ['# 实验室安全考试题库与参考答案：题目 ' + subset[0] + '–' + subset.at(-1),
      '', navigation.join(' · '), '', NOTICE,
      '', '本页 ' + subset.length + ' 道题。数据快照：' + text(reference.updatedAt) + '。同一题号下的各收录记录分别保留。',
      '', ORIGIN, '', '## 本页题目', '',
      ...subset.map(id => '- [题目 ' + id + '：' + text(groups.get(id)[0].record.stem) + '](#题目-' + id + ')')];
    for (const id of subset) {
      content.push('', '## 题目 ' + id);
      groups.get(id).forEach(({record, manual}, index) => content.push(...renderRecord(record, index + 1, sources, manual)));
    }
    content.push('', navigation.join(' · '));
    emit('reference/' + pageName(page), content);
    pageIndex.push('| [第 ' + (page + 1) + ' 页](reference/' + pageName(page) + ') | '
      + subset[0] + '–' + subset.at(-1) + ' | ' + subset.length + ' |');
  }
  for (const [name, title, selected] of [
    ['conflicts', '来源冲突题索引', conflicts],
    ['manual-review', '需人工核对题索引', manualIds],
  ]) {
    emit('reference/' + name + '.md', ['# 实验室安全题库：' + title, '',
      '[题库总目录](../index.md)', '', '共 ' + selected.length + ' 题。' + NOTICE, '',
      ...selected.map(id => '- [题目 ' + id + '：' + text(groups.get(id)[0].record.stem) + '](' + link(id, pages) + ')')]);
  }
  // Type indexes link to full records, avoiding a second copy of the answers.
  const typeLinks = [];
  for (const [type, title] of Object.entries(TYPES)) {
    const selected = ids.filter(id => groups.get(id).some(({record}) => record.type === type));
    const typePages = [];
    for (let offset = 0; offset < selected.length; offset += 250) {
      const name = type + '-' + String(offset / 250 + 1).padStart(2, '0') + '.md';
      const slice = selected.slice(offset, offset + 250);
      typePages.push('- [' + title + '索引 ' + (offset / 250 + 1) + '](' + name + ')（' + slice.length + ' 题）');
      emit('types/' + name, ['# 实验室安全' + title + '题干索引 ' + (offset / 250 + 1),
        '', '[题型目录](index.md) · [题库总目录](../index.md)', '',
        '点击题干查看完整选项、参考答案和来源证据。', '',
        ...slice.map(id => '- [题目 ' + id + '：' + text(groups.get(id)[0].record.stem) + '](' + link(id, pages, '../reference/') + ')')]);
    }
    typeLinks.push('', '## ' + title + '（' + selected.length + ' 题）', '', ...typePages);
  }
  emit('types/index.md', ['# 实验室安全题库：按题型查找', '',
    '[题库总目录](../index.md)', '', ...typeLinks]);
  const courseIndex = [];
  for (const course of courseBank.courses) {
    assert.match(course.code, /^[A-Za-z0-9_-]+$/);
    assert.equal(course.questionCount, course.questions.length);
    const name = course.code + '.md';
    const content = ['# 江南大学课程题库：' + text(course.title), '',
      '[课程目录](index.md) · [题库总目录](../index.md)', '',
      '- 课程代码：' + text(course.code), '- 平台课程标识：' + text(course.courseId),
      '- 页面分类：' + text(course.category || '未标注'),
      '- 收录日期：' + text(courseBank.collectedAt),
      '- 配套考核：' + text(course.assessment),
      '- 收录时页面状态：' + text(course.courseState || '未标注'),
      '', '以下为历史页面反馈，不能据此推断其他账号或当前平台状态。', '', ORIGIN];
    if (!course.questions.length) content.push('', '本次归档无配套习题；不表示视频学习已经完成。');
    for (const q of course.questions) {
      content.push('', '## 习题 ' + q.index + '（' + text(TYPES[q.type] ?? q.type) + '）', '',
        '**题干**：' + text(q.stem), '', '**选项（按来源顺序）**', '',
        ...q.options.map((option, index) => '- ' + String.fromCharCode(65 + index) + '. ' + text(option)),
        '', '**收录答案（历史反馈）**', '', ...q.answers.map(answer => '- ' + text(answer)),
        '', '**页面原始反馈**：' + text(q.feedback),
        '', '**来源状态**：' + text(q.sourceStatus));
    }
    emit('courses/' + name, content);
    courseIndex.push('| [' + text(course.title) + '](' + name + ') | ' + course.questions.length + ' | ' + text(course.assessment) + ' |');
  }
  emit('courses/index.md', ['# 江南大学实验室安全课程小节题库', '',
    '[题库总目录](../index.md)', '',
    '共 ' + courseBank.courseCount + ' 个小节、' + courseBank.questionCount + ' 道题；收录日期：' + text(courseBank.collectedAt) + '。', '',
    '| 课程 | 题数 | 收录时配套考核 |', '| --- | ---: | --- |', ...courseIndex]);
  emit('index.md', ['# 实验室安全考试题库与参考答案（可读版）', '',
    '[项目介绍与脚本安装](../../README.md) · [题库来源说明](../../DATA.md)', '',
    '本目录提供已收录的实验室安全题干、选项、参考答案和来源证据，可在 GitHub 直接阅读，无需安装脚本。',
    '', '综合题库共 ' + reference.questionCount + ' 道题、' + reference.sourceRecordCount + ' 条来源记录；课程题库共 '
      + courseBank.courseCount + ' 个江南大学课程小节、' + courseBank.questionCount + ' 道习题。',
    '', NOTICE, '', '## 如何查题', '',
    '1. 按题型打开下方索引，使用浏览器查找（Ctrl + F）输入题干关键词，点击题目链接查看答案。',
    '2. 已知题号时，按下表打开对应分页；每页最多 ' + PAGE_SIZE + ' 道题。',
    '3. 查课程习题时，按课程代码或名称打开课程目录。浏览器查找只搜索当前页；跨页查题可使用项目脚本的题库搜索，或下载 JSON 后全文检索。',
    '', '- [按题型查找：单选、多选、判断](types/index.md)',
    '- [20 个课程小节目录](courses/index.md)',
    '- [来源冲突题索引](reference/conflicts.md)（' + conflicts.length + ' 题）',
    '- [需人工核对题索引](reference/manual-review.md)（' + manualIds.length + ' 题）',
    '', '## 综合题库分页', '',
    '| 页面 | 题号范围 | 题数 |', '| --- | ---: | ---: |', ...pageIndex,
    '', '## 原始数据与收录时间', '',
    '- [综合题库 JSON](../../data/reference-bank.json)：' + text(reference.updatedAt),
    '- [课程小节题库 JSON](../../data/course-practice.json)：' + text(courseBank.collectedAt),
    '', '题号来自原始快照。同题的不同表述、答案和来源记录逐条保留；历史 confirmed 状态不等于当前核验。',
    '', '这些页面由现有 JSON 自动生成。维护者更新数据后运行 npm run docs:bank，并提交生成结果。生成检查不会修改原始题库。']);
  return output;
}

export async function generateReadableBank({root = ROOT, check = false} = {}) {
  const reference = JSON.parse(await readFile(join(root, 'data/reference-bank.json'), 'utf8'));
  const courses = JSON.parse(await readFile(join(root, 'data/course-practice.json'), 'utf8'));
  const output = join(root, 'docs/question-bank');
  const files = buildReadableBank(reference, courses);
  if (!check) {
    for (const [name, content] of files) {
      const target = join(output, name);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, content, 'utf8');
    }
  }
  for (const [name, content] of files) {
    assert.equal(await readFile(join(output, name), 'utf8'), content, '阅读版未同步：' + name);
  }
  const actual = (await readdir(output, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile())
    .map(entry => relative(output, join(entry.parentPath, entry.name)).split('\\').join('/')).sort();
  assert.deepEqual(actual, [...files.keys()].sort(), '阅读版目录存在过期或额外文件，请检查后手动处理');
  process.stdout.write((check ? 'Checked ' : 'Generated ') + files.size + ' readable Markdown files.\n');
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateReadableBank({check: process.argv.includes('--check')});
}
