/**
 * @file questions.ts
 * @project ocs-answer-hub
 * @module repositories
 * @description 题库、答案版本和内容锁持久化。
 * @logic 人工写入使用共享锁，自动积累只插入，版本与题目同事务保存。
 * @dependencies pg, search
 * @index_tags questions, revisions, repository
 * @author holic512
 */
import type pg from 'pg';
import type {Prepared} from '../search.js';
import type {Pagination} from './users.js';
export type QuestionRow={id:string;fingerprint:string;title:string;normal_title:string;type:string;options:string[];images:(string|{url:string})[];course:string;answer:string;deleted:boolean;content_version:number;generation_task_id?:string|null};
export type QuestionFilters=Pagination&{q:string;course:string;type:string};
export type QuestionVersion={id:string;answer:string;operation:string;snapshot:Record<string,unknown>|null;created_at:Date};
export type ExportQuestion=Pick<QuestionRow,'title'|'type'|'options'|'images'|'course'|'answer'>;
export class QuestionsRepository {
 constructor(private db:pg.Pool|pg.PoolClient){}
 async find(id:string){return (await this.db.query<QuestionRow>('SELECT * FROM questions WHERE id=$1 AND NOT deleted',[id])).rows[0];}
 async list(p:QuestionFilters){
  const where="NOT deleted AND (title ILIKE $1 OR answer ILIKE $1) AND ($2='' OR course=$2) AND ($3='' OR type=$3)",values=[`%${p.q.replace(/[\\%_]/g,'\\$&')}%`,p.course,p.type];
  const [items,total]=await Promise.all([this.db.query<QuestionRow>(`SELECT id,title,type,options,images,course,answer,hit_count,created_at,updated_at FROM questions WHERE ${where} ORDER BY updated_at DESC,id LIMIT $4 OFFSET $5`,[...values,p.pageSize,(p.page-1)*p.pageSize]),this.db.query<{total:number}>(`SELECT count(*)::int total FROM questions WHERE ${where}`,values)]);
  return {items:items.rows,total:total.rows[0].total,page:p.page,pageSize:p.pageSize};
 }
 async courses(){return (await this.db.query<{course:string;count:number}>('SELECT course,count(*)::int count FROM questions WHERE NOT deleted GROUP BY course ORDER BY course')).rows;}
 async versions(id:string){return (await this.db.query<QuestionVersion>('SELECT id::text,answer,operation,snapshot,created_at FROM answer_versions WHERE question_id=$1 ORDER BY id DESC LIMIT 100',[id])).rows;}
 async export(){return (await this.db.query<ExportQuestion>('SELECT title,type,options,images,course,answer FROM questions WHERE NOT deleted ORDER BY created_at')).rows;}
 async store(q:Prepared,answer:string,overwrite:boolean,operation:string,existingId?:string){
  await this.db.query('SELECT pg_advisory_xact_lock_shared(764003)');
  let row:QuestionRow|undefined;
  if(overwrite)row=(await this.db.query<QuestionRow>(`UPDATE questions SET fingerprint=$2,title=$3,normal_title=$4,type=$5,options=$6,images=$7,course=$8,answer=$9,deleted=false,updated_at=now() WHERE ${existingId?'id=$1':'fingerprint=$1'} RETURNING *`,[existingId??q.key,q.key,q.title,q.normalTitle,q.type,JSON.stringify(q.choices),JSON.stringify(q.images),q.course??'',answer])).rows[0];
  if(!row)row=(await this.db.query<QuestionRow>('INSERT INTO questions(fingerprint,title,normal_title,type,options,images,course,answer) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(fingerprint) DO NOTHING RETURNING *',[q.key,q.title,q.normalTitle,q.type,JSON.stringify(q.choices),JSON.stringify(q.images),q.course??'',answer])).rows[0];
  if(row)await this.db.query('INSERT INTO answer_versions(question_id,answer,operation,snapshot) VALUES($1,$2,$3,$4)',[row.id,row.answer,operation,JSON.stringify({title:row.title,type:row.type,options:row.options,images:row.images,course:row.course,answer:row.answer})]);
  else row=(await this.db.query<QuestionRow>('SELECT * FROM questions WHERE fingerprint=$1',[q.key])).rows[0];
  return row;
 }
 async remove(id:string){
  await this.db.query('SELECT pg_advisory_xact_lock_shared(764003)');
  const row=(await this.db.query<{answer:string}>('UPDATE questions SET deleted=true WHERE id=$1 AND NOT deleted RETURNING answer',[id])).rows[0];
  if(!row)return false;
  await this.db.query("INSERT INTO answer_versions(question_id,answer,operation) VALUES($1,$2,'删除题目')",[id,row.answer]);return true;
 }
}
