import {makeRecord,buildQuestionIndex,matchQuestion,questionKey,normalize} from './core.js';

// The packaged SQLite snapshot is read-only reference material. It is never
// promoted to live platform feedback or written into the user's GM collection.
export function createReferenceBank(data=null) {
  const records=[],groups=new Map(),manualRecords=[];
  let summary=null;
  if(data){
    if(data.format!=='jnsa-reference-bank'||data.version!==1||!Array.isArray(data.records)||data.records.length>30000)throw new Error('综合题库快照格式不正确');
    const sources=new Map((data.sources??[]).map(s=>[s.id,s.label]));
    for(const entry of data.records){
      if(!Number.isInteger(entry.questionId)||entry.questionId<1||typeof entry.conflict!=='boolean'||!Array.isArray(entry.evidence))throw new Error('综合题库来源信息不完整');
      const sourceNames=[...new Set(entry.evidence.map(e=>sources.get(e.sourceId)||e.sourceId))];
      const record={...makeRecord(entry,entry.answers,entry.answers.length?'user':'pending',`综合题库 #${entry.questionId} · ${sourceNames.join(' / ')}`,(entry.explanations??[]).join('\n')),referenceId:entry.questionId,referenceConflict:entry.conflict,evidence:entry.evidence};
      records.push(record);
      if(!groups.has(entry.questionId))groups.set(entry.questionId,[]);
      groups.get(entry.questionId).push(record);
    }
    if(groups.size!==data.includedQuestionCount||data.questionCount<data.includedQuestionCount)throw new Error('综合题库题数校验不一致');
    for(const entry of data.manualRecords??[]){
      if(typeof entry.stem!=='string'||!Array.isArray(entry.options)||!Array.isArray(entry.answers)||!Number.isInteger(entry.questionId))throw new Error('综合题库人工阅读记录损坏');
      manualRecords.push({...entry,key:questionKey(entry),source:`综合题库 #${entry.questionId} · ${sources.get(entry.sourceId)||entry.sourceId}`,referenceId:entry.questionId,evidence:[{recordIds:[entry.recordId]}]});
    }
    summary={name:data.name,questionCount:data.questionCount,includedQuestionCount:groups.size,conflictQuestionCount:data.conflictQuestionCount,sourceRecordCount:data.sourceRecordCount,updatedAt:data.updatedAt,sha256:data.sha256,excludedRecordCount:data.excludedRecordCount??0};
  }
  const index=buildQuestionIndex(records);
  function match(q,localIndex){
    const key=questionKey(q),referenceHits=index.get(key)??[],hits=[...(localIndex.get(key)??[]),...referenceHits];
    const result=matchQuestion(q,hits);
    // A coarse database identity can span punctuation/type variants. Once that
    // identity is flagged conflicting, no narrower spelling may hide the flag.
    const conflictingIds=new Set(referenceHits.filter(r=>r.referenceConflict).map(r=>r.referenceId));
    if(conflictingIds.size){
      const evidence=new Set(hits);
      for(const id of conflictingIds)for(const r of groups.get(id)??[])evidence.add(r);
      return {status:'conflict',answers:[],hits:[...evidence]};
    }
    return result;
  }
  function search(query,localIndex,limit=20){
    const words=normalize(query).toLowerCase().split(' ').filter(Boolean);
    if(!words.length)return {total:0,questions:[]};
    const found=new Map();
    for(const candidate of [...localIndex.values(),...index.values()]){
      const q=candidate[0];
      if(found.has(q.key))continue;
      const haystack=normalize(q.stem+' '+q.options.join(' ')).toLowerCase();
      if(words.every(word=>haystack.includes(word)))found.set(q.key,q);
    }
    for(const q of manualRecords){
      const text=normalize(q.stem+' '+q.options.join(' ')).toLowerCase();
      if(!found.has(q.key)&&words.every(word=>text.includes(word)))found.set(q.key,q);
    }
    return {total:found.size,questions:[...found.values()].slice(0,limit)};
  }
  return {summary,match,search};
}
