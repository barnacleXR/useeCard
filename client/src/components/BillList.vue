<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { formatMoney, type Bill } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import { shortDate } from '../format';
import BillEditor from './BillEditor.vue';
import EntityIcon from './EntityIcon.vue';
import CardArtwork from './CardArtwork.vue';
import CardBrandBadge from './CardBrandBadge.vue';
// 行布局：图标 | 名称 | 扣款账户 | 日期 | 状态 | 金额 | 操作菜单。
withDefaults(defineProps<{bills: Bill[]; empty?: string}>(), {empty: '这里还没有账单。'});
const store = useWorkspace(); const editing = ref<Bill>(); const pending = ref(''); const menu = ref('');
const statusText = (bill: Bill) => bill.status === 'paid' ? '已扣款' : bill.status === 'void' ? '已作废' : '待扣款';
async function action(bill: Bill, name: string) {
  menu.value = '';
  if (name === 'void' && !confirm('作废这笔账单？历史记录会保留，并从汇总中排除。')) return;
  pending.value = bill.id;
  try { await store.mutate(`/bills/${bill.id}/${name}`, {version: bill.version}); } catch { /* 错误由页面统一显示。 */ } finally { pending.value = ''; }
}
function edit(bill: Bill) { menu.value = ''; editing.value = bill; }
// 点击菜单外部或按 Esc 收起操作菜单。
const close = (event: Event) => { if (!(event.target as Element).closest?.('.row-actions')) menu.value = ''; };
const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') menu.value = ''; };
onMounted(() => { document.addEventListener('click', close); document.addEventListener('keydown', escape); });
onBeforeUnmount(() => { document.removeEventListener('click', close); document.removeEventListener('keydown', escape); });
</script>
<template>
  <div v-if="!bills.length" class="empty">{{ empty }}</div>
  <div v-else class="row-list">
    <article v-for="bill in bills" :key="bill.id" class="list-row bill-row" :class="bill.status">
      <CardArtwork class="row-logo" :name="bill.cardName" :asset-id="store.cardById.get(bill.cardId)?.iconAssetId" :last4="store.cardById.get(bill.cardId)?.last4" :width="64"/>
      <div class="row-name"><strong>{{ bill.cardName }}</strong><span class="card-network-line"><CardBrandBadge :brand="store.cardById.get(bill.cardId)?.brand ?? ''"/><small v-if="store.cardById.get(bill.cardId)?.last4">•••• {{ store.cardById.get(bill.cardId)?.last4 }}</small></span><small v-if="bill.note" class="row-note">{{ bill.note }}</small></div>
      <div class="row-account"><EntityIcon :name="bill.accountName" :asset-id="store.accountById.get(bill.debitAccountId)?.iconAssetId" :size="22"/><span>{{ bill.accountName }}</span></div>
      <div class="row-date">{{ shortDate(bill.dueDate) }}</div>
      <div class="row-status"><span class="status" :class="bill.status">{{ statusText(bill) }}</span></div>
      <div class="row-price">{{ formatMoney(bill.amountMinor, bill.currency) }}</div>
      <div class="row-actions">
        <template v-if="bill.status !== 'void'">
          <button type="button" class="menu-trigger" :aria-expanded="menu === bill.id" :aria-label="`${bill.cardName} ${bill.dueDate} 的操作`" :disabled="pending === bill.id" @click="menu = menu === bill.id ? '' : bill.id">⋮</button>
          <div v-if="menu === bill.id" class="row-menu" role="menu">
            <button type="button" role="menuitem" @click="edit(bill)">编辑</button>
            <button type="button" role="menuitem" @click="action(bill, bill.status === 'paid' ? 'undo-paid' : 'paid')">{{ bill.status === 'paid' ? '撤销已扣款' : '确认已扣款' }}</button>
            <button type="button" role="menuitem" class="danger" @click="action(bill, 'void')">作废</button>
          </div>
        </template>
      </div>
    </article>
  </div>
  <BillEditor v-if="editing" :bill="editing" @close="editing = undefined"/>
</template>
