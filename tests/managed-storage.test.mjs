import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedStorage,migrateSiteStorage} from '../src/managed-storage.js';
import {createBankStorage,createCategoryStorage} from '../src/storage.js';
import {makeRecord} from '../src/core.js';
import {parseHTML} from 'linkedom';
import {mountAssistant} from '../src/app.js';
const key='jnsa.bank.v1';
function memory(){const data=new Map(),writes=[];return {data,writes,storage:{keys:()=>[...data.keys()],getItem:k=>data.get(k)??null,setItem:(k,v)=>{writes.push(k);data.set(k,v);}}};}
function managed(){
  const m=memory(),listeners=new Map();let ids=0;
  const api={getValue:(k,d)=>m.data.get(k)??d,setValue:(k,v)=>{m.writes.push(k);m.data.set(k,v);},setValues:values=>{for(const [k,v] of Object.entries(values))api.setValue(k,v);},listValues:()=>[...m.data.keys()],addValueChangeListener:(k,f)=>{listeners.set(++ids,{k,f});return ids;},removeValueChangeListener:id=>listeners.delete(id)};
  return {...m,api,listeners,storage:createManagedStorage(api)};
}
const record=stem=>makeRecord({type:'single',stem,options:['甲','乙']},['乙'],'confirmed','平台已确认');
test('966道合成题迁移保留答案来源状态时间，不删除旧数据且幂等',()=>{
  const old=memory(),target=managed();
  const records=Array.from({length:966},(_,i)=>({...makeRecord({type:'single',stem:`合成迁移题 ${i}`,options:['甲','乙']},i%3?['乙']:[],['pending','user','confirmed'][i%3],`合成来源 ${i%4}`),observedAt:'2026-09-01T00:00:00.000Z'}));
  const backup={records:[...records,...records.slice(0,308).map(r=>({...r,source:'合成的第二来源'}))]};
  old.storage.setItem(key,JSON.stringify({version:1,records:backup.records,history:[{title:'保留历史'}],selectedCategories:['分类甲']}));
  old.storage.setItem(key+'.selection',JSON.stringify({version:1,selectedCategories:['分类乙']}));
  old.storage.setItem('token','不应复制');
  createCategoryStorage(old.storage,key).observe({id:'paper',title:'分类甲',expectedCount:10},backup.records[0].key);
  const before=[...old.data];migrateSiteStorage(old.storage,target.storage,key);
  assert.deepEqual([...old.data],before);const saved=createBankStorage(target.storage,key).read();
  assert.equal(new Set(saved.records.map(r=>r.key)).size,966);assert.deepEqual(saved.records,backup.records);
  assert.deepEqual(saved.history,[{title:'保留历史'}]);assert.equal(target.data.has('token'),false);
  assert.equal(createCategoryStorage(target.storage,key).readAll().length,1);
  assert.equal(target.data.get(key+'.selection'),old.data.get(key+'.selection'));
  target.writes.length=0;assert.equal(migrateSiteStorage(old.storage,target.storage,key).migrated,false);assert.deepEqual(target.writes,[]);
});
test('网站整体清空后独立题库和类目仍在，刷新不重新导入旧数据',()=>{
  const old=memory(),target=managed();old.storage.setItem(key,JSON.stringify({version:1,records:[record('旧题')]}));
  migrateSiteStorage(old.storage,target.storage,key);old.data.clear();
  migrateSiteStorage(old.storage,target.storage,key);assert.equal(createBankStorage(target.storage,key).read().records.length,1);
});
test('旧页继续新增可显式合并，不复活独立库已撤回的记录',()=>{
  const old=memory(),target=managed(),a=record('旧题');old.storage.setItem(key,JSON.stringify({version:1,records:[a]}));migrateSiteStorage(old.storage,target.storage,key);
  const bank=createBankStorage(target.storage,key);bank.save({version:1,records:[]},{remove:[a]});
  createBankStorage(old.storage,key).save({version:1,records:[record('后来新增')]});
  migrateSiteStorage(old.storage,target.storage,key,{force:true});assert.deepEqual(bank.read().records.map(r=>r.stem),['后来新增']);
});
test('旧数据损坏时零写入，迁移失败不标完成，重试可恢复',()=>{
  const old=memory(),target=managed();old.storage.setItem(key,'{broken');assert.throws(()=>migrateSiteStorage(old.storage,target.storage,key));assert.equal(target.data.size,0);
  old.storage.setItem(key,JSON.stringify({version:1,records:[record('迁移题')]}));const set=target.api.setValue;
  target.api.setValue=(k,v)=>{if(k===key)throw new Error('写入失败');set(k,v);};
  assert.throws(()=>migrateSiteStorage(old.storage,target.storage,key),/写入失败/);assert.equal(target.data.has(key+'.migration.v1'),false);
  target.api.setValue=set;migrateSiteStorage(old.storage,target.storage,key);assert.equal(createBankStorage(target.storage,key).read().records.length,1);
});
test('独立存储跨页面变更通知、取消监听及权限缺失保护',()=>{
  const m=managed(),events=[],unsubscribe=m.storage.subscribe(e=>events.push(e));const listener=[...m.listeners.values()][0];
  listener.f(key+'.changed',null,{key:key+'.selection'},true);listener.f(key+'.changed',null,{key},false);assert.deepEqual(events,[{key:key+'.selection'}]);
  unsubscribe();assert.equal(m.listeners.size,0);assert.throws(()=>createManagedStorage({}),/不会退回网站存储/);
  assert.throws(()=>m.storage.getItem('token'),/拒绝/);assert.throws(()=>m.storage.setItem('other','bad'),/拒绝/);
});
test('挂载独立存储后网站清空不影响查题，GM跨页消息更新索引',t=>{
  const old=memory(),target=managed();old.storage.setItem(key,JSON.stringify({version:1,records:[record('迁移旧题')]}));
  const {window,document}=parseHTML('<html><body></body></html>');window.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',hash:'#/unsupported'};window.localStorage=old.storage;
  let app=mountAssistant(window,{storage:target.storage,legacyStorage:old.storage});t.after(()=>app.destroy());
  assert.equal(app.getRecords().length,1);assert.match(document.querySelector('#jnsa-host').shadowRoot.querySelector('small').textContent,/脚本独立存储/);
  old.data.clear();app.destroy();app=mountAssistant(window,{storage:target.storage,legacyStorage:old.storage});assert.equal(app.getRecords().length,1);
  createBankStorage(target.storage,key).save({version:1,records:[record('另一页新题')]});
  [...target.listeners.values()][0].f(key+'.changed',null,{key},true);assert.equal(app.getRecords().length,2);
  assert.equal(old.data.size,0);
});
