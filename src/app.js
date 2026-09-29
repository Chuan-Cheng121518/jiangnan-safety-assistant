import {VERSION,BASE,normalize,sameSet,makeRecord,buildQuestionIndex,matchQuestion,mergeRecords,importBackup,exportCsv,courseState,routeKind} from './core.js';
import {visible,textOf,readQuestions,readCatalog,readCourse,readFeedback,readPracticeCategories,applyAnswers} from './adapter.js';
import {collectionRoute,feedbackRecord,createPracticeCollector} from './collector.js';
import {createCategoryCollector,practiceCategoryId,PRACTICE_HOME} from './categories.js';
import {createBackgroundScheduler} from './scheduler.js';
import {createBankStorage,createCategoryStorage} from './storage.js';
import {migrateSiteStorage} from './managed-storage.js';
import {paperRoute,readPaper,preparePaperBatch} from './paper.js';
import {createReferenceBank} from './reference-bank.js';
import {createPracticeBank} from './practice-bank.js';
import {createCourseBatch,courseBatchRoute} from './course-batch.js';
import {createExamFiller,examFillSummary} from './exam-fill.js';

export function mountAssistant(win, {demo=false,storage=win.localStorage,legacyStorage=null,referenceBank=null}={}) {
  const doc=win.document;
  if(!demo && (win.location.hostname!=='jnlab.jiangnan.edu.cn'||win.location.protocol!=='https:'))return null;
  if(doc.getElementById('jnsa-host'))return null;
  const key=demo?'jnsa.demo.v1':'jnsa.bank.v1';
  const selectionKey=key+'.selection';
  const practiceDraftKey=key+'.practiceDrafts';
  const bankStorage=createBankStorage(storage,key);
  const categoryStorage=createCategoryStorage(storage,key);
  let records=[], storageError='', queue=[], active=false, autoAdvance=false, pending=null, lastSignature='', currentCourse='', history=[], undoRecords=[], practiceDrafts={};
  let recordIndex=buildQuestionIndex(records),categoryEntries=new Map(),categoriesByQuestion=new Map(),categoryRevision=0,bankFilter='all',pendingCategory=null;
  let playbackRun=0, destroyed=false, boundVideo=null, endedListener=null;
  let collector=null,collectionLimit=20,courseBatch=null;
  let questionPage=0;
  let examFilter='all',referenceQuery='',referenceError='';
  let overwriteExam=false,singleFilling=false,practiceFilling=false,practiceSubmittedHash='';
  let reference=createReferenceBank();
  try{reference=createReferenceBank(referenceBank);}catch(error){referenceError=`综合题库加载失败：${error.message}`;}
  const practiceBank=createPracticeBank();
  const lookup=question=>{
    const referenceResult=reference.match(question,recordIndex);
    const context=practiceContext();
    const practiceResult=context?practiceBank.match(question,context.courseId):{hits:[],status:'unknown'};
    const hits=[...referenceResult.hits,...practiceResult.hits];
    const merged=matchQuestion(question,hits);
    if(referenceResult.status==='conflict'||practiceResult.status==='conflict'||merged.status==='conflict')return {status:'conflict',answers:[],hits};
    return merged;
  };
  const scheduler=createBackgroundScheduler(win);
  let categoryCollector=null,categoriesInitialized=false,completedCategories=new Map(),partialCategories=new Map();
  const chosenCategories=new Set();
  function setRecords(next){records=next;recordIndex=buildQuestionIndex(records);}
  function rebuildCategoryIndex(){
    categoriesByQuestion=new Map();
    for(const entry of categoryEntries.values())for(const questionKey of entry.questionKeys){
      if(!categoriesByQuestion.has(questionKey))categoriesByQuestion.set(questionKey,new Set());
      categoriesByQuestion.get(questionKey).add(entry.id);
    }
    categoryRevision++;
  }
  function loadCategoryEntries(entries){categoryEntries=new Map(entries.map(entry=>[entry.id,entry]));rebuildCategoryIndex();}
  function applyCategoryEntry(entry){categoryEntries.set(entry.id,entry);rebuildCategoryIndex();return entry;}
  const categoryList=()=>[...categoryEntries.values()].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));
  const contextFromEntry=entry=>({id:entry.id,title:entry.title,expectedCount:entry.expectedCount,knownKeys:[...entry.questionKeys]});
  function ensureCategoryContext(info){const {entry}=categoryStorage.ensure(info);pendingCategory=null;return contextFromEntry(applyCategoryEntry(entry));}
  function currentCategoryContext(){
    const id=practiceCategoryId(win.location.hash);if(!id)return null;
    const existing=categoryEntries.get(id);
    if(existing)return contextFromEntry(existing);
    if(pendingCategory&&Date.now()-pendingCategory.at<=60000)return ensureCategoryContext({id,title:pendingCategory.title,expectedCount:pendingCategory.expectedCount});
    return null;
  }
  function observeCategoryQuestion(question,context){
    if(categoriesByQuestion.get(question.key)?.has(context.id))return false;
    const {entry,changed}=categoryStorage.observe(context,question.key);applyCategoryEntry(entry);return changed;
  }
  function applySavedSelection(selected){chosenCategories.clear();selected.forEach(title=>chosenCategories.add(title));categoriesInitialized=true;}
  function readSavedSelection(){
    const raw=storage.getItem(selectionKey);if(raw===null)return null;
    const saved=JSON.parse(raw);
    if(saved?.version!==1||!Array.isArray(saved.selectedCategories)||saved.selectedCategories.some(title=>typeof title!=='string'))throw new Error('类目勾选数据格式不正确');
    return saved.selectedCategories;
  }
  const sleep=()=>new Promise(resolve=>win.setTimeout(resolve,250));
  function unbindVideo(){if(boundVideo&&endedListener)boundVideo.removeEventListener('ended',endedListener);boundVideo=null;endedListener=null;}
  function stopPlayback(){active=false;playbackRun++;unbindVideo();}
  try {
    if(legacyStorage)migrateSiteStorage(legacyStorage,storage,key);
    const saved=bankStorage.protect();
    if(saved.version!==1||!Array.isArray(saved.records))throw new Error('不支持的存储版本');
    setRecords(saved.records.map(r=>({...makeRecord(r,r.answers,r.status,demo&&r.source==='江南大学练习页面：回答正确'?'本地演示反馈：回答正确':r.source,r.explanation),observedAt:r.observedAt})));
    loadCategoryEntries(categoryStorage.readAll());
    history=Array.isArray(saved.history)?saved.history.slice(-100):[];
    for(const entry of Array.isArray(saved.completedCategories)?saved.completedCategories:[])if(entry&&typeof entry.title==='string'&&Number.isInteger(entry.count)&&entry.count>0)completedCategories.set(normalize(entry.title),entry.count);
    if(Array.isArray(saved.selectedCategories))applySavedSelection(saved.selectedCategories.filter(t=>typeof t==='string'));
    for(const entry of saved.partialCategories||[]){
      if(entry&&typeof entry.title==='string'&&Number.isInteger(entry.count)&&entry.count>0&&Number.isInteger(entry.collected)&&entry.collected>=0&&entry.collected<entry.count&&typeof entry.detail==='string')partialCategories.set(normalize(entry.title),entry);
    }
    const separateSelection=readSavedSelection();if(separateSelection!==null)applySavedSelection(separateSelection);
    const rawDrafts=storage.getItem(practiceDraftKey);
    if(rawDrafts!==null){
      const parsed=JSON.parse(rawDrafts);
      if(!parsed||parsed.version!==1||!parsed.drafts||typeof parsed.drafts!=='object'||Array.isArray(parsed.drafts))throw new Error('小节答案草稿格式不正确');
      practiceDrafts=parsed.drafts;
    }
  } catch(e){storageError=`本地数据无法读取，已停止写入：${e.message}。请先备份浏览器数据。`;}
  const host=doc.createElement('aside');host.id='jnsa-host';doc.body.append(host);
  const root=host.attachShadow({mode:'open'});
  const style=doc.createElement('style');style.textContent=`
    :host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#18352e}
    *{box-sizing:border-box} .panel{width:365px;max-width:calc(100vw - 24px);max-height:80vh;display:flex;flex-direction:column;background:#fffefb;border:1px solid #d6e3dc;border-radius:18px;box-shadow:0 16px 54px #123c3526;overflow:hidden}
    header{background:#174f43;color:white;padding:15px 18px;display:flex;justify-content:space-between;align-items:center}h2{font-size:17px;margin:0}small{font-size:11px;opacity:.8}button,select,input{font:inherit}button{border:1px solid #bdd1c7;background:#f0f6f2;color:#174f43;border-radius:8px;padding:6px 10px;cursor:pointer}button:hover{background:#ddece3}button:disabled{opacity:.5;cursor:default}header button{border:0;background:transparent;color:white}.body{padding:14px 16px;overflow:auto} .row{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.muted{font-size:12px;color:#60776d}.message{padding:9px 12px;background:#edf5f0;border-bottom:1px solid #d6e3dc;font-size:12px;white-space:pre-wrap} .card{padding:12px 0;border-bottom:1px solid #e4eae5}.stem{font-weight:600;margin:5px 0;overflow-wrap:anywhere}.badge{display:inline-block;background:#e8f1ed;color:#246451;border-radius:5px;padding:1px 6px;font-size:11px}.warn{color:#95611c;background:#fff1d7}label{cursor:pointer}input[type=checkbox]{accent-color:#216950;margin-right:8px}.answer{white-space:pre-wrap;overflow-wrap:anywhere;color:#2d7058}summary{cursor:pointer;font-weight:600;margin:8px 0}.hidden{display:none}.empty{padding:16px 0;color:#667a72}footer{padding:10px 16px;background:#f4f5f0;font-size:11px;color:#6d7e74}progress{width:100%;accent-color:#26715c} .review{max-height:220px;overflow:auto}
    @media(max-width:850px){:host{left:12px;right:12px;bottom:12px}.panel{width:100%;max-width:none;max-height:44vh}header{padding:8px 14px}h2{font-size:15px}.body{padding:8px 14px}footer{padding:5px 14px}.message{padding:5px 12px}}
  `;root.append(style);
  const el=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const panel=el('section',undefined,'panel');root.append(panel);
  const header=el('header');const heading=el('div');heading.append(el('h2','江南 · 学习助手'),el('small',demo?'演示环境 · 与真实数据隔离':`${storage.independent?'脚本独立存储':'网站存储'} · v${VERSION}`));header.append(heading);
  const minimize=el('button','收起');header.append(minimize);panel.append(header);
  const message=el('div',storageError||referenceError||'已就绪。打开课程、练习或考试页面开始。','message');message.setAttribute('role','status');panel.append(message);
  const body=el('div',undefined,'body');panel.append(body);const footer=el('footer','分类练习可开启自动提交收录；题库保存在本浏览器。');panel.append(footer);
  minimize.onclick=()=>{body.classList.toggle('hidden');message.classList.toggle('hidden');footer.classList.toggle('hidden');minimize.textContent=body.classList.contains('hidden')?'展开':'收起';};
  const status=msg=>{message.textContent=msg;};
  const save=(options)=>{if(storageError)throw new Error(storageError);const saved=bankStorage.save({version:1,records,history,completedCategories:[...completedCategories].map(([title,count])=>({title,count})),partialCategories:[...partialCategories.values()],...(categoriesInitialized?{selectedCategories:[...chosenCategories]}:{})},options);setRecords(saved.records);};
  const writeSelection=()=>{if(storageError)throw new Error(storageError);storage.setItem(selectionKey,JSON.stringify({version:1,selectedCategories:[...chosenCategories]}));};
  const saveSelection=()=>{try{writeSelection();}catch(e){status(`无法保存勾选：${e.message}`);}};
  const categoryIndexedCount=category=>new Set([...categoryEntries.values()].filter(entry=>normalize(entry.title)===normalize(category)).flatMap(entry=>entry.questionKeys)).size;
  const categoryComplete=(category,count)=>completedCategories.get(normalize(category))===count&&categoryIndexedCount(category)>=count;
  function add(entries){const next=mergeRecords(records,entries),previous=records;setRecords(next);try{save({restore:entries});}catch(e){setRecords(previous);throw e;}}
  const button=(text,action,parent=body)=>{const b=el('button',text);b.type='button';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await action();}catch(e){status(e.message);}finally{b.disabled=false;if(!destroyed)refresh(true);}};parent.append(b);return b;};
  const download=(name,text,type)=>{const url=win.URL.createObjectURL(new win.Blob([text],{type}));const a=el('a');a.href=url;a.download=name;root.append(a);a.click();a.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);};
  const currentQuestions=()=>['practice','exam'].includes(routeKind(win.location.hash))?readQuestions(doc):[];
  function practiceContext(){
    if(routeKind(win.location.hash)!=='practice')return null;
    const raw=String(win.location.hash).replace(/^#/,'');
    const query=raw.includes('?')?new URLSearchParams(raw.slice(raw.indexOf('?')+1)):new URLSearchParams();
    const path=raw.split('?')[0];
    const courseId=path.match(/\/learning\/([^/]+)\/learningExaming$/)?.[1]||'';
    if(!courseId||(query.get('learningMaterialId')&&query.get('learningMaterialId')!==courseId))return null;
    const title=normalize(query.get('learningMaterialName')||'');
    return {courseId,title,key:`${courseId}|${title}`};
  }
  function draftFor(question){
    const context=practiceContext();if(!context||!question?.key)return null;
    const draft=practiceDrafts[`${context.key}|${question.key}`];
    return draft&&Array.isArray(draft.answers)?draft:null;
  }
  function savePracticeDraft(question){
    const context=practiceContext();if(!context||!question?.key||storageError)return;
    const stored=storage.getItem(practiceDraftKey);
    if(stored!==null){const data=JSON.parse(stored);if(data?.version!==1||!data.drafts||typeof data.drafts!=='object'||Array.isArray(data.drafts))throw new Error('小节答案草稿格式不正确');practiceDrafts=data.drafts;}
    const id=`${context.key}|${question.key}`;
    practiceDrafts[id]={courseId:context.courseId,title:context.title,answers:[...question.selected],savedAt:new Date().toISOString()};
    storage.setItem(practiceDraftKey,JSON.stringify({version:1,drafts:practiceDrafts}));
  }
  function savedPracticeAnswer(question){
    const draft=draftFor(question);return draft?.answers?.length?draft.answers:[];
  }
  function courseIdFromHash(){
    return String(win.location.hash).replace(/^#/,'').split('?')[0].match(/\/learning\/([^/]+)$/)?.[1]||'';
  }
  function answerForPracticeQuestion(question,{bankOnly=false}={}){
    const context=practiceContext();
    if(!context||question.issue)return null;
    const captured=practiceBank.match(question,context.courseId);
    if(captured.status==='confirmed')return {answers:captured.answers,source:'本小节已通过答案'};
    if(!bankOnly){
    const saved=savedPracticeAnswer(question);
    if(saved.length)return {answers:saved,source:'上次保存的选择'};
    }
    const result=lookup(question);
    if(!question.issue&&result.status!=='conflict'&&result.answers.length)return {answers:result.answers,source:'本地题库答案'};
    return null;
  }
  function nativeAssessmentSubmit(){
    const buttons=[...doc.querySelectorAll('button,input[type="submit"]')].filter(element=>visible(element)&&!element.disabled&&!element.classList.contains('is-disabled')&&(textOf(element)||element.value||'')==='提交考核');
    return buttons.length===1?buttons[0]:null;
  }
  function freshPracticeQuestions(questions,pageHash){
    if(destroyed||win.location.hash!==pageHash||!practiceContext())throw new Error('课程页面已切换，恢复已停止');
    const fresh=currentQuestions();
    if(fresh.length!==questions.length||fresh.some((q,i)=>q.key!==questions[i].key||q.box!==questions[i].box||q.labels.some((label,j)=>label!==questions[i].labels[j])))throw new Error('题目已变化，请重新识别');
    return fresh;
  }
  async function fillPracticeAnswers(questions,{complete=false,bankOnly=false,pageHash=win.location.hash}={}){
    freshPracticeQuestions(questions,pageHash);
    const course=practiceBank.course(practiceContext().courseId);
    const plans=questions.map(q=>answerForPracticeQuestion(q,{bankOnly}));
    if(complete){
      if(!questions.length||plans.some(plan=>!plan))throw new Error('本节有未识别或无可靠答案的题目，未提交');
      if(course&&(questions.length!==course.records.length||!sameSet(questions.map(q=>q.key),course.records.map(q=>q.key))))throw new Error('本节题目数量或内容与已通过记录不一致，未提交');
    }
    let count=0;
    for(let i=0;i<questions.length;i++){
      const plan=plans[i];if(!plan)continue;
      const fresh=freshPracticeQuestions(questions,pageHash)[i];
      await applyAnswers(fresh,plan.answers,()=>freshPracticeQuestions(questions,pageHash)[i]?.key);
      savePracticeDraft(freshPracticeQuestions(questions,pageHash)[i]);count++;
    }
    if(!count)throw new Error('当前小节没有可恢复的完整答案');
    return {count,plans};
  }
  const examFiller=createExamFiller(win,{lookup,changed:state=>{
    if(destroyed)return;
    status(examFillSummary(state));updateExamFillControls(state);
  }});
  function updateExamFillControls(state=examFiller.state()){
    const controls=body.querySelector('.exam-fill-controls');if(!controls)return;
    controls.querySelector('.exam-fill-start').disabled=state.active||singleFilling;
    controls.querySelector('.exam-fill-stop').disabled=!state.active||state.cancelRequested;
    controls.querySelector('input').disabled=state.active||singleFilling;
    const progress=controls.querySelector('progress');progress.max=state.total||1;progress.value=state.processed;progress.hidden=state.stage==='idle';
    controls.querySelector('.exam-fill-progress').textContent=state.stage==='idle'?'':examFillSummary(state);
    body.querySelectorAll('.exam-single-fill').forEach(control=>{control.disabled=state.active||singleFilling;});
  }
  function renderExamFill(questions){
    const controls=el('section',undefined,'exam-fill-controls');body.append(controls);
    controls.append(el('p',`一键处理本页已加载的全部 ${questions.length} 题，不受下方筛选或每组 20 题预览限制。无冲突参考答案也会填入，仍需你核对。`,'muted'));
    const row=el('div',undefined,'row');controls.append(row);
    const pageHash=win.location.hash;
    button('一键填入本页答案',async()=>{
      if(singleFilling)throw new Error('请等待当前题目填入完成。');
      await examFiller.start({overwrite:overwriteExam,expectedHash:pageHash,expectedQuestions:questions});
    },row).className='exam-fill-start';
    button('停止填入',()=>examFiller.stop(),row).className='exam-fill-stop';
    const label=el('label'),check=el('input');check.type='checkbox';check.checked=overwriteExam;
    check.onchange=()=>{overwriteExam=check.checked;};label.append(check,doc.createTextNode('覆盖已作答题（默认保留）'));controls.append(label);
    const progress=el('progress');progress.setAttribute('aria-label','答案填入进度');controls.append(progress,el('div',undefined,'exam-fill-progress muted'));
    updateExamFillControls();
  }
  function captureCategoryOpen(event){
    const target=event.target.closest?.('button'),card=target?.closest?.('#pane-fourth .item');
    if(!card||textOf(target)!=='开始练习')return;
    const title=textOf(card.querySelector('.title')),match=textOf(card.querySelector('.count')).match(/^试题数量\s*[:：]\s*(\d+)\s*$/);
    if(title&&match)pendingCategory={title,expectedCount:Number(match[1]),at:Date.now()};
  }
  doc.addEventListener('click',captureCategoryOpen,true);
  function renderCollection(){
    const state=collector.state();
    const card=el('section',undefined,'card');body.append(card);
    card.append(el('div','练习答案自动收录','stem'),el('div','逐题提交并收录平台答案。连续 30 次无新增，或换题后仍停在已选同题，则记为待补充，类目队列继续下一类。每次启动会产生练习记录。','muted'));
    card.append(el('div','慢速收录：选题前等 6 秒，选项间隔 1 秒，提交前等 2 秒，反馈后等 5 秒；切换类目休息 10 秒。','muted'));
    const context=currentCategoryContext();
    card.append(el('div',context?`当前归类：${context.title} · 已归类 ${context.knownKeys.length}/${context.expectedCount} 题`:'当前网址尚未建立类目身份；仍可收录答案，但不会猜测分类。','muted'));
    const timing=scheduler.state();
    card.append(el('div',`${timing.mode==='worker'?'后台计时已启用':timing.mode==='fallback'?'普通计时（后台可能变慢）：'+timing.reason:timing.mode==='starting'?'后台计时启动中':'开始收录时启用后台计时'} · 本页最长额外等待 ${(timing.maxLateMs/1000).toFixed(1)} 秒。浏览器冻结或电脑休眠时仍会暂停。`,'muted'));
    if(categoryCollector.state().active){card.append(el('div',`当前类目：不同题 ${state.completed}/${state.limit} · 已处理 ${state.processed} 题次`,'muted'));return;}
    const row=el('div',undefined,'row');card.append(row);
    const label=el('label','本轮题数 '),input=el('input');input.type='number';input.min='1';input.max='500';input.value=String(collectionLimit);input.style.width='70px';input.disabled=state.active;
    input.oninput=input.onchange=()=>{collectionLimit=Number(input.value);};label.append(input);row.append(label);
    const start=button(state.active?`正在收录 ${state.completed}/${state.limit}`:state.canResume?'继续收录':'开始自动收录',()=>{
      if(storageError)throw new Error(storageError);
      // Check storage before creating a practice record on the platform.
      collectionLimit=Number(input.value);save();pending=null;
      void (state.canResume?collector.resume():collector.start(collectionLimit,currentCategoryContext())).catch(e=>status(e.message));
    },row);start.disabled=state.active||Boolean(storageError);
    if(state.active)button('暂停收录',()=>collector.stop(),row);
    else button('返回列表选择多个类目',()=>{win.location.hash=PRACTICE_HOME;},card);
  }
  function renderCategoryProgress(){
    const state=categoryCollector.state();
    if(!state.active&&!state.results.length)return;
    const section=el('section',undefined,'card');body.append(section);
    if(state.active){
      section.append(el('div',`类目 ${state.index+1}/${state.total}：${state.title}`,'stem'));
      section.append(el('div',`本类目标 ${state.target} 题 · 已处理 ${state.results.length} 类`,'muted'));
      button('暂停类目队列',()=>categoryCollector.stop(),section);
    }
    state.results.forEach(r=>section.append(el('div',`${r.title}：${r.collected}/${r.count} 题${r.complete?' · 已完成':` · 待补充（${r.detail}）`}`,'muted')));
  }
  function renderPracticeHome(){
    body.append(el('div','优先使用模拟练习整卷收录','stem'),el('p','在模拟练习打开100题试卷，先保存整卷题目；由你提交练习后，再收录平台逐题显示的正确答案。原分类整理仍可使用。','muted'));
    button('显示模拟练习',()=>{const tab=doc.querySelector('#tab-first');if(!tab||!visible(tab)||textOf(tab)!=='模拟练习')throw new Error('未找到模拟练习标签');tab.click();});
    const categories=readPracticeCategories(doc);
    if(!categories.length){
      body.append(el('p','打开“分类练习”即可勾选类目并连续收录。','empty'));
      button('显示分类练习',()=>{
        const tab=doc.querySelector('#tab-fourth');if(!tab||!visible(tab)||textOf(tab)!=='分类练习')throw new Error('未找到分类练习标签');tab.click();
      });return;
    }
    if(categoryCollector.state().active)return;
    if(!categoriesInitialized){categories.filter(c=>c.count>0&&c.button&&!categoryComplete(c.title,c.count)).forEach(c=>chosenCategories.add(c.title));categoriesInitialized=true;saveSelection();}
    body.append(el('div',`分类题库专项整理 · ${categories.length} 个类目`,'stem'),el('p','按勾选清单逐类整理。旧题精确命中平台确认答案时直接复用并复核；新题继续通过平台反馈收录。连续 30 次无新增则标待补充。','muted'));
    const actions=el('div',undefined,'row');body.append(actions);
    button('全选未完成类目',()=>{categories.filter(c=>c.count>0&&c.button&&!categoryComplete(c.title,c.count)).forEach(c=>chosenCategories.add(c.title));saveSelection();},actions);
    button('取消全选',()=>{chosenCategories.clear();saveSelection();},actions);
    const list=el('div',undefined,'review');body.append(list);
    categories.forEach(c=>{
      const done=categoryComplete(c.title,c.count);if(done)chosenCategories.delete(c.title);
      const line=el('div'),label=el('label'),input=el('input');input.type='checkbox';input.checked=chosenCategories.has(c.title);input.disabled=done||!(c.count>0&&c.button);
      input.onchange=()=>{if(input.checked)chosenCategories.add(c.title);else chosenCategories.delete(c.title);saveSelection();};
      const indexed=[...categoryEntries.values()].filter(entry=>normalize(entry.title)===normalize(c.title)),indexedCount=categoryIndexedCount(c.title);
      label.append(input,doc.createTextNode(`${c.title}（${c.count??'未知'} 题）${indexed.length?` · 已归类 ${indexedCount}`:''}${done?' ✓ 已完成':''}`));line.append(label);list.append(line);
      const partial=partialCategories.get(normalize(c.title));
      if(!done&&partial)line.append(el('div',`待补充 · 上次 ${partial.collected}/${partial.count} 题 · ${partial.detail}${partial.at?' · '+partial.at:''}`,'muted'));
      if(done)button('重新收录',()=>{const k=normalize(c.title),old=completedCategories.get(k);completedCategories.delete(k);chosenCategories.add(c.title);try{save();saveSelection();}catch(e){completedCategories.set(k,old);chosenCategories.delete(c.title);throw e;}},line);
    });
    const controls=el('div',undefined,'row');body.append(controls);
    controls.append(el('span','每类按平台完整题数收录','muted'));
    const start=button('整理所选类目',()=>{
      save();pending=null;
      const titles=categories.filter(c=>chosenCategories.has(c.title)&&!categoryComplete(c.title,c.count)).map(c=>c.title);
      void categoryCollector.start(titles).catch(e=>status(e.message));
    },controls);start.disabled=Boolean(storageError);
  }
  function renderPaper(paper){
    const section=el('section',undefined,'card');body.append(section);
    const confirmed=paper.feedback.filter(f=>f?.answers?.length&&!f.issue).length;
    section.append(el('div','模拟练习 · 整卷收录','stem'),el('div',`已读取 ${paper.questions.length}/${paper.expected??'未知'} 题 · 可核验答案 ${confirmed} 题`,'muted'));
    section.append(el('p',paper.complete?'整卷已加载。先保存题干和完整选项，提交练习后再收录正确答案；重复题不重复计数。':'尚不能确认整卷已加载完整，只会保存当前读到的题目，不标记收齐。','muted'));
    section.append(el('p','提交后请点击平台“查看结果”，再收录本卷正确答案。本模式不自动作答或交卷，不根据总分推断答案；模拟卷不作为类目。','muted'));
    const row=el('div',undefined,'row');section.append(row);
    const collect=answers=>{
      if(storageError)throw new Error(storageError);
      const fresh=readPaper(doc,win.location.hash);
      if(!fresh||fresh.signature!==paper.signature)throw new Error('试卷或反馈已变化，请重新读取后收录');
      const {records:batch,stats}=preparePaperBatch(fresh,recordIndex,{answers,demo});
      if(batch.length)add(batch);
      const note=stats.conflicts?`；${stats.conflicts} 题答案冲突，双方证据已保留，需人工核对` : '';
      status(answers?`本卷 ${stats.confirmed} 题有明确答案，写入 ${batch.length} 条新证据；${stats.missing} 题暂无可靠反馈，${stats.skipped} 题需人工阅读${note}。`:`已保存/保留 ${stats.unique} 道不同文字题，新增 ${stats.added} 题；${stats.skipped} 题需人工阅读。题目保存不代表答案已确认。`);
    };
    const savePaper=button(paper.complete?'保存整卷题目':'保存已加载题目',()=>collect(false),row);
    savePaper.disabled=Boolean(storageError)||!paper.questions.length;
    const saveAnswers=button('收录本卷正确答案',()=>collect(true),row);saveAnswers.disabled=Boolean(storageError)||!confirmed;
  }
  function renderPracticeRecovery(questions){
    const context=practiceContext();
    if(!context)return;
    const pageHash=win.location.hash;
    const withPracticeLock=async action=>{
      if(practiceFilling)throw new Error('正在恢复本节答案，请等待完成');
      practiceFilling=true;
      try{await action();}finally{practiceFilling=false;}
    };
    const section=el('section',undefined,'card');body.append(section);
    const saved=questions.filter(q=>savedPracticeAnswer(q).length).length;
    const known=questions.filter(q=>answerForPracticeQuestion(q,{bankOnly:true})).length;
    section.append(el('div','小节考核恢复','stem'));
    section.append(el('p',`${context?.title||'当前小节'} · 已保存选择 ${saved}/${questions.length} 题 · 题库可用答案 ${known}/${questions.length}`,'muted'));
    section.append(el('p','优先恢复本课程已通过的答案。点击下方恢复并提交后，确认一次即可补交当前小节；是否通过以平台结果为准。','muted'));
    const row=el('div',undefined,'row');section.append(row);
    const restore=button('恢复上次选择',()=>withPracticeLock(async()=>{
      let count=0;
      freshPracticeQuestions(questions,pageHash);
      for(const q of questions){const answers=savedPracticeAnswer(q);if(!answers.length||q.issue)continue;const fresh=freshPracticeQuestions(questions,pageHash)[q.index];await applyAnswers(fresh,answers,()=>freshPracticeQuestions(questions,pageHash)[q.index]?.key);count++;}
      if(!count)throw new Error('当前小节没有已保存的选择');
      status(`已恢复 ${count} 题的上次选择，请核对后点击平台“提交考核”。`);
    }),row);restore.disabled=!saved||Boolean(storageError)||practiceFilling;
    const fill=button('按题库恢复本节答案',()=>withPracticeLock(async()=>{
      const {count}=await fillPracticeAnswers(questions,{bankOnly:true,pageHash});
      status(`已恢复 ${count} 题的题库答案，请核对后点击平台“提交考核”。`);
    }),row);fill.disabled=!known||Boolean(storageError)||practiceFilling;
    const submit=button('恢复答案并提交当前考核',()=>withPracticeLock(async()=>{
      if(practiceSubmittedHash===pageHash)throw new Error('本节已发起提交，请等待平台结果；需要重试时请刷新页面');
      const target=nativeAssessmentSubmit();
      if(!target)throw new Error('当前页面未找到可用的“提交考核”按钮，请打开可作答的小节考核页。');
      const {count,plans}=await fillPracticeAnswers(questions,{complete:true,pageHash});
      if(typeof win.confirm!=='function')throw new Error('浏览器确认框不可用，已恢复答案，请手动点击平台提交');
      if(!win.confirm(`已恢复“${context.title||context.courseId}”的 ${count} 题。确认调用平台原有“提交考核”按钮补提交吗？`)){status(`已恢复 ${count} 题，未提交。`);return;}
      const fresh=freshPracticeQuestions(questions,pageHash);
      if(fresh.some((q,i)=>q.issue||!sameSet(q.selected,plans[i].answers)))throw new Error('选中答案发生变化，未提交');
      if(nativeAssessmentSubmit()!==target)throw new Error('平台提交按钮发生变化，未提交');
      practiceSubmittedHash=pageHash;
      target.click();status(`已恢复 ${count} 题并提交平台原有考核，请等待平台结果。`);
    }),row);submit.disabled=Boolean(storageError)||practiceFilling||practiceSubmittedHash===pageHash;
    button('保存本页当前选择',()=>{
      let count=0;for(const q of freshPracticeQuestions(questions,pageHash)){if(q.issue||!q.selected.length)continue;savePracticeDraft(q);count++;}
      if(!count)throw new Error('当前页面还没有已选答案');
      status(`已保存 ${count} 题的当前选择，下次打开本小节可恢复。`);
    },row).disabled=Boolean(storageError)||practiceFilling;
  }
  function renderQuestions(questions,{exam=false}={}){
    if(exam){
      body.append(el('div','考试辅助 · 本地题库查题','stem'),el('p','按题型、题干和完整选项文字查询全部题库。支持一键填入或逐题核对，交卷由你操作。','muted'));
      if(questions.length){
        const counts={confirmed:0,unconfirmed:0,conflict:0,unknown:0,unreadable:0};
        for(const q of questions)counts[q.issue?'unreadable':lookup(q).status]++;
        body.append(el('div',`已确认 ${counts.confirmed} · 待核验 ${counts.unconfirmed} · 冲突 ${counts.conflict} · 未命中 ${counts.unknown} · 需人工阅读 ${counts.unreadable}`,'muted'));
      }
    }
    if(!questions.length){body.append(el('p',exam?'当前未读到题目。考试列表不含题目；打开试卷后，助手会识别已加载的文字选择题。若题目已显示但仍无识别结果，需要适配该页结构。':'等待题目加载。请在平台打开分类练习或配套练习。','empty'));return;}
    body.append(el('div',`当前页面 ${questions.length} 题 · 不代表题库覆盖数`,'muted'));
    if(!exam)renderPracticeRecovery(questions);
    if(exam){
      renderExamFill(questions);
      const filters=el('div',undefined,'row');body.append(filters);
      for(const [value,label] of [['all','全部'],['fillable','可填选'],['unknown','未命中'],['conflict','冲突 / 人工阅读']]){
        const control=button(label,()=>{examFilter=value;questionPage=0;},filters);control.setAttribute('aria-pressed',String(examFilter===value));
      }
      questions=questions.filter(q=>examFilter==='all'||(examFilter==='conflict'?(q.issue||lookup(q).status==='conflict'):examFilter==='unknown'?(!q.issue&&lookup(q).status==='unknown'):(!q.issue&&['confirmed','unconfirmed'].includes(lookup(q).status))));
      if(!questions.length)body.append(el('p','当前筛选没有题目。','empty'));
    }
    if((exam||paperRoute(win.location.hash))&&questions.length>20){
      const total=Math.ceil(questions.length/20);questionPage=Math.min(questionPage,total-1);
      const row=el('div',undefined,'row');body.append(row);
      const previous=button('上一组',()=>{questionPage--;},row);previous.disabled=questionPage===0;
      row.append(el('span',`预览 ${questionPage+1}/${total} 组${exam?'（每组 20 题）':'（不影响整卷收录）'}`,'muted'));
      const next=button('下一组',()=>{questionPage++;},row);next.disabled=questionPage===total-1;
      questions=questions.slice(questionPage*20,(questionPage+1)*20);
    }
    for(const q of questions){
      const card=el('section',undefined,'card');body.append(card);
      const result=lookup(q);
      const labels={confirmed:'平台反馈已确认',unconfirmed:'参考答案待核验',unknown:'暂无答案',conflict:'答案来源冲突'};
      card.append(el('span',q.issue||labels[result.status],`badge ${q.issue||result.status==='conflict'?'warn':''}`),el('div',`${q.index+1}. ${q.stem||'无法识别题干'}`,'stem'));
      const categoryTitles=[...(categoriesByQuestion.get(q.key)??[])].map(id=>categoryEntries.get(id)?.title).filter(Boolean);
      if(categoryTitles.length)card.append(el('div',`类目：${[...new Set(categoryTitles)].join(' / ')}`,'muted'));
      if(!q.issue&&result.answers.length)card.append(el('div',result.answers.join('；'),'answer'));
      if(result.hits.length)card.append(el('div',[...new Set(result.hits.map(r=>r.source))].join(' / '),'muted'));
      if(!q.issue&&result.hits.length)renderEvidence(card,result);
      const row=el('div',undefined,'row');card.append(row);
      const pageHash=win.location.hash;
      if(exam)button('定位原题',()=>{
        const fresh=currentQuestions()[q.index];
        if(win.location.hash!==pageHash||fresh?.key!==q.key||fresh.box!==q.box)throw new Error('题目已切换，请重新识别');
        fresh.content.scrollIntoView?.({behavior:'smooth',block:'center'});
      },row);
      if(!q.issue && result.answers.length && result.status!=='conflict'&&!q.labels.some(label=>label.querySelector('input')?.disabled)){
        const fill=button(result.status==='confirmed'?'填入已确认答案':'填入参考答案',async()=>{
        if(examFiller.state().active||singleFilling)throw new Error('已有填入任务，请等待完成或停止。');
        singleFilling=true;updateExamFillControls();
        try{
        const freshQuestion=()=>{const live=win.location.hash===pageHash?currentQuestions()[q.index]:null;return live?.box===q.box&&!live.issue?live:null;};
        const fresh=freshQuestion();if(!fresh||fresh.key!==q.key)throw new Error('题目已切换，请重新识别');
        const latest=lookup(fresh);if(latest.status==='conflict'||!sameSet(latest.answers,result.answers))throw new Error('答案记录已变化，请重新核对');
        await applyAnswers(fresh,result.answers,()=>freshQuestion()?.key);status('已核对选中状态。请阅读后自行提交。');
        }finally{singleFilling=false;updateExamFillControls();}
      },row);fill.className='exam-single-fill';fill.disabled=examFiller.state().active||singleFilling;
      }
      if(!q.issue)button('记录当前选择',()=>{const fresh=currentQuestions()[q.index];if(!fresh||fresh.key!==q.key)throw new Error('题目已变化');add([makeRecord(fresh,fresh.selected,fresh.selected.length?'user':'pending','用户记录')]);status('已保存为待核验记录。');},row);
      if(result.status==='conflict'&&records.some(r=>r.key===q.key&&r.status!=='confirmed'))button('撤回本题参考记录',()=>{
        const removed=records.filter(r=>r.key===q.key&&r.status!=='confirmed');if(!removed.length)throw new Error('冲突来自平台确认记录，请人工核对，不自动覆盖');
        const previous=records;records=records.filter(r=>!removed.includes(r));try{save({remove:removed});undoRecords=removed;}catch(e){records=previous;throw e;}status('已撤回本题参考记录。可在本地题库中撤销。');
      },row);
    }
  }
  function renderEvidence(parent,result){
    const evidence=el('details');evidence.append(el('summary',result.status==='conflict'?'查看冲突答案与来源':'查看答案依据'));
    const seen=new Set();
    for(const record of result.hits){
      const id=JSON.stringify([record.source,record.answers,record.explanation]);if(seen.has(id))continue;seen.add(id);
      evidence.append(el('p',`${record.answers.join('；')||'暂无答案'} — ${record.source}`,'muted'));
      if(record.referenceId)evidence.append(el('div',`源记录：${record.evidence.flatMap(e=>e.recordIds).join('、')} · 文件历史状态仅作来源记录`,'muted'));
      if(record.explanation)evidence.append(el('p',record.explanation,'muted'));
    }
    parent.append(evidence);
  }
  function renderReference(){
    if(referenceError){body.append(el('p',referenceError,'warn'));return;}
    if(!reference.summary)return;
    const info=reference.summary,details=el('details',undefined,'reference-bank');body.append(details);
    details.append(el('summary',`综合题库 · ${info.questionCount} 题`));
    details.append(el('p',`可匹配 ${info.includedQuestionCount} 题 · 来源冲突 ${info.conflictQuestionCount} 题 · 需人工阅读 ${info.questionCount-info.includedQuestionCount} 题`,'muted'));
    details.append(el('p',`题库快照：${info.updatedAt?.replace('T',' ').replace('Z',' UTC')||'未知'}。综合题库与个人收录一起查询；文件答案显示为参考，冲突题不提供填选。`,'muted'));
    const row=el('div',undefined,'row'),query=el('input');query.type='search';query.placeholder='搜索题干或选项';query.setAttribute('aria-label','搜索综合题库');query.value=referenceQuery;row.append(query);details.append(row);
    const search=()=>{referenceQuery=query.value.trim();};button('搜索题库',search,row);
    query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();search();refresh(true);}};
    if(referenceQuery){
      const found=reference.search(referenceQuery,recordIndex);details.append(el('p',`找到 ${found.total} 条题目文字记录，显示前 ${found.questions.length} 条。搜索结果用于阅读，页面填选仍要求完整匹配。`,'muted'));
      for(const q of found.questions){const item=el('details'),result=lookup(q);item.append(el('summary',q.stem));q.options.forEach((option,i)=>item.append(el('div',`${String.fromCharCode(65+i)}. ${option}`,'muted')));item.append(el('p',q.issue?`需人工阅读：${q.issue}`:result.status==='conflict'?'答案存在冲突，请展开核对':result.answers.join('；')||'暂无答案','answer'));renderEvidence(item,q.issue?{status:'unknown',hits:[q]}:result);details.append(item);}
    }
  }
  function renderCourseBank(){
    if(!['catalog','course','practice'].includes(routeKind(win.location.hash)))return;
    const details=el('details',undefined,'course-bank');body.append(details);
    details.append(el('summary',`课程小节题库 · ${practiceBank.summary.courseCount} 小节 · ${practiceBank.summary.questionCount} 题`));
    details.append(el('p','2026-09-23 收录。答案来自本账号页面的逐题正确反馈，按课程编号对应。','muted'));
    for(const course of practiceBank.courses){
      const item=el('details');details.append(item);
      item.append(el('summary',`${course.title} · ${course.questions.length?course.questions.length+' 题':'无配套考核'}`));
      for(const q of course.questions){
        item.append(el('p',`${q.index}. ${q.stem}`,'stem'));
        q.options.forEach((option,i)=>item.append(el('div',`${String.fromCharCode(65+i)}. ${option}`,'muted')));
        item.append(el('p',`已通过答案：${q.answers.join('；')}`,'answer'));
      }
    }
    button('导出课程小节题库',()=>download('江南课程小节题库-20260923.json',JSON.stringify({format:'jnsa-course-practice-bank',version:1,collectedAt:'2026-09-23',...practiceBank.summary,courses:practiceBank.courses},null,2),'application/json;charset=utf-8'),details);
  }
  function renderCourseBatch(){
    if(!courseBatch)return;
    const state=courseBatch.state(),canStart=routeKind(win.location.hash)==='catalog'||Boolean(courseBatchRoute(win.location.hash));
    if(!canStart&&!state.active&&!state.canResume)return;
    const section=el('section',undefined,'card course-batch');body.append(section);
    section.append(el('div','20 小节一键答题与提交','stem'));
    section.append(el('p','自动逐节打开、填入已收录答案并提交；平台显示考核已通过后进入下一节。原已通过的小节和无考核小节会跳过。','muted'));
    const progress=el('progress');progress.max=state.total;progress.value=state.index;section.append(progress);
    section.append(el('div',`已处理 ${state.index}/${state.total}${state.active?' · '+state.title:''}`,'muted'));
    if(state.message)section.append(el('p',state.message,'muted'));
    const row=el('div',undefined,'row');section.append(row);
    const start=button(state.canResume?'继续剩余小节':state.phase==='completed'?'重新检查 20 个小节':'一键答题并提交 20 个小节',async()=>{
      if(storageError)throw new Error(storageError);
      if(practiceFilling||singleFilling||examFiller.state().active)throw new Error('请等待当前填选结束');
      stopPlayback();doc.querySelectorAll('video').forEach(v=>v.pause());
      collector.stop();categoryCollector.stop();pending=null;
      await courseBatch.start({resume:courseBatch.state().canResume});
    },row);start.disabled=state.busy||Boolean(storageError)||Boolean(state.error)||!canStart;
    const pause=button('暂停批量答题',()=>courseBatch.stop(),row);pause.disabled=!state.active;
    if(!canStart)section.append(el('p','返回学习中心后可继续。','muted'));
    if(state.results.length||state.pendingCourseId){
      button('导出处理记录',()=>download('江南小节批量处理记录.json',JSON.stringify(courseBatch.report(),null,2),'application/json;charset=utf-8'),section);
      const report=el('details');section.append(report);report.append(el('summary','查看处理结果'));
      const names={passed:'补提交后已通过','already-passed':'原已通过，已跳过','no-assessment':'归档无配套考核，已跳过'};
      state.results.forEach(item=>report.append(el('p',`${item.title}：${names[item.outcome]}`,'muted')));
    }
  }
  function renderCatalog(){
    const cards=readCatalog(doc);body.append(el('div',`当前页 ${cards.length} 门，清单 ${queue.length} 门`,'muted'));
    cards.forEach(c=>{const line=el('div',undefined,'card'),label=el('label'),check=el('input');check.type='checkbox';check.checked=queue.includes(c.title);check.onchange=()=>{if(check.checked)queue.push(c.title);else queue=queue.filter(t=>t!==c.title);};label.append(check,doc.createTextNode(c.title));line.append(label);body.append(line);});
    if(!cards.length)body.append(el('p','等待课程加载；必要时点击平台“查询”。','empty'));
    const row=el('div',undefined,'row');body.append(row);
    const autoLabel=el('label');const auto=el('input');auto.type='checkbox';auto.checked=autoAdvance;auto.onchange=()=>{autoAdvance=auto.checked;status(autoAdvance?'自动播放已开启：视频结束后直接进入下一门。':'自动播放已关闭。');};autoLabel.append(auto,doc.createTextNode('视频结束后自动播放下一门'));body.append(autoLabel);
    button('开始所选课程',async()=>{if(!queue.length)throw new Error('请先勾选课程');stopPlayback();active=true;currentCourse='';await openNext();},row);
    button('暂停清单',()=>{stopPlayback();doc.querySelectorAll('video').forEach(v=>v.pause());status('清单已暂停；再次开始需要你点击。');},row);
  }
  async function waitPlayback(probe,run,error){
    for(let i=0;i<80;i++){
      if(destroyed||run!==playbackRun)return null;
      const value=probe();if(value)return value;
      await sleep();
    }
    throw new Error(error);
  }
  function bindVideo(video){
    if(boundVideo===video)return;
    unbindVideo();boundVideo=video;
    const course=currentCourse,hash=win.location.hash;
    endedListener=()=>{
      if(!video.ended||!active||!autoAdvance||!course||course!==currentCourse||win.location.hash!==hash)return;
      unbindVideo();
      void goNextUnconditionally().catch(e=>{stopPlayback();status(e.message);});
    };
    video.addEventListener('ended',endedListener);
  }
  async function startVideo(run,title=''){
    let opened=false;
    const hash=win.location.hash;
    const video=await waitPlayback(()=>{
      if(win.location.hash!==hash)throw new Error('页面已切换，自动播放已暂停。');
      if(title&&normalize(readCourse(doc).title)!==normalize(title))return null;
      const videos=[...doc.querySelectorAll('video')].filter(visible);
      if(videos.length>1)throw new Error('出现多个播放器，请手动选择课程后继续。');
      if(videos.length===1)return videos[0];
      if(!opened){
        const study=[...doc.querySelectorAll('button')].find(e=>visible(e)&&textOf(e)==='学习'&&!e.disabled);
        if(study){opened=true;study.click();}
      }
      return null;
    },run,'等待播放器超时。请检查课程是否已加入学习，再点击“正常播放 / 继续”。');
    if(!video||run!==playbackRun)return;
    bindVideo(video);video.playbackRate=1;
    // Keep the native ended event and platform handlers intact.
    try{await video.play();}catch(e){stopPlayback();throw new Error(`浏览器未能开始播放，请点击“正常播放 / 继续”：${e.message}`);}
    if(run!==playbackRun){video.pause();return;}
    status(`正在正常播放${title?'：'+title:''}。${autoAdvance&&active?'视频结束后自动播放下一门。':'自动续播未开启。'}`);
  }
  async function openNext(){
    if(!active)return;
    if(!queue.length){active=false;status('所选清单已处理。');return;}
    const card=readCatalog(doc).find(c=>c.title===queue[0]);
    if(!card){active=false;status(`请在课程列表找到“${queue[0]}”所在页，再点击开始所选课程。`);return;}
    const run=playbackRun;
    currentCourse=card.title;card.card.click();status(`正在打开并播放：${currentCourse}`);
    try{
      const ready=await waitPlayback(()=>routeKind(win.location.hash)==='course'&&normalize(readCourse(doc).title)===normalize(currentCourse),run,'课程详情加载超时，清单已暂停。');
      if(ready)await startVideo(run,currentCourse);
    }catch(e){stopPlayback();throw e;}
  }
  async function goNextUnconditionally(){
    if(!queue.length){active=false;status('所选课程已全部播放。');return true;}
    queue=queue.filter(t=>t!==currentCourse);currentCourse='';
    if(!queue.length){active=false;status('所选课程已全部播放。');return true;}
    const run=playbackRun;
    // Close only the visible video dialog, once, before changing routes.
    const video=[...doc.querySelectorAll('video')].find(visible);
    video?.closest('.el-dialog')?.querySelector('.el-dialog__headerbtn')?.click();
    win.location.hash=BASE+'learningCenter';
    status(`当前视频已结束，准备下一门：${queue[0]}`);
    const ready=await waitPlayback(()=>routeKind(win.location.hash)==='catalog'&&readCatalog(doc).some(c=>c.title===queue[0]),run,`未找到下一门“${queue[0]}”，请找到对应课程页后重新开始。`);
    if(ready&&active)await openNext();
    return true;
  }
  async function play(){
    const kind=routeKind(win.location.hash);if(kind!=='course')throw new Error('请先进入课程详情');
    active=Boolean(currentCourse&&queue.includes(currentCourse));
    await startVideo(playbackRun,currentCourse);
  }
  function renderCourse(){
    const course=readCourse(doc),video=[...doc.querySelectorAll('video')].find(visible);
    body.append(el('div',course.title||'课程信息加载中','stem'),el('div',courseState(course,video?.ended),'badge'));
    body.append(el('p',`平台累计：${course.seconds??'待加载'} 秒 · 考核：${course.assessment||'待核验'}`,'muted'));
    if(video&&Number.isFinite(video.duration)){const progress=el('progress');progress.max=video.duration;progress.value=video.currentTime;body.append(progress,el('div',`视频 ${Math.floor(video.currentTime)} / ${Math.floor(video.duration)} 秒${video.paused?' · 已暂停':''}`,'muted'));}
    const row=el('div',undefined,'row');body.append(row);button('正常播放 / 继续',play,row);button('暂停',()=>{stopPlayback();doc.querySelectorAll('video').forEach(v=>v.pause());status('播放已暂停。');},row);
    const courseId=courseIdFromHash();
    const capturedCourse=practiceBank.course(courseId);
    if(capturedCourse&&!capturedCourse.questions.length)body.append(el('p','本小节收录时显示“考核 无”，没有习题需要补交。','muted'));
    if(courseId&&course.title&&(!capturedCourse||capturedCourse.questions.length))button('打开本节考核',()=>{
      win.location.hash=`${BASE}learningCenter/learning/${courseId}/learningExaming?learningMaterialName=${encodeURIComponent(course.title)}&learningMaterialId=${encodeURIComponent(courseId)}&isSuccess=false`;
      status('已打开本节考核页；等待题目加载后可恢复并提交。');
    },row);
    const autoLabel=el('label'),auto=el('input');auto.type='checkbox';auto.checked=autoAdvance;auto.onchange=()=>{autoAdvance=auto.checked;status(autoAdvance?'自动播放已开启：视频结束后直接进入下一门。':'自动播放已关闭。');};autoLabel.append(auto,doc.createTextNode('视频结束后自动播放下一门'));body.append(autoLabel);
    button('记录平台状态',()=>{if(!course.title||!course.learning)throw new Error('平台状态未加载完整，请稍后重试');const previous=history;history=[...history.filter(c=>c.title!==course.title),{...course,checkedAt:new Date().toISOString()}].slice(-100);try{save();}catch(e){history=previous;throw e;}status(`已记录：${courseState(course,video?.ended)}。`);},row);
  }
  function renderBank(){
    const allKeys=[...new Set(records.map(r=>r.key))],classified=allKeys.filter(questionKey=>categoriesByQuestion.has(questionKey)).length;
    const details=el('details',undefined,'personal-bank'),summary=el('summary',`本地题库与复习 · ${allKeys.length} 题 · 已归类 ${classified}`);details.append(summary);body.append(details);
    details.append(el('div',`已归类 ${classified}/${allKeys.length} 题 · 未归类 ${allKeys.length-classified} 题；一道题可属于多个类目。`,'muted'));
    const filters=el('div',undefined,'row'),filterLabel=el('label','查看 '),select=el('select');filters.append(filterLabel);filterLabel.append(select);details.append(filters);
    if(bankFilter.startsWith('category:')&&!categoryEntries.has(bankFilter.slice(9)))bankFilter='all';
    const option=(value,text)=>{const item=el('option',text);item.value=value;if(value===bankFilter)item.setAttribute('selected','');select.append(item);};
    option('all','全部题目');option('unclassified','未归类');categoryList().forEach(entry=>option(`category:${entry.id}`,`${entry.title}（${entry.questionKeys.length}/${entry.expectedCount}）`));
    select.onchange=()=>{bankFilter=select.value;refresh(true);};
    const row=el('div',undefined,'row');details.append(row);
    const input=el('input');input.type='file';input.accept='.json,.csv';input.className='hidden';details.append(input);
    button('导入题库',()=>input.click(),row);
    if(legacyStorage)button('合并旧版页面数据',()=>{
      if(storageError)throw new Error(storageError);
      const result=migrateSiteStorage(legacyStorage,storage,key,{force:true});
      setRecords(bankStorage.read().records);loadCategoryEntries(categoryStorage.readAll());
      status(`已合并旧版仍保留的 ${result.sourceRecords} 条记录；旧数据未删除。已清空的题目需从备份导入。`);
    },row);
    input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{
      if(file.size>5*1024*1024)throw new Error('文件不能超过 5 MB');
      const backup=importBackup(await file.text(),file.name.toLowerCase().endsWith('.csv')?'csv':'json');
      if(backup.records.length)add(backup.records);
      let importedCategories=0;
      if(backup.categories.length){const merged=categoryStorage.merge(backup.categories);merged.forEach(entry=>categoryEntries.set(entry.id,entry));rebuildCategoryIndex();importedCategories=merged.length;}
      status(`已导入 ${backup.records.length} 条记录${importedCategories?`和 ${importedCategories} 个类目索引`:''}；文件答案仍标记为待核验。`);refresh(true);
    }catch(e){status(`导入失败：${e.message}`);}};
    button('导出完整备份',()=>download(`jiangnan-bank-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,JSON.stringify({version:2,records,categories:categoryList()},null,2),'application/json'),row);
    button('导出 CSV',()=>download('jiangnan-bank.csv',exportCsv(records),'text/csv;charset=utf-8'),row);
    const selectedCategory=bankFilter.startsWith('category:')?categoryEntries.get(bankFilter.slice(9)):null;
    if(selectedCategory)button('导出当前类目',()=>{
      const keys=new Set(selectedCategory.questionKeys),name=selectedCategory.title.replace(/[\\/:*?"<>|]/g,'-');
      download(`jiangnan-category-${name}.json`,JSON.stringify({version:2,records:records.filter(record=>keys.has(record.key)),categories:[selectedCategory]},null,2),'application/json');
    },row);
    if(undoRecords.length)button('撤销上次撤回',()=>{add(undoRecords);undoRecords=[];status('已恢复上次撤回的记录。');},row);
    const review=el('div',undefined,'review');details.append(review);
    const shownKeys=bankFilter==='unclassified'?allKeys.filter(questionKey=>!categoriesByQuestion.has(questionKey)):selectedCategory?allKeys.filter(questionKey=>selectedCategory.questionKeys.includes(questionKey)):allKeys;
    for(const key of shownKeys.slice(-30).reverse()){
      const hits=recordIndex.get(key)??[],q=hits[0],m=matchQuestion(q,recordIndex),d=el('details');d.append(el('summary',q.stem));d.append(el('p',m.status==='conflict'?'答案存在冲突，请核对来源':m.answers.join('；')||'尚无答案','answer'));
      const titles=[...(categoriesByQuestion.get(key)??[])].map(id=>categoryEntries.get(id)?.title).filter(Boolean);if(titles.length)d.append(el('div',`类目：${[...new Set(titles)].join(' / ')}`,'muted'));
      hits.forEach(r=>{d.append(el('div',`${r.status} · ${r.source} · ${r.answers.join('；')||'待学习'}`,'muted'));if(r.explanation)d.append(el('p',r.explanation));});review.append(d);
    }
    if(!shownKeys.length)review.append(el('p','当前筛选下没有题目。','empty'));
    details.append(el('p',`当前筛选 ${shownKeys.length} 题，最多显示最近 30 题；完整备份包含全部答案记录和分类索引。导入答案仍需平台核验。`,'muted'));
    if(history.length){const hd=el('details');hd.append(el('summary',`课程核验记录 · ${history.length}`));history.slice().reverse().forEach(c=>hd.append(el('p',`${c.title}：${c.learning} / ${c.assessment||'待核验'}（${c.seconds??'-'} 秒）`,'muted')));body.append(hd);}
  }
  function captureSubmit(event){
    if(courseBatch?.state().active)return;
    if(routeKind(win.location.hash)==='exam'){
      const target=event.target.closest?.('button,[role="button"],input[type="submit"]');
      if(target&&/提交|交卷|结束考试/.test(textOf(target)||target.value||''))examFiller.stop('检测到交卷操作，已停止继续填入。');
      return;
    }
    if(collector?.state().active)return;
    if(routeKind(win.location.hash)!=='practice')return;
    const target=event.target.closest?.('button');
    if(!target||!['确定','提交练习','提交'].includes(textOf(target)))return;
    const questions=currentQuestions();
    if(readFeedback(doc,questions)){pending=null;return;}
    if(questions.length===1&&target.closest('form')!==questions[0].box.closest('form'))return;
    pending=questions.length===1&&!questions[0].issue&&questions[0].selected.length?{key:questions[0].key,answers:[...questions[0].selected],at:Date.now()}:null;
  }
  function capturePracticeSelection(event){
    if(routeKind(win.location.hash)!=='practice'||!event.target?.matches?.('input[type="radio"],input[type="checkbox"]'))return;
    const questions=currentQuestions();
    const question=questions.find(q=>q.labels.some(label=>label.contains(event.target)));
    if(question&&!question.issue)try{savePracticeDraft(question);}catch(e){status(`小节选择无法保存：${e.message}`);}
  }
  doc.addEventListener('click',captureSubmit,true);
  doc.addEventListener('change',capturePracticeSelection,true);
  const captureExamSubmit=()=>{if(routeKind(win.location.hash)==='exam')examFiller.stop('检测到交卷操作，已停止继续填入。');};
  doc.addEventListener('submit',captureExamSubmit,true);
  let stable='', stableAt=0;
  function refresh(force=false){
    if(!force&&(examFiller.state().active||practiceFilling))return;
    const kind=routeKind(win.location.hash),questions=currentQuestions();
    const paper=paperRoute(win.location.hash)?readPaper(doc,win.location.hash,questions):null;
    if(!collector?.state().active&&collectionRoute(win.location.hash)&&questions.length===1&&!questions[0].issue){
      const context=currentCategoryContext();
      if(context)try{observeCategoryQuestion(questions[0],context);}catch(e){storageError=`分类索引无法写入：${e.message}。专项整理已停止写入。`;status(storageError);}
    }
    if(pending){
      const q=questions[0];
      if(kind!=='practice'||questions.length!==1||q?.key!==pending.key||!sameSet(q.selected,pending.answers)||Date.now()-pending.at>30000)pending=null;
      else if(readFeedback(doc,questions)){
        try{add([feedbackRecord(q,readFeedback(doc,questions),pending.answers,demo)]);status('本次提交的正确反馈已归档。');}catch(e){status(e.message);}pending=null;
      }
    }
    const course=kind==='course'?readCourse(doc):null;
    const video=kind==='course'?[...doc.querySelectorAll('video')].find(visible):null;
    const signature=JSON.stringify([kind,questions.map(q=>[q.key,q.selected,q.issue]),paper?.signature,kind==='catalog'?readCatalog(doc).map(c=>c.title):null,kind==='practice-home'?readPracticeCategories(doc).map(c=>[c.title,c.count,Boolean(c.button)]):null,course,video?[Math.floor(video.currentTime/5),video.paused,video.ended]:null,records.length,categoryRevision,bankFilter,queue,history.length,questionPage,examFilter,referenceQuery]);
    if(signature!==stable){stable=signature;stableAt=Date.now();}
    if(!force && (signature===lastSignature||Date.now()-stableAt<600))return;
    // Keep expanded bank controls stable while the user operates them.
    if(!force && root.activeElement && body.contains(root.activeElement))return;
    lastSignature=signature;const bankOpen=body.querySelector('.personal-bank')?.open,referenceOpen=body.querySelector('.reference-bank')?.open,courseBankOpen=body.querySelector('.course-bank')?.open;body.replaceChildren();
    footer.textContent=(kind==='exam'?'考试辅助：填入答案后请核对，由你交卷。':paper?'整卷收录：保存题目 → 你提交练习 → 收录正确答案。':'分类练习可开启自动提交收录。')+(storage.independent?'题库使用脚本独立存储，请定期导出备份。':'题库在网站存储区，请定期备份。');
    renderCourseBatch();
    if(courseBatch?.state().active){footer.textContent='正在处理课程小节，可随时暂停；请保持当前页面打开。';return;}
    if(kind!=='exam')renderCategoryProgress();
    if(kind==='catalog')renderCatalog();else if(kind==='course')renderCourse();else if(kind==='practice'){if(collectionRoute(win.location.hash))renderCollection();if(paper)renderPaper(paper);renderQuestions(questions);}
    else if(kind==='exam')renderQuestions(questions,{exam:true});
    else if(kind==='practice-home')renderPracticeHome();
    else body.append(el('p','当前页面未启用助手。请打开学习中心、练习中心或考试中心。','empty'));
    renderCourseBank();renderReference();renderBank();if(bankOpen)body.querySelector('.personal-bank').open=true;if(referenceOpen&&body.querySelector('.reference-bank'))body.querySelector('.reference-bank').open=true;if(courseBankOpen&&body.querySelector('.course-bank'))body.querySelector('.course-bank').open=true;
  }
  collector=createPracticeCollector(win,{store:record=>add([record]),lookup:question=>matchQuestion(question,recordIndex),observeQuestion:observeCategoryQuestion,status,changed:()=>{if(!destroyed)refresh(true);},demo,sleep:scheduler.sleep});
  categoryCollector=createCategoryCollector(win,collector,{status,sleep:scheduler.sleep,changed:()=>{if(!destroyed)refresh(true);},categoryContext:ensureCategoryContext,completed:(title,count)=>{
    const k=normalize(title),old=completedCategories.get(k),oldPartial=partialCategories.get(k),selected=chosenCategories.has(title);
    completedCategories.set(k,count);partialCategories.delete(k);chosenCategories.delete(title);
    try{save();saveSelection();}catch(e){if(old===undefined)completedCategories.delete(k);else completedCategories.set(k,old);if(oldPartial)partialCategories.set(k,oldPartial);if(selected)chosenCategories.add(title);throw e;}
  },incomplete:result=>{
    const k=normalize(result.title),old=partialCategories.get(k);partialCategories.set(k,result);
    try{save();}catch(e){if(old)partialCategories.set(k,old);else partialCategories.delete(k);throw e;}
  }});
  courseBatch=createCourseBatch(win,{courses:practiceBank.courses,storage,key:key+'.courseBatch',status,saveAnswer:savePracticeDraft,sleep:scheduler.sleep,changed:()=>{if(!destroyed)refresh(true);}});
  const hashChange=()=>{pending=null;questionPage=0;courseBatch.routeChanged();if(!courseBatch.state().active)examFiller.stop('页面已切换，后续题目未填入。');if(categoryCollector.state().active)categoryCollector.routeChanged();else if(collector.state().active)collector.stop('页面已切换，自动收录已暂停。');lastSignature='';refresh(true);};win.addEventListener('hashchange',hashChange);
  const storageChange=event=>{
    if(event.key!==key&&event.key!==selectionKey&&!event.key?.startsWith(categoryStorage.prefix))return;
    try{
      if(event.key===key)setRecords(bankStorage.read().records);
      else if(event.key===selectionKey){const selected=readSavedSelection();if(selected!==null)applySavedSelection(selected);}
      else loadCategoryEntries(categoryStorage.readAll());
      refresh(true);
    }catch(e){storageError=`本地题库同步失败：${e.message}。已停止写入。`;collector.stop();categoryCollector.stop();status(storageError);}
  };
  const unsubscribe=storage.subscribe?storage.subscribe(storageChange):()=>win.removeEventListener('storage',storageChange);
  if(!storage.subscribe)win.addEventListener('storage',storageChange);
  const timer=win.setInterval(()=>{try{refresh();}catch(e){status(`已暂停识别：${e.message}`);}},900);
  refresh(true);
  return {refresh:()=>refresh(true),destroy(){destroyed=true;courseBatch.destroy();examFiller.stop('助手已关闭，填入已停止。');stopPlayback();categoryCollector.stop();collector.stop();scheduler.destroy();win.clearInterval(timer);win.removeEventListener('hashchange',hashChange);unsubscribe();doc.removeEventListener('click',captureSubmit,true);doc.removeEventListener('change',capturePracticeSelection,true);doc.removeEventListener('submit',captureExamSubmit,true);doc.removeEventListener('click',captureCategoryOpen,true);host.remove();},getRecords:()=>structuredClone(records),getCategories:()=>structuredClone(categoryList())};
}
