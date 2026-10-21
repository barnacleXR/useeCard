<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { McpConnectionInfo, OAuthClientInfo, OAuthGrantInfo } from '@ccm/shared';
import { api } from '../api';
import { mcpScopeLabels } from '../scopes';
// MCP 连接：AI 客户端通过 OAuth 授权访问 /mcp；凭证与 Web 登录、设备令牌、API Key 互不通用。
const info = ref<McpConnectionInfo>(); const grants = ref<OAuthGrantInfo[]>([]); const clients = ref<OAuthClientInfo[]>([]);
const error = ref(''); const copied = ref(''); const busy = ref(false);
const form = ref({name: '', redirectUris: '', confidential: false}); const created = ref<{clientId: string; clientSecret: string | null}>();
const time = (value: string | null, empty = '—') => value ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Tokyo', hour12: false}) : empty;
async function load() {
  try { [info.value, grants.value, clients.value] = await Promise.all([api<McpConnectionInfo>('/oauth/connection'), api<OAuthGrantInfo[]>('/oauth/grants'), api<OAuthClientInfo[]>('/oauth/clients')]); }
  catch (e) { error.value = (e as Error).message; }
}
async function copy(text: string, what: string) { try { await navigator.clipboard.writeText(text); copied.value = what; } catch { error.value = '无法写入剪贴板，请手动选中复制'; } }
async function revoke(grant: OAuthGrantInfo) {
  if (!confirm(`撤销「${grant.clientName}」的授权？该客户端会立即无法访问，需重新授权。`)) return;
  try { await api(`/oauth/grants/${grant.id}/revoke`, 'POST'); await load(); } catch (e) { error.value = (e as Error).message; }
}
async function remove(client: OAuthClientInfo) {
  if (!confirm(`删除客户端「${client.name}」？它的全部授权会一并撤销。`)) return;
  try { await api(`/oauth/clients/${client.id}/delete`, 'POST'); if (created.value?.clientId === client.id) created.value = undefined; await load(); } catch (e) { error.value = (e as Error).message; }
}
async function create() {
  busy.value = true; error.value = ''; copied.value = '';
  try {
    created.value = await api('/oauth/clients', 'POST', {name: form.value.name, redirectUris: form.value.redirectUris.split(/\s+/).filter(Boolean), confidential: form.value.confidential});
    form.value = {name: '', redirectUris: '', confidential: false}; await load();
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
onMounted(load);
</script>
<template>
  <h2>MCP 连接</h2>
  <p class="muted">让 Claude 等支持 MCP 的 AI 客户端查询备款、录入账单。客户端通过 OAuth 授权（授权码 + PKCE），你在授权页逐项选择权限；写入权限默认不勾选。</p>
  <template v-if="info">
    <div class="row mcp-endpoint"><code class="api-key-value">{{ info.endpoint }}</code><button class="quiet" type="button" @click="copy(info.endpoint, 'endpoint')">{{ copied === 'endpoint' ? '已复制' : '复制地址' }}</button></div>
    <ol class="mcp-steps muted">
      <li>在 AI 客户端添加「自定义连接器 / 远程 MCP 服务器」，填入上面的地址。</li>
      <li>客户端会打开 useeCard 授权页：确认客户端名称与回调域名，勾选需要的权限后授权。</li>
      <li>授权有效期 30 天（使用时自动续期），可随时在下方撤销。</li>
    </ol>
    <small class="muted">诊断：<a class="link" :href="info.resourceMetadata" target="_blank" rel="noopener">资源元数据</a> · <a class="link" :href="info.authorizationServerMetadata" target="_blank" rel="noopener">授权服务器元数据</a>。客户端必须能通过 HTTPS 访问本实例（本机 localhost 除外）。</small>
  </template>
  <p v-if="error" class="error" role="alert">{{ error }}</p>

  <h3 class="sub-heading">已授权的连接</h3>
  <div v-if="!grants.length" class="muted device-empty">还没有授权任何 AI 客户端。</div>
  <div v-for="grant in grants" :key="grant.id" class="master-row">
    <div>
      <strong>{{ grant.clientName }}</strong>
      <small>{{ grant.scopes.map(s => mcpScopeLabels[s]).join('、') }} · 授权 {{ time(grant.createdAt) }} · 最近使用 {{ time(grant.lastUsedAt, '尚未使用') }}</small>
    </div>
    <button class="quiet danger" @click="revoke(grant)">撤销</button>
  </div>

  <h3 class="sub-heading">客户端</h3>
  <p class="muted">大多数客户端会自动登记（动态客户端注册）。不支持自动登记的客户端可在此手动登记，获得 client_id。</p>
  <div v-for="client in clients" :key="client.id" class="master-row">
    <div>
      <strong>{{ client.name }}</strong> <span class="badge">{{ client.source === 'dcr' ? '自动登记' : '手动登记' }}</span> <span v-if="client.confidential" class="badge">机密</span>
      <small>{{ client.redirectUris.join('、') }} · 登记 {{ time(client.createdAt) }} · 有效授权 {{ client.activeGrants }}</small>
    </div>
    <button class="quiet danger" @click="remove(client)">删除</button>
  </div>
  <details class="mcp-manual">
    <summary>手动登记客户端</summary>
    <form class="stack api-key-form" @submit.prevent="create">
      <label>名称<input v-model="form.name" required maxlength="80" placeholder="例如：本地脚本"></label>
      <label>回调地址（每行一个；https，或本机 http）<textarea v-model="form.redirectUris" required rows="2" placeholder="https://example.com/oauth/callback"></textarea></label>
      <label class="checkbox"><input v-model="form.confidential" type="checkbox">机密客户端（生成 client_secret，用于服务器端应用）</label>
      <div><button class="primary" :disabled="busy">{{ busy ? '正在登记…' : '登记客户端' }}</button></div>
    </form>
  </details>
  <div v-if="created" class="api-key-created" role="status">
    <strong>客户端已登记。{{ created.clientSecret ? 'client_secret 只显示这一次，请立即复制保存。' : '' }}</strong>
    <div class="row"><span>client_id</span><code class="api-key-value">{{ created.clientId }}</code><button class="quiet" type="button" @click="copy(created.clientId, 'id')">{{ copied === 'id' ? '已复制' : '复制' }}</button></div>
    <div v-if="created.clientSecret" class="row"><span>client_secret</span><code class="api-key-value">{{ created.clientSecret }}</code><button class="quiet" type="button" @click="copy(created.clientSecret, 'secret')">{{ copied === 'secret' ? '已复制' : '复制' }}</button></div>
  </div>
</template>
