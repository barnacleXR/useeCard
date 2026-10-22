<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { billSearchInput, currencies, japanMonth, type BillPage, type BillSearch } from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import { SSelect } from '@vean/ui';
import PageShell from '../components/PageShell.vue';
import BillList from '../components/BillList.vue';
import DateRangeInput from '../components/fields/DateRangeInput.vue';
const store = useWorkspace();
const cardItems = computed(() => [{value: '', label: '全部卡片'}, ...store.cards.map(item => ({value: item.id, label: `${item.name}${item.archivedAt ? '（已归档）' : ''}`}))]);
const accountItems = computed(() => [{value: '', label: '全部账户'}, ...store.accounts.map(item => ({value: item.id, label: `${item.name}${item.archivedAt ? '（已归档）' : ''}`}))]);
const currencyItems = [{value: '', label: '全部币种'}, ...Object.keys(currencies).map(value => ({value, label: value}))];
const statusItems = [{value: '', label: '全部状态'}, {value: 'pending', label: '待确认扣款'}, {value: 'paid', label: '已扣款'}, {value: 'void', label: '已作废'}];
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
      <div class="field date-range-field"><span>扣款日</span><DateRangeInput v-model:from="filters.from" v-model:to="filters.to" label="扣款日范围"/></div>
      <div class="field filter-select"><span>信用卡</span><SSelect v-model="filters.cardId" :items="cardItems" :trigger-props="{'aria-label': '信用卡'}"/></div>
      <div class="field filter-select"><span>扣款账户</span><SSelect v-model="filters.accountId" :items="accountItems" :trigger-props="{'aria-label': '扣款账户'}"/></div>
      <div class="field filter-select"><span>币种</span><SSelect v-model="filters.currency" :items="currencyItems" :trigger-props="{'aria-label': '币种'}"/></div>
      <div class="field filter-select"><span>状态</span><SSelect v-model="filters.status" :items="statusItems" :trigger-props="{'aria-label': '状态'}"/></div>
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
