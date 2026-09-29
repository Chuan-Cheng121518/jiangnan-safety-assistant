import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountAssistant} from '../src/app.js';
import {BASE,sameSet} from '../src/core.js';
import {createPracticeBank} from '../src/practice-bank.js';
import {readQuestions} from '../src/adapter.js';

const bank=createPracticeBank();
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function setup(t,code,{questions,confirm=true}={}){
  const course=bank.courses.find(c=>c.code===code);
  const {window,document}=parseHTML('<html><body></body></html>');
  window.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',hash:'#'+BASE+`learningCenter/learning/${course.courseId}/learningExaming?learningMaterialId=${course.courseId}`};
  const values=new Map();window.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  let submitted=0,confirmed=0;window.confirm=()=>{confirmed++;return confirm;};
  document.body.innerHTML='<form class="examForm">'+(questions||course.questions).map(q=>`<div><span>${q.type==='multiple'?'多选题':q.type==='boolean'?'判断题':'单选题'}</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">${escape(q.stem)}</span><div class="options">${q.options.map((option,i)=>`<label class="el-${q.type==='multiple'?'checkbox':'radio'}"><input type="${q.type==='multiple'?'checkbox':'radio'}" value="${String.fromCharCode(65+i)}"><span class="richText">${escape(option)}</span></label>`).join('')}</div></div></div></div>`).join('')+'<button type="button" id="official-submit">提交考核</button></form>';
  for(const box of document.querySelectorAll('.options'))for(const label of box.querySelectorAll('label'))label.onclick=()=>{
    const input=label.querySelector('input');
    if(input.type==='checkbox')input.checked=!input.checked;
    else{box.querySelectorAll('input').forEach(other=>{other.checked=false;});input.checked=true;}
  };
  document.querySelector('#official-submit').onclick=()=>submitted++;
  const app=mountAssistant(window);t.after(()=>app.destroy());
  const root=document.querySelector('#jnsa-host').shadowRoot;
  const click=async name=>{const button=[...root.querySelectorAll('button')].find(b=>b.textContent===name);await button.onclick();};
  return {window,document,root,app,course,values,click,submitted:()=>submitted,confirmed:()=>confirmed};
}

test('37条历史答案均按所属课程和完整题目匹配，跨课程不能套用',()=>{
  for(const record of bank.records){assert.equal(bank.match(record,record.courseId).status,'confirmed');assert.equal(bank.match(record,'other-course').status,'unknown');}
});
test('无草稿时恢复课程已通过答案，写入实际选择，原生提交一次',async t=>{
  const e=setup(t,'JCFH01');
  await e.click('恢复答案并提交当前考核');
  assert.equal(e.submitted(),1);assert.equal(e.confirmed(),1);
  const actual=readQuestions(e.document);
  actual.forEach((q,i)=>assert.ok(sameSet(q.selected,e.course.questions[i].answers)));
  const drafts=JSON.parse(e.values.get('jnsa.bank.v1.practiceDrafts')).drafts;
  assert.equal(Object.keys(drafts).length,2);assert.ok(Object.values(drafts).every(d=>d.answers.length));
  e.app.refresh();await e.click('恢复答案并提交当前考核');assert.equal(e.submitted(),1);
});
test('课程题目缺页或出现未知题时阻止补提交',async t=>{
  const partial=setup(t,'JCFH01',{questions:[bank.courses.find(c=>c.code==='JCFH01').questions[0]]});
  await partial.click('恢复答案并提交当前考核');assert.equal(partial.submitted(),0);assert.equal(partial.confirmed(),0);
  assert.match(partial.root.querySelector('[role="status"]').textContent,/数量或内容.*不一致/);
  const unknown=setup(t,'JCSB07',{questions:[...bank.courses[0].questions,{type:'single',stem:'新增加的题目',options:['甲','乙']}]});
  await unknown.click('恢复答案并提交当前考核');assert.equal(unknown.submitted(),0);assert.match(unknown.root.querySelector('[role="status"]').textContent,/无可靠答案/);
});
test('恢复中切换课程立即停止，不向新页面提交',async t=>{
  const e=setup(t,'JCSB07'),label=e.document.querySelector('label'),original=label.onclick;
  label.onclick=()=>{original();e.window.location.hash='#'+BASE+'examCenter';};
  await e.click('恢复答案并提交当前考核');assert.equal(e.submitted(),0);assert.equal(e.confirmed(),0);
  assert.match(e.root.querySelector('[role="status"]').textContent,/页面已切换/);
});
test('取消确认仅恢复选项，不提交；分类练习不显示小节补提交入口',async t=>{
  const e=setup(t,'JCSB07',{confirm:false});
  await e.click('恢复答案并提交当前考核');assert.equal(e.submitted(),0);assert.equal(e.confirmed(),1);
  assert.deepEqual(readQuestions(e.document)[0].selected,['正确']);
  e.window.location.hash='#'+BASE+'practiceCenter/practiceClass';e.app.refresh();
  assert.ok(![...e.root.querySelectorAll('button')].some(b=>b.textContent==='恢复答案并提交当前考核'));
});
