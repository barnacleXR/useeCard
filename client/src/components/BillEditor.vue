<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { SSelect } from '@vean/ui';
import {
  computeBillPrefill,
  currencies,
  parseMoney,
  moneyDecimal,
  type Bill,
  type BillPrefill,
  type Currency,
} from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import ModalDialog from './ModalDialog.vue';
import DateInput from './fields/DateInput.vue';
import MonthInput from './fields/MonthInput.vue';

const props = defineProps<{ bill?: Bill }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();

const initialPrefill = props.bill ? null : computeBillPrefill();
const cardId = ref(props.bill?.cardId || '');
const accountId = ref(props.bill?.debitAccountId || '');
const currency = ref<Currency>(props.bill?.currency || store.defaultCurrency);
const cardItems = computed(() =>
  store.cards.filter(c => !c.archivedAt || c.id === props.bill?.cardId).map(c => ({ value: c.id, label: c.name })),
);
const accountItems = computed(() =>
  store.accounts
    .filter(a => !a.archivedAt || a.id === props.bill?.debitAccountId)
    .map(a => ({ value: a.id, label: a.name })),
);
const currencyItems = Object.keys(currencies).map(value => ({ value, label: value }));
const amount = ref(props.bill ? moneyDecimal(props.bill.amountMinor, props.bill.currency) : '');
const dueDate = ref(props.bill?.dueDate || initialPrefill?.dueDate || '');
const note = ref(props.bill?.note || '');
const statementMonth = ref(props.bill ? props.bill.statementMonth || '' : initialPrefill?.statementMonth || '');
const dueDateTouched = ref(!!props.bill);
const statementMonthTouched = ref(!!props.bill);
const error = ref('');
const savedNotice = ref('');
const busy = ref(false);
const continueNext = ref(false);

let key = crypto.randomUUID();
let lastPayload = '';
let prefillSeq = 0;

function onAmountInput(event: Event) {
  const input = event.target as HTMLInputElement;
  // 粘贴或输入带千分位逗号、货币符号、空格或全角数字时自动清理，便于直接复制银行 App 金额。
  const cleaned = input.value
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/[,，\s\u3000¥￥円]/g, '');
  if (input.value !== cleaned) input.value = cleaned;
  amount.value = cleaned;
  savedNotice.value = '';
}

function onDueDateInput(value: string) {
  dueDate.value = value;
  dueDateTouched.value = true;
  savedNotice.value = '';
}

function onStatementMonthInput(value: string) {
  statementMonth.value = value;
  statementMonthTouched.value = true;
  savedNotice.value = '';
}

watch(cardId, async value => {
  if (value) savedNotice.value = '';
  const card = store.cards.find(c => c.id === value);
  if (!card) return;
  accountId.value = card.defaultDebitAccountId;
  currency.value = card.defaultCurrency;
  if (props.bill || (dueDateTouched.value && statementMonthTouched.value)) return;
  const seq = ++prefillSeq;
  // 先用卡片常规扣款日同步预填，再以服务端历史规则补齐归属月或无配置卡的历史扣款日。
  const local = computeBillPrefill({ defaultDueDay: card.defaultDueDay });
  if (!dueDateTouched.value && card.defaultDueDay) dueDate.value = local.dueDate;
  try {
    const prefill = await api<BillPrefill>(`/bills/prefill?cardId=${encodeURIComponent(value)}`);
    if (seq !== prefillSeq || cardId.value !== value) return;
    if (!dueDateTouched.value) dueDate.value = prefill.dueDate;
    if (!statementMonthTouched.value) statementMonth.value = prefill.statementMonth;
  } catch {
    if (seq !== prefillSeq || cardId.value !== value) return;
    if (!dueDateTouched.value) dueDate.value = local.dueDate;
    if (!statementMonthTouched.value) statementMonth.value = local.statementMonth;
  }
});

async function save(andContinue = false) {
  error.value = '';
  savedNotice.value = '';
  if (!cardId.value || !accountId.value) {
    error.value = '请选择信用卡和扣款账户';
    return;
  }
  if (!dueDate.value) {
    error.value = '请选择实际扣款日';
    return;
  }
  try {
    const amountMinor = parseMoney(amount.value, currency.value);
    const duplicate = store.bills.some(
      b =>
        b.id !== props.bill?.id &&
        b.cardId === cardId.value &&
        b.currency === currency.value &&
        b.amountMinor === amountMinor &&
        b.dueDate === dueDate.value &&
        b.status !== 'void',
    );
    if (duplicate && !confirm('发现同卡、同日、同币种、同金额账单，仍然保存？')) return;
    const changed = props.bill && props.bill.currency !== currency.value;
    if (changed && !confirm(`币种改为 ${currency.value}，请确认金额 ${amount.value}，系统不会换汇。`)) return;
    const payload = {
      cardId: cardId.value,
      debitAccountId: accountId.value,
      amountMinor,
      currency: currency.value,
      dueDate: dueDate.value,
      statementMonth: statementMonth.value || null,
      note: note.value,
      ...(props.bill ? { version: props.bill.version, confirmCurrencyChange: !!changed } : {}),
    };
    const serialized = JSON.stringify(payload);
    if (lastPayload && serialized !== lastPayload) key = crypto.randomUUID();
    lastPayload = serialized;
    busy.value = true;
    continueNext.value = andContinue;
    await store.mutate(
      props.bill ? `/bills/${props.bill.id}` : '/bills',
      payload,
      props.bill ? 'PATCH' : 'POST',
      props.bill ? undefined : key,
    );
    if (andContinue && !props.bill) {
      prefillSeq++;
      cardId.value = '';
      accountId.value = '';
      amount.value = '';
      note.value = '';
      dueDateTouched.value = false;
      statementMonthTouched.value = false;
      key = crypto.randomUUID();
      lastPayload = '';
      savedNotice.value = '已保存，可继续录入下一条';
    } else {
      emit('close');
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    continueNext.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :title="bill ? '编辑账单' : '录入账单'"
    subtitle="参照信用卡 App 填写银行实际要求偿还的金额与日期。"
    :busy="busy"
    title-id="bill-title"
    @close="emit('close')"
  >
    <form id="bill-editor-form" class="form-grid" @submit.prevent="save(false)">
      <div class="field full">
        <span>信用卡</span>
        <SSelect
          v-model="cardId"
          :items="cardItems"
          placeholder="选择信用卡"
          :trigger-props="{ 'aria-label': '信用卡' }"
        />
      </div>

      <div class="field full">
        <span>扣款账户</span>
        <SSelect
          v-model="accountId"
          :items="accountItems"
          placeholder="选择账户"
          :trigger-props="{ 'aria-label': '扣款账户' }"
        />
      </div>

      <div class="field">
        <span>币种</span>
        <SSelect
          v-model="currency"
          :items="currencyItems"
          :trigger-props="{ 'aria-label': '币种' }"
        />
      </div>

      <label>
        应还金额
        <input
          :value="amount"
          required
          inputmode="decimal"
          placeholder="银行账单金额"
          @input="onAmountInput"
        />
        <small v-if="amount === '0'">无新增账单请前往月度检查，不必录入零元。</small>
      </label>

      <div class="field">
        <span>实际扣款日</span>
        <DateInput :model-value="dueDate" label="实际扣款日" @update:model-value="onDueDateInput" />
      </div>

      <div class="field">
        <span>账单归属月（可选）</span>
        <MonthInput
          :model-value="statementMonth"
          clearable
          label="账单归属月"
          @update:model-value="onStatementMonthInput"
        />
      </div>

      <label class="full">
        备注
        <textarea v-model="note" maxlength="1000" rows="3" placeholder="可选备注" @input="savedNotice = ''" />
      </label>

      <p v-if="savedNotice" class="saved-notice full" role="status">{{ savedNotice }}</p>
      <p v-if="error" class="error full" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <button type="button" class="quiet" :disabled="busy" @click="emit('close')">取消</button>
      <button v-if="!bill" type="button" class="quiet" :disabled="busy" @click="save(true)">
        {{ busy && continueNext ? '正在保存…' : '保存并继续' }}
      </button>
      <button type="submit" form="bill-editor-form" class="primary" :disabled="busy">
        {{ busy && !continueNext ? '正在保存…' : '保存账单' }}
      </button>
    </template>
  </ModalDialog>
</template>
