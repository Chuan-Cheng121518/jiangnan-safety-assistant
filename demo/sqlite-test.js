const data=await fetch('/dist/sqlite-demo-data.json').then(response=>response.json());
const paper=document.querySelector('#paper'),evidence=document.querySelector('#evidence');
let submissions=0;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const update=()=>{const selected=[...paper.querySelectorAll('.options')].map((box,index)=>[index+1,[...box.querySelectorAll('input:checked')].map(input=>input.value).join(',')]).filter(([,answer])=>answer);evidence.textContent=`已选 ${selected.length} 题 · 模拟交卷次数：${submissions} · ${selected.map(([id,answers])=>`${id}=${answers}`).join(' / ')}`;};
function render(questions){
  paper.replaceChildren();
  questions.forEach((q,i)=>{
    const wrapper=node('article'),heading=node('span',`${i+1}、${{single:'单选题',multiple:'多选题',boolean:'判断题'}[q.type]}`);wrapper.append(heading);
    const item=node('div');item.className='el-form-item';wrapper.append(item);
    const content=node('div');content.className='el-form-item__content';item.append(content);
    const stem=node('span',q.stem);stem.className='richText';content.append(stem);
    if(q.image){const image=node('img');image.alt='示例图片，需人工阅读';image.src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="50" height="30"%3E%3Crect width="50" height="30" fill="green"/%3E%3C/svg%3E';stem.append(image);}
    const options=node('div');options.className='options';content.append(options);
    [...q.options].reverse().forEach((option,n)=>{
      const label=node('label');label.className=q.type==='multiple'?'el-checkbox':'el-radio';const input=node('input');input.type=q.type==='multiple'?'checkbox':'radio';input.name='q'+i;input.value=String.fromCharCode(65+n);
      const outer=node('span');outer.className=q.type==='multiple'?'el-checkbox__label':'el-radio__label';outer.append(document.createTextNode(input.value+'. '));const text=node('span',option);text.className='richText';outer.append(text);label.append(input,outer);options.append(label);
    });paper.append(wrapper);
  });
  const submit=node('button','模拟交卷');submit.type='button';submit.onclick=()=>{submissions++;update();};paper.append(submit);update();
}
paper.onsubmit=event=>event.preventDefault();paper.onchange=update;
location.hash='/education/eductionTrainingCenter/examCenter/examing?local-test=1';
render(data.questions.slice(0,7));
document.querySelector('#full-paper').onclick=()=>{render(data.questions);window.dispatchEvent(new Event('hashchange'));};
const compiled=node('script');compiled.src='/dist/sqlite-demo.js';document.body.append(compiled);
