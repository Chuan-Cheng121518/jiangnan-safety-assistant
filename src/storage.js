import {makeRecord,mergeRecords,normalize} from './core.js';

const storageKeys=storage=>typeof storage.keys==='function'?storage.keys():Array.from({length:storage.length},(_,i)=>storage.key(i));
// Independent recovery entries also protect against stale-tab aggregate writes.
// Production uses the userscript adapter; localStorage is for legacy migration/demo.
export function createBankStorage(storage,key) {
  const prefix=key+'.records.';
  const identity=r=>JSON.stringify([r.key,r.status,r.answers.map(normalize).sort(),r.source]);
  const clean=r=>({...makeRecord(r,r.answers,r.status,r.source,r.explanation),observedAt:r.observedAt});
  function load() {
    const raw=storage.getItem(key);
    const state=raw?JSON.parse(raw):{version:1,records:[]};
    if(state.version!==1||!Array.isArray(state.records))throw new Error('不支持的存储版本');
    let records=state.records.map(clean);
    const entries=new Map();
    for(const entryKey of storageKeys(storage)) {
      if(!entryKey?.startsWith(prefix))continue;
      const entry=JSON.parse(storage.getItem(entryKey));
      if(typeof entry.removed!=='boolean')throw new Error('题库恢复记录损坏');
      const record=clean(entry.record),id=identity(record);
      if(entryKey!==prefix+id)throw new Error('题库恢复记录不匹配');
      entries.set(id,{record,removed:entry.removed});
    }
    records=records.filter(r=>!entries.get(identity(r))?.removed);
    records=mergeRecords(records,[...entries.values()].filter(e=>!e.removed).map(e=>e.record));
    return {state:{...state,records},entries};
  }
  function preserve(records,entries) {
    const writes=[];
    for(const record of records) {
      const id=identity(record);
      if(!entries.has(id))writes.push([prefix+id,JSON.stringify({record,removed:false})]);
    }
    if(storage.setMany&&writes.length)storage.setMany(writes);
    else for(const [entryKey,value] of writes)storage.setItem(entryKey,value);
  }
  return {
    read:()=>load().state,
    protect(){const {state,entries}=load();preserve(state.records,entries);return state;},
    save(snapshot,{remove=[],restore=[]}={}) {
      const {state:latest,entries}=load();
      const restored=new Set(restore.map(identity)),removed=new Set(remove.map(identity));
      let records=mergeRecords(latest.records,snapshot.records.map(clean));
      records=records.filter(r=>!removed.has(identity(r))&&(!entries.get(identity(r))?.removed||restored.has(identity(r))));
      // Write recovery records before the replaceable aggregate, including records
      // found in a newer tab's aggregate. Quota failures stop the caller's collection.
      preserve(records,entries);
      for(const record of restore)if(entries.get(identity(record))?.removed)storage.setItem(prefix+identity(record),JSON.stringify({record:clean(record),removed:false}));
      for(const record of remove)storage.setItem(prefix+identity(record),JSON.stringify({record:clean(record),removed:true}));
      const saved={...snapshot,version:1,records};
      storage.setItem(key,JSON.stringify(saved));
      return saved;
    }
  };
}

export function createCategoryStorage(storage,key) {
  const prefix=key+'.categories.';
  const cleanId=value=>{
    const id=String(value??'').trim();
    if(!id||id.length>500||/[\u0000-\u001f]/.test(id))throw new Error('类目标识格式不正确');
    return id;
  };
  const storageKey=id=>prefix+encodeURIComponent(cleanId(id));
  const clean=entry=>{
    const id=cleanId(entry?.id),title=normalize(entry?.title);
    const expectedCount=entry?.expectedCount;
    if(!title||title.length>500)throw new Error('类目名称格式不正确');
    if(!Number.isInteger(expectedCount)||expectedCount<1||expectedCount>20000)throw new Error('类目题数格式不正确');
    if(!Array.isArray(entry?.questionKeys)||entry.questionKeys.length>20000||entry.questionKeys.some(value=>typeof value!=='string'||!value||value.length>350000))throw new Error('类目题目索引格式不正确');
    const questionKeys=[...new Set(entry.questionKeys)];
    const updatedAt=typeof entry.updatedAt==='string'&&entry.updatedAt?entry.updatedAt:new Date().toISOString();
    return {version:1,id,title,expectedCount,questionKeys,updatedAt};
  };
  function read(id) {
    const raw=storage.getItem(storageKey(id));
    if(raw===null)return null;
    const entry=clean(JSON.parse(raw));
    if(storageKey(entry.id)!==storageKey(id))throw new Error('分类索引标识不匹配');
    return entry;
  }
  function readAll() {
    const entries=[];
    for(const entryKey of storageKeys(storage)){
      if(!entryKey?.startsWith(prefix))continue;
      const entry=clean(JSON.parse(storage.getItem(entryKey)));
      if(entryKey!==storageKey(entry.id))throw new Error('分类索引标识不匹配');
      entries.push(entry);
    }
    return entries.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));
  }
  function write(entry) {
    const saved=clean({...entry,updatedAt:new Date().toISOString()});
    storage.setItem(storageKey(saved.id),JSON.stringify(saved));
    return saved;
  }
  function ensure(info) {
    const id=cleanId(info?.id),latest=read(id);
    const candidate=clean({id,title:info.title,expectedCount:info.expectedCount,questionKeys:latest?.questionKeys??[],updatedAt:latest?.updatedAt});
    if(latest&&latest.title===candidate.title&&latest.expectedCount===candidate.expectedCount)return {entry:latest,changed:false};
    return {entry:write(candidate),changed:true};
  }
  function observe(info,questionKey) {
    if(typeof questionKey!=='string'||!questionKey||questionKey.length>350000)throw new Error('题目标识格式不正确');
    const id=cleanId(info?.id),latest=read(id);
    const keys=latest?.questionKeys??[],has=keys.includes(questionKey);
    const candidate=clean({id,title:info.title,expectedCount:info.expectedCount,questionKeys:has?keys:[...keys,questionKey],updatedAt:latest?.updatedAt});
    if(latest&&has&&latest.title===candidate.title&&latest.expectedCount===candidate.expectedCount)return {entry:latest,changed:false};
    return {entry:write(candidate),changed:true};
  }
  function merge(imported) {
    if(!Array.isArray(imported)||imported.length>200)throw new Error('分类索引必须是数组且不超过 200 类');
    const prepared=imported.map(clean),saved=[];
    for(const entry of prepared){
      const latest=read(entry.id),questionKeys=[...new Set([...(latest?.questionKeys??[]),...entry.questionKeys])];
      saved.push(write({...entry,questionKeys}));
    }
    return saved;
  }
  return {prefix,read,readAll,ensure,observe,merge};
}
