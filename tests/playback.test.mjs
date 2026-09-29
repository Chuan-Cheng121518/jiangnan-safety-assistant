import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountAssistant} from '../src/app.js';
import {BASE} from '../src/core.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(probe){for(let i=0;i<150;i++){if(probe())return;await sleep(20);}assert.fail('Timed out');}
function fixture(t,{delay=0,reject=false}={}){
  const {window:w,document:d}=parseHTML('<html><body><main></main></body></html>');
  const page=d.querySelector('main'),plays=[],videos=[],timers=[];
  let hash='#'+BASE+'learningCenter',closes=0,nativeEnds=0;
  const later=fn=>timers.push(setTimeout(fn,delay));
  w.location={hostname:'jnlab.jiangnan.edu.cn',protocol:'https:',get hash(){return hash;},set hash(value){hash=value.startsWith('#')?value:'#'+value;if(hash==='#'+BASE+'learningCenter')later(catalog);}};
  w.localStorage={getItem:()=>null,setItem:()=>{}};
  function catalog(){
    page.innerHTML=['A','B'].map(id=>`<div class="i_item"><img alt="${id}《示例》"><div class="ta-l elp">${id}《示例》 分类标签</div></div>`).join('');
    [...page.children].forEach((card,i)=>card.onclick=()=>{
      const id=['A','B'][i];hash='#'+BASE+'learningCenter/learning/'+id;page.replaceChildren();
      later(()=>{
        page.innerHTML=`<img alt="${id}《示例》"><p>进行中</p><p>未通过</p><button>学习</button>`;
        page.querySelector('button').onclick=()=>{
          later(()=>{
            const dialog=d.createElement('div');dialog.className='el-dialog';dialog.innerHTML='<button class="el-dialog__headerbtn">关闭</button><video></video>';page.append(dialog);
            dialog.querySelector('button').onclick=()=>{closes++;dialog.remove();};
            const v=dialog.querySelector('video');v.ended=false;v.paused=true;
            v.play=async()=>{if(reject)throw new Error('NotAllowedError');v.paused=false;plays.push(id);};v.pause=()=>{v.paused=true;};
            v.onended=()=>nativeEnds++;v.addEventListener('ended',v.onended);videos.push(v);
          });
        };
      });
    });
  }
  catalog();const app=mountAssistant(w),root=d.querySelector('#jnsa-host').shadowRoot;
  const click=label=>{app.refresh();const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();};
  const select=()=>{for(const input of root.querySelectorAll('input[type=checkbox]')){input.checked=true;input.onchange();}};
  const end=()=>{const v=videos.at(-1);v.ended=true;v.dispatchEvent(new w.Event('ended'));};
  t.after(()=>{app.destroy();timers.forEach(clearTimeout);});
  return {app,root,plays,videos,click,select,end,w,get closes(){return closes;},get nativeEnds(){return nativeEnds;}};
}

test('完整连播：等待慢加载，未通过考核也关闭旧弹窗并启动下一视频',async t=>{
  const f=fixture(t,{delay:550});f.select();f.click('开始所选课程');
  await until(()=>f.plays.length===1);assert.deepEqual(f.plays,['A']);
  const handler=f.videos[0].onended;f.app.refresh();assert.equal(f.videos[0].onended,handler);
  f.end();f.end();await until(()=>f.plays.length===2);
  assert.deepEqual(f.plays,['A','B']);assert.equal(f.closes,1);assert.equal(f.videos[1].paused,false);
  f.end();await sleep(300);assert.equal(f.plays.length,2);assert.match(f.root.querySelector('section').textContent,/全部播放/);
});
test('等待播放器时点击暂停会取消自动启动',async t=>{
  const f=fixture(t,{delay:550});f.select();f.click('开始所选课程');
  await sleep(100);f.click('暂停');await sleep(1200);assert.deepEqual(f.plays,[]);
});
test('关闭续播后结束视频不会进入下一门',async t=>{
  const f=fixture(t);f.select();f.click('开始所选课程');await until(()=>f.plays.length===1);
  f.app.refresh();const toggle=f.root.querySelector('input[type=checkbox]');toggle.checked=false;toggle.onchange();
  f.end();await sleep(350);assert.deepEqual(f.plays,['A']);assert.equal(f.closes,0);
});
test('浏览器拒绝播放时明确提示，点击继续可以恢复清单',async t=>{
  const f=fixture(t,{reject:true});f.select();f.click('开始所选课程');await until(()=>f.root.querySelector('section').textContent.includes('浏览器未能开始播放'));
  assert.deepEqual(f.plays,[]);f.videos[0].play=async()=>{f.videos[0].paused=false;f.plays.push('A');};
  f.click('正常播放 / 继续');await until(()=>f.plays.length===1);assert.equal(f.videos[0].paused,false);
});
test('销毁助手取消尚未完成的加载任务',async t=>{
  const f=fixture(t,{delay:550});f.select();f.click('开始所选课程');f.app.destroy();await sleep(1100);assert.deepEqual(f.plays,[]);
});
