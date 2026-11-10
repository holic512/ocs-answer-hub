/**
 * @file settings.ts
 * @project ocs-answer-hub
 * @module services
 * @description 注册赠分与凭证默认额度。
 * @logic 已保存值合并稳定默认值，业务调用共享同一设置入口。
 * @dependencies pg, SettingsRepository
 * @index_tags settings, service
 * @author holic512
 */
import type pg from 'pg';
import {SettingsRepository} from '../repositories/settings.js';
export type SystemSettings={registrationEnabled:boolean;registrationCredits:number;tokenDailyDefault:number;tokenRpmDefault:number;tokenDailyMax:number;tokenRpmMax:number};
export const defaultSettings:SystemSettings={registrationEnabled:true,registrationCredits:20,tokenDailyDefault:2000,tokenRpmDefault:60,tokenDailyMax:100000,tokenRpmMax:600};
export async function getSettings(pool:pg.Pool):Promise<SystemSettings>{return {...defaultSettings,...await new SettingsRepository(pool).read()};}
export class SettingsService {
 constructor(private pool:pg.Pool){}
 read(){return getSettings(this.pool);}
 async save(settings:SystemSettings){await new SettingsRepository(this.pool).save(settings);return settings;}
}
