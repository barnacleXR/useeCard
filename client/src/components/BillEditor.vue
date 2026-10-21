<script setup lang="ts">
import { ref, watch } from 'vue';
import { currencies, parseMoney, moneyDecimal, type Bill, type Currency } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
const props = defineProps<{bill?: Bill}>(); const emit = defineEmits<{close: []}>(); const store = useWorkspace();
const cardId = ref(props.bill?.cardId || ''); const accountId = ref(props.bill?.debitAccountId || ''); const currency = ref<Currency>(props.bill?.currency || store.defaultCurrency);
const amount = ref(props.bill ? moneyDecimal(props.bill.amountMinor, props.bill.currency) : ''); const dueDate = ref(props.bill?.dueDate || ''); const note = ref(props.bill?.note || ''); const statementMonth = ref(props.bill?.statementMonth || '');
const error = ref(''); const busy = ref(false); let key = crypto.randomUUID(); let lastPayload = '';
watch(cardId, value => { const card = store.cards.find(c => c.id === value); if (card) { accountId.value = card.defaultDebitAccountId; currency.value = card.defaultCurrency; } });
async function save() {
  error.value = '';
  try {
    const amountMinor = parseMoney(amount.value, currency.value);
    const duplicate = store.bills.some(b => b.id !== props.bill?.id && b.cardId === cardId.value && b.currency === currency.value && b.amountMinor === amountMinor && b.dueDate === dueDate.value && b.status !== 'void');
    if (duplicate && !confirm('发现同卡、同日、同币种、同金额账单，仍然保存？')) return;
    const changed = props.bill && props.bill.currency !== currency.value;
    if (changed && !confirm(`币种改为 ${currency.value}，请确认金额 ${amount.value}，系统不会换汇。`)) return;
    const payload = {cardId: cardId.value, debitAccountId: accountId.value, amountMinor, currency: currency.value, dueDate: dueDate.value, statementMonth: statementMonth.value || null, note: note.value, ...(props.bill ? {version: props.bill.version, confirmCurrencyChange: !!changed} : {})};
    const serialized = JSON.stringify(payload); if (lastPayload && serialized !== lastPayload) key = crypto.randomUUID(); lastPayload = serialized;
    busy.value = true; await store.mutate(props.bill ? `/bills/${props.bill.id}` : '/bills', payload, props.bill ? 'PATCH' : 'POST', props.bill ? undefined : key); emit('close');
  } catch(e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('close')"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="bill-title"><header class="row"><h2 id="bill-title">{{ bill ? '编辑账单' : '录入账单' }}</h2><button type="button" class="quiet" :disabled="busy" @click="emit('close')">关闭</button></header>
  <p class="muted">参照信用卡 App 填写银行实际要求偿还的金额与日期。</p>
  <form class="form-grid" @submit.prevent="save">
    <label>信用卡<select v-model="cardId" required><option value="" disabled>选择信用卡</option><option v-for="card in store.cards.filter(c => !c.archivedAt || c.id === bill?.cardId)" :key="card.id" :value="card.id">{{ card.name }}</option></select></label>
    <label>扣款账户<select v-model="accountId" required><option value="" disabled>选择账户</option><option v-for="account in store.accounts.filter(a => !a.archivedAt || a.id === bill?.debitAccountId)" :key="account.id" :value="account.id">{{ account.name }}</option></select></label>
    <label>币种<select v-model="currency"><option v-for="(_, code) in currencies" :key="code">{{ code }}</option></select></label>
    <label>应还金额<input v-model="amount" required inputmode="decimal" placeholder="银行账单金额"><small v-if="amount === '0'">无新增账单请前往月度检查，不必录入零元。</small></label>
    <label>实际扣款日<input v-model="dueDate" type="date" required></label><label>账单归属月（可选）<input v-model="statementMonth" type="month"></label>
    <label class="full">备注<textarea v-model="note" maxlength="1000" rows="2"/></label>
    <p v-if="error" class="error full" role="alert">{{ error }}</p><button class="primary full" :disabled="busy">{{ busy ? '正在保存…' : '保存账单' }}</button>
  </form></section></div>
</template>
