import {BASE,makeRecord,sameSet} from './core.js';
import {readQuestions,readFeedback,readPracticeEnd,applyAnswers,visible,textOf} from './adapter.js';

export function collectionRoute(hash) {
  return String(hash).replace(/^#/, '').split('?')[0]===BASE+'practiceCenter/practiceClass';
}

export function feedbackRecord(q,feedback,selected,demo=false) {
  if(q.issue||feedback.issue)throw new Error(q.issue||feedback.issue);
  const answers=feedback.correct?selected:feedback.answers;
  if(!answers?.length)throw new Error('反馈没有可保存的答案');
  return makeRecord(q,answers,'confirmed',`${demo?'本地演示反馈':'江南大学练习页面'}：${feedback.correct?'回答正确':'显示正确答案'}`,feedback.correct?'本次提交后页面显示：回答正确。':feedback.raw);
}

// Count scheduled polling time, not time the browser suspended this task.
// Always inspect the page after waking, including the final timeout sample.
class PracticeWaitTimeout extends Error {}
export async function waitForPracticeState(win,check,probe,{pollMs,timeoutMs,sleep=ms=>new Promise(resolve=>win.setTimeout(resolve,ms))},message) {
  let remaining=timeoutMs;
  while(true){
    check();const result=probe();if(result)return result;
    if(remaining<=0)throw new PracticeWaitTimeout(typeof message==='function'?message():message);
    const interval=Math.min(pollMs,remaining);
    await sleep(interval);
    remaining-=interval;
  }
}

export function createPracticeCollector(win,{store,status,changed=()=>{},lookup=()=>({status:'unknown',answers:[]}),observeQuestion=()=>{},demo=false,pollMs=250,timeoutMs=15000,feedbackGraceMs=60000,readMs=6000,optionMs=1000,submitMs=2000,reviewMs=5000,resetWaitMs=1500,noProgressLimit=30,sleep=ms=>new Promise(resolve=>win.setTimeout(resolve,ms))}={}) {
  const doc=win.document;
  if(!Number.isInteger(noProgressLimit)||noProgressLimit<1)throw new Error('无新增上限应为正整数');
  let active=false,generation=0,completed=0,processed=0,limit=20,noNew=0;
  let checkpoint=null;
  const state=()=>({active,completed,processed,limit,noNew,noProgressLimit,canResume:!active&&Boolean(checkpoint)&&checkpoint.hash===win.location.hash});
  const delay=sleep;
  function stop(message='自动收录已暂停。') {
    active=false;generation++;checkpoint=null;status(message);changed();
  }
  async function start(maximum=20,context=null,resuming=false) {
    if(active)return;
    if(resuming&&!state().canResume)throw new Error('原提交现场已变化，无法继续等待反馈');
    if(!resuming&&checkpoint)throw new Error('上次提交结果待确认，请使用继续收录，不能重新提交');
    if(!Number.isInteger(maximum)||maximum<1||maximum>20000)throw new Error('目标题数应为 1～20000 的整数');
    if(!collectionRoute(win.location.hash))throw new Error('请先在练习中心打开分类练习');
    const hash=win.location.hash,run=++generation;
    const categoryContext=resuming?checkpoint.context:context;
    if(categoryContext&&(!Array.isArray(categoryContext.knownKeys)||categoryContext.knownKeys.some(key=>typeof key!=='string'||!key)))throw new Error('类目已有题目索引格式不正确');
    const seen=resuming?checkpoint.seen:new Map([...(new Set(categoryContext?.knownKeys??[]))].map(key=>[key,null]));
    if(seen.size>maximum)throw new Error('类目已归类题数超过平台显示题数，请重新读取类目');
    let pendingSubmission=resuming?checkpoint.pendingSubmission:null;
    active=true;if(!resuming){completed=seen.size;processed=0;noNew=0;limit=maximum;}changed();
    const check=()=>{
      if(!active||generation!==run)throw new Error('cancelled');
      if(win.location.hash!==hash||!collectionRoute(win.location.hash))throw new Error('页面已切换，收录已暂停');
    };
    const question=()=>{
      check();const qs=readQuestions(doc);
      if(qs.length!==1)throw new Error('当前不是单题分类练习，收录已暂停');
      if(qs[0].issue)throw new Error(qs[0].issue);
      return qs[0];
    };
    const wait=(probe,message)=>waitForPracticeState(win,check,probe,{pollMs,timeoutMs,sleep},message);
    const pause=async(ms,message)=>{check();if(ms>0){status(message);await delay(ms);}check();};
    const observe=q=>{if(categoryContext)observeQuestion(q,categoryContext);};
    const finishPartial=(reason,detail)=>{
      check();active=false;checkpoint=null;status(`待补充：已收录不同题 ${completed}/${limit}；${detail}。已保存答案保留。`);changed();
      return {reason,completed,processed,detail};
    };
    const control=(q,name)=>{
      const form=q.box.closest('form');
      const matches=[...(form?.querySelectorAll('button')||[])].filter(b=>visible(b)&&textOf(b)===name&&!b.disabled&&!b.classList.contains('is-disabled'));
      if(matches.length!==1)throw new Error(`找不到唯一可用的“${name}”按钮，已暂停`);
      return matches[0];
    };
    const advance=async(q)=>{
      check();if(question().key!==q.key)throw new Error('题目已切换，收录已暂停');
      control(q,'下一题').click();
      let stableKey='',samples=0,stableSince=0,lastReason='等待页面更新',endSamples=0;
      const answerable=fresh=>fresh&&!fresh.issue&&fresh.labels.every(label=>{
        const input=label.querySelector('input');
        return input&&!input.disabled&&!label.classList.contains('is-disabled');
      })&&[...(fresh.box.closest('form')?.querySelectorAll('button')||[])].filter(b=>visible(b)&&textOf(b)==='确定'&&!b.disabled&&!b.classList.contains('is-disabled')).length===1;
      try { return await wait(()=>{
        const ending=readPracticeEnd(doc);
        if(ending)return ++endSamples>=2?{ended:true,detail:ending}:null;
        endSamples=0;
        const qs=readQuestions(doc);
        const fresh=qs[0];
        const ready=answerable(fresh);
        lastReason=qs.length!==1?`识别到 ${qs.length} 道题`:fresh.issue||
          (!ready?'答题控件尚未就绪':readFeedback(doc,qs)?'旧反馈尚未消失':fresh.key===q.key&&fresh.selected.length?'同题选项尚未清空':'');
        if(lastReason){stableKey='';samples=0;return null;}
        const signature=JSON.stringify([fresh.key,[...fresh.selected].sort()]);
        if(signature!==stableKey){stableKey=signature;samples=0;stableSince=Date.now();}
        // The platform can reset to an unselected copy of the same question.
        // Allow that state only after a settling delay; unchanged feedback never retries.
        if(fresh.key===q.key&&Date.now()-stableSince<resetWaitMs)return null;
        return ++samples>=2?qs[0]:null;
      },()=>`下一题未恢复到可答题状态（${lastReason||'等待题目稳定'}），已暂停；不会重试未确认的提交`);
      } catch(e) {
        check();
        // Only a completed next-question transition back to the same selected
        // question is recoverable. Submission, storage and unknown-page errors
        // remain fatal. Do not submit the ambiguous repeated question again.
        const qs=readQuestions(doc),fresh=qs[0];
        if(e instanceof PracticeWaitTimeout&&qs.length===1&&answerable(fresh)&&fresh.key===q.key&&fresh.selected.length&&!readFeedback(doc,qs))
          return {stalled:true,detail:'换题后仍为同一道已选题，已保留答案并跳过当前类目，等待回补'};
        throw e;
      }
    };
    try {
      if(completed>=limit){active=false;checkpoint=null;status(`本类已有 ${completed}/${limit} 题完成归类，无需重复提交。`);changed();return {reason:'limit',completed,processed};}
      let q=question();
      observe(q);
      // An already visible result cannot be attributed to a fresh submission.
      if(!pendingSubmission&&readFeedback(doc,[q])){await pause(reviewMs,`已有反馈，等待 ${reviewMs/1000} 秒后进入下一题。`);q=await advance(q);}
      if(q.ended)return finishPartial('platform-end',q.detail);
      if(q.stalled)return finishPartial('transition-stalled',q.detail);
      // Repeated submissions cannot prove coverage of a category. Keep a
      // separate occurrence count and continue until unique coverage matches.
      while(completed<limit){
        check();q=question();observe(q);
        const previouslySeen=seen.has(q.key),previous=seen.get(q.key);
        const existing=lookup(q),known=existing?.status==='confirmed'&&Array.isArray(existing.answers)?existing.answers:[];
        const trusted=Array.isArray(previous)&&previous.length?previous:known;
        if(!pendingSubmission){
        if(readFeedback(doc,[q]))throw new Error('提交前存在旧反馈，已暂停');
        await pause(readMs,`不同题 ${completed}/${limit}：等待 ${readMs/1000} 秒后选择答案，可随时暂停。`);
        const ready=question();
        if(ready.key!==q.key||readFeedback(doc,[ready]))throw new Error('等待期间题目或反馈已变化，已暂停');
        q=ready;
        status(trusted.length?`${previouslySeen?'遇到已归类题':'命中旧题库'}，复用平台已确认答案并等待反馈复核；不同题 ${completed}/${limit}，已处理 ${processed} 题次。`:`自动收录 ${completed}/${limit}：暂无可信答案，选择首个选项并等待平台答案。`);
        const answers=trusted.length?trusted:[q.options[0]];
        await applyAnswers(q,answers,()=>active&&generation===run&&win.location.hash===hash?readQuestions(doc)[0]?.key:null,{clickDelayMs:optionMs,sleep});
        await pause(submitMs,`选项已填好，等待 ${submitMs/1000} 秒后提交，可随时暂停。`);
        check();const submitted=question();
        if(submitted.key!==q.key)throw new Error('题目已切换，停止提交');
        const selected=[...submitted.selected];
        if(!sameSet(selected,answers))throw new Error('等待期间选项改变，已暂停，未提交');
        const submit=control(submitted,'确定');
        if(readFeedback(doc,[submitted]))throw new Error('提交前出现了其他反馈，已暂停');
        pendingSubmission={submitted,selected};
        submit.click(); // One click only; a timeout never retries the submission.
        }
        const {submitted,selected}=pendingSubmission;
        const probeFeedback=()=>{
          const current=question();
          if(current.key!==submitted.key||!sameSet(current.selected,selected))throw new Error('提交后题目或选择改变，无法关联反馈');
          return readFeedback(doc,[current]);
        };
        let feedback;
        try { feedback=await wait(probeFeedback,'等待平台答案超时'); }
        catch(e){
          if(!(e instanceof PracticeWaitTimeout))throw e;
          check();status(`平台反馈较慢，继续等待最多 ${feedbackGraceMs/1000} 秒；不会重复提交。`);changed();
          try { feedback=await waitForPracticeState(win,check,probeFeedback,{pollMs,timeoutMs:feedbackGraceMs,sleep},'等待平台答案超时'); }
          catch(late){
            if(!(late instanceof PracticeWaitTimeout))throw late;
            checkpoint={hash,seen,pendingSubmission,context:categoryContext};active=false;
            status(`等待平台答案超时，已暂停并保留进度；反馈出现后可继续收录，不会重复提交。`);changed();
            return {reason:'feedback-timeout',completed,processed,error:'等待平台答案超时'};
          }
        }
        check();const record=feedbackRecord(submitted,feedback,selected,demo);
        store(record);
        if(trusted.length&&!sameSet(trusted,record.answers))throw new Error('旧题库答案与最新平台反馈发生冲突，已保留两份来源并暂停');
        processed++;if(!previouslySeen){completed++;noNew=0;}else noNew++;
        seen.set(q.key,record.answers);
        pendingSubmission=null;checkpoint=null;
        status(`已收录不同题 ${completed}/${limit}，已处理 ${processed} 题次：${q.stem}${previous?'（重复题继续，不增加收齐数）':''}`);changed();
        if(completed>=limit)break;
        if(noNew>=noProgressLimit)return finishPartial('stagnant',`连续 ${noProgressLimit} 次无新增题目`);
        await pause(reviewMs,`已保存不同题 ${completed}/${limit}，等待 ${reviewMs/1000} 秒后进入下一题。`);q=await advance(q);
        if(q.ended)return finishPartial('platform-end',q.detail);
        if(q.stalled)return finishPartial('transition-stalled',q.detail);
      }
      if(generation===run){active=false;checkpoint=null;status(`本轮收录完成：${completed} 题，已保存到本地题库。`);changed();return {reason:'limit',completed};}
    } catch(e) {
      if(generation!==run)return {reason:'cancelled',completed};
      active=false;checkpoint=null;status(`自动收录已暂停（已保存 ${completed} 题）：${e.message}`);changed();
      return {reason:'error',completed,error:e.message};
    }
  }
  return {state,start,stop,resume:()=>start(limit,null,true),clearPending:()=>{checkpoint=null;}};
}
