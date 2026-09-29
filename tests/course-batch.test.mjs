import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {BASE} from '../src/core.js';
import {createCourseBatch,courseBatchHash,courseBatchRoute} from '../src/course-batch.js';
import {createPracticeBank} from '../src/practice-bank.js';

function environment(courses,passedIds=new Set()){
  const {window,document}=parseHTML('<html><body></body></html>');
  let hash='#'+BASE+'learningCenter';
  const submissions=[];
  const status=new Map(courses.map(course=>[course.courseId,passedIds.has(course.courseId)?'已通过':'未通过']));
  function render(){
    const route=courseBatchRoute(hash);
    if(!route){document.body.innerHTML='';return;}
    const course=courses.find(item=>item.courseId===route.id);
    if(!course){document.body.innerHTML='';return;}
    if(!route.assessment){
      document.body.innerHTML=`<main><img alt="${course.title}"><span>${status.get(course.courseId)}</span></main>`;
      return;
    }
    const questions=course.questions.map((question,index)=>{
      const heading=question.type==='multiple'?'多选题':question.type==='boolean'?'判断题':'单选题';
      const kind=question.type==='multiple'?'checkbox':'radio';
      const labels=question.options.map((option,optionIndex)=>`<label class="el-${kind}"><input type="${kind}" value="${String.fromCharCode(65+optionIndex)}"><span class="richText">${option}</span></label>`).join('');
      return `<div class="el-form-item"><div class="el-form-item__content"><span>${heading}</span><span class="richText">${question.stem}</span><div class="options">${labels}</div></div></div>`;
    }).join('');
    document.body.innerHTML=`<form>${questions}<button id="submit">提交考核</button></form>`;
    [...document.querySelectorAll('label')].forEach(label=>label.onclick=()=>{
      const input=label.querySelector('input');
      if(input.type==='radio')label.closest('.options').querySelectorAll('input[type="radio"]').forEach(other=>{other.checked=false;});
      input.checked=input.type==='checkbox'?!input.checked:true;
    });
    document.querySelector('#submit').onclick=()=>{
      submissions.push(course.courseId);
      status.set(course.courseId,'已通过');
      hash=courseBatchHash(course);
      render();
    };
  }
  Object.defineProperty(window,'location',{configurable:true,value:{hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',get hash(){return hash;},set hash(value){hash=value;render();}}});
  render();
  return {window,document,storage:new Map(),submissions};
}

test('课程批处理路由严格校验课程编号与考核参数',()=>{
  const course={courseId:'course-1',title:'JC《测试》'};
  const detail=courseBatchHash(course),assessment=courseBatchHash(course,true);
  assert.deepEqual(courseBatchRoute(detail),{id:'course-1',assessment:false});
  assert.deepEqual(courseBatchRoute(assessment),{id:'course-1',assessment:true});
  assert.equal(courseBatchRoute(assessment.replace('learningMaterialId=course-1','learningMaterialId=other')),null);
  assert.equal(courseBatchRoute('#/education/eductionTrainingCenter/learningCenter/learning/course-1/learningExaming?learningMaterialId=course-2'),null);
});

test('20小节队列逐节填答、原生提交并等待详情已通过',async()=>{
  const bank=createPracticeBank();
  const courses=bank.courses;
  const env=environment(courses,new Set([courses[2].courseId]));
  const messages=[];
  const storage={getItem:key=>env.storage.get(key)??null,setItem:(key,value)=>env.storage.set(key,String(value))};
  const batch=createCourseBatch(env.window,{courses,storage,status:message=>messages.push(message),pollMs:0,timeoutMs:1000,resultTimeoutMs:1000,submitDelayMs:0,courseDelayMs:0,clickDelayMs:0,sleep:async()=>{}});
  const result=await batch.start();
  assert.equal(result.phase,'completed');
  assert.equal(result.index,20);
  assert.deepEqual(result.results.map(item=>item.outcome),courses.map((course,i)=>!course.questions.length?'no-assessment':i===2?'already-passed':'passed'));
  assert.deepEqual(env.submissions,courses.filter((course,i)=>course.questions.length&&i!==2).map(course=>course.courseId));
  assert.ok(messages.some(message=>message.includes('等待平台确认')));
  batch.destroy();
});
