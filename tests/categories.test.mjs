import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {BASE} from '../src/core.js';
import {readPracticeCategories} from '../src/adapter.js';
import {createPracticeCollector} from '../src/collector.js';
import {createCategoryCollector,practiceCategoryId,PRACTICE_HOME} from '../src/categories.js';

const card=(title,count)=>`<div class="item"><div class="title">${title}</div><div class="count">试题数量：${count}</div><button>开始练习</button></div>`;
function setup(t,{loading=0,storeError=false,missingOnReturn=false,onComplete=()=>{},onIncomplete=()=>{},repeatFirst=false,endingFirst=false,stalledFirst=false,noFeedback=false,onStatus=()=>{}}={}){
  const {window:w,document:d}=parseHTML('<html><body><main></main></body></html>');
  const page=d.querySelector('main'),records=[],messages=[],opened=[],timers=[];
  let hash=PRACTICE_HOME,homeVisits=0,tabClicks=0,submits=0,manager;
  const later=fn=>timers.push(setTimeout(fn,loading));
  const items=[{title:'分类甲',count:2},{title:'分类乙',count:1}];
  function home(){
    homeVisits++;
    page.innerHTML=`<div id="tab-fourth" role="tab" aria-selected="${homeVisits===1}">分类练习</div><div id="pane-fourth" style="${homeVisits===1?'':'display:none'}"><div class="list">${items.filter((_,i)=>!missingOnReturn||homeVisits===1||i===0).map(c=>card(c.title,c.count)).join('')}</div></div>`;
    page.querySelector('#tab-fourth').onclick=()=>{tabClicks++;page.querySelector('#pane-fourth').style.display='';page.querySelector('#tab-fourth').setAttribute('aria-selected','true');};
    [...page.querySelectorAll('.item')].forEach((element,i)=>element.querySelector('button').onclick=()=>{
      opened.push(items[i].title);w.location.hash='#'+BASE+'practiceCenter/practiceClass?testPaperId='+i;page.replaceChildren();later(()=>question(i,0));
    });
  }
  function question(category,index){
    page.innerHTML=`<form><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">类别${category}题目${index}</span><div class="options">${['甲','乙'].map((s,i)=>`<label class="el-radio"><input type="radio" value="${i?'B':'A'}"><span class="el-radio__label">${i?'B':'A'}.<span class="richText">${s}</span></span></label>`).join('')}</div></div></div></div><div id="feedback"></div><button>确定</button></form>`;
    const labels=[...page.querySelectorAll('label')];labels.forEach(label=>{label.querySelector('input').checked=false;label.onclick=()=>{labels.forEach(l=>l.querySelector('input').checked=false);label.querySelector('input').checked=true;};});
    const button=page.querySelector('button');button.onclick=()=>{
      if(button.textContent==='下一题'&&stalledFirst&&category===0){page.querySelector('#feedback').replaceChildren();button.textContent='确定';return;}
      if(button.textContent==='下一题'){page.replaceChildren();later(()=>{if(endingFirst&&category===0)page.innerHTML='<p>本次练习已结束。</p>';else question(category,repeatFirst&&category===0?index:index+1);});return;}
      submits++;if(noFeedback)return;page.querySelector('#feedback').innerHTML='<span class="error">回答错误。</span>正确答案：B';button.textContent='下一题';
    };
  }
  w.location={get hash(){return hash;},set hash(value){hash=value;manager?.routeChanged();if(value===PRACTICE_HOME){page.replaceChildren();later(home);}}};
  home();
  const collector=createPracticeCollector(w,{store:r=>{if(storeError)throw new Error('存储已满');records.push(r);},status:s=>messages.push(s),pollMs:5,timeoutMs:250,feedbackGraceMs:20,readMs:0,optionMs:0,submitMs:0,reviewMs:5,resetWaitMs:5,noProgressLimit:3});
  manager=createCategoryCollector(w,collector,{status:s=>{messages.push(s);onStatus(s);},completed:onComplete,incomplete:onIncomplete,pollMs:5,timeoutMs:250,categoryPauseMs:5});
  t.after(()=>{manager.stop();timers.forEach(clearTimeout);});
  return {w,d,manager,collector,records,messages,opened,get tabClicks(){return tabClicks;},get submits(){return submits;}};
}

test('分类列表只读可见分类面板；题数不合法不会推断',()=>{
  const {document:d}=parseHTML(`<html><body><div id="pane-first">${card('模拟',100)}</div><div id="pane-fourth"><div class="list">${card('分类',2)}${card('未知','?')}</div></div></body></html>`);
  assert.deepEqual(readPracticeCategories(d).map(c=>[c.title,c.count]),[['分类',2],['未知',null]]);
  d.querySelector('#pane-fourth').style.display='none';assert.deepEqual(readPracticeCategories(d),[]);
});
test('分类路由只读取明确的 testPaperId',()=>{assert.equal(practiceCategoryId('#'+BASE+'practiceCenter/practiceClass?testPaperId=paper-1'),'paper-1');assert.equal(practiceCategoryId('#'+BASE+'practiceCenter/practiceClass?id=paper-1'),null);assert.equal(practiceCategoryId('#'+BASE+'examCenter?testPaperId=paper-1'),null);});

test('类目间休息时暂停，已保存结果保留且不打开下一类',async t=>{
  const h=setup(t,{onStatus:s=>{if(s.includes('上一类结果已保存'))h.manager.stop();}});
  await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲']);assert.equal(h.manager.state().results.length,1);assert.equal(h.manager.state().active,false);
});
test('真实子流程连续两类：等待题目加载、返回默认模拟页后点击分类标签',async t=>{
  const completed=[];const h=setup(t,{loading:20,onComplete:(title,count)=>completed.push([title,count])});await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲','分类乙']);assert.equal(h.submits,3);assert.equal(h.records.length,3);assert.equal(h.tabClicks,1);
  assert.equal(h.manager.state().active,false);assert.deepEqual(h.manager.state().results.map(r=>[r.title,r.complete]),[['分类甲',true],['分类乙',true]]);
  assert.deepEqual(completed,[['分类甲',2],['分类乙',1]]);
});
test('每类上限低于总数会切换，但明确标记未收齐',async t=>{
  const completed=[];const h=setup(t,{onComplete:(title,count)=>completed.push([title,count])});await h.manager.start(['分类甲','分类乙'],1);
  assert.equal(h.submits,2);assert.deepEqual(h.manager.state().results.map(r=>r.complete),[false,true]);
  assert.deepEqual(completed,[['分类乙',1]]);
});
test('保存失败停止整个队列，不打开下一类',async t=>{
  const h=setup(t,{storeError:true});await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲']);assert.equal(h.submits,1);assert.match(h.messages.at(-1),/存储已满/);
});

test('换题卡在已选同题会保存待补充并继续下一类，不重交卡住题',async t=>{
  const partial=[],complete=[];
  const h=setup(t,{stalledFirst:true,onIncomplete:r=>partial.push(r),onComplete:title=>complete.push(title)});
  await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲','分类乙']);assert.equal(h.submits,2);
  assert.equal(partial[0].reason,'transition-stalled');assert.equal(partial[0].collected,1);
  assert.deepEqual(complete,['分类乙']);assert.deepEqual(h.manager.state().results.map(r=>r.complete),[false,true]);
});

test('提交反馈超时标记当前类目并继续队列，不重复提交',async t=>{
  const h=setup(t,{noFeedback:true});await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲','分类乙']);assert.equal(h.submits,2);assert.equal(h.manager.state().results.length,2);
  assert.equal(h.manager.state().results[0].reason,'feedback-timeout');
  assert.match(h.manager.state().results[0].detail,/平台反馈超时/);
});
test('完成标记持久化失败不报告完成或进入下一类',async t=>{
  const h=setup(t,{onComplete:()=>{throw new Error('标记保存失败');}});await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲']);assert.equal(h.manager.state().results.length,0);assert.match(h.messages.at(-1),/标记保存失败/);
});
test('重复达到上限或平台结束时，保存待补充且自动完成第二类',async t=>{
  for(const reason of ['stagnant','platform-end']){
    const partial=[],completed=[];const h=setup(t,{repeatFirst:reason==='stagnant',endingFirst:reason==='platform-end',onIncomplete:r=>partial.push(r),onComplete:title=>completed.push(title)});
    await h.manager.start(['分类甲','分类乙']);
    assert.deepEqual(h.opened,['分类甲','分类乙']);assert.deepEqual(completed,['分类乙']);assert.equal(partial[0].reason,reason);assert.equal(partial[0].collected,1);assert.equal(partial[0].count,2);assert.match(h.messages.at(-1),/1 类待补充/);
  }
});
test('待补充记录保存失败时不进入下一类',async t=>{
  const h=setup(t,{repeatFirst:true,onIncomplete:()=>{throw new Error('待补充保存失败');}});await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲']);assert.equal(h.manager.state().results.length,0);assert.match(h.messages.at(-1),/待补充保存失败/);
});
test('暂停和手动转到考试页取消等待中的首次提交',async t=>{
  for(const action of ['pause','navigate']){
    const h=setup(t,{loading:50});const job=h.manager.start(['分类甲','分类乙']);
    if(action==='pause')h.manager.stop();else h.w.location.hash='#'+BASE+'examCenter';
    await job;assert.equal(h.submits,0);assert.equal(h.manager.state().active,false);
  }
});
test('返回后类目消失会暂停，不误点其它开始练习',async t=>{
  const h=setup(t,{missingOnReturn:true});await h.manager.start(['分类甲','分类乙']);
  assert.deepEqual(h.opened,['分类甲']);assert.equal(h.submits,2);assert.match(h.messages.at(-1),/未找到类目/);
});
test('重复类目及非法上限在点击页面前报错',async t=>{
  const h=setup(t);await assert.rejects(h.manager.start(['分类甲','分类甲']),/重复/);
  await assert.rejects(h.manager.start(['分类甲'],0),/上限/);assert.equal(h.opened.length,0);
});
