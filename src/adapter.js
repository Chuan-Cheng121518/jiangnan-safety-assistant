export function visible(el) {
  if (!el || el.closest('#jnsa-host,[hidden],[aria-hidden="true"]')) return false;
  for(let p=el;p && p.nodeType===1;p=p.parentElement) if(p.style?.display==='none'||p.style?.visibility==='hidden')return false;
  return true;
}
export const textOf = el => (el?.textContent??'').trim();
export function readPracticeEnd(doc) {
  // Exact standalone notice only; question text, buttons and loading/error
  // messages are never completion evidence. Unknown result screens time out.
  if(readQuestions(doc).length)return null;
  const scope=doc.querySelector('#app')||doc.body;
  if(!scope)return null;
  if([...scope.querySelectorAll('button')].some(b=>visible(b)&&!b.disabled&&['确定','下一题'].includes(textOf(b))))return null;
  const notice=[...scope.querySelectorAll('p,div,span')].find(e=>visible(e)&&e.children.length===0&&!e.closest('button,label,.richText,.options')&&/^(?:本次练习已完成|本次练习已结束|全部练习题已完成|没有更多题目了)[。！!]?$/.test(textOf(e)));
  return notice?textOf(notice):null;
}
export function readQuestions(doc) {
  return [...doc.querySelectorAll('.options')].filter(visible).map((box,index)=>{
    const content=box.closest('.el-form-item__content');
    if(!content) return null;
    const stemEl=[...content.querySelectorAll('.richText')].find(e=>!box.contains(e)&&!e.closest('.userAnswer'));
    const labels=[...box.querySelectorAll('label.el-radio,label.el-checkbox')].filter(visible);
    const options=labels.map(label=>textOf(label.querySelector('.richText,.ibbox')) || textOf(label.querySelector('.el-radio__label,.el-checkbox__label')).replace(/^[A-Z][.、．]\s*/,''));
    let heading='';
    for(let p=content.parentElement,depth=0;p&&depth<3;p=p.parentElement,depth++) {
      const span=[...p.children].find(e=>/^(?:\d+[.、]\s*)?(?:单选题|多选题|判断题)/.test(textOf(e)) && textOf(e).length<30);
      if(span){heading=textOf(span);break;}
    }
    const type=labels.some(l=>l.querySelector('input[type="checkbox"]'))?'multiple':/判断/.test(heading)||options.length===2&&options.every(o=>/^(正确|错误|对|错|是|否)$/.test(o))?'boolean':'single';
    const stem=textOf(stemEl);
    const hasMedia=Boolean(stemEl?.querySelector('img,svg,math,canvas')||box.querySelector('img,svg,math,canvas'));
    const selected=labels.flatMap((label,i)=>label.querySelector('input')?.checked||label.getAttribute('aria-checked')==='true'?[options[i]]:[]);
    const issue=hasMedia?'含图片或公式，需人工阅读':!stem||options.length<2?'题目结构不完整':new Set(options.map(normalize)).size!==options.length?'选项文字重复':options.some(o=>!normalize(o))?'选项缺少文字':'';
    return {index,type,stem,options,selected,issue,box,labels,content,key:questionKey({type,stem,options})};
  }).filter(Boolean).map((question,index)=>({...question,index}));
}
export function readCatalog(doc) {
  return [...doc.querySelectorAll('.i_item')].filter(visible).map(card=>({title:card.querySelector('img[alt]')?.alt||textOf(card.querySelector('.ta-l.elp'))||'',card})).filter(c=>c.title);
}
export function readPracticeCategories(doc) {
  const pane=doc.querySelector('#pane-fourth');
  if(!pane||!visible(pane))return [];
  return [...pane.querySelectorAll('.list .item')].filter(visible).map(card=>{
    const title=textOf(card.querySelector('.title'));
    const match=textOf(card.querySelector('.count')).match(/^试题数量\s*[:：]\s*(\d+)\s*$/);
    const buttons=[...card.querySelectorAll('button')].filter(b=>visible(b)&&textOf(b)==='开始练习'&&!b.disabled&&!b.classList.contains('is-disabled'));
    return {title,count:match?Number(match[1]):null,button:buttons.length===1?buttons[0]:null};
  }).filter(c=>c.title);
}
export function readCourse(doc) {
  const items=[...doc.querySelectorAll('p,span,div')].filter(e=>visible(e)&&e.children.length===0);
  const exact=value=>items.find(e=>textOf(e)===value);
  const image=[...doc.querySelectorAll('img[alt]')].find(e=>visible(e)&&/《.+》/.test(e.alt));
  const durationLabel=items.find(e=>textOf(e).startsWith('学习时长（秒）')) || [...doc.querySelectorAll('span')].find(e=>visible(e)&&textOf(e).startsWith('学习时长（秒）'));
  const duration=textOf(durationLabel).match(/学习时长（秒）\s*[：:]\s*(\d+)/);
  return {title:image?.alt||'',learning:exact('已完成')?'已完成':exact('进行中')?'进行中':exact('未开始')?'未开始':'',assessment:exact('未通过')?'未通过':exact('已通过')?'已通过':'',seconds:duration?Number(duration[1]):null};
}
export function readFeedback(doc, questions) {
  // Single-question feedback is outside the question's form item on the observed platform.
  if(questions.length!==1)return null;
  const scope=questions[0].box.closest('form')||questions[0].content.parentElement.parentElement.parentElement;
  if(!scope)return null;
  const outside=e=>visible(e)&&!questions[0].content.contains(e);
  const success=[...scope.querySelectorAll('.success')].filter(e=>outside(e)&&/^回答正确[。.!！]?$/.test(textOf(e)));
  const errors=[...scope.querySelectorAll('.error')].filter(e=>outside(e)&&/^回答错误[。.!！]?$/.test(textOf(e)));
  if(success.length+errors.length>1)return {issue:'反馈不唯一，请人工核对'};
  if(success.length)return {correct:true};
  if(!errors.length)return null;
  const raw=textOf(errors[0].parentElement);
  const match=normalize(raw).match(/^回答错误[。.!！]?\s*正确答案\s*[:：]\s*(.*?)\s*[。.]?$/);
  if(!match)return {correct:false,raw,issue:'未识别到完整的正确答案'};
  const mapped=mapAnswerText(questions[0],match[1]);
  return {correct:false,raw,...mapped};
}
export function mapAnswerText(q,text) {
  const value=normalize(text);
  let answers=[];
  if(q.type==='boolean'&&q.options.some(o=>normalize(o)===value))answers=[q.options.find(o=>normalize(o)===value)];
  else {
    if(!/^[A-Z](?:[\s,，、;；]*[A-Z])*$/.test(value))return {issue:'正确答案格式无法可靠映射'};
    const codes=value.match(/[A-Z]/g);
    const labels=q.labels.map(label=>{
      const prefix=normalize(textOf(label.querySelector('.el-radio__label,.el-checkbox__label'))).match(/^([A-Z])[.、]/)?.[1];
      const input=label.querySelector('input')?.value;
      if(prefix&&/^[A-Z]$/.test(input||'')&&prefix!==input)return null;
      return prefix||(/^[A-Z]$/.test(input||'')?input:null);
    });
    if(labels.some(l=>!l)||new Set(labels).size!==labels.length||new Set(codes).size!==codes.length||codes.some(c=>!labels.includes(c)))return {issue:'答案字母与选项标识不匹配'};
    answers=codes.map(code=>q.options[labels.indexOf(code)]);
  }
  if(!answers.length||(q.type!=='multiple'&&answers.length!==1))return {issue:'正确答案数量与题型不符'};
  return {answers};
}
export async function applyAnswers(question, answers, currentKey, {clickDelayMs=60,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  if(question.issue || question.key!==currentKey())throw new Error('页面已变化或题目无法可靠识别');
  if(!answers.length || !answers.every(a=>question.options.some(o=>normalize(o)===normalize(a))))throw new Error('答案与当前选项不一致');
  for(let i=0;i<question.labels.length;i++) {
    const label=question.labels[i], input=label.querySelector('input');
    if(!input||input.disabled||label.classList.contains('is-disabled'))throw new Error('选项已禁用');
    const wanted=answers.some(a=>normalize(a)===normalize(question.options[i]));
    const checked=Boolean(input.checked||label.getAttribute('aria-checked')==='true');
    if((question.type==='multiple'&&wanted!==checked)||(question.type!=='multiple'&&wanted&&!checked)) {
      if(question.key!==currentKey())throw new Error('题目已切换，停止填选');
      label.click(); await sleep(clickDelayMs);
    }
  }
  const selected=question.labels.flatMap((l,i)=>l.querySelector('input')?.checked||l.getAttribute('aria-checked')==='true'?[question.options[i]]:[]);
  if(question.key!==currentKey())throw new Error('题目已切换，停止填选');
  if(!sameSet(selected,answers))throw new Error('选中状态与答案不一致，请手动检查');
}

// Imports are removed only by the local deterministic userscript build.
import { normalize, questionKey, sameSet } from './core.js';
