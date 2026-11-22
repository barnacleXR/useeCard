import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMoney, formatMoney, dateSchema, addMinor, dueDaySchema, computeBillPrefill, nextCalendarDay, shiftMonth} from '../src/index.js';
test('十进制金额按币种精确解析，拒绝精度错误、零和溢出', () => {
  assert.equal(parseMoney('12.34','USD'),1234);
  assert.equal(parseMoney('1000','JPY'),1000);
  assert.equal(parseMoney('235,944','JPY'),235944);
  assert.equal(parseMoney(' 1,234,567.89 ','USD'),123456789);
  assert.equal(parseMoney('２３５，９４４','JPY'),235944);
  assert.equal(parseMoney('0.29','USD'),29);
  assert.equal(formatMoney(9007199254740991,'USD'),'USD 90,071,992,547,409.91');
  for(const [v,c] of [['1.5','JPY'],['1.234','USD'],['12,34','USD'],['0','JPY'],['9007199254740992','JPY'],['1e3','USD']] as const) assert.throws(()=>parseMoney(v,c));
  assert.throws(()=>addMinor(Number.MAX_SAFE_INTEGER,1));
});
test('日期仅校验日历合法性，不顺延周末或节假日',()=>{
  assert.equal(dateSchema.parse('2026-11-01'),'2026-11-01');
  assert.equal(dateSchema.parse('2028-02-29'),'2028-02-29');
  assert.throws(()=>dateSchema.parse('2026-02-29'));
});
test('账单日期预填：按常规扣款日、历史账单与月末夹紧计算，不推算节假日',()=>{
  assert.equal(dueDaySchema.parse(undefined), null);
  assert.equal(dueDaySchema.parse(null), null);
  assert.equal(dueDaySchema.parse(27), 27);
  for(const bad of [0, 32, 1.5, -1]) assert.throws(()=>dueDaySchema.parse(bad));
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(nextCalendarDay('2026-11-22', 27), '2026-11-27');
  assert.equal(nextCalendarDay('2026-11-22', 22), '2026-11-22');
  assert.equal(nextCalendarDay('2026-11-22', 10), '2026-12-10');
  assert.equal(nextCalendarDay('2026-12-22', 10), '2027-01-10');
  assert.equal(nextCalendarDay('2026-02-01', 31), '2026-02-28');
  assert.equal(nextCalendarDay('2028-02-01', 31), '2028-02-29');
  // 兜底：无配置无历史时填今天与上月。
  assert.deepEqual(computeBillPrefill({today: '2026-11-22'}), {dueDate: '2026-11-22', statementMonth: '2026-10'});
  // 配置常规扣款日优先于历史扣款日；历史归属月差值（0 个月）优先于默认 -1 月。
  assert.deepEqual(computeBillPrefill({
    today: '2026-11-22', defaultDueDay: 27, lastDueDate: '2026-10-28',
    lastStatementPair: {dueDate: '2026-10-28', statementMonth: '2026-10'},
  }), {dueDate: '2026-11-27', statementMonth: '2026-11'});
  // 未配置常规扣款日时回退到历史账单日号。
  assert.deepEqual(computeBillPrefill({
    today: '2026-11-22', defaultDueDay: null, lastDueDate: '2026-08-10',
    lastStatementPair: {dueDate: '2026-08-10', statementMonth: '2026-07'},
  }), {dueDate: '2026-12-10', statementMonth: '2026-11'});
  // 极端异常的历史差值回退到默认 -1 月。
  assert.deepEqual(computeBillPrefill({
    today: '2026-11-22', defaultDueDay: 27,
    lastStatementPair: {dueDate: '2026-10-27', statementMonth: '2025-01'},
  }), {dueDate: '2026-11-27', statementMonth: '2026-10'});
});
