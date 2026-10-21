<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { mcpReadScopes, type McpScope, type OAuthPendingRequest } from '@ccm/shared';
import { api } from '../api';
import BrandLogo from '../components/BrandLogo.vue';
import { mcpScopeLabels, mcpWriteScopes } from '../scopes';
// MCP 客户端的 OAuth 授权页：默认只勾选只读权限，写入权限必须手动勾选。
const route = useRoute();
const id = String(route.query.request || '');
const request = ref<OAuthPendingRequest>(); const scopes = ref<McpScope[]>([]); const error = ref(''); const busy = ref(false);
const writing = computed(() => scopes.value.some(s => mcpWriteScopes.includes(s)));
onMounted(async () => {
  if (!id) { error.value = '缺少授权请求，请回到 AI 客户端重新连接。'; return; }
  try { request.value = await api<OAuthPendingRequest>(`/oauth/requests/${encodeURIComponent(id)}`); scopes.value = [...request.value.defaultScopes]; }
  catch (e) { error.value = (e as Error).message; }
});
async function decide(action: 'approve' | 'deny') {
  busy.value = true; error.value = '';
  try { const {redirectUrl} = await api<{redirectUrl: string}>(`/oauth/requests/${encodeURIComponent(id)}/${action}`, 'POST', action === 'approve' ? {scopes: scopes.value} : {}); window.location.assign(redirectUrl); }
  catch (e) { error.value = (e as Error).message; busy.value = false; }
}
</script>
<template>
  <div class="auth-card consent-card">
    <BrandLogo :size="40"/>
    <template v-if="request">
      <p class="eyebrow">MCP 授权</p>
      <h1>允许「{{ request.clientName }}」访问 useeCard？</h1>
      <p class="muted">授权后将跳转回 <strong>{{ request.redirectHost }}</strong>。只授予这次需要的权限，可随时在「设置 → MCP 连接」中撤销。</p>
      <fieldset class="scope-list consent-scopes"><legend>只读</legend>
        <label v-for="scope in mcpReadScopes" :key="scope" class="checkbox"><input v-model="scopes" type="checkbox" :value="scope">{{ mcpScopeLabels[scope] }}</label>
      </fieldset>
      <fieldset class="scope-list consent-scopes"><legend>写入</legend>
        <label v-for="scope in mcpWriteScopes" :key="scope" class="checkbox"><input v-model="scopes" type="checkbox" :value="scope">{{ mcpScopeLabels[scope] }}<small v-if="request.requestedScopes.includes(scope)">（客户端申请）</small></label>
      </fieldset>
      <p v-if="writing" class="consent-warning" role="note">已勾选写入权限：AI 可以代你录入或修改账单。金额、币种与扣款日仍以银行显示为准，请留意它的操作结果。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="row consent-actions">
        <button class="quiet" :disabled="busy" @click="decide('deny')">拒绝</button>
        <button class="primary" :disabled="busy || !scopes.length" @click="decide('approve')">{{ busy ? '正在授权…' : '授权' }}</button>
      </div>
    </template>
    <template v-else>
      <h1>授权连接</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else class="muted">正在读取授权请求…</p>
      <RouterLink class="link" to="/">返回 useeCard</RouterLink>
    </template>
  </div>
</template>
