/**
 * @file concurrency.ts
 * @project ocs-answer-hub
 * @module 上游并发调度
 * @description 为同一来源提供有限并发和有截止时间的等待队列。
 * @logic 空闲槽立即分配，等待任务按顺序调度，超时任务从队列移除。
 * @dependencies timers
 * @index_tags concurrency, queue
 * @author holic512
 */
export class ConcurrencyPool{
 private active=0;
 private waiting:Array<{start:()=>void;timer:ReturnType<typeof setTimeout>}> = [];
 constructor(private limit:number){}
 get idle(){return this.active===0&&this.waiting.length===0;}
 acquire(deadline:number):Promise<(()=>void)|null>{
  if(deadline<=Date.now())return Promise.resolve(null);
  if(this.active<this.limit){this.active++;return Promise.resolve(()=>this.release());}
  return new Promise(resolve=>{
   const task={start:()=>{clearTimeout(task.timer);this.active++;resolve(()=>this.release());},timer:setTimeout(()=>{this.waiting.splice(this.waiting.indexOf(task),1);resolve(null);},deadline-Date.now())};
   this.waiting.push(task);
  });
 }
 private release(){this.active--;this.waiting.shift()?.start();}
}
