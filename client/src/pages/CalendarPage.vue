<script setup lang="ts">
import { ref, computed } from 'vue';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import MonthFilter from '../components/MonthFilter.vue';
import BillList from '../components/BillList.vue';
import { shortDate } from '../format';
const store = useWorkspace(); const selectedDay = ref('');
// 周一为一周第一天；日期一律按 date-only 字符串比较，不经过时区换算。
const grid = computed(() => {
  const [year, month] = store.month.split('-').map(Number); const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [...Array((first + 6) % 7).fill(null), ...Array.from({length: days}, (_, i) => `${store.month}-${String(i + 1).padStart(2, '0')}`)];
});
const active = computed(() => store.bills.filter(b => b.status !== 'void'));
const countOn = (date: string) => active.value.filter(b => b.dueDate === date).length;
const dayBills = computed(() => active.value.filter(b => b.dueDate === selectedDay.value));
</script>
<template>
  <PageShell>
    <MonthFilter/>
    <section class="panel"><div class="calendar-grid">
      <strong v-for="day in ['一','二','三','四','五','六','日']" :key="day" class="weekday">{{ day }}</strong>
      <template v-for="(date, i) in grid" :key="date || i">
        <button v-if="date" class="calendar-day" :class="{selected: selectedDay === date}" @click="selectedDay = date"><strong>{{ Number(date.slice(-2)) }}</strong><small v-if="countOn(date)">{{ countOn(date) }} 笔账单</small></button>
        <span v-else/>
      </template>
    </div></section>
    <section class="tile-section"><h2 class="list-title">{{ selectedDay ? shortDate(selectedDay) : '选择日期查看明细' }}</h2><BillList v-if="selectedDay" :bills="dayBills" empty="这一天没有账单。"/></section>
  </PageShell>
</template>
