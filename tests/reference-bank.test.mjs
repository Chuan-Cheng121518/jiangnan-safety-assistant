import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceBank} from '../src/reference-bank.js';
import {makeRecord,buildQuestionIndex} from '../src/core.js';

const q={type:'single',stem:'安全实验：选择甲。',options:['甲','乙']};
const row=(questionId,question=q,answers=['甲'],conflict=false)=>({...question,answers,questionId,conflict,evidence:[{sourceId:'source',recordIds:[questionId],originalStatus:'confirmed'}],explanations:['原始说明']});
const bank=records=>({format:'jnsa-reference-bank',version:1,name:'测试综合题库',questionCount:new Set(records.map(r=>r.questionId)).size,includedQuestionCount:new Set(records.map(r=>r.questionId)).size,conflictQuestionCount:records.some(r=>r.conflict)?1:0,sourceRecordCount:records.length,sources:[{id:'source',label:'测试资料'}],records});

test('文件中的 confirmed 保留为历史证据，匹配换序后的当前选项且不修改输入',()=>{
  const raw=bank([row(1)]),before=JSON.stringify(raw),ref=createReferenceBank(raw);
  const result=ref.match({...q,options:[...q.options].reverse()},new Map());
  assert.equal(result.status,'unconfirmed');assert.deepEqual(result.answers,['甲']);
  assert.equal(result.hits[0].evidence[0].originalStatus,'confirmed');
  assert.equal(JSON.stringify(raw),before);
});

test('数据库同题存在标点变体时，已知冲突不能被精确命中掩盖',()=>{
  const alternate={...q,stem:q.stem.replace('：',':').replace('。','')};
  const ref=createReferenceBank(bank([row(1,q,['甲'],true),row(1,alternate,['乙'],true)]));
  for(const current of [q,alternate]){
    const result=ref.match(current,buildQuestionIndex([makeRecord(current,['甲'],'confirmed','本页反馈')]));
    assert.equal(result.status,'conflict');assert.deepEqual(result.answers,[]);
    assert.ok(result.hits.some(r=>r.answers.includes('乙')));
  }
});

test('个人答案与综合题库冲突时展示冲突，同答案仍保留个人已确认状态',()=>{
  const ref=createReferenceBank(bank([row(1)]));
  assert.equal(ref.match(q,buildQuestionIndex([makeRecord(q,['乙'],'confirmed','本页反馈')])).status,'conflict');
  assert.equal(ref.match(q,buildQuestionIndex([makeRecord(q,['甲'],'confirmed','本页反馈')])).status,'confirmed');
});

test('不同题型、否定词、单位与标点差异不进行模糊填选',()=>{
  const ref=createReferenceBank(bank([row(1)]));
  for(const changed of [{...q,type:'multiple'},{...q,stem:'安全实验：不要选择甲。'},{...q,stem:q.stem.replace('。','')},{...q,options:['甲 mL','乙']}])assert.equal(ref.match(changed,new Map()).status,'unknown');
  assert.equal(ref.search('安全 甲',new Map()).total,1);
});

test('重复选项的原始题保留为人工搜索材料且没有填选答案',()=>{
  const raw=bank([]);raw.questionCount=1;raw.manualRecords=[{...q,options:['甲','甲'],answers:['甲'],questionId:3,recordId:30,sourceId:'source',issue:'选项文字重复'}];
  const ref=createReferenceBank(raw),found=ref.search('安全',new Map());
  assert.equal(found.total,1);assert.match(found.questions[0].issue,/重复/);
  assert.equal(ref.match(found.questions[0],new Map()).status,'unknown');
});

test('错误快照在挂载前失败，不静默加载不完整题库',()=>{
  const raw=bank([row(1)]);raw.includedQuestionCount=2;
  assert.throws(()=>createReferenceBank(raw),/题数/);
});
