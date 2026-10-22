<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { SConfigProvider, SAppShell } from '@vean/ui';
import { readThemeEnvelope } from '@vean/theme/storage';
import { colors } from './themePreset';
import ThemeInitializer from './components/ThemeInitializer.vue';
import { api, setCsrf } from './api';
import { useWorkspace } from './stores/workspace';
import NotificationButton from './components/NotificationButton.vue';
import ThemePanel from './components/ThemePanel.vue';
import BrandLogo from './components/BrandLogo.vue';
import ThemeModeButton from './components/ThemeModeButton.vue';
import { oidcMessage, takeHashParam } from './oidc';
import { formatMoney } from '@ccm/shared';
import { clearSnapshot, loadSnapshot, reconcileSnapshot, type OfflineSnapshot } from './offline';
const initialTheme = readThemeEnvelope() ? {} : {preset: colors, mode: 'dark' as const};
const route = useRoute(); const router = useRouter(); const store = useWorkspace();
const oidc = ref<{name:string}>(); const ready = ref(false); const loggedIn = ref(false); const initialized = ref(false); const username = ref(''); const password = ref(''); const error = ref(''); const submitting = ref(false);
const offline=ref<OfflineSnapshot|null>(null);const offlineOpen=ref(false);
// 授权页等独立页面登录后不显示侧栏。
const bare = computed(() => route.path.startsWith('/oauth/'));
const items = [
  {value:'/',label:'备款汇总',icon:'lucide:wallet'}, {value:'/bills',label:'账单',icon:'lucide:credit-card'}, {value:'/calendar',label:'日历',icon:'lucide:calendar-days'}, {value:'/reports',label:'月报',icon:'lucide:chart-no-axes-combined'}, {value:'/reviews',label:'月度检查',icon:'lucide:list-checks'}, {value:'/manage',label:'卡片与账户',icon:'lucide:landmark'}, {value:'/settings',label:'设置',icon:'lucide:settings'}, {value:'/profile',label:'个人中心',icon:'lucide:user-round'}, {value:'/backups',label:'备份',icon:'lucide:database-backup'}, {value:'/system',label:'系统',icon:'lucide:activity'}
];
function expired() { if (!loggedIn.value) return; setCsrf(''); loggedIn.value = false; store.themePanel = false;void clearSnapshot();offline.value=null;error.value = '登录已失效，请重新登录。'; }
window.addEventListener('ccm-session-expired', expired);
async function online(){if(!loggedIn.value)return;try{const {dataEpoch}=await api<{dataEpoch:string}>('/offline/version');await reconcileSnapshot(dataEpoch);window.dispatchEvent(new Event('useecard-offline-checked'));}catch{/* 下一次联网或刷新时重试。 */}}
window.addEventListener('online',online);
onBeforeUnmount(() => {window.removeEventListener('ccm-session-expired', expired);window.removeEventListener('online',online);});
onMounted(async () => {
  const oidcError = takeHashParam('oidc-error');
  try { const status = await api<{initialized:boolean; oidc?: {name:string}}>('/auth/status'); initialized.value = status.initialized; oidc.value = status.oidc;
    if (status.initialized) try { const session = await api<{csrf:string}>('/auth/session'); setCsrf(session.csrf); loggedIn.value = true; const version=await api<{dataEpoch:string}>('/offline/version');await reconcileSnapshot(version.dataEpoch);await store.refresh(); } catch { /* 未登录时显示登录页。 */ }
  } catch (e) { error.value = (e as Error).message; offline.value=await loadSnapshot().catch(()=>null); } finally { if (oidcError && !loggedIn.value) error.value = oidcMessage(oidcError); ready.value = true; }
});
async function login() {
  submitting.value = true; error.value = '';
  try { const result = await api<{csrf:string}>(initialized.value ? '/auth/login' : '/auth/setup','POST',{username:username.value,password:password.value}); setCsrf(result.csrf); password.value = ''; initialized.value = true; loggedIn.value = true; await store.refresh(); }
  catch(e) { error.value = (e as Error).message; } finally { submitting.value = false; }
}
async function logout() { try { await api('/auth/logout','POST'); } catch(e) { store.error = (e as Error).message; } finally { setCsrf('');loggedIn.value=false;await clearSnapshot();offline.value=null; } }
</script>
<template>
  <SConfigProvider persist-theme locale="zh-CN" :theme="initialTheme">
    <ThemeInitializer :first-run="Boolean(initialTheme.preset)"/>
    <div v-if="!ready" class="auth-page">正在连接自托管服务器…</div>
    <main v-else-if="!loggedIn && offlineOpen && offline" class="offline-view"><div class="panel"><h1>离线账单快照</h1><p class="muted">只读 · 保存于 {{new Date(offline.createdAt).toLocaleString('zh-CN')}} · 本机未加密</p><button class="quiet" @click="offlineOpen=false">返回登录</button><h2>账户</h2><p v-for="account in offline.accounts" :key="account.id">{{account.name}}</p><h2>卡片</h2><p v-for="card in offline.cards" :key="card.id">{{card.name}}</p><h2>账单</h2><div v-for="bill in offline.bills" :key="bill.id" class="offline-bill"><strong>{{bill.cardName}}</strong><span>{{bill.dueDate}} · {{formatMoney(bill.amountMinor,bill.currency)}} · {{({pending:'待扣款',paid:'已扣款',void:'已作废'} as Record<string,string>)[bill.status]||bill.status}}</span></div></div></main>
    <main v-else-if="!loggedIn" class="auth-page">
      <form class="auth-card" @submit.prevent="login">
        <BrandLogo :size="48"/><p class="eyebrow">YOUR CARDS, IN ORDER</p>
        <h1>{{ initialized ? '欢迎回来' : '创建你的 useeCard' }}</h1><p class="muted">{{ initialized ? '登录你的自托管备款空间。' : '创建唯一管理员，从空账本开始。' }}</p>
        <label>用户名<input v-model="username" required autocomplete="username" maxlength="100"></label>
        <label>密码<input v-model="password" required type="password" minlength="12" maxlength="128" :autocomplete="initialized ? 'current-password' : 'new-password'" placeholder="至少 12 位"></label>
        <p v-if="error" class="error" role="alert">{{ error }}</p><button class="primary" :disabled="submitting">{{ submitting ? '正在连接…' : initialized ? '登录' : '初始化实例' }}</button>
        <a v-if="initialized && oidc" class="quiet oidc-login" href="/api/auth/oidc/start">使用 {{ oidc.name }} 登录</a>
        <small class="muted">{{ bare ? '登录后继续授权 AI 客户端。' : '数据保存在自己的服务器，不连接银行或 Firebase。' }}</small>
        <button v-if="offline" type="button" class="quiet" @click="offlineOpen=true">查看本机离线快照</button>
      </form>
    </main>
    <main v-else-if="bare" class="auth-page"><RouterView/></main>
    <SAppShell v-else :items="items" :model-value="route.path" mode="sidebar" :ui="{layoutContent:'p-4 md:p-6'}" @select="value => router.push(String(value))">
      <template #logo><BrandLogo :size="30"/></template><template #title><strong>useeCard</strong></template>
      <template #header-end><div class="header-tools"><NotificationButton/><ThemeModeButton/><button class="quiet" aria-haspopup="dialog" @click="store.themePanel = true">外观</button><button class="quiet" @click="logout">退出</button></div></template>
      <div class="workspace"><p v-if="store.error" class="error" role="alert">{{ store.error }}</p><RouterView/></div>
    </SAppShell>
    <ThemePanel v-if="loggedIn && !bare"/>
  </SConfigProvider>
</template>
