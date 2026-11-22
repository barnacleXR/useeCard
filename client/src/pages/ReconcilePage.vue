<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { SSelect, SIcon } from '@vean/ui';
import {
  buildPresetMapping,
  computeBillQueryRange,
  decodeStatementBytes,
  detectStatementPreset,
  extractTransactions,
  formatMoney,
  guessDefaultMapping,
  parseDelimitedTable,
  reconcileBills,
  STATEMENT_PRESETS,
  suggestAccountId,
  type BankTransaction,
  type Bill,
  type BillPage,
  type Currency,
  type DateToleranceMode,
  type StatementMapping,
} from '@ccm/shared';
import { api } from '../api';
import { shortDate } from '../format';
import { useWorkspace } from '../stores/workspace';
import { loadReconcileDraft, saveReconcileDraft, clearReconcileDraft, type ReconcileDraft } from '../reconcileDraft';
import PageShell from '../components/PageShell.vue';
import BillEditor from '../components/BillEditor.vue';
import DateRangeInput from '../components/fields/DateRangeInput.vue';
import StatementSourceCard, { type StatementSource } from '../components/StatementSourceCard.vue';

const store = useWorkspace();
const restoring = ref(true);
const cacheError = ref('');
let cacheOwner = '';
let persistTimer: ReturnType<typeof setTimeout> | undefined;

const sources = ref<StatementSource[]>([]);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement>();
const pasteOpen = ref(false);
const pasteText = ref('');
const pasteLabel = ref('');
const importError = ref('');

const tolerance = ref<DateToleranceMode>('postpone');
const includePaid = ref(false);
const manualRange = ref(false);
const rangeFrom = ref('');
const rangeTo = ref('');

const bills = ref<Bill[]>([]);
const loadingBills = ref(false);
const billsError = ref('');
const editingBill = ref<Bill>();

const manualSelections = ref<Record<string, string>>({});
const checkedIds = ref<Set<string>>(new Set());
const userUncheckedIds = ref<Set<string>>(new Set());

const submitting = ref(false);
const submitMessage = ref('');
const submitErrors = ref<string[]>([]);

let sourceSeq = 0;
let fetchSeq = 0;

const toleranceItems: { value: DateToleranceMode; label: string }[] = [
  { value: 'postpone', label: '顺延 0~+3 天（推荐，覆盖周末/祝日）' },
  { value: 'around', label: '前后 ±3 天' },
  { value: 'exact', label: '仅扣款日当天（0 天）' },
];

function reparseSource(src: Omit<StatementSource, 'parsed'>): StatementSource {
  const parsed = extractTransactions(src.rows, {
    sourceId: src.id,
    sourceLabel: src.label,
    accountId: src.accountId,
    currency: src.currency,
    mapping: src.mapping,
  });
  return { ...src, parsed };
}

function addRawSource(label: string, text: string, encoding: StatementSource['encoding']) {
  importError.value = '';
  const { rows } = parseDelimitedTable(text);
  if (!rows.length) {
    importError.value = `「${label}」中没有可识别的数据行。`;
    return;
  }
  const preset = detectStatementPreset(rows[0]);
  const mapping = preset ? buildPresetMapping(preset, rows[0]) : guessDefaultMapping(rows);
  const currency: Currency = preset ? STATEMENT_PRESETS[preset].currency : store.defaultCurrency;
  const accountId = suggestAccountId(preset, store.accounts);
  const id = `src-${++sourceSeq}`;
  sources.value.push(
    reparseSource({
      id,
      label,
      encoding,
      preset,
      rows,
      accountId,
      currency,
      mapping,
    }),
  );
}

async function handleFiles(fileList: FileList | null) {
  if (!fileList?.length) return;
  importError.value = '';
  for (const file of Array.from(fileList)) {
    try {
      const buffer = await file.arrayBuffer();
      const { text, encoding } = decodeStatementBytes(new Uint8Array(buffer));
      addRawSource(file.name, text, encoding);
    } catch (e) {
      importError.value = `读取「${file.name}」失败：${(e as Error).message}`;
    }
  }
  if (fileInput.value) fileInput.value.value = '';
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  void handleFiles(event.dataTransfer?.files ?? null);
}

function importPaste() {
  const raw = pasteText.value.trim();
  if (!raw) return;
  const label = pasteLabel.value.trim() || `粘贴明细 #${sourceSeq + 1}`;
  addRawSource(label, raw, 'text');
  pasteText.value = '';
  pasteLabel.value = '';
  pasteOpen.value = false;
}

function updateSource(id: string, patch: { accountId?: string; currency?: Currency; mapping?: StatementMapping }) {
  sources.value = sources.value.map(src => {
    if (src.id !== id) return src;
    return reparseSource({
      ...src,
      accountId: patch.accountId ?? src.accountId,
      currency: patch.currency ?? src.currency,
      mapping: patch.mapping ?? src.mapping,
    });
  });
}

function removeSource(id: string) {
  sources.value = sources.value.filter(s => s.id !== id);
}

function clearAllSources() {
  sources.value = [];
  bills.value = [];
  manualSelections.value = {};
  checkedIds.value = new Set();
  userUncheckedIds.value = new Set();
  submitMessage.value = '';
  submitErrors.value = [];
  manualRange.value = false;
  rangeFrom.value = '';
  rangeTo.value = '';
  if (cacheOwner) void clearReconcileDraft(cacheOwner).catch(e => { cacheError.value = (e as Error).message; });
}

const autoRange = computed(() => {
  const ranges = sources.value
    .filter(s => s.accountId && s.parsed.dateRange)
    .map(s => s.parsed.dateRange!);
  return computeBillQueryRange(ranges, tolerance.value);
});

watch(
  [autoRange, manualRange],
  ([auto, manual]) => {
    if (!manual) {
      rangeFrom.value = auto?.from ?? '';
      rangeTo.value = auto?.to ?? '';
    }
  },
  { immediate: true },
);

function onRangeFromUpdate(v: string) {
  manualRange.value = true;
  rangeFrom.value = v;
}

function onRangeToUpdate(v: string) {
  manualRange.value = true;
  rangeTo.value = v;
}

function restoreAutoRange() {
  manualRange.value = false;
  rangeFrom.value = autoRange.value?.from ?? '';
  rangeTo.value = autoRange.value?.to ?? '';
}

const boundAccountIds = computed(() =>
  [...new Set(sources.value.map(s => s.accountId).filter(Boolean))].sort(),
);

const allTransactions = computed<BankTransaction[]>(() =>
  sources.value.filter(s => s.accountId).flatMap(s => s.parsed.transactions),
);

async function fetchBills() {
  if (restoring.value) return;
  const accounts = boundAccountIds.value;
  if (!accounts.length || !rangeFrom.value || !rangeTo.value) {
    bills.value = [];
    billsError.value = '';
    return;
  }
  if (rangeFrom.value > rangeTo.value) {
    billsError.value = '开始日期不能晚于结束日期';
    return;
  }
  const ticket = ++fetchSeq;
  loadingBills.value = true;
  billsError.value = '';
  try {
    const collected: Bill[] = [];
    for (const accountId of accounts) {
      let page = 1;
      while (true) {
        const params = new URLSearchParams({
          accountId,
          from: rangeFrom.value,
          to: rangeTo.value,
          page: String(page),
          pageSize: '100',
        });
        const res = await api<BillPage>(`/bills/search?${params}`);
        if (ticket !== fetchSeq) return;
        collected.push(...res.items);
        if (collected.length >= res.total || res.items.length < 100) break;
        page++;
      }
    }
    const dedup = new Map<string, Bill>();
    for (const b of collected) dedup.set(b.id, b);
    bills.value = Array.from(dedup.values());
  } catch (e) {
    if (ticket === fetchSeq) billsError.value = (e as Error).message;
  } finally {
    if (ticket === fetchSeq) loadingBills.value = false;
  }
}

watch(
  [boundAccountIds, rangeFrom, rangeTo, () => store.revision],
  () => { if (!restoring.value) void fetchBills(); },
  { immediate: true },
);

const result = computed(() =>
  reconcileBills({
    bills: bills.value,
    transactions: allTransactions.value,
    tolerance: tolerance.value,
    includePaid: includePaid.value,
    manualSelections: manualSelections.value,
  }),
);

// 重新读取服务器账单后再判断哪些手动选择仍然有效；不缓存旧的匹配结论。
function reconcileSelections() {
  if (restoring.value || loadingBills.value) return;
  const current = result.value;
  const validChoices = new Map(current.ambiguous.map(item => [
    item.bill.id,
    new Set(item.candidates.map(candidate => candidate.transaction.id)),
  ]));
  const nextSelections = Object.fromEntries(
    Object.entries(manualSelections.value).filter(([billId, txId]) => validChoices.get(billId)?.has(txId)),
  );
  if (Object.keys(nextSelections).length !== Object.keys(manualSelections.value).length) {
    manualSelections.value = nextSelections;
    return; // 重新计算匹配结果后再次校验。
  }
  const nextChecked = new Set<string>();
  for (const item of current.matched) {
    if (item.bill.status === 'pending' && !userUncheckedIds.value.has(item.bill.id)) {
      nextChecked.add(item.bill.id);
    }
  }
  for (const item of current.ambiguous) {
    if (item.bill.status !== 'pending') continue;
    const chosen = manualSelections.value[item.bill.id];
    if (chosen && validChoices.get(item.bill.id)?.has(chosen) && !userUncheckedIds.value.has(item.bill.id)) {
      nextChecked.add(item.bill.id);
    }
  }
  if ([...nextChecked].some(id => !checkedIds.value.has(id)) ||
      [...checkedIds.value].some(id => !nextChecked.has(id))) {
    checkedIds.value = nextChecked;
  }
}

watch(result, reconcileSelections, { immediate: true });
watch(loadingBills, busy => { if (!busy) reconcileSelections(); });

function toggleCheck(billId: string, checked: boolean) {
  const next = new Set(checkedIds.value);
  const nextUnchecked = new Set(userUncheckedIds.value);
  if (checked) {
    next.add(billId);
    nextUnchecked.delete(billId);
  } else {
    next.delete(billId);
    nextUnchecked.add(billId);
  }
  checkedIds.value = next;
  userUncheckedIds.value = nextUnchecked;
}

function selectManualCandidate(billId: string, txId: string) {
  const next = { ...manualSelections.value };
  if (!txId || txId === '__none__') {
    delete next[billId];
  } else {
    next[billId] = txId;
    const nextUnchecked = new Set(userUncheckedIds.value);
    nextUnchecked.delete(billId);
    userUncheckedIds.value = nextUnchecked;
  }
  manualSelections.value = next;
}

function isTxTakenByOther(txId: string, currentBillId: string): boolean {
  for (const [bId, selected] of Object.entries(manualSelections.value)) {
    if (bId !== currentBillId && selected === txId) return true;
  }
  return false;
}

const pendingMatched = computed(() => result.value.matched.filter(m => m.bill.status === 'pending'));
const paidMatched = computed(() => result.value.matched.filter(m => m.bill.status === 'paid'));

const selectedBillsToConfirm = computed(() => {
  const list: Bill[] = [];
  for (const m of pendingMatched.value) {
    if (checkedIds.value.has(m.bill.id)) list.push(m.bill);
  }
  for (const a of result.value.ambiguous) {
    if (a.bill.status !== 'pending') continue;
    const txId = manualSelections.value[a.bill.id];
    if (txId && checkedIds.value.has(a.bill.id)) list.push(a.bill);
  }
  return list;
});

function dayDeltaLabel(delta: number): string {
  if (delta === 0) return '同日';
  return delta > 0 ? `顺延 +${delta} 天` : `提前 ${Math.abs(delta)} 天`;
}

function signedDiffText(diffMinor: number, currency: Currency): string {
  if (diffMinor === 0) return formatMoney(0, currency);
  const sign = diffMinor > 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(diffMinor), currency)}`;
}

async function confirmSelectedPaid() {
  const targets = selectedBillsToConfirm.value;
  if (!targets.length || submitting.value) return;
  submitting.value = true;
  submitMessage.value = '';
  submitErrors.value = [];
  let succeeded = 0;

  for (const bill of targets) {
    try {
      await api(`/bills/${bill.id}/paid`, 'POST', { version: bill.version });
      succeeded++;
    } catch (e) {
      submitErrors.value.push(`${bill.cardName}（${bill.dueDate}）：${(e as Error).message}`);
    }
  }

  if (succeeded > 0) {
    submitMessage.value = `已确认 ${succeeded} 笔账单为「已扣款」。`;
    await store.refresh();
  }
  submitting.value = false;
}

function currentDraft(): ReconcileDraft {
  return {
    sources: sources.value.map(source => ({
      id: source.id,
      label: source.label,
      encoding: source.encoding,
      preset: source.preset,
      rows: source.rows.map(row => [...row]),
      accountId: source.accountId,
      currency: source.currency,
      mapping: { ...source.mapping },
    })),
    tolerance: tolerance.value,
    includePaid: includePaid.value,
    manualRange: manualRange.value,
    rangeFrom: rangeFrom.value,
    rangeTo: rangeTo.value,
    manualSelections: { ...manualSelections.value },
    checkedIds: [...checkedIds.value],
    userUncheckedIds: [...userUncheckedIds.value],
  };
}

function persistDraft() {
  if (restoring.value || !cacheOwner) return;
  void saveReconcileDraft(cacheOwner, currentDraft()).catch(e => {
    cacheError.value = (e as Error).message;
  });
}

watch(
  [sources, tolerance, includePaid, manualRange, rangeFrom, rangeTo, manualSelections, checkedIds, userUncheckedIds],
  () => {
    if (restoring.value || !cacheOwner) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistDraft, 350);
  },
  { deep: true },
);

onMounted(async () => {
  try {
    const profile = await api<{ username: string }>('/profile');
    cacheOwner = profile.username;
    const draft = await loadReconcileDraft(cacheOwner);
    if (draft) {
      const activeAccountIds = new Set(store.accounts.map(a => a.id));
      sources.value = draft.sources
        .filter(s => Array.isArray(s.rows) && s.rows.length > 0)
        .map(s => reparseSource({ ...s, accountId: activeAccountIds.has(s.accountId) ? s.accountId : '' }));
      sourceSeq = sources.value.length;
      tolerance.value = draft.tolerance;
      includePaid.value = draft.includePaid;
      manualRange.value = draft.manualRange;
      manualSelections.value = draft.manualSelections ?? {};
      checkedIds.value = new Set(draft.checkedIds ?? []);
      userUncheckedIds.value = new Set(draft.userUncheckedIds ?? []);
      if (draft.manualRange) {
        rangeFrom.value = draft.rangeFrom;
        rangeTo.value = draft.rangeTo;
      }
    }
  } catch (e) {
    cacheError.value = `无法恢复本机核验进度：${(e as Error).message}`;
  } finally {
    restoring.value = false;
    await fetchBills();
  }
});

onBeforeUnmount(() => {
  clearTimeout(persistTimer);
  persistDraft();
  pasteText.value = '';
  bills.value = [];
});
</script>

<template>
  <PageShell :entry="false">
    <template #actions>
      <RouterLink to="/bills" class="quiet">
        <SIcon icon="lucide:arrow-left" />
        <span>返回账单</span>
      </RouterLink>
    </template>

    <p v-if="cacheError" class="error" role="alert">{{ cacheError }}</p>
    <p v-if="restoring" class="muted">正在恢复本机核验进度…</p>
    <!-- 1. 导入流水区 -->
    <section class="panel stack" style="margin-bottom: 16px">
      <div
        class="drop-zone"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input
          ref="fileInput"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          multiple
          hidden
          @change="handleFiles(($event.target as HTMLInputElement).files)"
        />
        <div class="stack" style="align-items: center; gap: 6px; text-align: center">
          <SIcon icon="lucide:upload" style="font-size: 22px; color: var(--brand)" />
          <strong>拖入银行流水 CSV（可同时选择 SMBC + 楽天銀行 多份文件）</strong>
          <small class="muted">
            自动识别 UTF-8 / Shift_JIS 编码与银行格式；仅在浏览器内存处理，绝不上传服务器。
          </small>
          <div class="row wrap" style="justify-content: center; gap: 8px; margin-top: 6px">
            <button type="button" class="primary sm" @click="fileInput?.click()">选择 CSV 文件</button>
            <button type="button" class="quiet sm" @click="pasteOpen = !pasteOpen">
              <SIcon icon="lucide:clipboard-paste" />
              <span>{{ pasteOpen ? '收起粘贴框' : '粘贴网银明细文本' }}</span>
            </button>
            <button v-if="sources.length" type="button" class="quiet sm" @click="clearAllSources">
              清空全部流水
            </button>
          </div>
        </div>
      </div>

      <div v-if="pasteOpen" class="paste-box stack">
        <div class="row wrap" style="gap: 10px">
          <label style="flex: 1; min-width: 200px">
            来源名称（可选）
            <input v-model="pasteLabel" placeholder="例如：SMBC 网页复制" maxlength="60" />
          </label>
        </div>
        <label>
          粘贴 CSV 或网页表格复制的文本（支持逗号或 Tab 分隔）
          <textarea
            v-model="pasteText"
            rows="5"
            placeholder="可直接从网银明细表复制后粘贴到这里…"
          />
        </label>
        <div class="row" style="justify-content: flex-end; gap: 8px">
          <button type="button" class="quiet sm" @click="pasteOpen = false">取消</button>
          <button type="button" class="primary sm" :disabled="!pasteText.trim()" @click="importPaste">
            解析粘贴内容
          </button>
        </div>
      </div>

      <p v-if="importError" class="error" role="alert">{{ importError }}</p>
    </section>

    <section v-if="sources.length" class="stack" style="gap: 12px; margin-bottom: 16px">
      <StatementSourceCard
        v-for="src in sources"
        :key="src.id"
        :source="src"
        :accounts="store.accounts"
        @update="updateSource"
        @remove="removeSource"
      />
    </section>

    <!-- 2. 核验条件栏 -->
    <section v-if="sources.length" class="filter-bar">
      <div class="toolbar">
        <div class="field date-range-field">
          <span>账单扣款日范围</span>
          <DateRangeInput
            :from="rangeFrom"
            :to="rangeTo"
            label="账单扣款日范围"
            @update:from="onRangeFromUpdate"
            @update:to="onRangeToUpdate"
          />
        </div>
        <div class="field filter-select" style="min-width: 240px">
          <span>日期匹配容差</span>
          <SSelect
            :model-value="tolerance"
            :items="toleranceItems"
            :trigger-props="{ 'aria-label': '日期匹配容差' }"
            @update:model-value="v => (tolerance = String(v) as DateToleranceMode)"
          />
        </div>
        <label class="checkbox-inline">
          <input v-model="includePaid" type="checkbox" />
          <span>同时复核已扣款（paid）</span>
        </label>
        <button v-if="manualRange" type="button" class="quiet sm" @click="restoreAutoRange">
          恢复自动范围
        </button>
      </div>
    </section>

    <p v-if="billsError" class="error" role="alert" style="margin-bottom: 12px">{{ billsError }}</p>
    <p v-if="submitMessage" class="saved-notice" role="status" style="margin-bottom: 12px">{{ submitMessage }}</p>
    <div v-if="submitErrors.length" class="panel error stack" role="alert" style="margin-bottom: 12px; gap: 4px">
      <strong>部分账单确认失败：</strong>
      <small v-for="(err, idx) in submitErrors" :key="idx">{{ err }}</small>
    </div>

    <template v-if="sources.length && boundAccountIds.length">
      <!-- 3. 核验汇总与提交条 -->
      <section class="panel row wrap" style="margin-bottom: 16px; gap: 12px">
        <div class="row wrap" style="gap: 10px; justify-content: flex-start">
          <span class="badge">待确认命中 {{ pendingMatched.length }} 笔</span>
          <span v-if="includePaid" class="status paid">已扣款一致 {{ paidMatched.length }} 笔</span>
          <span v-if="result.ambiguous.length" class="status pending">
            多候选待指定 {{ result.ambiguous.length }} 笔
          </span>
          <span class="status void">未命中 {{ result.unmatched.length }} 笔</span>
          <span class="muted">未匹配出金 {{ result.unmatchedTransactions.length }} 条</span>
        </div>
        <button
          type="button"
          class="primary"
          :disabled="submitting || loadingBills || selectedBillsToConfirm.length === 0"
          @click="confirmSelectedPaid"
        >
          <SIcon icon="lucide:check-check" />
          <span>
            {{
              submitting
                ? '正在确认…'
                : `确认所选已扣款（${selectedBillsToConfirm.length} 笔）`
            }}
          </span>
        </button>
      </section>

      <div v-if="loadingBills" class="panel empty">正在加载对应账户的账单…</div>

      <div v-else class="stack" style="gap: 16px">
        <!-- 区块 A：唯一命中 -->
        <section class="panel stack">
          <div class="row wrap">
            <h2>唯一命中（{{ result.matched.length }}）</h2>
            <small class="muted">同账户、同币种、金额精确相等且在容差窗口内唯一对应。</small>
          </div>
          <p v-if="!result.matched.length" class="muted">暂无唯一命中的账单。</p>
          <div v-else class="data-table">
            <article
              v-for="item in result.matched"
              :key="item.bill.id"
              class="data-row reconcile-row"
            >
              <div class="reconcile-check">
                <input
                  v-if="item.bill.status === 'pending'"
                  type="checkbox"
                  :checked="checkedIds.has(item.bill.id)"
                  :aria-label="`选择确认 ${item.bill.cardName}`"
                  @change="toggleCheck(item.bill.id, ($event.target as HTMLInputElement).checked)"
                />
                <span v-else class="status paid">已一致</span>
              </div>
              <div class="reconcile-bill">
                <strong>{{ item.bill.cardName }}</strong>
                <small class="muted">
                  {{ item.bill.accountName }} · 账单日 {{ shortDate(item.bill.dueDate) }}
                </small>
              </div>
              <div class="reconcile-amount num">{{ formatMoney(item.bill.amountMinor, item.bill.currency) }}</div>
              <div class="reconcile-tx">
                <div class="row wrap" style="gap: 6px; justify-content: flex-start">
                  <span class="num">{{ shortDate(item.transaction.date) }}</span>
                  <span class="badge">{{ dayDeltaLabel(item.dayDelta) }}</span>
                </div>
                <small class="muted">{{ item.transaction.description || '（无摘要）' }}</small>
              </div>
            </article>
          </div>
        </section>

        <!-- 区块 B：多候选待手动指定 -->
        <section v-if="result.ambiguous.length" class="panel stack">
          <div class="row wrap">
            <h2>多候选待手动指定（{{ result.ambiguous.length }}）</h2>
            <small class="muted">同一窗口存在多笔同额记录，请结合银行摘要手动指定 1 对 1 匹配。</small>
          </div>
          <div class="data-table">
            <article
              v-for="item in result.ambiguous"
              :key="item.bill.id"
              class="data-row reconcile-row"
            >
              <div class="reconcile-check">
                <input
                  v-if="item.bill.status === 'pending'"
                  type="checkbox"
                  :disabled="!manualSelections[item.bill.id]"
                  :checked="checkedIds.has(item.bill.id)"
                  @change="toggleCheck(item.bill.id, ($event.target as HTMLInputElement).checked)"
                />
                <span v-else class="status paid">已扣款</span>
              </div>
              <div class="reconcile-bill">
                <strong>{{ item.bill.cardName }}</strong>
                <small class="muted">
                  {{ item.bill.accountName }} · 账单日 {{ shortDate(item.bill.dueDate) }}
                </small>
              </div>
              <div class="reconcile-amount num">{{ formatMoney(item.bill.amountMinor, item.bill.currency) }}</div>
              <div class="reconcile-tx">
                <select
                  class="candidate-select"
                  :value="manualSelections[item.bill.id] || '__none__'"
                  @change="selectManualCandidate(item.bill.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="__none__">请选择对应的银行流水…</option>
                  <option
                    v-for="cand in item.candidates"
                    :key="cand.transaction.id"
                    :value="cand.transaction.id"
                    :disabled="isTxTakenByOther(cand.transaction.id, item.bill.id)"
                  >
                    {{ cand.transaction.date }}（{{ dayDeltaLabel(cand.dayDelta) }}）·
                    {{ cand.transaction.description || '无摘要' }}
                  </option>
                </select>
              </div>
            </article>
          </div>
        </section>

        <!-- 区块 C：未命中账单 -->
        <section v-if="result.unmatched.length" class="panel stack">
          <div class="row wrap">
            <h2>未命中账单（{{ result.unmatched.length }}）</h2>
            <small class="muted">在当前容差窗口内未找到同额出金，可核对下方疑差额线索或编辑账单。</small>
          </div>
          <div class="stack" style="gap: 10px">
            <article v-for="item in result.unmatched" :key="item.bill.id" class="unmatched-card">
              <div class="row wrap" style="gap: 10px">
                <div class="row wrap" style="gap: 8px; justify-content: flex-start">
                  <strong>{{ item.bill.cardName }}</strong>
                  <span class="status" :class="item.bill.status">
                    {{ item.bill.status === 'paid' ? '已标已扣款（未匹配到流水）' : '待扣款' }}
                  </span>
                  <small class="muted">{{ item.bill.accountName }} · {{ shortDate(item.bill.dueDate) }}</small>
                </div>
                <div class="row wrap" style="gap: 10px">
                  <strong class="num">{{ formatMoney(item.bill.amountMinor, item.bill.currency) }}</strong>
                  <button type="button" class="quiet sm" @click="editingBill = item.bill">编辑账单</button>
                </div>
              </div>

              <div v-if="item.nearClues.length" class="clue-list">
                <small class="muted">同窗口疑差额线索（未匹配出金）：</small>
                <div v-for="clue in item.nearClues" :key="clue.transaction.id" class="clue-item">
                  <span class="num">{{ shortDate(clue.transaction.date) }}</span>
                  <span>{{ clue.transaction.description || '（无摘要）' }}</span>
                  <span class="num">{{ formatMoney(clue.transaction.amountMinor, clue.transaction.currency) }}</span>
                  <span class="badge">
                    差额 {{ signedDiffText(clue.diffMinor, clue.transaction.currency) }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <!-- 区块 D：未匹配的银行出金（默认折叠） -->
        <details v-if="result.unmatchedTransactions.length" class="panel">
          <summary class="unmatched-summary">
            <span>未匹配的银行出金（{{ result.unmatchedTransactions.length }} 条）</span>
            <small class="muted">展开查看未绑定到账单的出金流水（日常消费、事前返済或漏录账单）</small>
          </summary>
          <div class="data-table" style="margin-top: 12px">
            <article
              v-for="tx in result.unmatchedTransactions"
              :key="tx.id"
              class="data-row tx-row"
            >
              <div class="tx-date num">{{ shortDate(tx.date) }}</div>
              <div class="tx-desc">
                <strong>{{ tx.description || '（无摘要）' }}</strong>
                <small class="muted">
                  {{ store.accountById.get(tx.accountId)?.name || tx.sourceLabel }} · 第 {{ tx.rowIndex }} 行
                </small>
              </div>
              <div class="tx-amount num">{{ formatMoney(tx.amountMinor, tx.currency) }}</div>
            </article>
          </div>
        </details>
      </div>
    </template>

    <BillEditor v-if="editingBill" :bill="editingBill" @close="editingBill = undefined" />
  </PageShell>
</template>

<style scoped>
.drop-zone {
  padding: 24px 16px;
  border: 1.5px dashed var(--line-strong, var(--line-subtle));
  border-radius: var(--radius-md);
  background: var(--surface-canvas);
  transition: border-color 0.15s var(--ease), background-color 0.15s var(--ease);
}

.drop-zone.dragging {
  border-color: var(--brand);
  background: var(--surface-hover);
}

.paste-box {
  padding-top: 12px;
  border-top: 1px solid var(--line-subtle);
  gap: 10px;
}

.checkbox-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: var(--control-h);
  font-size: 13px;
  cursor: pointer;
}

.checkbox-inline input {
  width: 16px;
  height: 16px;
}

.reconcile-row {
  grid-template-columns: 64px minmax(0, 1.2fr) minmax(110px, auto) minmax(0, 1.6fr);
  gap: 12px;
  align-items: center;
}

.reconcile-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.reconcile-check input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.reconcile-bill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.reconcile-bill strong {
  font-size: 13.5px;
  font-weight: 580;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reconcile-amount,
.tx-amount {
  text-align: right;
  font-size: 14px;
  font-weight: 650;
  color: var(--text-primary);
  white-space: nowrap;
}

.reconcile-tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.reconcile-tx small {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.candidate-select {
  width: 100%;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-subtle);
  background: var(--surface-card, var(--surface-canvas));
}

.unmatched-card {
  padding: 12px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.clue-list {
  padding-top: 8px;
  border-top: 1px dashed var(--line-subtle);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.clue-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.unmatched-summary {
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.tx-row {
  grid-template-columns: 108px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.tx-date {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  padding-top: 2px;
}

.tx-desc {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.tx-desc strong {
  font-size: 13.5px;
  font-weight: 580;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
}

@media (max-width: 720px) {
  .reconcile-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .reconcile-check {
    justify-content: flex-start;
  }

  .reconcile-amount {
    text-align: left;
  }

  .tx-row {
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
  }

  .tx-desc {
    grid-column: 1 / -1;
    order: 3;
  }
}
</style>
