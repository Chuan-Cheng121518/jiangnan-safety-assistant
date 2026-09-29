import {createBankStorage,createCategoryStorage} from './storage.js';

// Only userscript-owned data enters this adapter; never copy site credentials.
export function createManagedStorage(api,key='jnsa.bank.v1') {
  for(const name of ['getValue','setValue','listValues','addValueChangeListener','removeValueChangeListener'])
    if(typeof api?.[name]!=='function')throw new Error('油猴独立存储权限未就绪，请更新原脚本后刷新；不会退回网站存储');
  const signal=key+'.changed';
  const belongs=k=>k===key||k.startsWith(key+'.');
  const check=k=>{if(typeof k!=='string'||!belongs(k))throw new Error('拒绝访问非题库存储');};
  const announce=k=>{
    if(k===key||k===key+'.selection'||k.startsWith(key+'.categories.'))
      api.setValue(signal,{key:k,nonce:Date.now()+':'+Math.random()});
  };
  return {
    independent:true,
    keys:()=>api.listValues().filter(belongs),
    getItem(k){check(k);const value=api.getValue(k,null);if(value!==null&&typeof value!=='string')throw new Error('独立题库存储格式损坏');return value;},
    setItem(k,v){check(k);api.setValue(k,String(v));announce(k);},
    setMany(entries){
      for(const [k] of entries)check(k);
      if(typeof api.setValues==='function')api.setValues(Object.fromEntries(entries));
      else for(const [k,v] of entries)api.setValue(k,v);
      for(const [k] of entries)announce(k);
    },
    subscribe(callback){
      const id=api.addValueChangeListener(signal,(_key,_old,value,remote)=>{
        if(remote&&typeof value?.key==='string'&&belongs(value.key))callback({key:value.key});
      });
      return ()=>api.removeValueChangeListener(id);
    }
  };
}

export function migrateSiteStorage(source,destination,key='jnsa.bank.v1',{force=false}={}) {
  const marker=key+'.migration.v1';
  const markerRaw=destination.getItem(marker);
  if(markerRaw!==null&&JSON.parse(markerRaw)?.version!==1)throw new Error('旧题迁移标记损坏');
  if(!force&&markerRaw!==null)return {migrated:false};
  // Validate the entire source before the first destination write. No deletes.
  const old=createBankStorage(source,key).read();
  const categories=createCategoryStorage(source,key).readAll();
  const selection=source.getItem(key+'.selection');
  if(selection!==null){const parsed=JSON.parse(selection);if(parsed?.version!==1||!Array.isArray(parsed.selectedCategories)||parsed.selectedCategories.some(t=>typeof t!=='string'))throw new Error('旧版勾选数据损坏');}
  const bank=createBankStorage(destination,key),latest=bank.read();
  bank.save({...old,...latest,records:old.records,...(destination.getItem(key)===null?old:{})});
  if(categories.length)createCategoryStorage(destination,key).merge(categories);
  if(selection!==null&&destination.getItem(key+'.selection')===null)destination.setItem(key+'.selection',selection);
  const saved=bank.read();
  destination.setItem(marker,JSON.stringify({version:1,at:new Date().toISOString(),sourceRecords:old.records.length}));
  return {migrated:true,sourceRecords:old.records.length,totalRecords:saved.records.length};
}
