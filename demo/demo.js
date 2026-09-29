import {mountAssistant} from '../src/app.js';
import {BASE,makeRecord,mergeRecords} from '../src/core.js';
const page=document.querySelector('#page');let index=0,mixed=false,done=false,passed=false;
let categoryId=null,repeatOnce=false,loopCategoryDemo=false;
const questions=[
  {type:'单选题',stem:'演示题：请选择字母 B。',options:['字母 A','字母 B','字母 C'],answers:[1]},
  {type:'多选题',stem:'演示题：请选择偶数。',options:['数字 1','数字 2','数字 4','数字 5'],answers:[1,2]},
  {type:'判断题',stem:'演示题：二加二等于四。',options:['正确','错误'],answers:[0]}
];
const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
function renderQuestion(q,i){
  const wrap=node('div');wrap.className='box';const heading=node('span',q.type);heading.className='bold';wrap.append(heading);
  const item=node('div');item.className='el-form-item';wrap.append(item);const content=node('div');content.className='el-form-item__content';item.append(content);
  const stem=node('div');stem.className='flex';const rich=node('span',q.stem);rich.className='richText';stem.append(rich);content.append(stem);
  const options=node('div');options.className='options';content.append(options);const multi=q.type==='多选题';
  q.options.forEach((option,n)=>{const label=node('label');label.className=multi?'el-checkbox':'el-radio';label.setAttribute('role',multi?'checkbox':'radio');const input=node('input');input.type=multi?'checkbox':'radio';input.name='q'+i;input.value=String.fromCharCode(65+n);const outer=node('span');outer.className=multi?'el-checkbox__label':'el-radio__label';outer.append(document.createTextNode(input.value+'. '));const text=node('span',option);text.className='richText';outer.append(text);label.append(input,outer);options.append(label);});
  return wrap;
}
function practice(){location.hash=BASE+'practiceCenter/practiceClass?demo=1'+(categoryId===null?'':'&testPaperId=demo-'+categoryId);page.replaceChildren();const form=node('form');form.onsubmit=e=>e.preventDefault();page.append(form);
  (mixed?questions:[questions[index]]).forEach((q,i)=>form.append(renderQuestion(q,i)));
  const feedback=node('div');form.append(feedback);const submit=node('button',mixed?'提交练习':'确定');submit.type='button';form.append(submit);
  submit.onclick=()=>{const blocks=[...form.querySelectorAll('.options')];const qs=mixed?questions:[questions[index]];const ok=blocks.every((block,i)=>{const actual=[...block.querySelectorAll('input')].flatMap((e,n)=>e.checked?[n]:[]);return JSON.stringify(actual)===JSON.stringify(qs[i].answers);});
    if(ok){feedback.className='success';feedback.textContent='回答正确。';}
    else {const error=node('span','回答错误。');error.className='error';feedback.replaceChildren(error);if(!mixed)feedback.append(document.createTextNode('正确答案：'+questions[index].answers.map(i=>String.fromCharCode(65+i)).join(',')));}
    submit.hidden=true;const next=node('button','下一题');next.type='button';next.onclick=()=>{if(repeatOnce){repeatOnce=false;const note=document.querySelector('#reset-evidence');note.textContent='已模拟一次同题清空重置';}else index=(index+1)%questions.length;practice();};form.append(next);};
}
function categoryHome(){
  categoryId=null;page.replaceChildren();
  const tab=node('button','分类练习');tab.id='tab-fourth';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');page.append(tab);
  const pane=node('div');pane.id='pane-fourth';pane.style.display='none';page.append(pane);
  const list=node('div');list.className='list';pane.append(list);
  (loopCategoryDemo?[{title:'循环演示分类一',count:4,start:0},{title:'循环演示分类二',count:1,start:2}]:[{title:'演示分类一',count:2,start:0},{title:'演示分类二',count:1,start:2}]).forEach((c,i)=>{
    const card=node('div');card.className='item box';const title=node('div',c.title);title.className='title';const count=node('div','试题数量：'+c.count);count.className='count';const start=node('button','开始练习');start.onclick=()=>{categoryId=i;index=c.start;mixed=false;practice();};card.append(title,count,start);list.append(card);
  });
  tab.onclick=()=>{tab.setAttribute('aria-selected','true');pane.style.display='';};
}
function examDemo(){
  // Only the isolated demo bank is seeded; school data is never accessed.
  const saved=JSON.parse(localStorage.getItem('jnsa.demo.v1')||'{"version":1,"records":[]}');
  const examples=questions.map(q=>makeRecord({type:q.type==='多选题'?'multiple':q.type==='判断题'?'boolean':'single',stem:q.stem,options:q.options},q.answers.map(i=>q.options[i]),'confirmed','本地演示反馈'));
  saved.records=mergeRecords(saved.records,examples);localStorage.setItem('jnsa.demo.v1',JSON.stringify(saved));
  window.dispatchEvent(new StorageEvent('storage',{key:'jnsa.demo.v1'}));
  location.hash=BASE+'examCenter/examing?demo=1';page.replaceChildren();
  const form=node('form');form.onsubmit=e=>e.preventDefault();page.append(form);
  questions.forEach((q,i)=>form.append(renderQuestion({...q,options:[...q.options].reverse()},i)));
  const evidence=node('p','模拟交卷次数：0');evidence.id='exam-submit-evidence';form.append(evidence);
  const submit=node('button','模拟交卷');submit.type='button';form.append(submit);let submissions=0;
  submit.onclick=()=>{evidence.textContent=`模拟交卷次数：${++submissions}`;};
}
function mockPaperDemo(result=false){
  location.hash=BASE+'practiceCenter/'+(result?'result/demo-100':'practice?testPaperId=demo-100');page.replaceChildren();
  page.append(node('h3',result?'100题模拟结果（仅本地演示）':'100题模拟练习（仅本地演示）'),node('p','试题总数：100'));
  const form=node('form');form.className='examForm';form.onsubmit=e=>e.preventDefault();page.append(form);
  for(let i=0;i<100;i++){
    const base=questions[i%questions.length],q={...base,stem:`整卷演示第${i+1}题：${base.stem}`},wrap=renderQuestion(q,i);form.append(wrap);
    if(result){
      for(const input of wrap.querySelectorAll('input'))input.disabled=true;
      for(const text of wrap.querySelectorAll('.options .richText'))text.className='ibbox';
      const feedback=node('div');feedback.className='userAnswer';
      const text=node('p','正确答案：'+(q.type==='判断题'?q.options[q.answers[0]]:q.answers.map(n=>String.fromCharCode(65+n)).join(','))+' ');
      const state=node('span','回答错误');state.className='ml10';text.append(state);feedback.append(text);
      const explanation=node('div','试题解析：');explanation.className='flex';const rich=node('span','这是用于测试整卷收录的示例反馈。');rich.className='richText';explanation.append(rich);feedback.append(explanation);
      wrap.querySelector('.el-form-item__content').append(feedback);
    }
  }
  const control=node('button',result?'回到100题模拟卷':'模拟提交并查看结果（不联网）');control.type='button';control.onclick=()=>mockPaperDemo(!result);page.append(control);
}
const poster='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" fill="#dceade"/><text x="35" y="110" fill="#38604b" font-size="24">LOCAL DEMO / STUDY</text></svg>');
let samplePromise;
function sampleVideo(){
  if(samplePromise)return samplePromise;
  samplePromise=new Promise((resolve,reject)=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');const stream=canvas.captureStream(15);const chunks=[];
    let timer;const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());reject(new Error('当前浏览器无法生成示例视频'));};
    recorder.onstop=()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());resolve(URL.createObjectURL(new Blob(chunks,{type:'video/webm'})));};
    const started=performance.now();
    const draw=()=>{const elapsed=(performance.now()-started)/1000;ctx.fillStyle='#dceade';ctx.fillRect(0,0,640,360);ctx.fillStyle='#245746';ctx.font='28px sans-serif';ctx.fillText('LOCAL PLAYBACK DEMO',65,120);ctx.font='22px sans-serif';ctx.fillText(`${elapsed.toFixed(1)} / 4 seconds`,65,190);ctx.fillRect(65,245,Math.min(elapsed/4,1)*500,12);};
    draw();recorder.start();timer=setInterval(draw,66);setTimeout(()=>recorder.stop(),4100);
  });return samplePromise;
}
function courses(){location.hash=BASE+'learningCenter';page.replaceChildren();for(const id of ['01','02']){const card=node('div');card.className='i_item';const img=node('img');img.alt=`DEMO${id}《本地播放示例》`;img.src=poster;const title=node('div',img.alt);title.className='ta-l elp';card.append(img,title,node('p','本地示例课程 · 不计入学校进度'));card.onclick=()=>course(id);page.append(card);}}
function course(id='01'){location.hash=BASE+'learningCenter/learning/demo-'+id;page.replaceChildren();const box=node('div');box.className='box';page.append(box);const image=node('img');image.alt=`DEMO${id}《本地播放示例》`;image.src=poster;image.style.width='100%';box.append(image,node('p',done?'已完成':'进行中'),node('div',passed?'已通过':'未通过'));
  const duration=node('span','学习时长（秒）： 0 / -');box.append(duration);const study=node('button','学习');box.append(study);
  study.onclick=async()=>{if(box.querySelector('video'))return;study.disabled=true;const notice=node('p','正在本地生成 4 秒示例视频…');box.append(notice);try{const src=await sampleVideo();if(!box.isConnected)return;const video=node('video');video.controls=true;video.src=src;video.autoplay=false;box.append(video);video.ontimeupdate=()=>{duration.textContent=`学习时长（秒）： ${Math.floor(video.currentTime)} / -`;};notice.textContent='示例视频已就绪，请点击助手正常播放。';}catch(e){notice.textContent=e.message;}finally{study.disabled=false;}};
  const finish=node('button','模拟平台确认完成');finish.onclick=()=>{done=true;passed=true;course(id);};box.append(finish,node('p','勾选两门课程和自动续播后开始。示例视频结束不会自动确认课程完成。'));
}
window.addEventListener('hashchange',()=>{if(location.hash==='#'+BASE+'learningCenter')courses();else if(location.hash==='#'+BASE+'practiceCenter')categoryHome();});
document.querySelector('#single').onclick=()=>{categoryId=null;mixed=false;index=0;practice();};document.querySelector('#categories').onclick=()=>{location.hash=BASE+'practiceCenter';categoryHome();};document.querySelector('#mixed').onclick=()=>{categoryId=null;mixed=true;practice();};document.querySelector('#exam').onclick=examDemo;document.querySelector('#courses').onclick=courses;document.querySelector('#unsupported').onclick=()=>{location.hash='/unsupported';page.replaceChildren(node('p','此为未支持页面示例。'));};
const resetDemo=node('button','模拟同题重置');resetDemo.onclick=()=>{categoryId=null;mixed=false;index=0;repeatOnce=true;document.querySelector('#reset-evidence').textContent='下一次换题将清空并保留同题';practice();};document.querySelector('nav').append(resetDemo);
const resetEvidence=node('p');resetEvidence.id='reset-evidence';document.querySelector('nav').after(resetEvidence);
const loopDemo=node('button','模拟循环类目');loopDemo.onclick=()=>{loopCategoryDemo=true;location.hash=BASE+'practiceCenter';categoryHome();};document.querySelector('nav').append(loopDemo);
const paperDemo=node('button','100题整卷收录演示');paperDemo.onclick=()=>mockPaperDemo();document.querySelector('nav').append(paperDemo);
practice();mountAssistant(window,{demo:true});
