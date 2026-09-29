import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateQuestion,questionKey,normalize} from '../src/core.js';

export async function readSqliteBank(path){
  const before=await readFile(path),sha256=createHash('sha256').update(before).digest('hex');
  const db=new DatabaseSync(path,{readOnly:true,allowExtension:false});
  try{
    const integrity=db.prepare('PRAGMA quick_check').all();
    if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw new Error('SQLite 完整性检查未通过');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('SQLite 来源关联损坏');
    const metadata=Object.fromEntries(db.prepare('SELECT key,value FROM metadata').all().map(r=>[r.key,r.value]));
    if(metadata.schema_version!=='1')throw new Error('暂不支持该 SQLite 结构版本');
    const sources=db.prepare('SELECT id,label,record_count FROM sources ORDER BY id').all();
    const questions=db.prepare('SELECT id,answer_conflict FROM questions ORDER BY id').all();
    const conflicts=new Map(questions.map(q=>[q.id,Boolean(q.answer_conflict)]));
    const rows=db.prepare('SELECT id,question_id,source_id,question_type,stem,options_json,answer_texts_json,status,explanation FROM source_records ORDER BY id').all();
    const grouped=new Map(),excluded=[],manualRecords=[];
    for(const row of rows){
      let clean;
      try{
        const options=JSON.parse(row.options_json).map(o=>o.text),answers=JSON.parse(row.answer_texts_json);
        clean=validateQuestion({type:row.question_type,stem:row.stem,options,answers});
      }catch(error){
        excluded.push({recordId:row.id,questionId:row.question_id,reason:error.message});
        manualRecords.push({type:row.question_type,stem:row.stem,options:JSON.parse(row.options_json).map(o=>o.text),answers:JSON.parse(row.answer_texts_json),questionId:row.question_id,issue:error.message,sourceId:row.source_id,recordId:row.id});
        continue;
      }
      const id=JSON.stringify([row.question_id,questionKey(clean),clean.answers.map(normalize).sort()]);
      if(!grouped.has(id))grouped.set(id,{...clean,questionId:row.question_id,conflict:conflicts.get(row.question_id),evidence:[],explanations:[]});
      const record=grouped.get(id);
      let evidence=record.evidence.find(e=>e.sourceId===row.source_id&&e.originalStatus===row.status);
      if(!evidence){evidence={sourceId:row.source_id,originalStatus:row.status,recordIds:[]};record.evidence.push(evidence);}
      evidence.recordIds.push(row.id);
      if(row.explanation&&!record.explanations.includes(row.explanation))record.explanations.push(row.explanation);
    }
    const records=[...grouped.values()],includedIds=new Set(records.map(r=>r.questionId));
    const bank={format:'jnsa-reference-bank',version:1,name:metadata.database_name||'综合题库',sha256,updatedAt:metadata.last_updated_at_utc||metadata.created_at_utc,
      questionCount:questions.length,includedQuestionCount:includedIds.size,sourceRecordCount:rows.length,conflictQuestionCount:questions.filter(q=>q.answer_conflict).length,
      excludedRecordCount:excluded.length,sources:sources.map(({id,label})=>({id,label})),records,manualRecords};
    const report={...bank,records:undefined,manualRecords:undefined,sources,packedRecords:records.length,manualRecords:excluded,manualQuestionIds:questions.filter(q=>!includedIds.has(q.id)).map(q=>q.id)};
    const afterHash=createHash('sha256').update(await readFile(path)).digest('hex');
    if(sha256!==afterHash)throw new Error('读取期间数据库发生变化，请稍后重试');
    return {bank,report};
  }finally{db.close();}
}
