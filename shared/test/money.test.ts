import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMoney, formatMoney, dateSchema, addMinor} from '../src/index.js';
test('十进制金额按币种精确解析，拒绝精度错误、零和溢出', () => {
  assert.equal(parseMoney('12.34','USD'),1234);
  assert.equal(parseMoney('1000','JPY'),1000);
  assert.equal(parseMoney('0.29','USD'),29);
  assert.equal(formatMoney(9007199254740991,'USD'),'USD 90,071,992,547,409.91');
  for(const [v,c] of [['1.5','JPY'],['1.234','USD'],['0','JPY'],['9007199254740992','JPY'],['1e3','USD']] as const) assert.throws(()=>parseMoney(v,c));
  assert.throws(()=>addMinor(Number.MAX_SAFE_INTEGER,1));
});
test('日期仅校验日历合法性，不顺延周末或节假日',()=>{
  assert.equal(dateSchema.parse('2026-11-01'),'2026-11-01');
  assert.equal(dateSchema.parse('2028-02-29'),'2028-02-29');
  assert.throws(()=>dateSchema.parse('2026-02-29'));
});
