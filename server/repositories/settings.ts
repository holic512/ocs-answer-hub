/**
 * @file settings.ts
 * @project ocs-answer-hub
 * @module repositories
 * @description 系统设置持久化。
 * @logic 读取已保存设置并以 JSON 合并已校验的更新。
 * @dependencies pg
 * @index_tags settings, repository
 * @author holic512
 */
import type pg from 'pg';
import type {SystemSettings} from '../services/settings.js';
export class SettingsRepository {
 constructor(private db:pg.Pool){}
 async read(){return (await this.db.query<{value:Partial<SystemSettings>}>('SELECT value FROM settings WHERE id=1')).rows[0]?.value??{};}
 async save(settings:SystemSettings){await this.db.query('UPDATE settings SET value=value || $1::jsonb WHERE id=1',[JSON.stringify(settings)]);}
}
