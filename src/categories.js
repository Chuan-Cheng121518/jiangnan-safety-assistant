import {BASE,normalize} from './core.js';
import {readPracticeCategories,readQuestions,visible,textOf} from './adapter.js';
import {collectionRoute,waitForPracticeState} from './collector.js';

export const PRACTICE_HOME='#'+BASE+'practiceCenter';
export function practiceHome(hash){return String(hash).replace(/^#/, '').split('?')[0]===BASE+'practiceCenter';}
export function practiceCategoryId(hash){
  if(!collectionRoute(hash))return null;
  const query=String(hash).split('?')[1]??'',id=new URLSearchParams(query).get('testPaperId')?.trim();
  return id||null;
}

export function createCategoryCollector(win,collector,{status,changed=()=>{},completed=()=>{},incomplete=()=>{},categoryContext=info=>({...info,knownKeys:[]}),pollMs=250,timeoutMs=20000,categoryPauseMs=10000,sleep=ms=>new Promise(resolve=>win.setTimeout(resolve,ms))}={}) {
  const doc=win.document;
  let active=false,generation=0,queue=[],index=0,results=[],phase='idle',expectedHash='',openingHash='';
  const state=()=>({active,index,total:queue.length,title:queue[index]?.title||'',target:queue[index]?.target||0,results:results.map(r=>({...r})),phase});
  function stop(message='类目收录已暂停，已保存的题目保留。') {
    active=false;generation++;phase='idle';
    if(collector.state().active)collector.stop(message);
    status(message);changed();
  }
  function navigationAllowed(){
    const hash=win.location.hash;
    if(phase==='returning')return hash===expectedHash||hash===PRACTICE_HOME;
    if(phase==='opening'){
      if(hash===expectedHash)return true;
      if(collectionRoute(hash)&&!openingHash)openingHash=hash;
      return hash===openingHash;
    }
    return hash===expectedHash;
  }
  function routeChanged(){if(active&&!navigationAllowed())stop('页面被手动切换，类目收录已暂停。');}
  async function start(selected,perCategoryMax=null){
    if(active||collector.state().active)throw new Error('请先暂停当前收录');
    if(!practiceHome(win.location.hash))throw new Error('请在练习中心的分类列表启动');
    if(perCategoryMax!==null&&(!Number.isInteger(perCategoryMax)||perCategoryMax<1||perCategoryMax>20000))throw new Error('每类上限应为 1～20000 的整数');
    if(!Array.isArray(selected)||!selected.length)throw new Error('请先勾选类目');
    const list=readPracticeCategories(doc);
    const planned=selected.map(title=>{
      const matches=list.filter(c=>normalize(c.title)===normalize(title));
      if(matches.length!==1||!matches[0].button||!Number.isInteger(matches[0].count)||matches[0].count<1||matches[0].count>20000)throw new Error(`类目“${title}”信息不完整或名称重复`);
      const c=matches[0];return {title:c.title,count:c.count,target:perCategoryMax===null?c.count:Math.min(c.count,perCategoryMax)};
    });
    if(new Set(planned.map(c=>normalize(c.title))).size!==planned.length)throw new Error('勾选的类目重复');
    const run=++generation;queue=planned;index=0;results=[];active=true;phase='listing';expectedHash=win.location.hash;changed();
    const check=()=>{
      if(!active||run!==generation)throw new Error('cancelled');
      if(!navigationAllowed())throw new Error('页面已切换，类目收录已暂停');
    };
    const wait=(probe,message)=>waitForPracticeState(win,check,probe,{pollMs,timeoutMs,sleep},message);
    try {
      for(index=0;index<queue.length;index++){
        check();const item=queue[index];
        if(index>0){
          status(`上一类结果已保存，休息 ${categoryPauseMs/1000} 秒后切换到：${item.title}。可随时暂停。`);changed();
          await sleep(categoryPauseMs);check();
          phase='returning';status(`正在返回分类列表，准备收录：${item.title}`);changed();
          win.location.hash=PRACTICE_HOME;
          await wait(()=>win.location.hash===PRACTICE_HOME&&doc.querySelector('#tab-fourth'),'返回练习中心超时');
          expectedHash=PRACTICE_HOME;phase='listing';
        }
        // Returning to the home page may select the simulation tab by default.
        let selectedTab=false;
        const category=await wait(()=>{
          const tab=doc.querySelector('#tab-fourth');
          if(!tab||!visible(tab)||normalize(textOf(tab))!=='分类练习')return null;
          if(tab.getAttribute('aria-selected')!=='true'){
            if(!selectedTab){selectedTab=true;tab.click();}return null;
          }
          const matches=readPracticeCategories(doc).filter(c=>normalize(c.title)===normalize(item.title));
          if(matches.length>1)throw new Error('类目名称重复，不能可靠定位');
          if(matches.length!==1||!matches[0].button)return null;
          if(matches[0].count!==item.count)throw new Error(`“${item.title}”的题数已变化，请重新读取类目列表`);
          return matches[0];
        },`未找到类目“${item.title}”，已暂停`);
        check();phase='opening';openingHash='';
        status(`正在打开类目 ${index+1}/${queue.length}：${item.title}（目标 ${item.target} 题）`);changed();
        category.button.click();
        let stableKey='',samples=0;
        await wait(()=>{
          if(!collectionRoute(win.location.hash))return false;
          const qs=readQuestions(doc);
          if(qs.length!==1){stableKey='';samples=0;return false;}
          if(qs[0].key!==stableKey){stableKey=qs[0].key;samples=0;}
          return ++samples>=2;
        },`“${item.title}”的题目加载超时`);
        check();expectedHash=win.location.hash;phase='collecting';changed();
        const id=practiceCategoryId(expectedHash);
        if(!id)throw new Error(`“${item.title}”页面缺少 testPaperId，不能可靠记录分类`);
        const context=categoryContext({id,title:item.title,expectedCount:item.count,hash:expectedHash});
        if(!context)throw new Error(`“${item.title}”类目身份无法保存`);
        const outcome=await collector.start(item.target,context);
        check();
        if(!['limit','stagnant','platform-end','transition-stalled','feedback-timeout'].includes(outcome?.reason))throw new Error(outcome?.error||'当前类目尚未收齐，已暂停');
        const complete=outcome.reason==='limit'&&outcome.completed===item.count;
        const result={title:item.title,count:item.count,collected:outcome.completed,complete,reason:outcome.reason,detail:outcome.detail||(outcome.reason==='feedback-timeout'?'平台反馈超时，未重复提交，转入下一类':complete?'数量已对齐':'达到本轮上限，未收齐'),at:new Date().toISOString()};
        if(complete)completed(item.title,item.count);
        else incomplete(result);
        if(outcome.reason==='feedback-timeout')collector.clearPending();
        results.push(result);
        changed();
      }
      active=false;phase='idle';
      const complete=results.filter(r=>r.complete).length;
      status(`类目队列已结束：${results.length} 类；${complete} 类已完成，${results.length-complete} 类待补充。待补充类目保留勾选，之后可重试。`);changed();
    }catch(e){
      if(run!==generation)return;
      stop(`类目收录已暂停：${e.message}。已保存的题目保留。`);
    }
  }
  return {state,start,stop,routeChanged};
}
