import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresetMapping,
  computeBillQueryRange,
  decodeStatementBytes,
  detectStatementPreset,
  extractTransactions,
  guessDefaultMapping,
  normalizeStatementDate,
  parseDelimitedTable,
  parseStatementDebitMinor,
  reconcileBills,
  suggestAccountId,
  type Account,
  type Bill,
} from '../src/index.js';

const accSmbc: Account = {
  id: 'acc-smbc',
  name: '三井住友銀行',
  bankName: '三井住友銀行',
  bankCode: '0009',
  iconAssetId: null,
  note: '',
  sortOrder: 1,
  version: 1,
  archivedAt: null,
};

const accRakuten: Account = {
  id: 'acc-rakuten',
  name: '楽天銀行',
  bankName: '楽天銀行',
  bankCode: '0036',
  iconAssetId: null,
  note: '',
  sortOrder: 2,
  version: 1,
  archivedAt: null,
};

function makeBill(overrides: Partial<Bill>): Bill {
  return {
    id: 'bill-1',
    cardId: 'card-1',
    debitAccountId: 'acc-smbc',
    amountMinor: 10000,
    currency: 'JPY',
    dueDate: '2026-11-04',
    statementMonth: '2026-10',
    note: '',
    status: 'pending',
    version: 1,
    paidAt: null,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    cardName: '测试卡',
    accountName: '三井住友銀行',
    ...overrides,
  };
}

test('支持 UTF-8（含 BOM）与 Shift_JIS 字节解码', () => {
  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('年月日,お引出し\n2026/11/4,2820', 'utf8')]);
  const r1 = decodeStatementBytes(utf8Bom);
  assert.equal(r1.encoding, 'utf-8');
  assert.ok(r1.text.startsWith('年月日,'));

  // "ｾｿﾞﾝ" 在 Shift_JIS (CP932) 中的字节序列为 0xBE 0xBF 0xDE 0xDD
  const sjis = new Uint8Array([0xbe, 0xbf, 0xde, 0xdd]);
  const r2 = decodeStatementBytes(sjis);
  assert.equal(r2.encoding, 'shift_jis');
  assert.equal(r2.text, 'ｾｿﾞﾝ');
});

test('CSV 与网页复制粘贴 TSV 解析及日期/金额规范化', () => {
  const tsv = '2026/11/6\t"9,050"\tﾒﾙﾍﾟｲ\n\n2026/11/22\t\t入金\n';
  const parsed = parseDelimitedTable(tsv);
  assert.equal(parsed.delimiter, '\t');
  assert.equal(parsed.rows.length, 2);

  assert.equal(normalizeStatementDate('2026/11/6'), '2026-11-06');
  assert.equal(normalizeStatementDate('20261104'), '2026-11-04');
  assert.equal(normalizeStatementDate('2026年11月4日'), '2026-11-04');
  assert.equal(normalizeStatementDate('2026-02-29'), null);

  assert.equal(parseStatementDebitMinor('370,935', 'JPY', 'separate-debit'), 370935);
  assert.equal(parseStatementDebitMinor('￥235,944円', 'JPY', 'separate-debit'), 235944);
  assert.equal(parseStatementDebitMinor('－１７，５００円', 'JPY', 'signed-negative'), 17500);
  assert.equal(parseStatementDebitMinor('-17,500', 'JPY', 'signed-negative'), 17500);
  assert.equal(parseStatementDebitMinor('130,760', 'JPY', 'signed-negative'), null);
  assert.equal(parseStatementDebitMinor('-12.34', 'USD', 'signed-negative'), 1234);
  assert.equal(parseStatementDebitMinor('1.5', 'JPY', 'separate-debit'), null);
});

test('自动识别 SMBC 与 楽天銀行 预设并绑定账户与日期区间', () => {
  const smbcCsv = [
    '年月日,お引出し,お預入れ,お取り扱い内容,残高',
    '2026/11/22,,500000,振込,526404',
    '2026/11/10,370935,,ﾐﾂﾋﾞｼUFJﾆｺｽ,29404',
    '2026/11/6,9050,,ﾒﾙﾍﾟｲ,400339',
    '2026/11/4,21250,,ｾｿﾞﾝ,410389',
  ].join('\r\n');
  const smbcTable = parseDelimitedTable(smbcCsv);
  const smbcPreset = detectStatementPreset(smbcTable.rows[0]);
  assert.equal(smbcPreset, 'smbc');
  assert.equal(suggestAccountId(smbcPreset, [accRakuten, accSmbc]), 'acc-smbc');

  const smbcRes = extractTransactions(smbcTable.rows, {
    sourceId: 's1',
    sourceLabel: 'meisai.csv',
    accountId: 'acc-smbc',
    currency: 'JPY',
    mapping: buildPresetMapping('smbc', smbcTable.rows[0]),
  });
  assert.equal(smbcRes.errors.length, 0);
  assert.equal(smbcRes.transactions.length, 3);
  assert.deepEqual(smbcRes.dateRange, { min: '2026-11-04', max: '2026-11-10' });

  const rbCsv = [
    '取引日,入出金(円),取引後残高(円),入出金内容',
    '20261104,-17500,3323,カ）ヒ゛ユ－カ－ト゛',
    '20261109,130760,134083,入金',
    '20261115,-233805,447578,事前返済',
  ].join('\r\n');
  const rbTable = parseDelimitedTable(rbCsv);
  const rbPreset = detectStatementPreset(rbTable.rows[0]);
  assert.equal(rbPreset, 'rakuten');
  assert.equal(suggestAccountId(rbPreset, [accSmbc, accRakuten]), 'acc-rakuten');

  const rbRes = extractTransactions(rbTable.rows, {
    sourceId: 's2',
    sourceLabel: 'RB.csv',
    accountId: 'acc-rakuten',
    currency: 'JPY',
    mapping: buildPresetMapping('rakuten', rbTable.rows[0]),
  });
  assert.equal(rbRes.transactions.length, 2);
  assert.equal(rbRes.transactions[0].amountMinor, 17500);
  assert.deepEqual(rbRes.dateRange, { min: '2026-11-04', max: '2026-11-15' });

  const unknownRows = parseDelimitedTable('2026-11-04,2820,Saison').rows;
  assert.equal(detectStatementPreset(unknownRows[0]), null);
  assert.equal(guessDefaultMapping(unknownRows).hasHeader, false);
});

test('查询区间推算与匹配引擎：顺延、void 过滤、跨月同额、多候选冲突与疑差额线索', () => {
  assert.deepEqual(
    computeBillQueryRange(
      [
        { min: '2026-11-04', max: '2026-11-10' },
        { min: '2026-11-04', max: '2026-11-15' },
      ],
      'postpone',
    ),
    { from: '2026-11-01', to: '2026-11-15' },
  );

  const bills: Bill[] = [
    makeBill({ id: 'b-saison', cardName: 'Saison Gold', dueDate: '2026-11-04', amountMinor: 21250 }),
    makeBill({ id: 'b-weekend', cardName: 'mercard gold', dueDate: '2026-12-06', amountMinor: 133795 }),
    makeBill({ id: 'b-void', cardName: '错账作废', dueDate: '2026-11-04', amountMinor: 17500, status: 'void' }),
    makeBill({
      id: 'b-rakuten-paid',
      cardName: 'JRE VIEW',
      debitAccountId: 'acc-rakuten',
      accountName: '楽天銀行',
      dueDate: '2026-11-04',
      amountMinor: 17500,
      status: 'paid',
    }),
    makeBill({ id: 'b-diff', cardName: '差额卡', dueDate: '2026-11-06', amountMinor: 6187, status: 'paid' }),
    // 跨月同额：相隔 30 天不应互相干扰
    makeBill({ id: 'b-rent-oct', cardName: '家賃10', dueDate: '2026-10-26', amountMinor: 125300 }),
    makeBill({ id: 'b-rent-nov', cardName: '家賃11', dueDate: '2026-11-26', amountMinor: 125300 }),
    // 同窗口双笔同额：应进入 ambiguous
    makeBill({ id: 'b-dup-1', cardName: '卡A', dueDate: '2026-11-20', amountMinor: 5000 }),
    makeBill({ id: 'b-dup-2', cardName: '卡B', dueDate: '2026-11-21', amountMinor: 5000 }),
  ];

  const transactions = [
    {
      id: 't-saison',
      sourceId: 's1',
      sourceLabel: 'SMBC',
      accountId: 'acc-smbc',
      currency: 'JPY' as const,
      date: '2026-11-04',
      amountMinor: 21250,
      description: 'ｾｿﾞﾝ',
      rowIndex: 2,
    },
    {
      id: 't-weekend',
      sourceId: 's1',
      sourceLabel: 'SMBC',
      accountId: 'acc-smbc',
      currency: 'JPY' as const,
      date: '2026-12-07',
      amountMinor: 133795,
      description: 'ﾒﾙﾍﾟｲ',
      rowIndex: 3,
    },
    {
      id: 't-rakuten',
      sourceId: 's2',
      sourceLabel: 'Rakuten',
      accountId: 'acc-rakuten',
      currency: 'JPY' as const,
      date: '2026-11-04',
      amountMinor: 17500,
      description: 'カ）ヒ゛ユ－カ－ト゛',
      rowIndex: 2,
    },
    {
      id: 't-merpay-diff',
      sourceId: 's1',
      sourceLabel: 'SMBC',
      accountId: 'acc-smbc',
      currency: 'JPY' as const,
      date: '2026-11-06',
      amountMinor: 9050,
      description: 'ﾒﾙﾍﾟｲ',
      rowIndex: 4,
    },
    {
      id: 't-rent-oct',
      sourceId: 's1',
      sourceLabel: 'SMBC',
      accountId: 'acc-smbc',
      currency: 'JPY' as const,
      date: '2026-10-26',
      amountMinor: 125300,
      description: 'ﾔﾁﾝ',
      rowIndex: 5,
    },
    {
      id: 't-rent-nov',
      sourceId: 's1',
      sourceLabel: 'SMBC',
      accountId: 'acc-smbc',
      currency: 'JPY' as const,
      date: '2026-11-26',
      amountMinor: 125300,
      description: 'ﾔﾁﾝ',
      rowIndex: 6,
    },
    {
      id: 't-dup-1',
      sourceId: 's1',
      sourceLabel: 'SMBC',
      accountId: 'acc-smbc',
      currency: 'JPY' as const,
      date: '2026-11-21',
      amountMinor: 5000,
      description: 'ｶｰﾄﾞA',
      rowIndex: 7,
    },
    {
      id: 't-extra',
      sourceId: 's2',
      sourceLabel: 'Rakuten',
      accountId: 'acc-rakuten',
      currency: 'JPY' as const,
      date: '2026-11-15',
      amountMinor: 233805,
      description: '事前返済',
      rowIndex: 3,
    },
  ];

  // 不开启 includePaid 时，paid 账单不参与核验
  const pendingOnly = reconcileBills({ bills, transactions, tolerance: 'postpone', includePaid: false });
  assert.deepEqual(
    pendingOnly.matched.map(m => [m.bill.id, m.dayDelta]),
    [
      ['b-saison', 0],
      ['b-weekend', 1],
      ['b-rent-oct', 0],
      ['b-rent-nov', 0],
    ],
  );
  assert.deepEqual(
    pendingOnly.ambiguous.map(a => a.bill.id).sort(),
    ['b-dup-1', 'b-dup-2'],
  );
  assert.equal(pendingOnly.unmatched.length, 0);

  // 开启 includePaid + 手动指定多候选之一
  const withPaid = reconcileBills({
    bills,
    transactions,
    tolerance: 'postpone',
    includePaid: true,
    manualSelections: { 'b-dup-1': 't-dup-1' },
  });
  assert.ok(withPaid.matched.some(m => m.bill.id === 'b-rakuten-paid'));
  assert.ok(!withPaid.matched.some(m => m.bill.id === 'b-void'));
  assert.equal(withPaid.unmatched.length, 1);
  assert.equal(withPaid.unmatched[0].bill.id, 'b-diff');
  assert.equal(withPaid.unmatched[0].nearClues[0].transaction.id, 't-merpay-diff');
  assert.equal(withPaid.unmatched[0].nearClues[0].diffMinor, 9050 - 6187);
  // t-dup-1 已被手动占用，不应出现在 unmatchedTransactions；t-extra 和 t-merpay-diff 应保留
  assert.deepEqual(
    withPaid.unmatchedTransactions.map(t => t.id),
    ['t-extra', 't-merpay-diff'],
  );
});
