import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {BASE,mergeRecords} from '../src/core.js';
import {readQuestions,readFeedback,readPracticeEnd} from '../src/adapter.js';
import {createPracticeCollector,collectionRoute,feedbackRecord} from '../src/collector.js';

function fixture({multi=false,boolean=false,options=['甲','乙','丙'],codes=['A','B','C'],stem='测试题'}={}) {
  return `<div><span>${multi?'多选题':boolean?'判断题':'单选题'}</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">${stem}</span><div class="options">${options.map((o,i)=>`<label class="el-${multi?'checkbox':'radio'}"><input type="${multi?'checkbox':'radio'}" value="${codes[i]}"><span class="el-${multi?'checkbox':'radio'}__label">${codes[i]}.<span class="richText">${o}</span></span></label>`).join('')}</div></div></div></div>`;
}
function documentFor(html){return parseHTML(`<html><body><form>${html}</form></body></html>`).document;}
const error=value=>`<div id="feedback"><span class="error">回答错误。</span>正确答案：${value}</div>`;

test('平台错误反馈保存正确选项文字，不保存错误试选；字母按标识而非下标映射',()=>{
  const d=documentFor(fixture({options:['丙','甲','乙'],codes:['C','A','B']})+error('B'));
  const qs=readQuestions(d),feedback=readFeedback(d,qs);
  const r=feedbackRecord(qs[0],feedback,['丙']);
  assert.deepEqual(r.answers,['乙']);assert.equal(r.status,'confirmed');assert.match(r.explanation,/正确答案：B/);
  assert.equal(mergeRecords([r],[r]).length,1);
});
test('多选兼容逗号、顿号及连续字母；判断题兼容答案文字',()=>{
  for(const value of ['A,B,C','A，B、C','ABC']){
    const d=documentFor(fixture({multi:true})+error(value));assert.deepEqual(readFeedback(d,readQuestions(d)).answers,['甲','乙','丙']);
  }
  const d=documentFor(fixture({boolean:true,options:['正确','错误'],codes:['A','B']})+error('错误'));
  assert.deepEqual(readFeedback(d,readQuestions(d)).answers,['错误']);
});
test('越界、重复、截断、单选多答案、字母与标签冲突均拒绝归档',()=>{
  for(const value of ['Z','A,A','A,','A,B','A 或 B','']){
    const d=documentFor(fixture()+error(value));assert.ok(readFeedback(d,readQuestions(d)).issue,value);
  }
  const d=documentFor(fixture()+error('A'));d.querySelector('input').value='B';assert.ok(readFeedback(d,readQuestions(d)).issue);
});
test('隐藏反馈及混入题干的反馈不读取；成功和错误冲突停止',()=>{
  const d=documentFor(fixture()+`<div style="display:none">${error('B')}</div>`);
  assert.equal(readFeedback(d,readQuestions(d)),null);
  d.querySelector('.richText').innerHTML='<span class="success">回答正确。</span>';
  assert.equal(readFeedback(d,readQuestions(d)),null);
  const conflict=documentFor(fixture()+error('B')+'<div class="success">回答正确。</div>');
  assert.ok(readFeedback(conflict,readQuestions(conflict)).issue);
});
test('只允许已观察的分类练习路由',()=>{
  assert.equal(collectionRoute('#'+BASE+'practiceCenter/practiceClass?testPaperId=123'),true);
  for(const path of ['examCenter','practiceCenter/practiceRecord','learningCenter/learningExaming','practiceCenter/practiceClassExtra'])assert.equal(collectionRoute('#'+BASE+path),false);
});

function harness({respond=true,feedbackDelay=0,feedbackGraceMs=30,timeoutMs=150,storeError=false,changeSelection=false,repeat=false,repeatOnce=false,repeatTimes=0,repeatEvery=0,stopAfter=0,unchanged=false,retained=false,retainedSame=false,disabledNext=false,blankNext=false,delayedNext=false,throttledNext=false,ending=false,noProgressLimit=30,pacing={},lookup,observeQuestion,onStatus=()=>{}}={}){
  const {window:w,document:d}=parseHTML('<html><body><main></main></body></html>');
  w.location={hash:'#'+BASE+'practiceCenter/practiceClass?testPaperId=test'};
  const page=d.querySelector('main'),messages=[],selections=[];let records=[],submits=0,nexts=0,index=0;
  function render(){
    page.innerHTML=`<form>${fixture({multi:index===1,stem:'题目'+index})}<div id="feedback"></div><button>确定</button></form>`;
    const labels=[...page.querySelectorAll('label')];
    labels.forEach(label=>{label.querySelector('input').checked=false;label.onclick=()=>{
      const input=label.querySelector('input');
      if(input.type==='radio'){labels.forEach(l=>l.querySelector('input').checked=false);input.checked=true;}else input.checked=!input.checked;
    };});
    if(index>0&&retained)labels.at(-1).querySelector('input').checked=true;
    if(index>0&&disabledNext)labels.forEach(l=>l.querySelector('input').disabled=true);
    const button=page.querySelector('button');button.onclick=()=>{
      if(button.textContent==='下一题'){
        nexts++;if(unchanged)return;
        if(blankNext){page.replaceChildren();return;}
        if(retainedSame){page.querySelector('#feedback').replaceChildren();button.textContent='确定';return;}
        if(ending){page.innerHTML='<p>本次练习已完成。</p>';return;}
        if(delayedNext){render();setTimeout(()=>{index++;render();},10);return;}
        if(!repeat&&!(repeatOnce&&nexts===1)&&nexts>repeatTimes&&(!repeatEvery||nexts%repeatEvery===0))index++;render();return;
      }
      submits++;
      selections.push(labels.filter(l=>l.querySelector('input').checked).map(l=>l.querySelector('input').value));
      if(!respond)return;
      const f=page.querySelector('#feedback');
      const showFeedback=()=>{if(index===2){f.className='success';f.textContent='回答正确。';}
        else f.innerHTML=`<span class="error">回答错误。</span>正确答案：${index===1?'A,C':'B'}`;
        if(changeSelection)labels[0].querySelector('input').checked=false;
        button.textContent='下一题';};
      if(feedbackDelay)setTimeout(showFeedback,feedbackDelay);else showFeedback();
    };
  }
  render();
  let delayed=false;
  const runtime={document:d,location:w.location,setTimeout:(fn,ms)=>{
    if(throttledNext&&nexts&&!delayed){delayed=true;return setTimeout(fn,220);}
    return setTimeout(fn,ms);
  }};
  const collector=createPracticeCollector(runtime,{store:r=>{if(storeError)throw new Error('存储已满');records=mergeRecords(records,[r]);if(stopAfter&&submits>=stopAfter)setTimeout(()=>collector.stop(),0);},status:s=>{messages.push(s);onStatus(s);},lookup,observeQuestion,pollMs:5,timeoutMs,feedbackGraceMs,readMs:0,optionMs:0,submitMs:0,reviewMs:5,resetWaitMs:30,noProgressLimit,...pacing});
  return {w,d,collector,messages,selections,get records(){return records;},get submits(){return submits;},get nexts(){return nexts;}};
}
test('三题完整流程：错误单选、多选及正确反馈；按限额停在结果页',async()=>{
  const h=harness();await h.collector.start(3);
  assert.equal(h.submits,3);assert.equal(h.nexts,2);assert.equal(h.records.length,3);
  assert.deepEqual(h.records.map(r=>r.answers),[['乙'],['甲','丙'],['甲']]);assert.equal(h.collector.state().active,false);
});
test('精确命中平台确认答案时复用，用户答案仍走首选项反馈',async()=>{
  const confirmed=harness({lookup:()=>({status:'confirmed',answers:['乙']})});await confirmed.collector.start(1);assert.deepEqual(confirmed.selections,[['B']]);
  const user=harness({lookup:()=>({status:'unconfirmed',answers:['乙']})});await user.collector.start(1);assert.deepEqual(user.selections,[['A']]);
});
test('旧确认答案与最新平台反馈冲突时保存证据并暂停',async()=>{
  const h=harness({lookup:()=>({status:'confirmed',answers:['甲']})});const outcome=await h.collector.start(1);
  assert.equal(outcome.reason,'error');assert.equal(h.records.length,1);assert.deepEqual(h.records[0].answers,['乙']);assert.match(outcome.error,/冲突/);
});
test('类目已有索引作为断点，新遇到题在提交前记录归属',async()=>{
  const observed=[],h=harness({observeQuestion:(q,context)=>observed.push([q.key,context.id])});const existing=readQuestions(h.d)[0].key;
  const outcome=await h.collector.start(2,{id:'paper-1',knownKeys:[existing]});
  assert.equal(outcome.reason,'limit');assert.equal(outcome.completed,2);assert.ok(observed.some(([,id])=>id==='paper-1'));assert.equal(h.submits,2);
});
test('类目索引已达到平台题数时不重复提交',async()=>{const h=harness(),existing=readQuestions(h.d)[0].key;const outcome=await h.collector.start(1,{id:'paper-1',knownKeys:[existing]});assert.equal(outcome.reason,'limit');assert.equal(h.submits,0);assert.match(h.messages.at(-1),/无需重复提交/);});

test('新题保留旧选中项仍能继续；单选切换、多选清理后才提交',async()=>{
  const h=harness({retained:true});const result=await h.collector.start(3);
  assert.equal(result.reason,'limit');assert.equal(h.records.length,3);
  assert.deepEqual(h.selections,[['A'],['A'],['A']]);
  assert.deepEqual(h.records.map(r=>r.answers),[['乙'],['甲','丙'],['甲']]);
});

test('同题保留选项但已返回确定状态：保存待补充，不重复提交',async()=>{
  const h=harness({retainedSame:true});const result=await h.collector.start(2);
  assert.equal(result.reason,'transition-stalled');assert.equal(result.completed,1);
  assert.equal(h.submits,1);assert.equal(h.nexts,1);assert.equal(h.records.length,1);
});

test('未知空白页或禁用控件不能被当作可恢复换题问题',async()=>{
  for(const options of [{blankNext:true},{retained:true,disabledNext:true}]){
    const h=harness(options);const result=await h.collector.start(2);
    assert.equal(result.reason,'error');assert.equal(h.submits,1);
  }
});

test('选题等待、提交等待及反馈等待期间暂停均不继续动作',async()=>{
  for(const phase of ['后选择答案','选项已填好','后进入下一题']){
    const h=harness({pacing:{readMs:5,submitMs:5,reviewMs:5},onStatus:s=>{if(s.includes(phase))h.collector.stop();}});
    const result=await h.collector.start(2);
    assert.equal(result.reason,'cancelled');assert.equal(h.submits,phase==='后进入下一题'?1:0);assert.equal(h.nexts,0);
  }
});

test('提交等待期间选项被清空不提交空答案',async()=>{
  const h=harness({pacing:{submitMs:5},onStatus:s=>{if(s.includes('选项已填好'))for(const input of h.d.querySelectorAll('input'))input.checked=false;}});
  const result=await h.collector.start(1);
  assert.equal(result.reason,'error');assert.equal(h.submits,0);assert.match(result.error,/选项改变/);
});

test('选题等待期间切换题目不会填选旧题答案',async()=>{
  const h=harness({pacing:{readMs:5},onStatus:s=>{if(s.includes('后选择答案'))h.d.querySelector('.richText').textContent='另一道题';}});
  const result=await h.collector.start(1);
  assert.equal(result.reason,'error');assert.equal(h.submits,0);assert.equal(h.d.querySelector('input').checked,false);
});
test('换题后定时器被延迟超过超时窗口，恢复时仍重新检查已就绪的新题',async()=>{
  const h=harness({throttledNext:true});const result=await h.collector.start(3);
  assert.equal(result.reason,'limit');assert.equal(h.records.length,3);assert.equal(h.submits,3);
});
test('平台无反馈超时不重试、不进入下一题',async()=>{
  const h=harness({respond:false});await h.collector.start(2);
  assert.equal(h.submits,1);assert.equal(h.records.length,0);assert.equal(h.nexts,0);assert.match(h.messages.at(-1),/超时/);
});
test('平台反馈延迟时延长等待并只提交一次',async()=>{
  const h=harness({feedbackDelay:180,timeoutMs:20,feedbackGraceMs:250});const result=await h.collector.start(1);
  assert.equal(result.reason,'limit');assert.equal(h.submits,1);assert.equal(h.records.length,1);
});
test('存储失败停在当前结果页，不丢失反馈继续切题',async()=>{
  const h=harness({storeError:true});await h.collector.start(2);
  assert.equal(h.submits,1);assert.equal(h.nexts,0);assert.match(h.messages.at(-1),/存储已满/);
});
test('暂停及切换考试页取消尚未发生的提交',async()=>{
  for(const action of ['stop','navigate']){
    const h=harness();const task=h.collector.start(2);
    if(action==='stop')h.collector.stop();else h.w.location.hash='#'+BASE+'examCenter';
    await task;assert.equal(h.submits,0);assert.equal(h.records.length,0);assert.equal(h.collector.state().active,false);
  }
});
test('反馈期间选择改变不冒认；连续五次重复仍继续到不同题数达到目标',async()=>{
  const h=harness({changeSelection:true});await h.collector.start(2);assert.equal(h.records.length,0);
  const repeat=harness({repeatTimes:5});const result=await repeat.collector.start(2);assert.equal(result.reason,'limit');assert.equal(repeat.submits,7);assert.equal(repeat.records.length,2);assert.equal(repeat.collector.state().completed,2);assert.equal(repeat.collector.state().processed,7);
});
test('同题清空重置后复用答案，重复提交不能冒充收齐',async()=>{
  const h=harness({repeatOnce:true});await h.collector.start(2);
  assert.equal(h.submits,3);assert.deepEqual(h.selections,[['A'],['B'],['A']]);
  assert.equal(h.collector.state().completed,2);assert.equal(h.records.length,2);assert.match(h.messages.at(-1),/本轮收录完成/);
});
test('平台持续返回同题不会虚报完成，用户仍可暂停',async()=>{
  const h=harness({repeat:true,stopAfter:5});const outcome=await h.collector.start(2);
  assert.equal(outcome.reason,'cancelled');assert.equal(h.records.length,1);assert.equal(h.collector.state().completed,1);assert.equal(h.submits,5);
});
test('连续30次无新增结束本轮为待补充，不提交第32次',async()=>{
  const h=harness({repeat:true});const outcome=await h.collector.start(2);
  assert.equal(outcome.reason,'stagnant');assert.equal(outcome.completed,1);assert.equal(h.submits,31);assert.equal(h.collector.state().active,false);assert.match(h.messages.at(-1),/待补充/);
});
test('遇到新题会重置连续无新增计数',async()=>{
  const h=harness({repeatEvery:3,noProgressLimit:3});const outcome=await h.collector.start(3);
  assert.equal(outcome.reason,'limit');assert.equal(h.submits,7);assert.equal(h.collector.state().noNew,0);
});
test('明确练习结束后退出，未对齐数量仍为待补充',async()=>{
  const h=harness({ending:true});const outcome=await h.collector.start(2);
  assert.equal(outcome.reason,'platform-end');assert.equal(outcome.completed,1);assert.equal(h.submits,1);assert.match(h.messages.at(-1),/待补充/);
});
test('提交成功、题干、隐藏提示及仍可答题的页面不识别成结束',()=>{
  for(const html of ['<p>提交成功</p>','<p>没有题目</p>','<div hidden><p>本次练习已完成。</p></div>',fixture({stem:'本次练习已完成。'}),'<p>本次练习已完成。</p><button>确定</button>'])assert.equal(readPracticeEnd(documentFor(html)),null);
  assert.equal(readPracticeEnd(documentFor('<p>本次练习已结束。</p>')),'本次练习已结束。');
});
test('下一题无反应且旧反馈仍在时，绝不重复提交',async()=>{
  const h=harness({unchanged:true});await h.collector.start(2);assert.equal(h.submits,1);assert.match(h.messages.at(-1),/未恢复/);
});
test('切题先清空旧题再延迟渲染新题时，不提前提交旧题',async()=>{
  const h=harness({delayedNext:true});await h.collector.start(2);assert.equal(h.submits,2);assert.equal(h.records.length,2);
});
test('启动时旧成功反馈只跳过；不会当成本轮新提交',async()=>{
  const h=harness();h.d.querySelector('#feedback').innerHTML='<div class="success">回答正确。</div>';h.d.querySelector('button').textContent='下一题';
  await h.collector.start(1);assert.equal(h.submits,1);assert.equal(h.records.length,1);assert.equal(h.records[0].stem,'题目1');
});
