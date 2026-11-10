/**
 * @file settings.ts
 * @project ocs-answer-hub
 * @module modules
 * @description 系统设置 HTTP 边界。
 * @logic 校验完整表单并调用设置服务，路由不执行 SQL。
 * @dependencies fastify, zod, SettingsService
 * @index_tags settings, routes
 * @author holic512
 */
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {SettingsService,defaultSettings} from '../services/settings.js';
export {getSettings} from '../services/settings.js';
export type {SystemSettings} from '../services/settings.js';
export const settingsSchema=z.object({registrationEnabled:z.boolean().default(defaultSettings.registrationEnabled),registrationCredits:z.number().int().min(0).max(1000000).default(defaultSettings.registrationCredits),tokenDailyDefault:z.number().int().min(1).max(100000).default(defaultSettings.tokenDailyDefault),tokenRpmDefault:z.number().int().min(1).max(600).default(defaultSettings.tokenRpmDefault),tokenDailyMax:z.number().int().min(1).max(100000).default(defaultSettings.tokenDailyMax),tokenRpmMax:z.number().int().min(1).max(600).default(defaultSettings.tokenRpmMax)}).refine(s=>s.tokenDailyDefault<=s.tokenDailyMax&&s.tokenRpmDefault<=s.tokenRpmMax,{message:'凭证默认额度不得超过最大值'});
export function registerSettings(app:FastifyInstance,pool:pg.Pool){
 const service=new SettingsService(pool);
 app.get('/api/admin/settings',()=>service.read());
 app.put('/api/admin/settings',req=>service.save(settingsSchema.parse(req.body)));
}
