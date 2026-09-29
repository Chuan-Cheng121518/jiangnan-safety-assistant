// A local worker only sends timer notifications. It never receives page data.
export function createBackgroundScheduler(win) {
  let worker=null,url='',attempted=false,disposed=false,nextId=0,mode='idle',reason='',lastLateMs=0,maxLateMs=0,workerWakes=0;
  const pending=new Map();
  const now=()=>win.performance?.now?.()??Date.now();
  const revoke=()=>{if(url){win.URL.revokeObjectURL(url);url='';}};
  function fallback(message){
    mode='fallback';reason=message;
    if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}
    revoke();
    // Each pending wait already has a window timer as a fallback.
  }
  function finish(id,source){
    const item=pending.get(id);if(!item)return;
    const remaining=item.due-now();
    if(remaining>1){
      if(source==='worker'&&worker)try{worker.postMessage({id,ms:remaining});}catch{fallback('后台计时通信失败');}
      else {win.clearTimeout(item.timer);item.timer=win.setTimeout(()=>finish(id,'window'),remaining);}
      return;
    }
    pending.delete(id);win.clearTimeout(item.timer);
    if(worker)try{worker.postMessage({cancel:id});}catch{fallback('后台计时通信失败');}
    lastLateMs=Math.max(0,now()-item.due);maxLateMs=Math.max(maxLateMs,lastLateMs);
    if(source==='worker')workerWakes++;
    item.resolve();
  }
  function initialize(){
    if(attempted||disposed)return;attempted=true;
    if(!win.Worker||!win.Blob||!win.URL?.createObjectURL){fallback('浏览器未提供后台计时能力');return;}
    try {
      const source=`const timers=new Map();self.onmessage=({data})=>{if(data.cancel!==undefined){clearTimeout(timers.get(data.cancel));timers.delete(data.cancel);return;}clearTimeout(timers.get(data.id));timers.set(data.id,setTimeout(()=>{timers.delete(data.id);self.postMessage({id:data.id});},data.ms));};self.postMessage({ready:true});`;
      url=win.URL.createObjectURL(new win.Blob([source],{type:'text/javascript'}));
      worker=new win.Worker(url);mode='starting';
      worker.onmessage=({data})=>{if(disposed)return;if(data?.ready){mode='worker';revoke();}else if(Number.isInteger(data?.id))finish(data.id,'worker');};
      worker.onerror=()=>fallback('网站或浏览器未允许后台计时');
    }catch{fallback('网站或浏览器未允许后台计时');}
  }
  function sleep(ms){
    if(!Number.isFinite(ms)||ms<0)throw new Error('等待时长无效');
    if(disposed)return Promise.resolve();
    initialize();const id=++nextId;
    return new Promise(resolve=>{
      const item={resolve,due:now()+ms,timer:null};pending.set(id,item);
      item.timer=win.setTimeout(()=>finish(id,'window'),ms);
      if(worker)try{worker.postMessage({id,ms});}catch{fallback('后台计时通信失败');}
    });
  }
  function destroy(){
    disposed=true;if(worker){worker.terminate();worker=null;}revoke();
    for(const item of pending.values()){win.clearTimeout(item.timer);item.resolve();}pending.clear();mode='stopped';
  }
  return {sleep,destroy,state:()=>({mode,reason,lastLateMs,maxLateMs,workerWakes,pending:pending.size})};
}
