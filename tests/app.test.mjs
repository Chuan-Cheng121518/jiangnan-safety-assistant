import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountAssistant} from '../src/app.js';
import {BASE,makeRecord} from '../src/core.js';
import {readQuestions} from '../src/adapter.js';
function environment(raw=null){
  const {window,document}=parseHTML('<html><body></body></html>');
  window.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',hash:'#'+BASE+'practiceCenter/practiceClass'};
  const storage=new Map(raw?[['jnsa.bank.v1',raw]]:[]);window.localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
  return {window,document,storage};
}
test('错误域名不开启，重复挂载被阻止',()=>{const e=environment();e.window.location.hostname='example.com';assert.equal(mountAssistant(e.window),null);e.window.location.hostname='jnlab.jiangnan.edu.cn';const app=mountAssistant(e.window);assert.ok(app);assert.equal(mountAssistant(e.window),null);app.destroy();});
test('配套考核页支持保存并恢复上次选择',(t)=>{
  const e=environment();e.window.location.hash='#'+BASE+'learningCenter/learning/course-1/learningExaming?learningMaterialId=course-1&learningMaterialName=JCXL03';
  e.document.body.innerHTML='<form class="examForm"><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">恢复题</span><div class="options"><label class="el-radio"><input type="radio" value="A"><span class="richText">甲</span></label><label class="el-radio"><input type="radio" value="B"><span class="richText">乙</span></label></div></div></div></div><button>提交考核</button></form>';
  const labels=[...e.document.querySelectorAll('label')];labels.forEach(label=>{label.onclick=()=>{labels.forEach(other=>{other.querySelector('input').checked=false;});label.querySelector('input').checked=true;}});
  const app=mountAssistant(e.window);t.after(()=>app.destroy());const root=e.document.querySelector('#jnsa-host').shadowRoot;
  assert.match(root.querySelector('section').textContent,/小节考核恢复/);e.document.querySelector('input[value="B"]').checked=true;e.document.querySelector('input[value="B"]').dispatchEvent(new e.window.Event('change',{bubbles:true}));
  const draft=JSON.parse(e.storage.get('jnsa.bank.v1.practiceDrafts'));assert.equal(Object.keys(draft.drafts).length,1);assert.deepEqual(Object.values(draft.drafts)[0].answers,['乙']);
  app.refresh();const restore=[...root.querySelectorAll('button')].find(b=>b.textContent==='恢复上次选择');assert.equal(restore.disabled,false);
});
test('配套考核页恢复答案后可调用平台原生提交按钮',(t)=>{
  const e=environment();e.window.location.hash='#'+BASE+'learningCenter/learning/course-2/learningExaming?learningMaterialId=course-2&learningMaterialName=JCXL04';
  e.window.confirm=()=>true;
  e.document.body.innerHTML='<form class="examForm"><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">提交恢复题</span><div class="options"><label class="el-radio"><input type="radio" value="A"><span class="richText">甲</span></label><label class="el-radio"><input type="radio" value="B"><span class="richText">乙</span></label></div></div></div></div><button id="submit-assessment">提交考核</button></form>';
  const labels=[...e.document.querySelectorAll('label')];labels.forEach(label=>{label.onclick=()=>{labels.forEach(other=>other.querySelector('input').checked=false);label.querySelector('input').checked=true;}});
  const app=mountAssistant(e.window);t.after(()=>app.destroy());const root=e.document.querySelector('#jnsa-host').shadowRoot;
  const input=e.document.querySelector('input[value="B"]');input.checked=true;input.dispatchEvent(new e.window.Event('change',{bubbles:true}));let submitted=0;e.document.querySelector('#submit-assessment').onclick=()=>{submitted++;};
  app.refresh();const recover=[...root.querySelectorAll('button')].find(b=>b.textContent==='恢复答案并提交当前考核');recover.click();
  return new Promise(resolve=>setTimeout(()=>{assert.equal(submitted,1);resolve();},20));
});
test('损坏存储不覆盖，界面明确提示',(t)=>{const e=environment('{broken');const app=mountAssistant(e.window);t.after(()=>app.destroy());assert.match(e.document.querySelector('#jnsa-host').shadowRoot.querySelector('section').textContent,/停止写入/);assert.equal(e.storage.get('jnsa.bank.v1'),'{broken');});
test('导入文字作为文本渲染，不执行题库 HTML',(t)=>{const raw=JSON.stringify({version:1,records:[{type:'single',stem:'<img src=x onerror=alert(1)>',options:['甲','乙'],answers:['甲'],status:'user',source:'文件',explanation:'<script>alert(1)</script>'}]});const e=environment(raw);const app=mountAssistant(e.window);t.after(()=>app.destroy());const root=e.document.querySelector('#jnsa-host').shadowRoot;assert.equal(root.querySelectorAll('img,script').length,0);assert.match(root.querySelector('section').textContent,/<img/);});
test('单题反馈归档只关联实际点击提交时的题目和选择',()=>{
  const e=environment();e.document.body.innerHTML='<form><div><span class="bold">单选题</span><div class="el-form-item"><div class="el-form-item__content"><div class="flex"><span class="richText">测试题</span></div><div class="options"><label class="el-radio"><input type="radio"><span class="richText">甲</span></label><label class="el-radio"><input type="radio"><span class="richText">乙</span></label></div></div></div></div><div id="feedback"></div><button>确定</button></form>';
  const app=mountAssistant(e.window);e.document.querySelector('input').checked=true;e.document.querySelector('button').click();const f=e.document.querySelector('#feedback');f.className='success';f.textContent='回答正确。';app.refresh();assert.equal(app.getRecords().length,1);assert.equal(app.getRecords()[0].status,'confirmed');app.refresh();assert.equal(app.getRecords().length,1);app.destroy();
});
test('已有旧成功反馈不能被新点击当作本次确认',(t)=>{
  const e=environment();e.document.body.innerHTML='<form><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><div><span class="richText">旧题</span></div><div class="options"><label class="el-radio"><input type="radio"><span class="richText">甲</span></label><label class="el-radio"><input type="radio"><span class="richText">乙</span></label></div></div></div></div><div class="success">回答正确。</div><button>确定</button></form>';
  const app=mountAssistant(e.window);t.after(()=>app.destroy());e.document.querySelector('input').checked=true;e.document.querySelector('button').click();app.refresh();assert.equal(app.getRecords().length,0);
});
test('已完成类目从本地恢复并按题数变化自动失效',(t)=>{
  const raw=JSON.stringify({version:1,records:[],completedCategories:[{title:'分类甲',count:2}]});
  const e=environment(raw);e.storage.set('jnsa.bank.v1.categories.paper-1',JSON.stringify({version:1,id:'paper-1',title:'分类甲',expectedCount:2,questionKeys:['key-1','key-2'],updatedAt:'2026-09-21'}));e.window.location.hash='#'+BASE+'practiceCenter';e.document.body.innerHTML='<div id="tab-fourth">分类练习</div><div id="pane-fourth"><div class="list"><div class="item"><div class="title">分类甲</div><div class="count">试题数量：2</div><button>开始练习</button></div><div class="item"><div class="title">分类乙</div><div class="count">试题数量：3</div><button>开始练习</button></div></div></div>';
  const app=mountAssistant(e.window);t.after(()=>app.destroy());
  const root=e.document.querySelector('#jnsa-host').shadowRoot;let text=root.querySelector('section').textContent;assert.match(text,/分类甲（2 题） · 已归类 2 ✓ 已完成/);
  const checks=[...root.querySelectorAll('input[type=checkbox]')];assert.equal(checks[0].disabled,true);assert.equal(checks[1].disabled,false);
  e.document.querySelector('.count').textContent='试题数量：4';app.refresh();text=root.querySelector('section').textContent;assert.doesNotMatch(text,/分类甲（4 题） ✓ 已完成/);
});
test('旧版完成标记没有逐题分类证据时不冒充已归类',(t)=>{const e=environment(JSON.stringify({version:1,records:[],completedCategories:[{title:'分类甲',count:2}]}));e.window.location.hash='#'+BASE+'practiceCenter';e.document.body.innerHTML='<div id="pane-fourth"><div class="list"><div class="item"><div class="title">分类甲</div><div class="count">试题数量：2</div><button>开始练习</button></div></div></div>';const app=mountAssistant(e.window);t.after(()=>app.destroy());const root=e.document.querySelector('#jnsa-host').shadowRoot;assert.doesNotMatch(root.querySelector('section').textContent,/✓ 已完成/);assert.equal(root.querySelector('input[type=checkbox]').disabled,false);});
test('从已勾选列表连续完成两类，保存完成标记；重新挂载后不再勾选完成项',async t=>{
  const e=environment(JSON.stringify({version:1,records:[],partialCategories:[{title:'分类甲',count:1,collected:0,detail:'上次无新增',at:'2026-09-19'}]}));const page=e.document.createElement('main');e.document.body.append(page);
  let hash='#'+BASE+'practiceCenter';const opened=[];
  e.window.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',get hash(){return hash;},set hash(value){hash=value;if(value==='#'+BASE+'practiceCenter')home();}};
  function home(){
    page.innerHTML='<button id="tab-fourth" aria-selected="false">分类练习</button><div id="pane-fourth" style="display:none"><div class="list">'+['分类甲','分类乙'].map(title=>`<div class="item"><div class="title">${title}</div><div class="count">试题数量：1</div><button>开始练习</button></div>`).join('')+'</div></div>';
    page.querySelector('#tab-fourth').onclick=()=>{page.querySelector('#tab-fourth').setAttribute('aria-selected','true');page.querySelector('#pane-fourth').style.display='';};
    [...page.querySelectorAll('.item')].forEach((card,i)=>card.querySelector('button').onclick=()=>{
      opened.push(i);hash='#'+BASE+'practiceCenter/practiceClass?testPaperId='+i;
      page.innerHTML=`<form><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">类目${i}题目</span><div class="options">${['甲','乙'].map((s,n)=>`<label class="el-radio"><input type="radio" value="${n?'B':'A'}"><span class="el-radio__label">${n?'B':'A'}.<span class="richText">${s}</span></span></label>`).join('')}</div></div></div></div><div id="feedback"></div><button>确定</button></form>`;
      const labels=[...page.querySelectorAll('label')];labels.forEach(l=>{l.querySelector('input').checked=false;l.onclick=()=>{labels.forEach(x=>x.querySelector('input').checked=false);l.querySelector('input').checked=true;};});
      page.querySelector('button').onclick=()=>{page.querySelector('#feedback').innerHTML='<span class="error">回答错误。</span>正确答案：B';page.querySelector('button').textContent='下一题';};
    });
  }
  home();page.querySelector('#tab-fourth').click();let app=mountAssistant(e.window);t.after(()=>app.destroy());
  let root=e.document.querySelector('#jnsa-host').shadowRoot;
  [...root.querySelectorAll('button')].find(b=>b.textContent==='整理所选类目').click();
  for(let i=0;i<2000&&!root.querySelector('section').textContent.includes('类目队列已结束');i++)await new Promise(r=>setTimeout(r,20));
  assert.match(root.querySelector('section').textContent,/类目队列已结束：2 类/);assert.deepEqual(opened,[0,1]);
  const saved=JSON.parse(e.storage.get('jnsa.bank.v1'));assert.deepEqual(saved.completedCategories,[{title:'分类甲',count:1},{title:'分类乙',count:1}]);assert.deepEqual(saved.selectedCategories,[]);assert.deepEqual(saved.partialCategories,[]);
  const categoryKeys=[...e.storage.keys()].filter(key=>key.startsWith('jnsa.bank.v1.categories.'));assert.equal(categoryKeys.length,2);assert.ok(categoryKeys.every(key=>JSON.parse(e.storage.get(key)).questionKeys.length===1));
  app.destroy();e.window.location.hash='#'+BASE+'practiceCenter';page.querySelector('#tab-fourth').click();app=mountAssistant(e.window);root=e.document.querySelector('#jnsa-host').shadowRoot;
  assert.equal(root.querySelectorAll('input[type=checkbox]').length,2);
  assert.ok([...root.querySelectorAll('input[type=checkbox]')].every(c=>c.disabled&&!c.checked));
  [...root.querySelectorAll('button')].find(b=>b.textContent==='重新收录').click();
  assert.equal(JSON.parse(e.storage.get('jnsa.bank.v1')).completedCategories.length,1);
});

test('自选剩余类目在刷新后保留，不变回全选',t=>{
  const e=environment(JSON.stringify({version:1,records:[],selectedCategories:['分类乙']}));e.window.location.hash='#'+BASE+'practiceCenter';
  e.document.body.innerHTML='<div id="pane-fourth"><div class="list">'+['分类甲','分类乙'].map(title=>`<div class="item"><div class="title">${title}</div><div class="count">试题数量：1</div><button>开始练习</button></div>`).join('')+'</div></div>';
  const app=mountAssistant(e.window);t.after(()=>app.destroy());const checks=[...e.document.querySelector('#jnsa-host').shadowRoot.querySelectorAll('input[type=checkbox]')];
  assert.equal(checks[0].checked,false);assert.equal(checks[1].checked,true);
});
test('勾选类目只写独立小存储，不重写整份题库',t=>{
  const raw=JSON.stringify({version:1,records:[],selectedCategories:['分类乙']});const e=environment(raw);e.window.location.hash='#'+BASE+'practiceCenter';
  e.document.body.innerHTML='<div id="pane-fourth"><div class="list">'+['分类甲','分类乙'].map(title=>`<div class="item"><div class="title">${title}</div><div class="count">试题数量：1</div><button>开始练习</button></div>`).join('')+'</div></div>';
  let app=mountAssistant(e.window);t.after(()=>app.destroy());let checks=[...e.document.querySelector('#jnsa-host').shadowRoot.querySelectorAll('input[type=checkbox]')];
  checks[0].checked=true;checks[0].onchange();assert.equal(e.storage.get('jnsa.bank.v1'),raw);assert.deepEqual(new Set(JSON.parse(e.storage.get('jnsa.bank.v1.selection')).selectedCategories),new Set(['分类甲','分类乙']));
  app.destroy();app=mountAssistant(e.window);checks=[...e.document.querySelector('#jnsa-host').shadowRoot.querySelectorAll('input[type=checkbox]')];assert.ok(checks.every(check=>check.checked));
});
test('1274条记录和2905条分类关系下，勾选仍只走轻量存储且低于100毫秒',t=>{
  const unique=Array.from({length:966},(_,i)=>makeRecord({type:'single',stem:`性能题${i}`,options:['甲','乙']},['甲'],'confirmed','平台反馈'));
  const records=Array.from({length:1274},(_,i)=>({...unique[i%966],source:`平台反馈-${Math.floor(i/966)}`})),raw=JSON.stringify({version:1,records});
  const e=environment(raw);for(let category=0;category<22;category++){const questionKeys=[];for(let i=category;i<2905;i+=22)questionKeys.push(unique[i%966].key);e.storage.set(`jnsa.bank.v1.categories.paper-${category}`,JSON.stringify({version:1,id:`paper-${category}`,title:`分类${category}`,expectedCount:questionKeys.length,questionKeys,updatedAt:'2026-09-21'}));}
  e.window.location.hash='#'+BASE+'practiceCenter';e.document.body.innerHTML='<div id="pane-fourth"><div class="list">'+Array.from({length:22},(_,i)=>`<div class="item"><div class="title">分类${i}</div><div class="count">试题数量：200</div><button>开始练习</button></div>`).join('')+'</div></div>';
  const app=mountAssistant(e.window);t.after(()=>app.destroy());const check=e.document.querySelector('#jnsa-host').shadowRoot.querySelector('input[type=checkbox]'),before=e.storage.get('jnsa.bank.v1'),start=performance.now();check.checked=false;check.onchange();const elapsed=performance.now()-start;
  assert.equal(e.storage.get('jnsa.bank.v1'),before);assert.ok(elapsed<100,`勾选耗时 ${elapsed.toFixed(1)}ms`);
});
test('日常从分类列表进入题目会渐进归类，不重写主题库',t=>{
  const source={type:'single',stem:'旧题归类',options:['甲','乙']},record=makeRecord(source,['乙'],'confirmed','平台反馈'),raw=JSON.stringify({version:1,records:[record]});
  const e=environment(raw);e.window.location.hash='#'+BASE+'practiceCenter';
  e.document.body.innerHTML='<main><div id="pane-fourth"><div class="list"><div class="item"><div class="title">试剂安全</div><div class="count">试题数量：2</div><button id="open-category">开始练习</button></div></div></div></main>';
  const page=e.document.querySelector('main'),open=e.document.querySelector('#open-category');open.onclick=()=>{e.window.location.hash='#'+BASE+'practiceCenter/practiceClass?testPaperId=paper-1';page.innerHTML='<form><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">旧题归类</span><div class="options"><label class="el-radio"><input type="radio" value="A"><span class="richText">甲</span></label><label class="el-radio"><input type="radio" value="B"><span class="richText">乙</span></label></div></div></div></div><button>确定</button></form>';};
  const app=mountAssistant(e.window);t.after(()=>app.destroy());open.click();app.refresh();
  assert.equal(e.storage.get('jnsa.bank.v1'),raw);assert.equal(app.getCategories().length,1);assert.deepEqual(app.getCategories()[0].questionKeys,[record.key]);
  assert.match(e.document.querySelector('#jnsa-host').shadowRoot.querySelector('section').textContent,/已归类 1\/1 题/);
});
test('待补充记录刷新后显示数量原因，仍勾选且不冒充完成',t=>{
  const e=environment(JSON.stringify({version:1,records:[],selectedCategories:['分类甲'],partialCategories:[{title:'分类甲',count:2,collected:1,detail:'连续 30 次无新增题目',at:'2026-09-19'}]}));e.window.location.hash='#'+BASE+'practiceCenter';
  e.document.body.innerHTML='<div id="pane-fourth"><div class="list"><div class="item"><div class="title">分类甲</div><div class="count">试题数量：2</div><button>开始练习</button></div></div></div>';
  const app=mountAssistant(e.window);t.after(()=>app.destroy());const root=e.document.querySelector('#jnsa-host').shadowRoot;
  assert.match(root.querySelector('section').textContent,/待补充 · 上次 1\/2 题 · 连续 30 次无新增题目/);
  const check=root.querySelector('input[type=checkbox]');assert.equal(check.checked,true);assert.equal(check.disabled,false);
});

test('面板按刚输入的题数运行；自动反馈写入本地存储且刷新后仍在',async t=>{
  const e=environment();
  e.document.body.innerHTML='<form><div><span>单选题</span><div class="el-form-item"><div class="el-form-item__content"><span class="richText">自动归档测试</span><div class="options"><label class="el-radio"><input type="radio" value="A"><span class="el-radio__label">A.<span class="richText">甲</span></span></label><label class="el-radio"><input type="radio" value="B"><span class="el-radio__label">B.<span class="richText">乙</span></span></label></div></div></div></div><div id="feedback"></div><button>确定</button></form>';
  const q=readQuestions(e.document)[0];q.labels.forEach(l=>{l.querySelector('input').checked=false;l.onclick=()=>{q.labels.forEach(x=>x.querySelector('input').checked=false);l.querySelector('input').checked=true;};});
  let submits=0;e.document.querySelector('button').onclick=()=>{submits++;e.document.querySelector('#feedback').innerHTML='<span class="error">回答错误。</span>正确答案：B';e.document.querySelector('button').textContent='下一题';};
  const app=mountAssistant(e.window);t.after(()=>app.destroy());
  const root=e.document.querySelector('#jnsa-host').shadowRoot,input=root.querySelector('input[type=number]');
  input.value='1'; // The click also reads the current value without requiring blur/change.
  [...root.querySelectorAll('button')].find(b=>b.textContent==='开始自动收录').click();
  for(let i=0;i<750&&!root.querySelector('section').textContent.includes('本轮收录完成');i++)await new Promise(r=>setTimeout(r,20));
  assert.match(root.querySelector('section').textContent,/本轮收录完成：1 题/);assert.equal(submits,1);
  const saved=e.storage.get('jnsa.bank.v1');assert.deepEqual(JSON.parse(saved).records[0].answers,['乙']);
  app.destroy();const restored=mountAssistant(e.window);t.after(()=>restored.destroy());assert.equal(restored.getRecords().length,1);
});
