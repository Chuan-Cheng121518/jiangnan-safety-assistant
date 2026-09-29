import {routeKind,sameSet,normalize} from './core.js';
import {readQuestions,applyAnswers} from './adapter.js';

// The whole visible paper is fixed at start. A replacement question, reordered
// options or new paper must never receive clicks from the old operation.
function sameExamQuestion(a,b){
  return a?.key===b?.key&&a.box===b.box&&a.labels.length===b.labels.length&&
    a.labels.every((label,i)=>label===b.labels[i]&&label.querySelector('input')===b.inputs[i]&&normalize(a.options[i])===normalize(b.options[i]));
}
const examSnapshot=q=>({...q,inputs:q.labels.map(label=>label.querySelector('input'))});

export function examFillSummary(state){
  const title=state.active?(state.cancelRequested?'正在停止':'正在填入'):state.stage==='complete'?'填入完成':'填入已停止';
  const counts=`已处理 ${state.processed}/${state.total} 题 · 填入 ${state.filled} · 保留 ${state.kept} · 跳过 ${state.skipped}`;
  const reasons=Object.entries(state.skippedReasons).map(([reason,count])=>`${reason} ${count}`).join('，');
  return `${title}：${counts}${reasons?`\n跳过原因：${reasons}`:''}${state.reason?`\n${state.reason}`:''}${state.active?'':'\n请核对答案后自行交卷。'}`;
}

export function createExamFiller(win,{lookup,changed=()=>{},apply=applyAnswers}={}){
  let state={active:false,cancelRequested:false,stage:'idle',total:0,processed:0,filled:0,kept:0,skipped:0,skippedReasons:{},reason:''};
  const snapshot=()=>({...state,skippedReasons:{...state.skippedReasons}});
  const notify=()=>changed(snapshot());
  const stop=(reason='你已停止填入；正在处理的题目请手动核对。')=>{
    if(!state.active||state.cancelRequested)return;
    state.cancelRequested=true;state.reason=reason;notify();
  };
  async function start({overwrite=false,expectedHash=win.location.hash,expectedQuestions=null}={}){
    if(state.active)throw new Error('正在填入，请等待完成或停止。');
    const hash=win.location.hash,questions=readQuestions(win.document).map(examSnapshot);
    if(routeKind(hash)!=='exam'||hash!==expectedHash||!questions.length)throw new Error('考试页面已变化，请重新识别。');
    if(expectedQuestions&&(questions.length!==expectedQuestions.length||questions.some((q,i)=>!sameExamQuestion(q,examSnapshot(expectedQuestions[i])))))throw new Error('试卷题目已变化，请重新识别。');
    state={active:true,cancelRequested:false,stage:'running',total:questions.length,processed:0,filled:0,kept:0,skipped:0,skippedReasons:{},reason:''};
    notify();
    const checkPaper=()=>{
      if(state.cancelRequested)throw new Error(state.reason);
      if(win.location.hash!==hash||routeKind(win.location.hash)!=='exam')throw new Error('页面已切换，后续题目未填入。');
      const live=readQuestions(win.document);
      if(live.length!==questions.length||live.some((q,i)=>!sameExamQuestion(q,questions[i])))throw new Error('试卷题目或选项已变化，后续题目未填入。');
      return live;
    };
    let currentIndex=-1;
    try{
      for(let i=0;i<questions.length;i++){
        currentIndex=i;
        const q=checkPaper()[i],result=lookup(q);
        const disabled=q.labels.some(label=>!label.querySelector('input')||label.querySelector('input').disabled||label.classList.contains('is-disabled'));
        const skip=q.issue?'需人工阅读':disabled?'选项不可操作':result.status==='conflict'?'答案冲突':!['confirmed','unconfirmed'].includes(result.status)||!result.answers?.length?'未命中':'';
        if(skip){state.skipped++;state.skippedReasons[skip]=(state.skippedReasons[skip]||0)+1;}
        // Even overwrite mode preserves a choice changed by the user since start.
        else if((!overwrite&&q.selected.length)||!sameSet(q.selected,questions[i].selected)||sameSet(q.selected,result.answers))state.kept++;
        else{
          await apply(q,result.answers,()=>{
            const live=checkPaper()[i],latest=lookup(live);
            if(live.issue||latest.status==='conflict'||!sameSet(latest.answers,result.answers))throw new Error('答案依据或题目状态已变化，请重新核对。');
            if(live.labels.some(label=>label.querySelector('input')?.disabled||label.classList.contains('is-disabled')))throw new Error('选项已禁用，请手动核对。');
            return live.key;
          });
          state.filled++;
        }
        state.processed++;notify();
        // Give the page a chance to process Stop, navigation or manual changes.
        await new Promise(resolve=>win.setTimeout(resolve,0));
      }
      checkPaper();state.stage='complete';
    }catch(error){
      state.stage='stopped';state.reason=`${error.message}${currentIndex>=0?` 请核对第 ${currentIndex+1} 题。`:''}`;
    }finally{state.active=false;notify();}
    return snapshot();
  }
  return {start,stop,state:snapshot};
}
