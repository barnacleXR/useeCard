import { addDays, dateSchema, parseMoney, type Account, type Bill, type Currency } from './index.js';

export type StatementPresetId = 'smbc' | 'rakuten';
export type StatementAmountMode = 'separate-debit' | 'signed-negative';
export type DateToleranceMode = 'postpone' | 'around' | 'exact';

export interface StatementPresetInfo {
  id: StatementPresetId;
  label: string;
  bankCode: string;
  currency: Currency;
  amountMode: StatementAmountMode;
}

export const STATEMENT_PRESETS: Record<StatementPresetId, StatementPresetInfo> = {
  smbc: { id: 'smbc', label: '三井住友銀行', bankCode: '0009', currency: 'JPY', amountMode: 'separate-debit' },
  rakuten: { id: 'rakuten', label: '楽天銀行', bankCode: '0036', currency: 'JPY', amountMode: 'signed-negative' },
};

export interface StatementMapping {
  hasHeader: boolean;
  dateColumn: number;
  amountColumn: number;
  amountMode: StatementAmountMode;
  descriptionColumn: number | null;
}

export interface BankTransaction {
  id: string;
  sourceId: string;
  sourceLabel: string;
  accountId: string;
  currency: Currency;
  date: string;
  amountMinor: number;
  description: string;
  rowIndex: number;
}

export interface StatementExtractOptions {
  sourceId: string;
  sourceLabel: string;
  accountId: string;
  currency: Currency;
  mapping: StatementMapping;
}

export interface ParsedStatementResult {
  transactions: BankTransaction[];
  skippedRows: number;
  errors: string[];
  dateRange: { min: string; max: string } | null;
}

export interface ReconcileMatch {
  bill: Bill;
  transaction: BankTransaction;
  dayDelta: number;
}

export interface ReconcileAmbiguous {
  bill: Bill;
  candidates: { transaction: BankTransaction; dayDelta: number }[];
}

export interface ReconcileNearClue {
  transaction: BankTransaction;
  dayDelta: number;
  diffMinor: number;
}

export interface ReconcileUnmatched {
  bill: Bill;
  nearClues: ReconcileNearClue[];
}

export interface ReconcileInput {
  bills: Bill[];
  transactions: BankTransaction[];
  tolerance: DateToleranceMode;
  includePaid?: boolean;
  manualSelections?: Record<string, string>;
}

export interface ReconcileResult {
  matched: ReconcileMatch[];
  ambiguous: ReconcileAmbiguous[];
  unmatched: ReconcileUnmatched[];
  unmatchedTransactions: BankTransaction[];
}

// 优先按严格 UTF-8 解码（自动跳过 BOM），失败时回退日本网银常见的 Shift_JIS（CP932）。
export function decodeStatementBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'shift_jis' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  } catch {
    const text = new TextDecoder('shift_jis').decode(bytes);
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'shift_jis' };
  }
}

// 解析 CSV 或网页复制粘贴的制表符表格，兼容引号内逗号与换行，跳过全空行。
export function parseDelimitedTable(text: string): { delimiter: ',' | '\t'; rows: string[][] } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = normalized.split('\n').find(line => line.trim().length > 0) ?? '';
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter: ',' | '\t' = tabCount > commaCount ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some(c => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(c => c.length > 0)) rows.push(row);
  return { delimiter, rows };
}

function normalizeHeader(cell: string): string {
  return cell.replace(/[\s\u3000]+/g, '');
}

// 根据表头识别已知银行流水格式。
export function detectStatementPreset(headers: string[]): StatementPresetId | null {
  const set = new Set(headers.map(normalizeHeader));
  if (set.has('年月日') && set.has('お引出し') && set.has('お取り扱い内容')) return 'smbc';
  if (set.has('取引日') && set.has('入出金(円)') && set.has('入出金内容')) return 'rakuten';
  return null;
}

export function buildPresetMapping(preset: StatementPresetId, headers: string[]): StatementMapping {
  const norm = headers.map(normalizeHeader);
  if (preset === 'smbc') {
    return {
      hasHeader: true,
      dateColumn: norm.indexOf('年月日'),
      amountColumn: norm.indexOf('お引出し'),
      amountMode: 'separate-debit',
      descriptionColumn: norm.indexOf('お取り扱い内容'),
    };
  }
  return {
    hasHeader: true,
    dateColumn: norm.indexOf('取引日'),
    amountColumn: norm.indexOf('入出金(円)'),
    amountMode: 'signed-negative',
    descriptionColumn: norm.indexOf('入出金内容'),
  };
}

// 当导入未知格式时给出尽可能合理的初始列映射，避免全空白配置。
export function guessDefaultMapping(rows: string[][]): StatementMapping {
  const first = rows[0] ?? [];
  const hasHeader = first.length > 0 && !normalizeStatementDate(first[0] ?? '');
  const colCount = first.length;
  return {
    hasHeader,
    dateColumn: 0,
    amountColumn: colCount > 1 ? 1 : 0,
    amountMode: 'separate-debit',
    descriptionColumn: colCount > 2 ? colCount - 1 : null,
  };
}

export function suggestAccountId(preset: StatementPresetId | null, accounts: Account[]): string {
  const active = accounts.filter(a => !a.archivedAt);
  if (!active.length) return '';
  if (preset) {
    const info = STATEMENT_PRESETS[preset];
    const byCode = active.find(a => a.bankCode === info.bankCode);
    if (byCode) return byCode.id;
    const keyword = preset === 'smbc' ? '三井住友' : '楽天';
    const byName = active.find(a => a.name.includes(keyword) || a.bankName.includes(keyword));
    if (byName) return byName.id;
  }
  return active.length === 1 ? active[0].id : '';
}

export function normalizeStatementDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate: string | null = null;
  let m = trimmed.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) {
    candidate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  } else {
    m = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) candidate = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (!candidate) return null;
  return dateSchema.safeParse(candidate).success ? candidate : null;
}

export function parseStatementDebitMinor(
  raw: string,
  currency: Currency,
  mode: StatementAmountMode,
): number | null {
  const cleaned = raw
    .trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[－−]/g, '-')
    .replace(/＋/g, '+')
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/[\s\u3000¥￥円]/g, '');
  if (!cleaned) return null;
  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (!unsigned) return null;

  if (mode === 'separate-debit') {
    if (negative) return null;
  } else if (!negative) {
    return null;
  }

  try {
    return parseMoney(unsigned, currency);
  } catch {
    return null;
  }
}

export function extractTransactions(rows: string[][], options: StatementExtractOptions): ParsedStatementResult {
  const { mapping, sourceId, sourceLabel, accountId, currency } = options;
  const start = mapping.hasHeader ? 1 : 0;
  const transactions: BankTransaction[] = [];
  const errors: string[] = [];
  let skippedRows = 0;
  let minDate = '';
  let maxDate = '';

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const dateCell = row[mapping.dateColumn] ?? '';
    const amountCell = row[mapping.amountColumn] ?? '';
    const date = normalizeStatementDate(dateCell);
    if (!date) {
      if (dateCell.trim()) errors.push(`第 ${i + 1} 行日期无法识别：${dateCell}`);
      skippedRows++;
      continue;
    }
    const amountMinor = parseStatementDebitMinor(amountCell, currency, mapping.amountMode);
    if (amountMinor === null) {
      skippedRows++;
      continue;
    }
    const description = mapping.descriptionColumn !== null ? (row[mapping.descriptionColumn] ?? '').trim() : '';
    transactions.push({
      id: `${sourceId}#${i + 1}`,
      sourceId,
      sourceLabel,
      accountId,
      currency,
      date,
      amountMinor,
      description,
      rowIndex: i + 1,
    });
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }

  return {
    transactions,
    skippedRows,
    errors,
    dateRange: minDate ? { min: minDate, max: maxDate } : null,
  };
}

export function toleranceBounds(tolerance: DateToleranceMode): { minDelta: number; maxDelta: number } {
  if (tolerance === 'exact') return { minDelta: 0, maxDelta: 0 };
  if (tolerance === 'around') return { minDelta: -3, maxDelta: 3 };
  return { minDelta: 0, maxDelta: 3 };
}

export function computeBillQueryRange(
  dateRanges: { min: string; max: string }[],
  tolerance: DateToleranceMode,
): { from: string; to: string } | null {
  if (!dateRanges.length) return null;
  let min = dateRanges[0].min;
  let max = dateRanges[0].max;
  for (const r of dateRanges) {
    if (r.min < min) min = r.min;
    if (r.max > max) max = r.max;
  }
  const { minDelta, maxDelta } = toleranceBounds(tolerance);
  return {
    from: addDays(min, -maxDelta),
    to: addDays(max, -minDelta),
  };
}

function diffDays(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`).getTime();
  const b = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// 基于二分图连通分量做 1-to-1 安全匹配，同窗口撞金额时交由人工指定。
export function reconcileBills(input: ReconcileInput): ReconcileResult {
  const { minDelta, maxDelta } = toleranceBounds(input.tolerance);
  const manualSelections = input.manualSelections ?? {};

  const targetBills = input.bills.filter(b => {
    if (b.status === 'void') return false;
    return input.includePaid ? true : b.status === 'pending';
  });

  const billMap = new Map(targetBills.map(b => [b.id, b]));
  const txMap = new Map(input.transactions.map(t => [t.id, t]));

  const billEdges = new Map<string, { txId: string; dayDelta: number }[]>();
  const txEdges = new Map<string, string[]>();

  for (const bill of targetBills) {
    const edges: { txId: string; dayDelta: number }[] = [];
    for (const tx of input.transactions) {
      if (tx.accountId !== bill.debitAccountId) continue;
      if (tx.currency !== bill.currency) continue;
      if (tx.amountMinor !== bill.amountMinor) continue;
      const dayDelta = diffDays(bill.dueDate, tx.date);
      if (dayDelta < minDelta || dayDelta > maxDelta) continue;
      edges.push({ txId: tx.id, dayDelta });
      const list = txEdges.get(tx.id) ?? [];
      list.push(bill.id);
      txEdges.set(tx.id, list);
    }
    edges.sort((a, b) => Math.abs(a.dayDelta) - Math.abs(b.dayDelta) || a.dayDelta - b.dayDelta);
    billEdges.set(bill.id, edges);
  }

  const visitedBills = new Set<string>();
  const visitedTxs = new Set<string>();
  const matched: ReconcileMatch[] = [];
  const ambiguous: ReconcileAmbiguous[] = [];
  const unmatched: ReconcileUnmatched[] = [];
  const usedTxIds = new Set<string>();

  for (const bill of targetBills) {
    if (visitedBills.has(bill.id)) continue;
    const edges = billEdges.get(bill.id) ?? [];
    if (!edges.length) {
      visitedBills.add(bill.id);
      unmatched.push({ bill, nearClues: [] });
      continue;
    }

    // 遍历该账单所在的二分图连通分量。
    const compBills: string[] = [];
    const compTxs: string[] = [];
    const queue: ({ kind: 'bill' | 'tx'; id: string })[] = [{ kind: 'bill', id: bill.id }];
    visitedBills.add(bill.id);

    while (queue.length) {
      const node = queue.shift()!;
      if (node.kind === 'bill') {
        compBills.push(node.id);
        for (const e of billEdges.get(node.id) ?? []) {
          if (!visitedTxs.has(e.txId)) {
            visitedTxs.add(e.txId);
            queue.push({ kind: 'tx', id: e.txId });
          }
        }
      } else {
        compTxs.push(node.id);
        for (const bId of txEdges.get(node.id) ?? []) {
          if (!visitedBills.has(bId)) {
            visitedBills.add(bId);
            queue.push({ kind: 'bill', id: bId });
          }
        }
      }
    }

    if (compBills.length === 1 && compTxs.length === 1) {
      const b = billMap.get(compBills[0])!;
      const edge = billEdges.get(b.id)![0];
      const tx = txMap.get(edge.txId)!;
      matched.push({ bill: b, transaction: tx, dayDelta: edge.dayDelta });
      usedTxIds.add(tx.id);
    } else {
      for (const bId of compBills) {
        const b = billMap.get(bId)!;
        const candidates = (billEdges.get(bId) ?? []).map(e => ({
          transaction: txMap.get(e.txId)!,
          dayDelta: e.dayDelta,
        }));
        ambiguous.push({ bill: b, candidates });
        const selectedTxId = manualSelections[bId];
        if (selectedTxId && candidates.some(c => c.transaction.id === selectedTxId)) {
          usedTxIds.add(selectedTxId);
        }
      }
    }
  }

  // 为未命中账单补充同账户、同币种、容差窗口内的未占用出金作为疑差额线索。
  for (const item of unmatched) {
    const clues: ReconcileNearClue[] = [];
    for (const tx of input.transactions) {
      if (usedTxIds.has(tx.id)) continue;
      if (tx.accountId !== item.bill.debitAccountId) continue;
      if (tx.currency !== item.bill.currency) continue;
      const dayDelta = diffDays(item.bill.dueDate, tx.date);
      if (dayDelta < minDelta || dayDelta > maxDelta) continue;
      clues.push({
        transaction: tx,
        dayDelta,
        diffMinor: tx.amountMinor - item.bill.amountMinor,
      });
    }
    clues.sort(
      (a, b) =>
        Math.abs(a.dayDelta) - Math.abs(b.dayDelta) ||
        Math.abs(a.diffMinor) - Math.abs(b.diffMinor),
    );
    item.nearClues = clues.slice(0, 5);
  }

  const unmatchedTransactions = input.transactions
    .filter(tx => !usedTxIds.has(tx.id))
    .sort((a, b) => b.date.localeCompare(a.date) || a.rowIndex - b.rowIndex);

  return { matched, ambiguous, unmatched, unmatchedTransactions };
}
