import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {BASE,makeRecord,buildQuestionIndex,matchQuestion} from '../src/core.js';
import {readPaper,preparePaperBatch,paperRoute} from '../src/paper.js';
import {mountAssistant} from '../src/app.js';

function environment(count=100){
  const {window,document}=parseHTML('<html><body><main><p id="total"></p><form class="examForm"></form><button id="submit">提交练习</button></main></body></html>');
  window.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',hash:'#'+BASE+'practiceCenter/practice?testPaperId=mock-100'};
  document.querySelector('#total').textContent='试题总数：'+count;
  for(let i=0;i<count;i++){
    const multi=i%3===1,boolean=i%3===2,options=boolean?['正确','错误']:['甲的完整文字','乙的完整文字','丙的完整文字'];
    const item=document.createElement('div');item.className='el-form-item';item.id='anchor'+i;
    item.innerHTML=`<div class="el-form-item__content"><div><span>${i+1}、</span><span class="richText">模拟练习第${i}题</span></div><div class="options">${options.map((s,n)=>`<label class="${multi?'el-checkbox':'el-radio'}"><input type="${multi?'checkbox':'radio'}" value="${String.fromCharCode(65+n)}"><span class="${multi?'el-checkbox__label':'el-radio__label'}">${String.fromCharCode(65+n)}.<span class="richText">${s}</span></span></label>`).join('')}</div><div class="feedback"></div></div>`;
    document.querySelector('form').append(item);
  }
  const data=new Map(),writes=[];
  window.localStorage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>{writes.push(k);data.set(k,v);}};
  let submitted=0;document.querySelector('#submit').onclick=()=>{submitted++;};
  return {window,document,data,writes,get submitted(){return submitted;},paper:()=>readPaper(document,window.location.hash)};
}
const button=(e,text)=>[...e.document.querySelector('#jnsa-host').shadowRoot.querySelectorAll('button')].find(b=>b.textContent===text);
const message=e=>e.document.querySelector('#jnsa-host').shadowRoot.querySelector('[role=status]').textContent;
function feedback(e){[...e.document.querySelectorAll('.feedback')].forEach((f,i)=>{f.textContent='正确答案：'+(i%3===1?'A,C':'B');});}

test('真实整卷结构一次读取100题，完整选项保存且不把选择冒充答案',()=>{
  const e=environment();e.document.querySelector('input').checked=true;
  const paper=e.paper();assert.equal(paper.questions.length,100);assert.equal(paper.complete,true);
  assert.equal(paper.questions[1].type,'multiple');assert.equal(paper.questions[2].type,'boolean');
  const batch=preparePaperBatch(paper,[]);assert.equal(batch.records.length,100);
  assert.ok(batch.records.every(r=>r.status==='pending'&&r.answers.length===0));
  assert.deepEqual(batch.records[0].options,['甲的完整文字','乙的完整文字','丙的完整文字']);
});
test('100题逐题反馈映射到选项全文，多选判断均正确',()=>{
  const e=environment();feedback(e);const batch=preparePaperBatch(e.paper(),[],{answers:true});
  assert.equal(batch.records.length,100);assert.equal(batch.stats.confirmed,100);
  assert.deepEqual(batch.records[0].answers,['乙的完整文字']);
  assert.deepEqual(batch.records[1].answers,['甲的完整文字','丙的完整文字']);
  assert.deepEqual(batch.records[2].answers,['错误']);
});
test('总分、答题卡、题干中的正确答案字样不构成逐题答案',()=>{
  const e=environment(3);const notice=e.document.createElement('p');notice.textContent='正确答案：A';e.document.querySelector('main').append(notice);
  e.document.querySelector('.richText').textContent='正确答案：A';
  e.document.querySelector('.feedback').textContent='得分100，全部正确';
  const batch=preparePaperBatch(e.paper(),[],{answers:true});assert.equal(batch.records.length,0);assert.equal(batch.stats.missing,3);
});
test('反馈必须唯一且字母可映射，图片题和部分加载不虚报完整',()=>{
  const e=environment(3);feedback(e);
  e.document.querySelector('.feedback').innerHTML='<p>正确答案：A</p><p>正确答案：B</p>';
  e.document.querySelectorAll('.feedback')[1].textContent='正确答案：Z';
  e.document.querySelectorAll('.richText')[8].append(e.document.createElement('img'));
  e.document.querySelector('#total').textContent='试题总数：100';
  const paper=e.paper();assert.equal(paper.complete,false);
  const batch=preparePaperBatch(paper,[],{answers:true});assert.equal(batch.records.length,0);assert.equal(batch.stats.skipped,1);
});
test('重复整卷不新增证据，旧确认答案不被待核验题目覆盖',()=>{
  const e=environment(3);feedback(e);const first=preparePaperBatch(e.paper(),[],{answers:true});
  assert.equal(preparePaperBatch(e.paper(),first.records,{answers:true}).records.length,0);
  assert.equal(preparePaperBatch(e.paper(),first.records).records.length,0);
});
test('同题在卷内重复只计一道，冲突双方证据保留',()=>{
  const e=environment(3);feedback(e);const first=e.document.querySelector('.el-form-item');
  e.document.querySelectorAll('.el-form-item')[2].replaceWith(first.cloneNode(true));
  const paper=e.paper(),old=makeRecord(paper.questions[0],['甲的完整文字'],'confirmed','旧平台答案');
  const batch=preparePaperBatch(paper,[old],{answers:true});assert.equal(batch.stats.unique,2);assert.equal(batch.records.length,2);assert.equal(batch.stats.conflicts,1);
  assert.equal(matchQuestion(old,buildQuestionIndex([old,...batch.records])).status,'conflict');
});
test('面板整卷保存仅写一次主题库，重复保存无写入，交卷次数为0',async t=>{
  const e=environment(),app=mountAssistant(e.window);t.after(()=>app.destroy());e.writes.length=0;
  const start=performance.now();await button(e,'保存整卷题目').onclick();const elapsed=performance.now()-start;
  assert.equal(app.getRecords().length,100);assert.equal(e.writes.filter(k=>k==='jnsa.bank.v1').length,1);assert.equal(e.submitted,0);
  assert.match(message(e),/新增 100 题/);assert.equal(app.getCategories().length,0);
  e.writes.length=0;await button(e,'保存整卷题目').onclick();assert.deepEqual(e.writes,[]);
  assert.ok(elapsed<1500,`100题收录与渲染耗时 ${elapsed.toFixed(1)}ms`);
  feedback(e);app.refresh();await button(e,'收录本卷正确答案').onclick();
  assert.equal(new Set(app.getRecords().map(r=>r.key)).size,100);assert.equal(app.getRecords().filter(r=>r.status==='confirmed').length,100);assert.equal(e.submitted,0);
  assert.ok(button(e,'下一组'));await button(e,'下一组').onclick();assert.ok(button(e,'上一组'));
});
test('页面切换后旧整卷按钮失效；正式考试不提供模拟卷采集',async t=>{
  const e=environment(3),app=mountAssistant(e.window);t.after(()=>app.destroy());const stale=button(e,'保存整卷题目');
  e.window.location.hash='#'+BASE+'examCenter/examing?testPaperId=mock-100';await stale.onclick();
  assert.equal(app.getRecords().length,0);assert.match(message(e),/试卷或反馈已变化/);
  assert.equal(button(e,'保存整卷题目'),undefined);assert.equal(paperRoute(e.window.location.hash),false);
});
test('刷新后已保存题目保留，结果收录可独立完成，无自动提交',async t=>{
  const e=environment(3);let app=mountAssistant(e.window);t.after(()=>app.destroy());
  await button(e,'保存整卷题目').onclick();app.destroy();feedback(e);app=mountAssistant(e.window);
  assert.equal(app.getRecords().length,3);await button(e,'收录本卷正确答案').onclick();
  assert.equal(app.getRecords().filter(r=>r.status==='confirmed').length,3);assert.equal(e.submitted,0);
});

test('官方结果页模板：换页、禁用选项、ibbox、答案后的正确状态与解析',async t=>{
  const e=environment(3),before=e.paper().questions.map(q=>q.key);
  e.window.location.hash='#'+BASE+'practiceCenter/result/practice-record-1';
  [...e.document.querySelectorAll('.el-form-item')].forEach((item,i)=>{
    for(const span of item.querySelectorAll('.options .richText'))span.className='ibbox';
    for(const input of item.querySelectorAll('input'))input.disabled=true;
    if(i===2){item.querySelector('input').value='true';item.querySelectorAll('input')[1].value='false';}
    const f=item.querySelector('.feedback');f.className='userAnswer';
    f.innerHTML=`<p> 正确答案：${i===1?'A,C':i===2?'正确':'B'} <span class="ml10">回答错误</span></p><div class="flex">试题解析：<span class="richText">官方解析示例</span></div>`;
  });
  const paper=e.paper();assert.equal(paper.complete,true);assert.deepEqual(paper.questions.map(q=>q.key),before);
  const batch=preparePaperBatch(paper,[],{answers:true});assert.equal(batch.records.length,3);
  assert.deepEqual(batch.records[2].answers,['正确']);assert.match(batch.records[0].explanation,/官方解析示例/);
  const app=mountAssistant(e.window);t.after(()=>app.destroy());await button(e,'收录本卷正确答案').onclick();
  assert.equal(app.getRecords().length,3);assert.equal(button(e,'填入已确认答案'),undefined);assert.equal(e.submitted,0);
  assert.equal(paperRoute('#'+BASE+'practiceCenter/result/'),false);
});
