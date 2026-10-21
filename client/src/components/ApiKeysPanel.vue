<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { apiScopes, japanMonth, type ApiKeyCreated, type ApiKeyInfo, type ApiScope } from '@ccm/shared';
import { api } from '../api';
// 只读 REST API v1：创建、查看与撤销独立 API Key；原文只在创建后显示一次。
const scopeLabels: Record<ApiScope, string> = {'accounts:read': '账户', 'cards:read': '信用卡', 'bills:read': '账单', 'summary:read': '备款汇总', 'reviews:read': '月度检查'};
const keys = ref<ApiKeyInfo[]>([]); const created = ref<ApiKeyCreated>(); const error = ref(''); const busy = ref(false); const copied = ref(false);
const form = ref({name: '', scopes: [...apiScopes] as ApiScope[], expiresInDays: 90 as 30 | 90 | 365 | null});
const origin = window.location.origin;
const example = computed(() => `curl '${origin}/api/v1/summary?dueMonth=${japanMonth()}' \\\n  -H 'Authorization: Bearer ${created.value?.key ?? '<API Key>'}'`);
const time = (value: string | null, empty = '—') => value ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Tokyo', hour12: false}) : empty;
const expired = (key: ApiKeyInfo) => !!key.expiresAt && Date.parse(key.expiresAt) <= Date.now();
async function load() { try { keys.value = await api<ApiKeyInfo[]>('/api-keys'); } catch (e) { error.value = (e as Error).message; } }
async function create() {
  busy.value = true; error.value = ''; copied.value = false;
  try { created.value = await api<ApiKeyCreated>('/api-keys', 'POST', form.value); form.value.name = ''; await load(); }
  catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
async function copy() { if (!created.value) return; try { await navigator.clipboard.writeText(created.value.key); copied.value = true; } catch { error.value = '无法写入剪贴板，请手动选中复制'; } }
async function revoke(key: ApiKeyInfo) {
  if (!confirm(`撤销「${key.name}」？使用该 Key 的脚本会立即无法访问。`)) return;
  try { await api(`/api-keys/${key.id}/revoke`, 'POST'); if (created.value?.id === key.id) created.value = undefined; await load(); } catch (e) { error.value = (e as Error).message; }
}
onMounted(load);
</script>
<template>
  <h2>外部 API</h2>
  <p class="muted">供脚本或其他系统读取数据的只读接口（<code>/api/v1</code>），使用独立的 API Key；Web 登录、iOS 设备令牌都不能用于此接口。文档：<a class="link" href="/api/v1/openapi.json" target="_blank" rel="noopener">OpenAPI 3.1</a></p>
  <form class="stack api-key-form" @submit.prevent="create">
    <label>名称<input v-model="form.name" required maxlength="60" placeholder="例如：家庭看板脚本"></label>
    <fieldset class="scope-list"><legend>权限（只读）</legend>
      <label v-for="scope in apiScopes" :key="scope" class="checkbox"><input v-model="form.scopes" type="checkbox" :value="scope">{{ scopeLabels[scope] }} <code>{{ scope }}</code></label>
    </fieldset>
    <label>有效期<select v-model="form.expiresInDays"><option :value="30">30 天</option><option :value="90">90 天</option><option :value="365">365 天</option><option :value="null">永不过期</option></select></label>
    <div><button class="primary" :disabled="busy || !form.scopes.length">{{ busy ? '正在创建…' : '创建 API Key' }}</button></div>
  </form>
  <div v-if="created" class="api-key-created" role="status">
    <strong>新 API Key 只显示这一次，请立即复制保存。</strong>
    <div class="row"><code class="api-key-value">{{ created.key }}</code><button class="quiet" type="button" @click="copy">{{ copied ? '已复制' : '复制' }}</button></div>
  </div>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <div v-if="!keys.length" class="muted device-empty">还没有 API Key。</div>
  <div v-for="key in keys" :key="key.id" class="master-row">
    <div>
      <strong>{{ key.name }}</strong> <code>{{ key.prefix }}…</code> <span v-if="expired(key)" class="status void">已过期</span>
      <small>{{ key.scopes.map(s => scopeLabels[s]).join('、') }} · 创建 {{ time(key.createdAt) }} · 到期 {{ time(key.expiresAt, '永不') }} · 最近使用 {{ time(key.lastUsedAt, '尚未使用') }}</small>
    </div>
    <button class="quiet danger" @click="revoke(key)">撤销</button>
  </div>
  <p class="muted">调用示例（金额为最小货币单位整数，各币种分别汇总）：</p>
  <pre class="code-sample">{{ example }}</pre>
</template>
