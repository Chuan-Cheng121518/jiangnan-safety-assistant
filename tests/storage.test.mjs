import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankStorage,createCategoryStorage} from '../src/storage.js';
import {makeRecord} from '../src/core.js';
const key='jnsa.bank.v1';
const record=stem=>makeRecord({type:'single',stem,options:['甲','乙']},['甲'],'confirmed','平台反馈');
function fixture(){
  const data=new Map();
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  return {data,storage,bank:createBankStorage(storage,key)};
}
test('旧页面从零题开始保存，不覆盖后来收录的题目',()=>{
  const {bank}=fixture();const stale=bank.read();
  bank.save({version:1,records:[record('先收录')]});
  bank.save({...stale,records:[record('后收录')]});
  assert.equal(bank.read().records.length,2);
});
test('即使旧版脚本把主存储覆盖为空，新版仍从逐条副本恢复',()=>{
  const {bank,storage}=fixture();
  bank.save({version:1,records:[record('保留甲'),record('保留乙')]});
  storage.setItem(key,JSON.stringify({version:1,records:[]}));
  assert.equal(createBankStorage(storage,key).read().records.length,2);
});
test('挂载保护已有题库，后续旧页覆盖后仍可恢复',()=>{
  const {bank,storage}=fixture();
  storage.setItem(key,JSON.stringify({version:1,records:[record('旧版现有题')]}));bank.protect();
  storage.setItem(key,JSON.stringify({version:1,records:[]}));assert.equal(bank.read().records.length,1);
});
test('模拟两页面交错写主存储，独立记录保留两边新增',()=>{
  const {bank,storage}=fixture();const other=createBankStorage(storage,key),set=storage.setItem;
  let injected=false;
  storage.setItem=(k,v)=>{if(k===key&&!injected){injected=true;other.save({version:1,records:[record('并发乙')]});}set(k,v);};
  bank.save({version:1,records:[record('并发甲')]});
  assert.equal(bank.read().records.length,2);
});
test('撤回不会被旧页复活，显式撤销可以恢复',()=>{
  const {bank}=fixture();const r=record('可撤回');const stale=bank.save({version:1,records:[r]});
  bank.save({version:1,records:[]},{remove:[r]});bank.save(stale);
  assert.equal(bank.read().records.length,0);
  bank.save(stale,{restore:[r]});assert.equal(bank.read().records.length,1);
});
test('损坏主存储保留原文，保存失败而不静默清零',()=>{
  const {bank,storage}=fixture();storage.setItem(key,'{broken');
  assert.throws(()=>bank.save({version:1,records:[]}));assert.equal(storage.getItem(key),'{broken');
});
test('存储空间不足时不覆盖旧主存储',()=>{
  const {bank,storage}=fixture();bank.save({version:1,records:[record('已有')]});const raw=storage.getItem(key);
  storage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.throws(()=>bank.save({version:1,records:[record('新增')]}),/QuotaExceededError/);assert.equal(storage.getItem(key),raw);
});
test('分类索引按类目分块，多类目共享同一题目键',()=>{
  const {storage,data}=fixture(),categories=createCategoryStorage(storage,key),question=record('跨类题').key;
  categories.observe({id:'paper-a',title:'化学品',expectedCount:2},question);
  categories.observe({id:'paper-b',title:'消防',expectedCount:3},question);
  const all=categories.readAll();assert.equal(all.length,2);assert.ok(all.every(entry=>entry.questionKeys[0]===question));
  assert.equal(data.has(key),false);assert.equal([...data.keys()].filter(k=>k.startsWith(categories.prefix)).length,2);
});
test('重复观察不写存储，跨页面追加采用最新并集',()=>{
  const {storage}=fixture(),first=createCategoryStorage(storage,key),second=createCategoryStorage(storage,key);let writes=0;const set=storage.setItem;
  storage.setItem=(k,v)=>{writes++;set(k,v);};
  const info={id:'paper-a',title:'化学品',expectedCount:2},a=record('甲题').key,b=record('乙题').key;
  assert.equal(first.observe(info,a).changed,true);const afterFirst=writes;
  assert.equal(first.observe(info,a).changed,false);assert.equal(writes,afterFirst);
  second.observe(info,b);assert.deepEqual(new Set(first.read('paper-a').questionKeys),new Set([a,b]));
});
test('版本2分类导入校验后按标识合并',()=>{
  const {storage}=fixture(),categories=createCategoryStorage(storage,key),a=record('甲题').key,b=record('乙题').key;
  categories.observe({id:'paper-a',title:'化学品',expectedCount:2},a);
  categories.merge([{version:1,id:'paper-a',title:'化学品',expectedCount:2,questionKeys:[b],updatedAt:'旧时间'}]);
  assert.deepEqual(new Set(categories.read('paper-a').questionKeys),new Set([a,b]));
  assert.throws(()=>categories.merge([{id:'',title:'坏类目',expectedCount:1,questionKeys:[]}]),/标识/);
});
