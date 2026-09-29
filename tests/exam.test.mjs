import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountAssistant} from '../src/app.js';
import {BASE,makeRecord} from '../src/core.js';
import {readQuestions} from '../src/adapter.js';

const single={type:'single',stem:'考试演示单选',options:['甲','乙','丙']};
const multiple={type:'multiple',stem:'考试演示多选',options:['一','二','四']};
const boolean={type:'boolean',stem:'考试演示判断',options:['正确','错误']};

function environment(questions=[],records=[]){
  const {window,document}=parseHTML('<html><body><form id="paper"></form></body></html>');
  window.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',hash:'#'+BASE+'examCenter/examing?testPaperId=exam-2'};
  const storage=new Map([['jnsa.bank.v1',JSON.stringify({version:1,records})]]),writes=[];
  window.localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:k=>storage.get(k)??null,setItem:(k,v)=>{writes.push(k);storage.set(k,v);}};
  const form=document.querySelector('form');
  questions.forEach((q,i)=>{
    const block=document.createElement('div'),heading=document.createElement('span');
    heading.textContent={single:'单选题',multiple:'多选题',boolean:'判断题'}[q.type];block.append(heading);
    const item=document.createElement('div');item.className='el-form-item';block.append(item);
    const content=document.createElement('div');content.className='el-form-item__content';item.append(content);
    const stem=document.createElement('span');stem.className='richText';stem.textContent=q.stem;content.append(stem);
    if(q.image)stem.append(document.createElement('img'));
    const box=document.createElement('div');box.className='options';content.append(box);
    q.options.forEach((option,n)=>{
      const label=document.createElement('label');label.className=q.type==='multiple'?'el-checkbox':'el-radio';
      const input=document.createElement('input');input.type=q.type==='multiple'?'checkbox':'radio';input.name='q'+i;input.value=String.fromCharCode(65+n);input.checked=false;
      const text=document.createElement('span');text.className='richText';text.textContent=option;label.append(input,text);box.append(label);
      label.addEventListener('click',()=>{
        if(q.type==='multiple')input.checked=!input.checked;
        else {for(const radio of box.querySelectorAll('input'))radio.checked=false;input.checked=true;}
      });
    });
    form.append(block);
  });
  const submit=document.createElement('button');submit.textContent='提交';submit.type='button';form.append(submit);
  let submissions=0;submit.addEventListener('click',()=>{submissions++;});
  return {window,document,storage,writes,submit,get submissions(){return submissions;}};
}

function panel(e){return e.document.querySelector('#jnsa-host').shadowRoot;}
function cards(e){return [...panel(e).querySelectorAll('.body>.card')];}
function buttons(card){return [...card.querySelectorAll('button')];}

test('考试跨类命中全库，三种题型换序后按完整文字填选且不交卷',async t=>{
  const records=[makeRecord(single,['乙'],'confirmed','平台反馈'),makeRecord(multiple,['二','四'],'confirmed','平台反馈'),makeRecord(boolean,['正确'],'confirmed','平台反馈')];
  const e=environment([single,multiple,boolean].map(q=>({...q,options:[...q.options].reverse()})),records);
  const category={version:1,id:'practice-1',title:'其他练习类目',expectedCount:3,questionKeys:records.map(r=>r.key),updatedAt:'2026-09-21'};
  e.storage.set('jnsa.bank.v1.categories.practice-1',JSON.stringify(category));
  const app=mountAssistant(e.window);t.after(()=>app.destroy());
  const before=e.storage.get('jnsa.bank.v1'),categoryBefore=e.storage.get('jnsa.bank.v1.categories.practice-1');e.writes.length=0;
  assert.match(panel(e).querySelector('section').textContent,/考试辅助 · 本地题库查题/);
  assert.match(panel(e).querySelector('section').textContent,/已确认 3/);
  assert.equal(e.submissions,0);
  for(let i=0;i<3;i++)await buttons(cards(e)[i]).find(b=>b.textContent==='填入已确认答案').onclick();
  assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['乙'],['四','二'],['正确']]);
  assert.equal(e.submissions,0);assert.deepEqual(e.writes,[]);
  assert.equal(e.storage.get('jnsa.bank.v1'),before);assert.equal(e.storage.get('jnsa.bank.v1.categories.practice-1'),categoryBefore);
  assert.deepEqual(app.getRecords().map(r=>r.status),['confirmed','confirmed','confirmed']);
  assert.ok(![...panel(e).querySelectorAll('button')].some(b=>/自动收录|整理所选|暂停类目/.test(b.textContent)));
});

test('考试未知、待核验、冲突和图片题分别展示，不能冒认已确认答案',t=>{
  const reference={...single,stem:'参考题'},conflict={...single,stem:'冲突题'},unknown={...single,stem:'未知题'},image={...single,stem:'只有图案不同的题',image:true};
  const records=[makeRecord(reference,['甲'],'user','用户记录'),makeRecord(conflict,['甲'],'confirmed','平台旧反馈'),makeRecord(conflict,['乙'],'confirmed','平台新反馈'),makeRecord(image,['丙'],'confirmed','旧图题')];
  const e=environment([reference,conflict,unknown,image],records),app=mountAssistant(e.window);t.after(()=>app.destroy());
  assert.match(panel(e).querySelector('section').textContent,/已确认 0 · 待核验 1 · 冲突 1 · 未命中 1 · 需人工阅读 1/);
  assert.equal(cards(e)[0].querySelector('.answer').textContent,'甲');
  assert.ok(buttons(cards(e)[0]).some(b=>b.textContent==='填入参考答案'));
  for(const card of cards(e).slice(1)){assert.equal(card.querySelector('.answer'),null);assert.ok(!buttons(card).some(b=>b.textContent.startsWith('填入')));}
  assert.equal(e.submissions,0);assert.ok(readQuestions(e.document).every(q=>q.selected.length===0));
});

test('题库查看筛选不限制考试查题，切换筛选后仍命中未归类旧题',t=>{
  const e=environment([single],[makeRecord(single,['乙'],'confirmed','平台反馈')]);
  e.storage.set('jnsa.bank.v1.categories.other',JSON.stringify({version:1,id:'other',title:'别的类目',expectedCount:1,questionKeys:[],updatedAt:'2026-09-21'}));
  const app=mountAssistant(e.window);t.after(()=>app.destroy());
  const select=panel(e).querySelector('select');Object.defineProperty(select,'value',{value:'category:other'});select.onchange();
  assert.match(panel(e).querySelector('section').textContent,/当前筛选 0 题/);
  assert.equal(cards(e)[0].querySelector('.answer').textContent,'乙');
  assert.ok(buttons(cards(e)[0]).some(b=>b.textContent==='填入已确认答案'));
});

test('切换试卷后旧填选按钮不能操作文字相同的新试卷',async t=>{
  const e=environment([single],[makeRecord(single,['乙'],'confirmed','平台反馈')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  const fill=buttons(cards(e)[0]).find(b=>b.textContent==='填入已确认答案');
  e.window.location.hash='#'+BASE+'examCenter/examing?testPaperId=exam-3';await fill.onclick();
  assert.match(panel(e).querySelector('[role=status]').textContent,/题目已切换/);
  assert.deepEqual(readQuestions(e.document)[0].selected,[]);assert.equal(e.submissions,0);
});

test('多选填选期间切换试卷立即停止后续选项',async t=>{
  const e=environment([multiple],[makeRecord(multiple,['一','二'],'confirmed','平台反馈')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  e.document.querySelector('label').addEventListener('click',()=>{e.window.location.hash='#'+BASE+'examCenter/examing?testPaperId=exam-3';});
  await buttons(cards(e)[0]).find(b=>b.textContent==='填入已确认答案').onclick();
  assert.deepEqual(readQuestions(e.document)[0].selected,['一']);assert.equal(e.submissions,0);
  assert.match(panel(e).querySelector('[role=status]').textContent,/停止填选/);
});

test('考试提交和总反馈不会进入练习确认采集流程',t=>{
  const e=environment([single]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  e.document.querySelector('input').checked=true;e.submit.click();
  const feedback=e.document.createElement('div');feedback.className='success';feedback.textContent='回答正确。';e.document.querySelector('form').append(feedback);
  app.refresh();assert.deepEqual(app.getRecords(),[]);assert.deepEqual(app.getCategories(),[]);
});

test('考试列表无题目时明确提示，不自行打开或开始考试',t=>{
  const e=environment();e.window.location.hash='#'+BASE+'examCenter';e.submit.textContent='开始考试';
  const app=mountAssistant(e.window);t.after(()=>app.destroy());
  assert.match(panel(e).querySelector('section').textContent,/考试列表不含题目/);
  assert.equal(e.submissions,0);assert.equal(e.window.location.hash,'#'+BASE+'examCenter');
});

test('综合题库随脚本加载可填选，原有题库与分类不被复制或改写',async t=>{
  const referenceBank={format:'jnsa-reference-bank',version:1,name:'测试综合库',questionCount:1,includedQuestionCount:1,conflictQuestionCount:0,sourceRecordCount:1,sources:[{id:'s',label:'测试来源'}],records:[{...single,answers:['乙'],questionId:1,conflict:false,evidence:[{sourceId:'s',recordIds:[10]}]}]};
  const e=environment([{...single,options:[...single.options].reverse()}]);
  const before=e.storage.get('jnsa.bank.v1'),app=mountAssistant(e.window,{referenceBank});t.after(()=>app.destroy());
  assert.match(panel(e).querySelector('.reference-bank').textContent,/综合题库 · 1 题/);
  assert.equal(cards(e)[0].querySelector('.answer').textContent,'乙');
  await buttons(cards(e)[0]).find(b=>b.textContent==='填入参考答案').onclick();
  assert.deepEqual(readQuestions(e.document)[0].selected,['乙']);assert.equal(e.submissions,0);
  assert.deepEqual(app.getRecords(),[]);assert.equal(e.storage.get('jnsa.bank.v1'),before);assert.deepEqual(e.writes,[]);
});

test('100题考试分页筛选后仍按原题索引填选',async t=>{
  const qs=Array.from({length:100},(_,i)=>({...single,stem:'分页题'+i})),records=qs.slice(0,99).map(q=>makeRecord(q,['乙'],'confirmed','测试反馈'));
  const e=environment(qs,records),app=mountAssistant(e.window);t.after(()=>app.destroy());
  assert.equal(cards(e).length,20);
  await [...panel(e).querySelectorAll('button')].find(b=>b.textContent==='下一组').onclick();
  assert.match(cards(e)[0].querySelector('.stem').textContent,/21\. 分页题20/);
  await buttons(cards(e)[0]).find(b=>b.textContent==='填入已确认答案').onclick();
  assert.deepEqual(readQuestions(e.document)[20].selected,['乙']);assert.deepEqual(readQuestions(e.document)[0].selected,[]);
  await [...panel(e).querySelectorAll('button')].find(b=>b.textContent==='未命中').onclick();
  assert.equal(cards(e).length,1);assert.match(cards(e)[0].textContent,/分页题99/);assert.equal(e.submissions,0);
});

test('同一路径同文字但题块已经替换时，旧按钮不能点击旧节点',async t=>{
  const e=environment([single],[makeRecord(single,['乙'],'confirmed','测试反馈')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  const fill=buttons(cards(e)[0]).find(b=>b.textContent==='填入已确认答案'),old=e.document.querySelector('.el-form-item');
  old.replaceWith(old.cloneNode(true));await fill.onclick();
  assert.deepEqual(readQuestions(e.document)[0].selected,[]);assert.match(panel(e).querySelector('[role=status]').textContent,/题目已切换/);assert.equal(e.submissions,0);
});

const examControl=(e,name)=>buttons(panel(e)).find(button=>button.textContent===name);
const startExamFill=e=>examControl(e,'一键填入本页答案').onclick();

test('一键填入跨越100题预览和筛选，三种题型换序，跳过冲突与未知且不改题库或交卷',async t=>{
  const templates=[single,multiple,boolean],answers=[['乙'],['一','四'],['正确']];
  const qs=Array.from({length:100},(_,i)=>({...templates[i%3],stem:'一键整卷'+i,options:[...templates[i%3].options].reverse()}));
  const records=qs.slice(0,99).map((q,i)=>makeRecord(q,answers[i%3],i%2?'user':'confirmed','本地验证'));
  records.push(makeRecord(qs[98],['错误'],'user','冲突来源'));
  const e=environment(qs,records),app=mountAssistant(e.window);t.after(()=>app.destroy());
  const before=new Map(e.storage);e.writes.length=0;
  await examControl(e,'未命中').onclick();assert.equal(cards(e).length,1);
  await startExamFill(e);
  const actual=readQuestions(e.document);
  actual.slice(0,98).forEach((q,i)=>assert.deepEqual(q.selected.toSorted(),answers[i%3].toSorted(),`第 ${i+1} 题`));
  assert.deepEqual(actual.slice(98).map(q=>q.selected),[[],[]]);
  assert.match(panel(e).querySelector('[role=status]').textContent,/已处理 100\/100 题 · 填入 98 · 保留 0 · 跳过 2/);
  assert.equal(e.submissions,0);assert.deepEqual(e.storage,before);assert.deepEqual(e.writes,[]);
});

test('一键填入默认保留已答题，显式覆盖能修正单选和多选且不重复勾选',async t=>{
  const records=[makeRecord(single,['乙'],'confirmed','测试'),makeRecord(multiple,['二','四'],'user','测试'),makeRecord(boolean,['正确'],'confirmed','测试')];
  const e=environment([single,multiple,boolean],records),app=mountAssistant(e.window);t.after(()=>app.destroy());
  let qs=readQuestions(e.document);qs[0].labels[0].click();qs[1].labels[0].click();qs[1].labels[1].click();
  await startExamFill(e);
  assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['甲'],['一','二'],['正确']]);
  assert.match(panel(e).querySelector('[role=status]').textContent,/填入 1 · 保留 2 · 跳过 0/);
  const overwrite=panel(e).querySelector('.exam-fill-controls input');overwrite.checked=true;overwrite.onchange();
  await startExamFill(e);
  assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['乙'],['二','四'],['正确']]);
  assert.match(panel(e).querySelector('[role=status]').textContent,/填入 2 · 保留 1 · 跳过 0/);
  await startExamFill(e);assert.match(panel(e).querySelector('[role=status]').textContent,/填入 0 · 保留 3 · 跳过 0/);
  assert.equal(e.submissions,0);
});

test('一键填入跳过媒体、重复文字和禁用选项，参考答案保持待核验',async t=>{
  const image={...single,stem:'图片题',image:true},disabled={...single,stem:'禁用题'},duplicate={...single,stem:'重复选项题',options:['甲','甲']};
  const e=environment([image,disabled,duplicate,single],[makeRecord(image,['甲'],'confirmed','测试'),makeRecord(disabled,['甲'],'confirmed','测试'),makeRecord(single,['乙'],'user','测试')]);
  e.document.querySelectorAll('.options')[1].querySelector('input').disabled=true;
  const app=mountAssistant(e.window);t.after(()=>app.destroy());await startExamFill(e);
  assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[[],[],[],['乙']]);
  assert.match(panel(e).querySelector('[role=status]').textContent,/填入 1 · 保留 0 · 跳过 3/);
  assert.match(panel(e).querySelector('[role=status]').textContent,/需人工阅读 2，选项不可操作 1/);
  assert.equal(app.getRecords().at(-1).status,'user');assert.equal(e.submissions,0);
});

test('停止填入可中断多选，任务退出前不能重复启动，之后可覆盖补齐',async t=>{
  const e=environment([multiple,single],[makeRecord(multiple,['一','二'],'confirmed','测试'),makeRecord(single,['乙'],'confirmed','测试')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  const running=startExamFill(e);
  assert.equal(examControl(e,'一键填入本页答案').disabled,true);
  assert.equal(examControl(e,'停止填入').disabled,false);
  await examControl(e,'停止填入').onclick();
  assert.equal(examControl(e,'一键填入本页答案').disabled,true);
  await startExamFill(e);await running;
  assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['一'],[]]);
  assert.match(panel(e).querySelector('[role=status]').textContent,/填入已停止.*已处理 0\/2/s);
  assert.equal(examControl(e,'一键填入本页答案').disabled,false);
  const overwrite=panel(e).querySelector('.exam-fill-controls input');overwrite.checked=true;overwrite.onchange();
  await startExamFill(e);assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['一','二'],['乙']]);assert.equal(e.submissions,0);
});

test('批量填入期间手动修改后续题，覆盖模式仍保留新选择',async t=>{
  const second={...single,stem:'稍后手动修改'},e=environment([single,second],[makeRecord(single,['乙'],'confirmed','测试'),makeRecord(second,['乙'],'confirmed','测试')]);
  const app=mountAssistant(e.window);t.after(()=>app.destroy());
  const overwrite=panel(e).querySelector('.exam-fill-controls input');overwrite.checked=true;overwrite.onchange();
  const running=startExamFill(e);readQuestions(e.document)[1].labels[2].click();await running;
  assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['乙'],['丙']]);
  assert.match(panel(e).querySelector('[role=status]').textContent,/填入 1 · 保留 1 · 跳过 0/);
});

test('批量操作逐次核对试卷路由、题块、选项节点及禁用状态',async t=>{
  for(const change of ['route','box','input','disabled']){
    const e=environment([multiple,single],[makeRecord(multiple,['一','二'],'confirmed','测试'),makeRecord(single,['乙'],'confirmed','测试')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
    e.document.querySelector('label').addEventListener('click',()=>{
      if(change==='route')e.window.location.hash+='&changed=1';
      if(change==='box'){const box=e.document.querySelectorAll('.options')[1];box.replaceWith(box.cloneNode(true));}
      if(change==='input'){const input=e.document.querySelectorAll('input')[1];input.replaceWith(input.cloneNode(true));}
      if(change==='disabled')e.document.querySelectorAll('input')[1].disabled=true;
    });
    await startExamFill(e);
    assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['一'],[]],change);
    assert.match(panel(e).querySelector('[role=status]').textContent,/填入已停止/);assert.equal(e.submissions,0);
  }
});

test('旧批量按钮不能启动新题块，单题填入期间批量按钮锁定',async t=>{
  const e=environment([single],[makeRecord(single,['乙'],'confirmed','测试')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  const oldStart=examControl(e,'一键填入本页答案'),oldBox=e.document.querySelector('.options');oldBox.replaceWith(oldBox.cloneNode(true));
  await oldStart.onclick();assert.match(panel(e).querySelector('[role=status]').textContent,/试卷题目已变化/);assert.deepEqual(readQuestions(e.document)[0].selected,[]);
  // Restore the original working input handlers and refresh the page controls.
  e.document.querySelector('.options').replaceWith(oldBox);app.refresh();
  const filling=examControl(e,'填入已确认答案').onclick();assert.equal(examControl(e,'一键填入本页答案').disabled,true);
  await startExamFill(e);await filling;assert.deepEqual(readQuestions(e.document)[0].selected,['乙']);assert.equal(e.submissions,0);
});

test('用户手动提交或销毁助手会中断剩余填入',async t=>{
  for(const action of ['submit','destroy']){
    const e=environment([multiple,single],[makeRecord(multiple,['一','二'],'confirmed','测试'),makeRecord(single,['乙'],'confirmed','测试')]),app=mountAssistant(e.window);t.after(()=>app.destroy());
    const running=startExamFill(e);
    if(action==='submit')e.submit.click();else app.destroy();
    await running;assert.deepEqual(readQuestions(e.document).map(q=>q.selected),[['一'],[]]);
    assert.equal(e.submissions,action==='submit'?1:0);
  }
});

test('填入过程中个人库同步产生冲突，后续选项立即停止',async t=>{
  const record=makeRecord(multiple,['一','二'],'confirmed','测试'),e=environment([multiple],[record]),app=mountAssistant(e.window);t.after(()=>app.destroy());
  const running=startExamFill(e);
  e.storage.set('jnsa.bank.v1',JSON.stringify({version:1,records:[record,makeRecord(multiple,['四'],'user','新参考')]}));
  const event=new e.window.Event('storage');Object.defineProperty(event,'key',{value:'jnsa.bank.v1'});e.window.dispatchEvent(event);
  await running;assert.deepEqual(readQuestions(e.document)[0].selected,['一']);assert.match(panel(e).querySelector('[role=status]').textContent,/答案依据或题目状态已变化/);assert.equal(e.submissions,0);
});
