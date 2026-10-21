import { Inject, Injectable } from '@nestjs/common';
import { preferencesInput, type Preferences } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';

// 个人偏好：默认币种只影响新建卡片，不改历史账单；提醒偏好用于生成提醒计划。
@Injectable()
export class SettingsService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}
  preferences(owner: string): Preferences { const row = this.ledger.db.prepare('SELECT username,defaultCurrency,reminderDaysBefore,reminderTime,inAppNotifications FROM users WHERE id=?').get(owner) as Omit<Preferences,'inAppNotifications'> & {inAppNotifications:number}; return {...row,inAppNotifications:!!row.inAppNotifications}; }
  setPreferences(owner: string, body: unknown) {
    const input = preferencesInput.parse(body);
    const fields: string[] = Object.keys(input);
    // 字段名来自上面的白名单 schema，取值走参数绑定。
    this.ledger.db.prepare(`UPDATE users SET ${fields.map(f => `${f}=@${f}`).join(',')} WHERE id=@owner`).run({...input, ...(input.inAppNotifications === undefined ? {} : {inAppNotifications:Number(input.inAppNotifications)}), owner});
    return this.preferences(owner);
  }
}
