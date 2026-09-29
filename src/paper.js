import {BASE,normalize,makeRecord,matchQuestion,mergeRecords,buildQuestionIndex} from './core.js';
import {visible,textOf,readQuestions,mapAnswerText} from './adapter.js';

export function paperRoute(hash){
  const path=String(hash).replace(/^#/,'').split('?')[0],prefix=BASE+'practiceCenter/';
  return path===prefix+'practice'||path.startsWith(prefix+'result/')&&/^[^/]+$/.test(path.slice((prefix+'result/').length));
}

// Parse only feedback belonging to this exact question, never a whole-paper score.
export function readPaperFeedback(q){
  if(q.issue)return {issue:q.issue};
  const scope=q.box.closest('.el-form-item');
  if(!scope||scope.querySelectorAll('.options').length!==1)return null;
  const nodes=[...scope.querySelectorAll('p,div,span')].filter(e=>visible(e)&&!e.closest('.options,.richText')&&!e.querySelector('.options,.richText'));
  const matches=nodes.filter(e=>/^正确答案\s*[:：]/.test(normalize(textOf(e))));
  const leaves=matches.filter(e=>!matches.some(other=>other!==e&&e.contains(other)));
  if(!leaves.length)return null;
  if(leaves.length!==1)return {issue:'本题正确答案反馈不唯一'};
  const raw=normalize(textOf(leaves[0])),value=raw.replace(/^正确答案\s*[:：]\s*/,'').replace(/\s*回答(?:正确|错误)[。.!！]?$/,'').replace(/[。.]$/,'').trim();
  const explanation=textOf(scope.querySelector('.userAnswer .flex .richText'));
  return {...mapAnswerText(q,value),raw,explanation};
}

export function readPaper(doc,hash,questions=readQuestions(doc)){
  if(!paperRoute(hash))return null;
  const totals=[...doc.querySelectorAll('div,span,p')].filter(e=>visible(e)&&!e.closest('.el-form-item')).map(e=>normalize(textOf(e)).match(/^试题总数\s*[:：]\s*(\d+)$/)).filter(Boolean).map(m=>Number(m[1]));
  const counts=[...new Set(totals)],expected=counts.length===1?counts[0]:null;
  const feedback=questions.map(readPaperFeedback);
  return {questions,expected,feedback,complete:expected>0&&questions.length===expected,signature:JSON.stringify([hash,expected,questions.map((q,i)=>[q.key,q.issue,feedback[i]])])};
}

export function preparePaperBatch(paper,existing,{answers=false,demo=false}={}){
  if(!paper?.questions.length)throw new Error('尚未读到整卷题目');
  if(paper.questions.length>1000)throw new Error('当前页面题目过多，请分批保存');
  const index=existing instanceof Map?existing:buildQuestionIndex(existing);
  const records=[],seen=new Set(),stats={loaded:paper.questions.length,unique:0,added:0,confirmed:0,skipped:0,missing:0,conflicts:0};
  for(let i=0;i<paper.questions.length;i++){
    const q=paper.questions[i],feedback=paper.feedback[i];
    if(q.issue){stats.skipped++;continue;}
    if(!seen.has(q.key)){seen.add(q.key);stats.unique++;if(!index.has(q.key))stats.added++;}
    if(answers){
      if(!feedback?.answers?.length||feedback.issue){stats.missing++;continue;}
      const record=makeRecord(q,feedback.answers,'confirmed',demo?'本地演示整卷反馈':'江南大学模拟练习页面：显示正确答案',feedback.raw+(feedback.explanation?'\n试题解析：'+feedback.explanation:''));
      records.push(record);stats.confirmed++;
    }else if(!index.has(q.key))records.push(makeRecord(q,[],'pending','模拟练习整卷：题干和选项'));
  }
  const merged=mergeRecords([],records),proposed=buildQuestionIndex(mergeRecords([...index.values()].flat(),merged));
  stats.conflicts=[...new Set(merged.map(r=>r.key))].filter(key=>matchQuestion(proposed.get(key)[0],proposed).status==='conflict').length;
  // Keep first-seen evidence unchanged and avoid rewriting an identical batch.
  const fresh=merged.filter(r=>!(index.get(r.key)??[]).some(old=>old.status===r.status&&old.source===r.source&&JSON.stringify(old.answers.map(normalize).sort())===JSON.stringify(r.answers.map(normalize).sort())));
  return {records:fresh,stats};
}
