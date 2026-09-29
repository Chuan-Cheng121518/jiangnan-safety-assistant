import {readFile,writeFile} from 'node:fs/promises';
import {buildUserscript} from './build.mjs';
const root=new URL('../',import.meta.url),bank=JSON.parse(await readFile(new URL('dist/jiangnan-safety-assistant.user.js.bank.json',root),'utf8'));
const chosen=['single','multiple','boolean'].map(type=>bank.records.find(r=>r.type===type&&!r.conflict));
chosen.push(bank.records.find(r=>r.conflict),{type:'single',stem:'本地验证未命中题：请选择测试文字。',options:['测试甲','测试乙']},bank.manualRecords[0],{...chosen[0],image:true});
const seen=new Set(chosen.map(r=>r.stem));for(const record of bank.records){if(!seen.has(record.stem)&&!record.conflict){chosen.push(record);seen.add(record.stem);}if(chosen.length===100)break;}
const questions=chosen.map(({type,stem,options,image})=>({type,stem,options,...(image?{image:true}:{})}));
await writeFile(new URL('dist/sqlite-demo-data.json',root),JSON.stringify({questions}));
await writeFile(new URL('dist/sqlite-demo.js',root),await buildUserscript({bank,demo:true}));
process.stdout.write('Prepared local SQLite demo with 100 questions\n');
