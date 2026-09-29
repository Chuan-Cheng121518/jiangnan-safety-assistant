import {BASE,normalize,questionKey,sameSet,routeKind} from './core.js';
import {readCourse,readQuestions,applyAnswers,visible,textOf} from './adapter.js';

export function courseBatchRoute(hash){
  const raw=String(hash).replace(/^#/,''),[path,query='']=raw.split('?');
  const match=path.match(/^\/education\/eductionTrainingCenter\/learningCenter\/learning\/([^/]+)(\/learningExaming)?$/);
  if(!match)return null;
  const supplied=new URLSearchParams(query).get('learningMaterialId');
  if(supplied&&supplied!==match[1])return null;
  return {id:match[1],assessment:Boolean(match[2])};
}
export function courseBatchHash(course,assessment=false){
  const detail='#'+BASE+'learningCenter/learning/'+encodeURIComponent(course.courseId);
  return assessment?`${detail}/learningExaming?learningMaterialId=${encodeURIComponent(course.courseId)}&learningMaterialName=${encodeURIComponent(course.title)}&isSuccess=false`:detail;
}
export function courseSubmitButton(doc){
  const matches=[...doc.querySelectorAll('button,input[type="submit"]')].filter(el=>visible(el)&&!el.disabled&&!el.classList.contains('is-disabled')&&normalize(textOf(el)||el.value)==='提交考核');
  return matches.length===1?matches[0]:null;
}
export function courseAnswerPlan(course,questions){
  if(questions.length!==course.questions.length||!questions.length)throw new Error('本节题目数量与已收录记录不一致');
  const keys=course.questions.map(questionKey);
  if(!sameSet(keys,questions.map(q=>q.key)))throw new Error('题干或选项已变化，需重新收录本节答案');
  return questions.map(q=>{
    if(q.issue)throw new Error(q.issue);
    const hits=course.questions.filter(item=>questionKey(item)===q.key);
    if(hits.length!==1||!hits[0].answers.length||!hits[0].answers.every(a=>q.options.some(o=>normalize(o)===normalize(a))))throw new Error('本节答案不完整或不能唯一匹配');
    if(q.labels.some(label=>!label.querySelector('input')||label.querySelector('input').disabled||label.classList.contains('is-disabled')))throw new Error('本节选项已禁用，无法答题');
    return [...hits[0].answers];
  });
}

// Uses only visible course pages and their native submit button. A durable
// intent is written before clicking so reloads never blindly replay a submit.
export function createCourseBatch(win,{courses,storage,key='jnsa.bank.v1.courseBatch',status=()=>{},changed=()=>{},saveAnswer=()=>{},sleep=ms=>new Promise(resolve=>win.setTimeout(resolve,ms)),pollMs=250,timeoutMs=25000,resultTimeoutMs=60000,submitDelayMs=1000,courseDelayMs=1200,clickDelayMs=80}={}){
  const doc=win.document,ids=courses.map(c=>c.courseId),lockKey=key+'.lock';
  if(!ids.length||new Set(ids).size!==ids.length)throw new Error('小节清单无效');
  let active=false,busy=false,destroyed=false,generation=0,expectedHash='',allowReturn=false;
  let index=0,results=[],pendingCourseId='',phase='idle',message='',loadError='',owner='',heartbeat=0;
  const stamp=()=>new Date().toISOString();
  const snapshot=()=>({version:1,courseIds:ids,index,results:results.map(r=>({...r})),pendingCourseId,phase,message,updatedAt:stamp()});
  const state=()=>({...snapshot(),active,busy,total:courses.length,title:courses[index]?.title||'',canResume:phase==='paused'&&index<courses.length,error:loadError});
  function load(){
    const raw=storage.getItem(key);if(raw===null)return;
    const saved=JSON.parse(raw);
    if(saved?.version!==1||JSON.stringify(saved.courseIds||[])!==JSON.stringify(ids)||!Number.isInteger(saved.index)||saved.index<0||saved.index>ids.length||!Array.isArray(saved.results)||saved.results.length!==saved.index||saved.results.some((r,i)=>r.courseId!==ids[i]||!['passed','already-passed','no-assessment'].includes(r.outcome))||(saved.pendingCourseId&&saved.pendingCourseId!==ids[saved.index]))throw new Error('小节进度记录不完整，请先导出检查');
    index=saved.index;results=saved.results;pendingCourseId=saved.pendingCourseId||'';
    phase=index===ids.length?'completed':'paused';
    message=phase==='completed'?'上次已检查全部小节。':pendingCourseId?'上次已提交，继续时先核验平台结果，不重复提交。':'已恢复上次进度，点击继续剩余小节。';
  }
  try{load();}catch(error){loadError=error.message;message=loadError;}
  function readLock(){const raw=storage.getItem(lockKey);return raw===null?null:JSON.parse(raw);}
  function ownLock(){const lock=readLock();if(!owner||lock?.owner!==owner)throw new Error('队列已在其它页面运行，本页停止操作');}
  function acquire(){
    const lock=readLock();if(lock?.owner&&lock.expires>Date.now())throw new Error('另一个页面正在处理小节，请先在该页面暂停');
    owner=`${Date.now()}:${Math.random()}`;heartbeat=Date.now();storage.setItem(lockKey,JSON.stringify({owner,expires:heartbeat+90000}));
  }
  function release(){try{if(owner&&readLock()?.owner===owner)storage.setItem(lockKey,JSON.stringify({owner:'',expires:0}));}catch{}owner='';}
  function save(){ownLock();storage.setItem(key,JSON.stringify(snapshot()));}
  function announce(text){message=text;status(text);changed();}
  function stop(text='已暂停，已处理的小节保留。'){
    if(!active)return;
    active=false;generation++;phase='paused';message=text;
    try{save();}catch(error){message+=` 进度保存失败：${error.message}`;}
    release();status(message);changed();
  }
  function navigationAllowed(){
    if(win.location.hash===expectedHash)return true;
    const route=courseBatchRoute(win.location.hash);
    return allowReturn&&route?.id===courses[index]?.courseId&&!route.assessment;
  }
  function routeChanged(){if(active&&!navigationAllowed())stop('页面已手动切换或登录失效，批量答题已暂停。');}
  async function start({resume=false}={}){
    if(active||busy||destroyed)throw new Error('请等待当前队列停止后再启动');
    if(loadError)throw new Error(loadError);
    if(routeKind(win.location.hash)!=='catalog'&&!courseBatchRoute(win.location.hash))throw new Error('请在学习中心或课程页面启动');
    acquire();
    try{load();}catch(error){release();throw error;}
    if(pendingCourseId&&!resume){release();throw new Error('有一节提交结果待核验，请点击继续剩余小节');}
    if(!resume){index=0;results=[];pendingCourseId='';}
    if(index>=courses.length){release();return state();}
    active=true;busy=true;phase='starting';expectedHash=win.location.hash;allowReturn=false;const run=++generation;
    const check=()=>{
      if(destroyed||!active||run!==generation)throw new Error('cancelled');
      ownLock();
      if(Date.now()-heartbeat>10000){heartbeat=Date.now();storage.setItem(lockKey,JSON.stringify({owner,expires:heartbeat+90000}));}
      if(!navigationAllowed())throw new Error('页面已切换或登录失效');
    };
    const wait=async(probe,error,limit=timeoutMs)=>{
      const deadline=Date.now()+limit;
      for(;;){check();const value=probe();if(value)return value;if(Date.now()>=deadline)throw new Error(error);await sleep(pollMs);}
    };
    const navigate=(hash,nextPhase)=>{check();expectedHash=hash;allowReturn=false;phase=nextPhase;win.location.hash=hash;};
    const finish=(course,outcome)=>{
      check();results.push({courseId:course.courseId,title:course.title,outcome,at:stamp()});pendingCourseId='';index++;save();changed();
    };
    try{
      save();announce(`开始处理 ${courses.length} 个小节，已处理 ${index} 个。`);
      // Let simultaneous starts settle before any navigation or submission.
      await sleep(pollMs);check();
      while(index<courses.length){
        const course=courses[index];
        if(!course.questions.length){finish(course,'no-assessment');continue;}
        announce(`${index+1}/${courses.length} · 检查：${course.title}`);
        navigate(courseBatchHash(course),'checking');
        await sleep(pollMs);check();
        const detail=await wait(()=>{
          const route=courseBatchRoute(win.location.hash),value=readCourse(doc);
          if(!route||route.assessment||route.id!==course.courseId||normalize(value.title)!==normalize(course.title))return null;
          return value.assessment?value:null;
        },'课程状态未加载完整或课程名称已变化');
        if(detail.assessment==='已通过'){finish(course,pendingCourseId?'passed':'already-passed');}
        else{
          if(pendingCourseId)throw new Error('本节上次已发起提交，但平台仍未确认通过；请核对平台记录后再继续，脚本不会重复提交');
          navigate(courseBatchHash(course,true),'opening');
          announce(`${index+1}/${courses.length} · 打开考核：${course.title}`);
          let stable='',samples=0;
          const questions=await wait(()=>{
            const qs=readQuestions(doc);
            if(qs.length!==course.questions.length){stable='';samples=0;return null;}
            const signature=JSON.stringify(qs.map(q=>[q.key,q.issue]));
            if(signature!==stable){stable=signature;samples=0;}
            if(++samples<2)return null;
            courseAnswerPlan(course,qs);
            return courseSubmitButton(doc)?qs:null;
          },'本节题目或提交按钮未加载完整，未提交');
          const answers=courseAnswerPlan(course,questions);
          const fresh=()=>{
            check();const live=readQuestions(doc);
            if(live.length!==questions.length||live.some((q,i)=>q.key!==questions[i].key||q.box!==questions[i].box||q.labels.some((label,n)=>label!==questions[i].labels[n])))throw new Error('题目已变化，停止填选');
            courseAnswerPlan(course,live);return live;
          };
          phase='filling';announce(`${index+1}/${courses.length} · 恢复 ${questions.length} 题：${course.title}`);
          for(let q=0;q<questions.length;q++){
            await applyAnswers(fresh()[q],answers[q],()=>fresh()[q].key,{clickDelayMs,sleep});
            check();saveAnswer(fresh()[q]);
          }
          await sleep(submitDelayMs);check();
          if(fresh().some((q,i)=>!sameSet(q.selected,answers[i])))throw new Error('选中答案已改变，未提交');
          const target=courseSubmitButton(doc);if(!target)throw new Error('未找到唯一可用的提交考核按钮');
          pendingCourseId=course.courseId;phase='verifying';save();
          allowReturn=true;check();target.click();
          announce(`${index+1}/${courses.length} · 已提交，等待平台确认：${course.title}`);
          await wait(()=>{
            const route=courseBatchRoute(win.location.hash);
            if(!route||route.assessment||route.id!==course.courseId)return null;
            const value=readCourse(doc);
            return normalize(value.title)===normalize(course.title)&&value.assessment==='已通过'?value:null;
          },'已提交，但未等到课程详情显示考核已通过；已停止，未重复提交',resultTimeoutMs);
          expectedHash=win.location.hash;allowReturn=false;finish(course,'passed');
        }
        if(index<courses.length){phase='waiting';await sleep(courseDelayMs);check();}
      }
      phase='completed';save();active=false;release();
      const passed=results.filter(r=>r.outcome==='passed').length,already=results.filter(r=>r.outcome==='already-passed').length,none=results.filter(r=>r.outcome==='no-assessment').length;
      announce(`已处理 ${results.length}/${courses.length} 个小节：补提交并通过 ${passed}，原已通过 ${already}，无配套考核 ${none}。`);
    }catch(error){if(run===generation)stop(`批量答题已暂停：${error.message}。`);}
    finally{busy=false;if(!destroyed)changed();}
    return state();
  }
  return {state,start,stop,routeChanged,report:()=>snapshot(),destroy(){stop('页面已关闭，队列暂停；下次点击继续。');destroyed=true;}};
}
