<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { SConfigProvider } from '@vean/ui';
import { readThemeEnvelope } from '@vean/theme/storage';
import { formatMoney } from '@ccm/shared';
import { colors } from './themePreset';
import ThemeInitializer from './components/ThemeInitializer.vue';
import AppShell from './components/AppShell.vue';
import BrandLogo from './components/BrandLogo.vue';
import { api, setCsrf } from './api';
import { useWorkspace } from './stores/workspace';
import { oidcMessage, takeHashParam } from './oidc';
import { clearSnapshot, loadSnapshot, reconcileSnapshot, type OfflineSnapshot } from './offline';
import { enableReconcileDrafts, clearAllReconcileDrafts } from './reconcileDraft';

const initialTheme = readThemeEnvelope() ? {} : { preset: colors, mode: 'auto' as const };
const route = useRoute();
const store = useWorkspace();

const oidc = ref<{ name: string }>();
const ready = ref(false);
const loggedIn = ref(false);
const initialized = ref(false);
const username = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);
const offline = ref<OfflineSnapshot | null>(null);
const offlineOpen = ref(false);

// 授权页等独立页面登录后不显示应用外壳。
const bare = computed(() => route.path.startsWith('/oauth/'));

function expired() {
  if (!loggedIn.value) return;
  setCsrf('');
  loggedIn.value = false;
  void clearSnapshot();
  void clearAllReconcileDrafts();
  offline.value = null;
  error.value = '登录已失效，请重新登录。';
}

async function online() {
  if (!loggedIn.value) return;
  try {
    const { dataEpoch } = await api<{ dataEpoch: string }>('/offline/version');
    await reconcileSnapshot(dataEpoch);
    window.dispatchEvent(new Event('useecard-offline-checked'));
  } catch {
    /* 下一次联网或刷新时重试。 */
  }
}

window.addEventListener('ccm-session-expired', expired);
window.addEventListener('online', online);
onBeforeUnmount(() => {
  window.removeEventListener('ccm-session-expired', expired);
  window.removeEventListener('online', online);
});

onMounted(async () => {
  const oidcError = takeHashParam('oidc-error');
  try {
    const status = await api<{ initialized: boolean; oidc?: { name: string } }>('/auth/status');
    initialized.value = status.initialized;
    oidc.value = status.oidc;
    if (status.initialized) {
      try {
        const session = await api<{ csrf: string }>('/auth/session');
        setCsrf(session.csrf);
        enableReconcileDrafts();
        loggedIn.value = true;
        const version = await api<{ dataEpoch: string }>('/offline/version');
        await reconcileSnapshot(version.dataEpoch);
        await store.refresh();
      } catch {
        /* 未登录时显示登录页。 */
      }
    }
  } catch (e) {
    error.value = (e as Error).message;
    offline.value = await loadSnapshot().catch(() => null);
  } finally {
    if (oidcError && !loggedIn.value) error.value = oidcMessage(oidcError);
    ready.value = true;
  }
});

async function login() {
  submitting.value = true;
  error.value = '';
  try {
    const result = await api<{ csrf: string }>(
      initialized.value ? '/auth/login' : '/auth/setup',
      'POST',
      { username: username.value, password: password.value },
    );
    setCsrf(result.csrf);
    enableReconcileDrafts();
    password.value = '';
    initialized.value = true;
    loggedIn.value = true;
    await store.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}

async function logout() {
  try {
    await api('/auth/logout', 'POST');
  } catch (e) {
    store.error = (e as Error).message;
  } finally {
    setCsrf('');
    loggedIn.value = false;
    await clearAllReconcileDrafts();
    await clearSnapshot();
    offline.value = null;
  }
}
</script>

<template>
  <SConfigProvider persist-theme locale="zh-CN" :theme="initialTheme">
    <ThemeInitializer />

    <div v-if="!ready" class="auth-page">
      <div class="stack" style="align-items: center; gap: 12px">
        <BrandLogo :size="36" />
        <p class="muted">正在连接自托管服务器…</p>
      </div>
    </div>

    <main v-else-if="!loggedIn && offlineOpen && offline" class="offline-view">
      <div class="panel stack">
        <div class="row wrap">
          <div>
            <h1>离线账单快照</h1>
            <small class="muted">
              只读 · 保存于 {{ new Date(offline.createdAt).toLocaleString('zh-CN') }} · 本机未加密
            </small>
          </div>
          <button type="button" class="quiet" @click="offlineOpen = false">返回登录</button>
        </div>

        <div>
          <h2 style="margin-bottom: 8px">账户</h2>
          <div class="row wrap" style="justify-content: flex-start; gap: 8px">
            <span v-for="account in offline.accounts" :key="account.id" class="badge">
              {{ account.name }}
            </span>
          </div>
        </div>

        <div>
          <h2 style="margin-bottom: 8px">卡片</h2>
          <div class="row wrap" style="justify-content: flex-start; gap: 8px">
            <span v-for="card in offline.cards" :key="card.id" class="status void">
              {{ card.name }}
            </span>
          </div>
        </div>

        <div>
          <h2 style="margin-bottom: 8px">账单</h2>
          <div v-for="bill in offline.bills" :key="bill.id" class="offline-bill">
            <strong>{{ bill.cardName }}</strong>
            <span>
              {{ bill.dueDate }} · {{ formatMoney(bill.amountMinor, bill.currency) }} ·
              {{
                ({ pending: '待扣款', paid: '已扣款', void: '已作废' } as Record<string, string>)[
                  bill.status
                ] || bill.status
              }}
            </span>
          </div>
        </div>
      </div>
    </main>

    <main v-else-if="!loggedIn" class="auth-page">
      <form class="auth-card" @submit.prevent="login">
        <div class="auth-card-head">
          <BrandLogo :size="40" />
          <h1 style="margin-top: 8px">{{ initialized ? '登录 useeCard' : '初始化 useeCard' }}</h1>
          <p class="muted">
            {{ initialized ? '进入你的自托管信用卡备款空间。' : '创建唯一管理员账户，从空账本开始。' }}
          </p>
        </div>

        <label>
          用户名
          <input v-model="username" required autocomplete="username" maxlength="100" />
        </label>
        <label>
          密码
          <input
            v-model="password"
            required
            type="password"
            minlength="12"
            maxlength="128"
            :autocomplete="initialized ? 'current-password' : 'new-password'"
            placeholder="至少 12 位"
          />
        </label>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button class="primary" style="width: 100%" :disabled="submitting">
          {{ submitting ? '正在连接…' : initialized ? '登录' : '初始化实例' }}
        </button>

        <template v-if="initialized && oidc">
          <div class="auth-divider">或</div>
          <a class="quiet oidc-login" href="/api/auth/oidc/start">使用 {{ oidc.name }} 登录</a>
        </template>

        <small class="muted">
          {{ bare ? '登录后继续授权 AI 客户端。' : '数据保存在你的服务器，不连接银行或第三方云。' }}
        </small>

        <button v-if="offline" type="button" class="quiet" style="width: 100%" @click="offlineOpen = true">
          查看本机离线快照
        </button>
      </form>
    </main>

    <main v-else-if="bare" class="auth-page">
      <RouterView />
    </main>

    <AppShell v-else @logout="logout">
      <RouterView />
    </AppShell>
  </SConfigProvider>
</template>
