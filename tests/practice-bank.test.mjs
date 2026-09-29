import test from 'node:test';
import assert from 'node:assert/strict';
import {createPracticeBank} from '../src/practice-bank.js';

test('内置课程小节题库包含已确认的 20 门课程和 37 道题',()=>{
  const bank=createPracticeBank();
  assert.deepEqual(bank.summary,{courseCount:20,questionCount:37,updatedAt:'2026-09-23'});
  const result=bank.match({type:'boolean',stem:'当烘箱使用温度超过100℃时，不得触摸工作箱门、观察门及箱体表面，以防烫伤。',options:['正确','错误']});
  assert.equal(result.status,'confirmed');
  assert.deepEqual(result.answers,['正确']);
});
