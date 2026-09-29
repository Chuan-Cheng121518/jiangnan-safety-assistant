import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPracticeBank} from '../src/practice-bank.js';

const bank=createPracticeBank();
const output=resolve(process.argv[2]||'../outputs');
const json={format:'jnsa-course-practice-bank',version:1,collectedAt:bank.summary.updatedAt,courseCount:bank.summary.courseCount,questionCount:bank.summary.questionCount,courses:bank.courses};
const lines=['# 江南课程小节题库','',`采集日期：${json.collectedAt}。共 ${json.courseCount} 个小节、${json.questionCount} 条课程习题记录。`,'','题干、选项和答案按页面原文保留；答案依据是本账号结果页的“正确答案 / 回答正确”。这是已完成练习的归档，不代表平台当前学习状态，也不代替安全操作指导。','', '其中 JCSW25《超净工作台的使用规范及注意事项》显示“考核 无”，没有配套习题。','', '| 课程 | 题数 | 考核 |','| --- | ---: | --- |'];
for(const course of bank.courses)lines.push(`| ${course.title} | ${course.questions.length} | ${course.assessment} |`);
for(const course of bank.courses){
  lines.push('',`## ${course.title}`,'',`课程编号：${course.courseId}`,'');
  if(course.category)lines.push(`页面分类：${course.category}`,'');
  if(!course.questions.length){lines.push('平台显示“考核 无”。');continue;}
  for(const q of course.questions){
    lines.push(`### ${q.index}. ${q.type==='multiple'?'多选题':q.type==='boolean'?'判断题':'单选题'}`,'',q.stem,'');
    q.options.forEach((option,i)=>lines.push(`- ${String.fromCharCode(65+i)}. ${option}`));
    lines.push('',`**已通过答案：${q.answers.map(answer=>q.type==='boolean'?answer:`${String.fromCharCode(65+q.options.indexOf(answer))}. ${answer}`).join('；')}**`,'',`平台反馈：${q.feedback}`,'');
  }
}
await writeFile(resolve(output,'江南课程小节题库-20260923.json'),JSON.stringify(json,null,2)+'\n');
await writeFile(resolve(output,'江南课程小节题库-20260923.md'),lines.join('\n')+'\n');
process.stdout.write(`Exported ${json.courseCount} courses / ${json.questionCount} questions\n`);
