import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readSqliteBank} from './sqlite-bank.mjs';
import {createReferenceBank} from '../src/reference-bank.js';
import {questionKey,sameSet,normalize} from '../src/core.js';

const path=process.argv[2];if(!path)throw new Error('请指定 SQLite 文件');
const {bank,report}=await readSqliteBank(path),reference=createReferenceBank(bank),ids=new Set();
const db=new DatabaseSync(path,{readOnly:true,allowExtension:false});
let matched=0,conflicting=0,manual=0;
const started=performance.now(),byId=new Map(),signatures=new Map();
for(const record of bank.records){
  const key=questionKey(record);if(!signatures.has(key))signatures.set(key,new Set());signatures.get(key).add(JSON.stringify(record.answers.map(normalize).sort()));
  for(const evidence of record.evidence)for(const id of evidence.recordIds){assert.ok(!ids.has(id),'重复来源记录');ids.add(id);byId.set(id,record);}
}
const manualById=new Map(bank.manualRecords.map(r=>[r.recordId,r]));
try{
  for(const row of db.prepare('SELECT r.*,q.answer_conflict FROM source_records r JOIN questions q ON q.id=r.question_id').all()){
    const q={type:row.question_type,stem:row.stem,options:JSON.parse(row.options_json).map(o=>o.text),answers:JSON.parse(row.answer_texts_json)};
    if(manualById.has(row.id)){const preserved=manualById.get(row.id);assert.equal(preserved.stem,q.stem);assert.deepEqual(preserved.options,q.options);assert.deepEqual(preserved.answers,q.answers);assert.ok(!ids.has(row.id));ids.add(row.id);manual++;continue;}
    const packed=byId.get(row.id);assert.ok(packed,'缺失来源记录');assert.equal(packed.questionId,row.question_id);assert.equal(questionKey(packed),questionKey(q));assert.ok(sameSet(packed.answers,q.answers));
    const result=reference.match({...q,options:[...q.options].reverse()},new Map());
    if(row.answer_conflict||signatures.get(questionKey(q)).size>1){assert.equal(result.status,'conflict');assert.deepEqual(result.answers,[]);conflicting++;}
    else{assert.equal(result.status,'unconfirmed');assert.ok(sameSet(result.answers,q.answers));assert.ok(result.answers.every(a=>q.options.some(o=>normalize(a)===normalize(o))));matched++;}
  }
  assert.equal(ids.size,bank.sourceRecordCount);
  assert.equal(new Set([...bank.records,...bank.manualRecords].map(r=>r.questionId)).size,bank.questionCount);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),bank.sha256);
  const result={sourceSha256:bank.sha256,totalQuestions:bank.questionCount,matchableQuestions:bank.includedQuestionCount,conflictQuestions:bank.conflictQuestionCount,sourceRowsChecked:ids.size,referenceAnswerRows:matched,conflictRows:conflicting,manualRows:manual,lookupMilliseconds:Math.round(performance.now()-started),packedRecords:report.packedRecords};
  if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{db.close();}
