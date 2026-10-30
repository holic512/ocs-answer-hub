import {digest} from './security.js';
export type QuestionInput={title:string;options?:string|string[];type?:string;images?:any[];suggestion_title?:string;suggestion_options?:string;course?:string};
export type Prepared=ReturnType<typeof prepare>;
export function normalise(text:string){return String(text??'').normalize('NFC').replace(/[\uFF01-\uFF5E]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/\u3000/g,' ').replace(/<sup>(.*?)<\/sup>/gi,'^($1)').replace(/<sub>(.*?)<\/sub>/gi,'_($1)').replace(/<\/?(?:p|div|span|br|b|strong|em|i|u|table|tbody|tr|td|li|ul|ol)\s*\/?>/gi,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();}
export function compact(text:string){return normalise(text).replace(/^[【\[]?(?:单选题|多选题|判断题|填空题)[】\]]?\s*/,'').replace(/^\d{1,3}[.、]\s+/,'').replace(/[\s，。！？、：；“”‘’【】]/g,'');}
export function parseOptions(raw:string|string[]=''){const lines=Array.isArray(raw)?raw:String(raw).split(/\r?\n/);return lines.map(x=>normalise(x).replace(/^[A-Za-z][.、:：)）]\s*/,'').trim()).filter(Boolean);}
export function prepare(q:QuestionInput){const title=normalise(q.title),type=['single','multiple','judgement','completion'].includes(q.type??'')?q.type!:'unknown';const choices=parseOptions(q.options),images=(q.images??[]).slice(0,10);const optionSet=[...choices].map(compact).sort();return {...q,title,type,images,options:q.options??'',choices,optionSet,normalTitle:compact(title),key:digest(JSON.stringify([compact(title),type,optionSet,images,q.course??'']))};}
const truth=new Map([['true','正确'],['false','错误'],['正确','正确'],['错误','错误'],['对','正确'],['错','错误'],['√','正确'],['×','错误'],['是','正确'],['否','错误'],['1','正确'],['0','错误']]);
export function canonicalAnswer(raw:unknown,q:Prepared):string|null{
 if(raw===null||raw===undefined)return null;
 if(q.type==='single'&&typeof raw==='string'){const exact=q.choices.find(choice=>compact(choice)===compact(raw))??matchChoice(normalise(raw).replace(/^(?:正确)?答案\s*[:：]\s*/,''),q.choices);if(exact)return exact;}
 let values=Array.isArray(raw)?raw.map(String):String(raw).trim().replace(/^(?:正确)?答案\s*[:：]\s*/,'').split(/#|\|\|/);
 values=values.map(x=>normalise(x)).filter(Boolean);if(!values.length||values.some(x=>/^(?:未知|不知道|无法确定|无答案|未找到|undefined|null|not found)$/i.test(x)))return null;
 if(q.type==='judgement')return truth.get(values[0].toLowerCase())??null;
 if(q.type==='single'||q.type==='multiple'){
  if(!q.choices.length)return null;
  if(values.length===1&&!q.choices.some(c=>compact(c)===compact(values[0]))){const v=values[0].replace(/[\s,，、;；]/g,'');if(/^[A-Z]+$/i.test(v))values=[...v.toUpperCase()];}
  const out:string[]=[];for(const value of values){const found=matchChoice(value,q.choices);if(!found)return null;if(!out.includes(found))out.push(found);}
  if(q.type==='single'&&out.length!==1)return null;return out.join('#');
 }
 const answer=values.join('#');return answer.length<=12000?answer:null;
}
function matchChoice(value:string,choices:string[]):string|undefined{
 const exact=choices.find(choice=>compact(choice)===compact(value));if(exact)return exact;
 if(/^[A-Z]$/i.test(value))return choices[value.toUpperCase().charCodeAt(0)-65];
 const labelled=/^([A-Z])[.、:)]\s*(.+)$/i.exec(value);if(!labelled)return undefined;
 const choice=choices[labelled[1].toUpperCase().charCodeAt(0)-65];
 return choice&&compact(choice)===compact(labelled[2])?choice:undefined;
}
function signature(text:string){return JSON.stringify([text.match(/\d+(?:\.\d+)?/g)??[],text.match(/不是|不正确|不属于|不能|不得|不包括|不|错误|除外|至少|至多|以上|以下|大于|小于/g)??[]]);}
export function dice(a:string,b:string){if(a===b)return 1;const grams=(s:string)=>new Set(Array.from({length:Math.max(s.length-1,0)},(_,i)=>s.slice(i,i+2)));const aa=grams(a),bb=grams(b);if(!aa.size||!bb.size)return 0;return 2*[...aa].filter(x=>bb.has(x)).length/(aa.size+bb.size);}
export function fuzzySafe(a:Prepared,b:Prepared){return a.type===b.type&&JSON.stringify(a.optionSet)===JSON.stringify(b.optionSet)&&JSON.stringify(a.images)===JSON.stringify(b.images)&&(a.course??'')===(b.course??'')&&signature(a.normalTitle)===signature(b.normalTitle)&&(a.normalTitle===b.normalTitle||(a.normalTitle.length>=40&&dice(a.normalTitle,b.normalTitle)>=.985));}
