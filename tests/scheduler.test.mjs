import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundScheduler} from '../src/scheduler.js';

function environment({worker=true,constructionError=false,windowLag=0}={}){
  let time=0,next=0,instance=null,terminated=0,revoked=0;const timers=new Map(),sent=[];
  const win={performance:{now:()=>time},setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,due:time+ms+windowLag});return id;},clearTimeout:id=>timers.delete(id),Blob:class{},URL:{createObjectURL:()=> 'blob:local-test',revokeObjectURL:()=>revoked++}};
  if(worker)win.Worker=class{constructor(){if(constructionError)throw new Error('blocked');instance=this;}postMessage(data){sent.push(data);}terminate(){terminated++;}};
  const tick=ms=>{time+=ms;for(const [id,t] of [...timers])if(t.due<=time){timers.delete(id);t.fn();}};
  return {win,tick,sent,timers,get worker(){return instance;},get revoked(){return revoked;},get terminated(){return terminated;}};
}

test('后台窗口计时被延迟时，Worker 提醒按期完成且迟到回调不重复执行',async()=>{
  const h=environment({windowLag:60000}),s=createBackgroundScheduler(h.win);let resolved=0;
  const p=s.sleep(1000).then(()=>resolved++);const late=[...h.timers.values()][0].fn;
  h.worker.onmessage({data:{ready:true}});h.tick(1000);h.worker.onmessage({data:{id:1}});await p;
  late();h.worker.onmessage({data:{id:1}});await Promise.resolve();
  assert.equal(resolved,1);assert.equal(h.timers.size,0);assert.equal(s.state().workerWakes,1);assert.equal(s.state().maxLateMs,0);assert.equal(h.revoked,1);
  assert.deepEqual(h.sent[0],{id:1,ms:1000});s.destroy();
});

test('提前到达的计时通知不能缩短配置的操作间隔',async()=>{
  const h=environment(),s=createBackgroundScheduler(h.win);let done=false;const p=s.sleep(1000).then(()=>done=true);
  h.tick(100);h.worker.onmessage({data:{id:1}});await Promise.resolve();assert.equal(done,false);assert.deepEqual(h.sent.at(-1),{id:1,ms:900});
  h.tick(900);await p;assert.equal(done,true);s.destroy();
});

test('Worker 不可用或构造被拒绝时，明确降级并完成原等待',async()=>{
  for(const opts of [{worker:false},{constructionError:true}]){
    const h=environment(opts),s=createBackgroundScheduler(h.win),p=s.sleep(500);
    assert.equal(s.state().mode,'fallback');assert.ok(s.state().reason);h.tick(500);await p;assert.equal(s.state().pending,0);s.destroy();
  }
});

test('Worker 异步失败不丢失未完成等待，后续不反复创建',async()=>{
  const h=environment(),s=createBackgroundScheduler(h.win),p=s.sleep(500);
  h.worker.onerror();assert.equal(s.state().mode,'fallback');assert.equal(h.terminated,1);h.tick(700);await p;
  assert.equal(s.state().maxLateMs,200);const q=s.sleep(300);h.tick(300);await q;assert.equal(h.terminated,1);s.destroy();
});

test('销毁释放所有计时和 Worker，等待被唤醒以便上层检查取消',async()=>{
  const h=environment(),s=createBackgroundScheduler(h.win);const p=s.sleep(6000),q=s.sleep(2000);const late=h.worker.onmessage;
  s.destroy();await Promise.all([p,q]);late({data:{id:1}});
  assert.equal(h.timers.size,0);assert.equal(h.terminated,1);assert.equal(s.state().pending,0);assert.equal(s.state().mode,'stopped');await s.sleep(1000);assert.equal(h.timers.size,0);
});

test('非法时长不创建计时任务',()=>{
  const h=environment(),s=createBackgroundScheduler(h.win);for(const value of [-1,NaN,Infinity])assert.throws(()=>s.sleep(value),/无效/);assert.equal(h.worker,null);
});
