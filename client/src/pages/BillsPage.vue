<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { billSearchInput, currencies, japanMonth, type BillPage, type BillSearch } from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import BillList from '../components/BillList.vue';
const store = useWorkspace();
// 默认显示当前日本月份；清空日期即查询全部历史。
const monthRange = (month: string) => { const [y, m] = month.split('-').map(Number); return {from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`}; };
const blank = () => ({...monthRange(japanMonth()), cardId: '', accountId: '', currency: '', status: ''});
const route = useRoute();
function linkedFilters() { const parsed = billSearchInput.safeParse(route.query); if (!parsed.success || !Object.keys(route.query).length) return blank(); const q = parsed.data; return {from:q.from||'',to:q.to||'',cardId:q.cardId||'',accountId:q.accountId||'',currency:q.currency||'',status:q.status||''}; }
const filters = ref(linkedFilters()); const page = ref(1); const pageSize = 20;
const result = ref<BillPage>({items: [], total: 0, page: 1, pageSize}); const loading = ref(false); const error = ref('');
const pages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)));
let sequence = 0;
async function load() {
  const ticket = ++sequence; loading.value = true; error.value = '';
  const query: BillSearch = {...filters.value, page: page.value, pageSize};
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)]));
  try { const data = await api<BillPage>(`/bills/search?${params}`); if (ticket === sequence) result.value = data; }
  catch (e) { if (ticket === sequence) error.value = (e as Error).message; }
  finally { if (ticket === sequence) loading.value = false; }
}
watch(filters, () => { if (page.value === 1) void load(); else page.value = 1; }, {deep: true});
watch(page, () => void load());
watch(() => store.revision, () => void load()); // 录入、编辑、状态变更后同步刷新本页。
watch(() => route.query, () => { filters.value = linkedFilters(); });
onMounted(load);
</script>
<template>
  <PageShell>
    <div class="toolbar filters">
      <label>扣款日从<input v-model="filters.from" type="date"></label>
      <label>至<input v-model="filters.to" type="date"></label>
      <label>信用卡<select v-model="filters.cardId"><option value="">全部卡片</option><option v-for="item in store.cards" :key="item.id" :value="item.id">{{ item.name }}{{ item.archivedAt ? '（已归档）' : '' }}</option></select></label>
      <label>扣款账户<select v-model="filters.accountId"><option value="">全部账户</option><option v-for="item in store.accounts" :key="item.id" :value="item.id">{{ item.name }}{{ item.archivedAt ? '（已归档）' : '' }}</option></select></label>
      <label>币种<select v-model="filters.currency"><option value="">全部币种</option><option v-for="(_, code) in currencies" :key="code">{{ code }}</option></select></label>
      <label>状态<select v-model="filters.status"><option value="">全部状态</option><option value="pending">待确认扣款</option><option value="paid">已扣款</option><option value="void">已作废</option></select></label>
      <button class="quiet" type="button" @click="filters = blank()">重置</button>
    </div>
    <section class="tile-section">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-else-if="loading && !result.items.length" class="empty">正在读取账单…</div>
      <BillList v-else :bills="result.items"/>
      <nav v-if="result.total" class="pager" aria-label="账单分页">
        <span class="muted">共 {{ result.total }} 笔 · 第 {{ page }} / {{ pages }} 页</span>
        <div class="master-actions"><button class="quiet" :disabled="page <= 1 || loading" @click="page--">上一页</button><button class="quiet" :disabled="page >= pages || loading" @click="page++">下一页</button></div>
      </nav>
    </section>
  </PageShell>
</template>
