<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { formatMoney, type Bill, type Review } from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
const props = defineProps<{review: Review; month: string}>(); const emit = defineEmits<{close: []}>(); const store = useWorkspace();
// 候选账单不受扣款月份筛选限制：跨月已有账单也可被本轮检查引用。
const candidates = ref<Bill[]>([]); const selected = ref<string[]>([...props.review.billIds]); const loading = ref(true); const busy = ref(false); const error = ref('');
onMounted(async () => {
  try { candidates.value = (await api<Bill[]>(`/bills?cardId=${props.review.cardId}`)).filter(b => b.status !== 'void'); }
  catch (e) { error.value = (e as Error).message; } finally { loading.value = false; }
});
async function save() {
  error.value = '';
  if (!selected.value.length) { error.value = '请至少勾选一笔账单；没有账单请使用“无新增账单”。'; return; }
  busy.value = true;
  try { await store.mutate(`/reviews/${props.month}/confirm`, {items: [{id: props.review.id, version: props.review.version, status: 'reviewed', billIds: selected.value}]}); emit('close'); }
  catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('close')"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="link-title"><header class="row"><h2 id="link-title">{{ review.cardName }} · 关联账单</h2><button type="button" class="quiet" :disabled="busy" @click="emit('close')">关闭</button></header>
  <p class="muted">勾选本轮（{{ month }}）检查已核对的账单，可选择其他月份录入的账单。</p>
  <div v-if="loading" class="empty">正在读取账单…</div>
  <div v-else-if="!candidates.length" class="empty">这张卡还没有有效账单，请先录入账单。</div>
  <form v-else class="stack" @submit.prevent="save">
    <label v-for="bill in candidates" :key="bill.id" class="checkbox link-option"><input v-model="selected" type="checkbox" :value="bill.id"><span class="bill-info"><strong>{{ formatMoney(bill.amountMinor, bill.currency) }}</strong><small>{{ bill.dueDate }} · {{ bill.accountName }}{{ bill.status === 'paid' ? ' · 已扣款' : '' }}</small></span></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p><button class="primary" :disabled="busy">{{ busy ? '正在保存…' : `确认关联 ${selected.length} 笔` }}</button>
  </form>
  <p v-if="error && !candidates.length" class="error" role="alert">{{ error }}</p>
  </section></div>
</template>
