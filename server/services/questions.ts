/**
 * @file questions.ts
 * @project ocs-answer-hub
 * @module services
 * @description 题目规范化、编辑和导入业务。
 * @logic 路由校验后的题目统一规范化，显式覆盖才更新已有答案。
 * @dependencies QuestionsRepository, search, core
 * @index_tags questions, import, service
 * @author holic512
 */
import type pg from 'pg';
import {fail,transaction} from '../core.js';
import {canonicalAnswer,prepare,type Prepared,type QuestionInput} from '../search.js';
import {QuestionsRepository,type QuestionFilters,type QuestionRow} from '../repositories/questions.js';
export type {QuestionRow} from '../repositories/questions.js';
export type QuestionData=QuestionInput&{answer:string|string[]};
export async function storeQuestion(pool:pg.Pool,q:Prepared,answer:string,overwrite=false,operation='自动积累',existingId?:string):Promise<QuestionRow>{return transaction(pool,c=>new QuestionsRepository(c).store(q,answer,overwrite,operation,existingId));}
export class QuestionsService {
 constructor(private pool:pg.Pool){}
 list(p:QuestionFilters){return new QuestionsRepository(this.pool).list(p);}
 async detail(id:string){const row=await new QuestionsRepository(this.pool).find(id);if(!row)throw fail('题目不存在',404);return row;}
 async courses(){return {items:await new QuestionsRepository(this.pool).courses()};}
 async versions(id:string){return {items:await new QuestionsRepository(this.pool).versions(id)};}
 async create(data:QuestionData){const q=prepare(data),answer=canonicalAnswer(data.answer,q);if(!answer)throw fail('答案无法匹配题型或选项');const row=await storeQuestion(this.pool,q,answer,true,'新增题目');return {id:row.id};}
 async update(id:string,data:QuestionData){const q=prepare(data),answer=canonicalAnswer(data.answer,q);if(!answer)throw fail('答案与题型或选项不匹配');await storeQuestion(this.pool,q,answer,true,'编辑题目',id);}
 async remove(id:string){await transaction(this.pool,async c=>{if(!await new QuestionsRepository(c).remove(id))throw fail('题目不存在',404);});}
 async export(){return {format:'ocs-answer-hub-v2',items:await new QuestionsRepository(this.pool).export()};}
 async import(data:{preview:boolean;overwrite:boolean;items:QuestionData[]}){
  const rows=data.items.map((input,index)=>{const q=prepare(input);return {q,answer:canonicalAnswer(input.answer,q),index:index+1};}),invalid=rows.filter(row=>!row.answer).map(row=>row.index);
  if(data.preview)return {total:rows.length,valid:rows.length-invalid.length,invalid};
  if(invalid.length)throw fail(`第 ${invalid.slice(0,10).join('、')} 行答案无效`);
  for(const row of rows)await storeQuestion(this.pool,row.q,row.answer!,data.overwrite,'导入题目');
  return {imported:rows.length};
 }
}
