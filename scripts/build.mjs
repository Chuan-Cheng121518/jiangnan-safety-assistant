import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {VERSION} from '../src/core.js';
import {createReferenceBank} from '../src/reference-bank.js';
const root=new URL('../',import.meta.url);
export async function buildUserscript({bank=null,demo=false}={}){
if(bank)createReferenceBank(bank);
const sources=await Promise.all(['core','storage','managed-storage','scheduler','adapter','paper','collector','categories','reference-bank','practice-bank','course-batch','exam-fill','app'].map(name=>readFile(new URL(`src/${name}.js`,root),'utf8')));
const metadata=`// ==UserScript==
// @name         江南大学实验室安全学习助手
// @namespace    local.jiangnan.safety.assistant
// @version      ${VERSION}
// @license      MIT (source code; bundled data retains its original rights)
// @homepageURL  https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant
// @supportURL   https://github.com/Chuan-Cheng121518/jiangnan-safety-assistant/issues
// @description  ${bank?'综合题库 '+bank.questionCount+' 题、20 小节一键答题与提交、考试答案一键填入':'20 小节一键答题与提交、本地题库与学习辅助'}
// @match        https://jnlab.jiangnan.edu.cn/front/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setValues
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-idle
// @noframes
// ==/UserScript==
`;
const body=sources.map(s=>s.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
const snapshot=JSON.stringify(bank).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const startup=`
let managed;
try {
  managed=createManagedStorage({
    getValue:typeof GM_getValue==='function'?GM_getValue:null,
    setValue:typeof GM_setValue==='function'?GM_setValue:null,
    setValues:typeof GM_setValues==='function'?GM_setValues:null,
    listValues:typeof GM_listValues==='function'?GM_listValues:null,
    addValueChangeListener:typeof GM_addValueChangeListener==='function'?GM_addValueChangeListener:null,
    removeValueChangeListener:typeof GM_removeValueChangeListener==='function'?GM_removeValueChangeListener:null
  });
} catch(error) {
  managed={keys:()=>[],getItem(){throw error;},setItem(){throw error;}};
}
mountAssistant(window,{storage:managed,legacyStorage:window.localStorage,referenceBank:${snapshot}});
`;
return `${metadata}\n(()=>{\n'use strict';\n${body}\n${demo?`mountAssistant(window,{demo:true,referenceBank:${snapshot}});`:startup}\n})();\n`;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{sqlite:{type:'string'},bank:{type:'string'},output:{type:'string'},demo:{type:'boolean',default:false},help:{type:'boolean',default:false}}});
  if(values.help){process.stdout.write('node scripts/build.mjs [--bank JSON题库路径 | --sqlite 数据库路径] [--output 成品路径] [--demo]\n默认使用 data/reference-bank.json\n');}
  else{
    if(values.sqlite&&values.bank)throw new Error('--sqlite 和 --bank 不能同时使用');
    let bank=null,report=null;
    if(values.sqlite){const {readSqliteBank}=await import('./sqlite-bank.mjs');({bank,report}=await readSqliteBank(resolve(values.sqlite)));}
    else{
      bank=JSON.parse(await readFile(values.bank?resolve(values.bank):new URL('data/reference-bank.json',root),'utf8'));
      createReferenceBank(bank);
      const {records,manualRecords,...summary}=bank;
      report={...summary,packedRecords:records.length,manualRecordCount:manualRecords.length};
    }
    const output=resolve(values.output||fileURLToPath(new URL('dist/jiangnan-safety-assistant.user.js',root)));
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,await buildUserscript({bank,demo:values.demo}));
    if(bank){await writeFile(output+'.bank.json',JSON.stringify(bank));await writeFile(output+'.report.json',JSON.stringify(report,null,2));}
    process.stdout.write(`Built ${output}${bank?` (${bank.questionCount} questions, ${bank.includedQuestionCount} matchable, ${bank.conflictQuestionCount} conflicts)`:''}\n`);
  }
}
