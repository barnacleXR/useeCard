<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Review } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import ReviewLinkDialog from '../components/ReviewLinkDialog.vue';
import MonthInput from '../components/fields/MonthInput.vue';
const store = useWorkspace(); const selected = ref<string[]>([]); const lowOpen = ref(false); const linking = ref<Review>();
const visible = computed(() => store.reviews.filter(r => lowOpen.value || r.frequency === 'regular'));
watch(() => store.reviewMonth, () => { selected.value = []; });
// 折叠低频卡时取消其勾选，避免批量确认看不见的卡。
watch(lowOpen, open => { if (!open) selected.value = selected.value.filter(id => visible.value.some(r => r.id === id)); });
const missingCards = computed(() => store.reviews.length ? store.cards.filter(c => !c.archivedAt && !store.reviews.some(r => r.cardId === c.id)) : []);
const statusText = (r: Review) => r.status === 'unreviewed' ? '未确认' : r.status === 'no_new' ? '无新增账单' : `已核对 ${r.billIds.length} 笔`;
async function start() { try { await store.mutate(`/reviews/${store.reviewMonth}/start`); } catch {} }
async function addCards() { if (confirm(`将 ${missingCards.value.map(c => c.name).join('、')} 加入 ${store.reviewMonth} 检查清单？`)) try { await store.mutate(`/reviews/${store.reviewMonth}/cards`, {cardIds: missingCards.value.map(c => c.id)}); } catch {} }
async function confirmNone() {
  const items = store.reviews.filter(r => selected.value.includes(r.id)); if (!items.length) return;
  const linked = items.some(r => r.billIds.length); if (linked && !confirm('所选检查项已关联账单。解除关联并确认无新增？实际账单仍保留。')) return;
  try { await store.mutate(`/reviews/${store.reviewMonth}/confirm`, {items: items.map(r => ({id: r.id, version: r.version, status: 'no_new', unlinkConfirmed: linked}))}); selected.value = []; } catch {}
}
</script>
<template>
  <PageShell>
    <section class="panel">
      <div class="row wrap"><div><h2>逐卡核对，不用填零</h2><p class="muted">无新增只表示本轮检查结论，不抵消已有待还账单。</p></div><div class="field"><span>检查月份</span><MonthInput v-model="store.reviewMonth" label="检查月份"/></div></div>
      <button v-if="!store.reviews.length" class="primary" @click="start">创建本月检查清单</button>
      <template v-else>
        <div class="row wrap"><button class="quiet" @click="lowOpen = !lowOpen">{{ lowOpen ? '折叠' : '展开' }}低频卡（{{ store.reviews.filter(r => r.frequency === 'low').length }}）</button><button class="primary" :disabled="!selected.length" @click="confirmNone">所选 {{ selected.length }} 张无新增账单</button></div>
        <div v-if="missingCards.length" class="row notice"><span>{{ missingCards.length }} 张卡在清单创建后新增，未加入本轮检查。</span><button class="quiet" @click="addCards">加入本轮</button></div>
        <div v-for="review in visible" :key="review.id" class="review-row">
          <label class="checkbox"><input v-model="selected" type="checkbox" :value="review.id">{{ review.cardName }}</label>
          <span class="status" :class="review.status">{{ statusText(review) }}</span>
          <button class="quiet" @click="linking = review">关联账单</button>
        </div>
        <p class="muted">检查月份和扣款月份相互独立，可关联任意月份录入的账单。</p>
      </template>
    </section>
    <ReviewLinkDialog v-if="linking" :review="linking" :month="store.reviewMonth" @close="linking = undefined"/>
  </PageShell>
</template>
