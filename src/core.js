export const VERSION = '0.5.4';
export const BASE = '/education/eductionTrainingCenter/';
export const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export const sameSet = (a, b) => JSON.stringify([...a].map(normalize).sort()) === JSON.stringify([...b].map(normalize).sort());
export function routeKind(hash) {
  const path = String(hash).replace(/^#/, '').split('?')[0];
  if (path === BASE + 'learningCenter') return 'catalog';
  // The platform nests the assessment route below a course route:
  // learningCenter/learning/<courseId>/learningExaming. Check it first or
  // the generic course prefix hides the question page from the assistant.
  if (/^\/education\/eductionTrainingCenter\/learningCenter\/learning\/[^/]+\/learningExaming$/.test(path)) return 'practice';
  if (path.startsWith(BASE + 'learningCenter/learning/')) return 'course';
  if (path.startsWith(BASE + 'practiceCenter/')) return 'practice';
  if (path === BASE + 'practiceCenter') return 'practice-home';
  if (path === BASE + 'examCenter' || path.startsWith(BASE + 'examCenter/')) return 'exam';
  return 'unsupported';
}
export function questionKey(q) {
  return JSON.stringify([q.type, normalize(q.stem), q.options.map(normalize).sort()]);
}
export function validateQuestion(q) {
  if (!q || !['single', 'multiple', 'boolean'].includes(q.type)) throw new Error('题型应为 single、multiple 或 boolean');
  if (typeof q.stem !== 'string' || !normalize(q.stem) || q.stem.length > 12000) throw new Error('题干为空或过长');
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 26 || q.options.some(o => typeof o !== 'string' || !normalize(o) || o.length > 12000)) throw new Error('选项格式不正确');
  if (new Set(q.options.map(normalize)).size !== q.options.length) throw new Error('选项文字重复，无法可靠匹配');
  const answers = q.answers ?? [];
  if (!Array.isArray(answers) || answers.some(a => typeof a !== 'string' || !q.options.some(o => normalize(o) === normalize(a)))) throw new Error('答案必须是完整选项文字');
  if (new Set(answers.map(normalize)).size !== answers.length || (q.type !== 'multiple' && answers.length > 1)) throw new Error('答案数量与题型不符');
  return {type:q.type, stem:q.stem, options:[...q.options], answers:[...answers]};
}
export function makeRecord(q, answers = [], status = 'pending', source = '手动记录', explanation = '') {
  const clean = validateQuestion({...q, answers});
  if (!['pending','user','confirmed'].includes(status) || (status !== 'pending' && !answers.length)) throw new Error('答案确认状态不正确');
  return {...clean, key:questionKey(clean), status, source:String(source).slice(0,500), explanation:String(explanation).slice(0,12000), observedAt:new Date().toISOString()};
}
export function buildQuestionIndex(records) {
  const index = new Map();
  for (const record of records) {
    if (!index.has(record.key)) index.set(record.key, []);
    index.get(record.key).push(record);
  }
  return index;
}
export function matchQuestion(q, recordsOrIndex) {
  const key = questionKey(q);
  const hits = recordsOrIndex instanceof Map ? [...(recordsOrIndex.get(key) ?? [])] : recordsOrIndex.filter(r => r.key === key);
  const candidates = hits.filter(r => r.answers.length);
  const distinct = new Set(candidates.map(r => JSON.stringify(r.answers.map(normalize).sort())));
  if (distinct.size > 1) return {status:'conflict', answers:[], hits};
  const confirmed = candidates.find(r => r.status === 'confirmed');
  return {status:confirmed ? 'confirmed' : candidates.length ? 'unconfirmed' : 'unknown', answers:confirmed?.answers ?? candidates[0]?.answers ?? [], hits};
}
export function mergeRecords(old, added) {
  const result = [...old];
  const identity = entry => JSON.stringify([entry.key,entry.status,entry.answers.map(normalize).sort(),entry.source]);
  const indexes = new Map();
  result.forEach((entry,index)=>{const id=identity(entry);if(!indexes.has(id))indexes.set(id,index);});
  for (const entry of added) {
    const id = identity(entry),index=indexes.get(id);
    if (index === undefined) {indexes.set(id,result.length);result.push(entry);} else result[index] = entry;
  }
  if (result.length > 20000) throw new Error('记录超过 20000 条，请先导出整理');
  return result;
}
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/,'');
  for (let i=0; i<input.length; i++) {
    const c=input[i];
    if (c === '"') {
      if (quoted && input[i+1] === '"') { cell+='"'; i++; }
      else if (quoted || cell === '') quoted=!quoted;
      else throw new Error('CSV 引号格式不正确');
    } else if (c===',' && !quoted) {row.push(cell);cell='';}
    else if ((c==='\n'||c==='\r') && !quoted) { if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell=''; }
    else cell+=c;
  }
  if(quoted)throw new Error('CSV 引号未闭合');
  row.push(cell);if(row.some(Boolean))rows.push(row);
  return rows;
}
export function importBackup(text, format) {
  if (text.length > 5*1024*1024) throw new Error('导入文件不能超过 5 MB');
  let list,categories=[],version=1;
  if(format==='csv') {
    const [header,...rows]=parseCsv(text);
    if(!header || !['type','stem','options','answers'].every(k=>header.includes(k)))throw new Error('CSV 缺少 type,stem,options,answers 列');
    list=rows.map(row=>Object.fromEntries(header.map((h,i)=>[h, ['options','answers'].includes(h)?JSON.parse(row[i]||'[]'):row[i]||''])));
  } else {
    const parsed=JSON.parse(text);
    if(!Array.isArray(parsed)&&parsed?.version!==undefined&&![1,2].includes(parsed.version))throw new Error('不支持的备份版本');
    if(!Array.isArray(parsed)&&parsed?.version===2)version=2;
    list=Array.isArray(parsed)?parsed:parsed?.records;
    if(!Array.isArray(parsed)&&parsed?.version===2){
      if(parsed.categories!==undefined&&!Array.isArray(parsed.categories))throw new Error('分类索引格式不正确');
      categories=parsed.categories??[];
    }
  }
  if(!Array.isArray(list)||list.length>20000)throw new Error('题库必须是记录数组且不超过 20000 条');
  // Imported claims never become platform-confirmed facts without fresh feedback.
  const records=list.map((q,i)=>{
    try{return makeRecord(q,q.answers??[],q.answers?.length?'user':'pending',`导入：${String(q.source||'用户文件').slice(0,450)}`,q.explanation||'');}
    catch(e){throw new Error(`第 ${i+1} 条：${e.message}`);}
  });
  return {version,records,categories};
}
export function importBank(text, format) {return importBackup(text,format).records;}
export function exportCsv(records) {
  const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
  const cols=['type','stem','options','answers','status','source','explanation'];
  return '\uFEFF'+[cols.join(','),...records.map(r=>cols.map(c=>quote(Array.isArray(r[c])?JSON.stringify(r[c]):r[c]??'')).join(','))].join('\r\n');
}
export function courseState(course, videoEnded=false) {
  if(course.learning==='已完成' && course.assessment==='已通过')return '平台已确认完成';
  if(course.learning==='已完成' && !course.assessment)return '学习已完成，考核状态待核验';
  if(videoEnded)return '视频已结束（不代表平台考核通过）';
  if(course.assessment==='未通过')return '配套考核待完成';
  return course.learning || '等待平台状态';
}
