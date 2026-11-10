/**
 * @file JobsPage.tsx
 * @project ocs-answer-hub
 * @module 题库迭代
 * @description 课程种子驱动的新题生成工作区。
 * @logic 选择已有题目创建生成任务，独立执行记录展示进度与候选结果。
 * @dependencies GenerationForm, hooks/use-resource, components/ui
 * @index_tags iteration, generation
 * @author holic512
 */
import {useState} from 'react';
import {Link} from 'react-router';
import {Button} from '../components/ui/button';
import {Heading} from '../components/workspace';
import {GenerationForm} from '../components/GenerationForm';
import {Feedback} from '../components/ui/alert';
import {api} from '../lib/api';
export default function JobsPage(){const [job,setJob]=useState<{id:string}|null>(null);return <><Heading title="题库迭代" desc="基于已有种子题生成新的课程练习题，自动去重并入库。"><Button asChild variant="outline"><Link to="/executions?kind=generation">查看生成记录</Link></Button></Heading>{job&&<Feedback message="迭代任务已创建，可在执行记录中查看进度和入库结果。"/>}<section className="card"><GenerationForm onSave={async(values)=>{const result=await api<{id:string}>('/admin/operations/jobs','POST',{kind:'generation',...values});setJob(result);}}/></section><p className="page-note">需要定期扩充课程？在<Link to="/schedules">自动化任务</Link>中设置执行计划。</p></>;}
