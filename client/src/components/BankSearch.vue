<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import type { BankEntry } from '@ccm/shared';
import { api } from '../api';
// 从内置的全国金融机构清单检索（片假名、平假名、罗马字或 4 位代码）。
const props = defineProps<{bankCode: string; bankName: string}>();
const emit = defineEmits<{select: [bank: BankEntry | null]}>();
const query = ref(props.bankName); const results = ref<BankEntry[]>([]); const open = ref(false); const active = ref(0);
let timer = 0; let sequence = 0;
watch(() => props.bankName, value => { query.value = value; });
async function search() {
  const ticket = ++sequence;
  try { const data = await api<BankEntry[]>(`/banks?q=${encodeURIComponent(query.value)}`); if (ticket === sequence) { results.value = data; active.value = 0; } } catch { /* 检索失败时保留手填名称 */ }
}
function onInput() { open.value = true; window.clearTimeout(timer); timer = window.setTimeout(search, 150); }
function choose(bank: BankEntry) { query.value = bank.name; open.value = false; emit('select', bank); }
function onKey(event: KeyboardEvent) {
  if (!open.value || !results.value.length) return;
  if (event.key === 'ArrowDown') { active.value = (active.value + 1) % results.value.length; event.preventDefault(); }
  else if (event.key === 'ArrowUp') { active.value = (active.value - 1 + results.value.length) % results.value.length; event.preventDefault(); }
  else if (event.key === 'Enter') { choose(results.value[active.value]); event.preventDefault(); }
  else if (event.key === 'Escape') open.value = false;
}
// 延迟收起，让列表项的点击先生效。
function closeLater() { window.setTimeout(() => { open.value = false; }, 150); }
onBeforeUnmount(() => window.clearTimeout(timer));
</script>
<template>
  <div class="bank-search">
    <input v-model="query" role="combobox" :aria-expanded="open" aria-autocomplete="list" placeholder="输入 みずほ / mitsui / 0009" autocomplete="off" @input="onInput" @focus="onInput" @keydown="onKey" @blur="closeLater">
    <small v-if="bankCode" class="muted">机构代码 {{ bankCode }} · <button type="button" class="link-button" @click="query = ''; emit('select', null)">不关联银行</button></small>
    <ul v-if="open && results.length" class="bank-results" role="listbox">
      <li v-for="(bank, index) in results" :key="bank.code" role="option" :aria-selected="index === active" :class="{active: index === active}" @mousedown.prevent="choose(bank)">
        <strong>{{ bank.name }}</strong><small>{{ bank.kana }} · {{ bank.code }}</small><span v-if="bank.domain" class="badge">可抓取官网图标</span>
      </li>
    </ul>
  </div>
</template>
