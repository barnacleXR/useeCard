<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { SIcon } from '@vean/ui';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import BrandLogo from './BrandLogo.vue';
import ThemeModeButton from './ThemeModeButton.vue';
import BillEditor from './BillEditor.vue';

// 面向个人用户的轻量应用外壳：桌面端可收起侧栏 + 移动端精简顶栏与底部 Tab 栏。
const emit = defineEmits<{ logout: [] }>();
const route = useRoute();
const store = useWorkspace();

const STORAGE_KEY = 'useecard-sidebar-collapsed';
const collapsed = ref(localStorage.getItem(STORAGE_KEY) === '1');
const quickEditor = ref(false);
const moreOpen = ref(false);

const unreadCount = ref(0);
const unreadFailed = ref(false);
const profile = ref<{ username: string; displayName: string; hasAvatar: number } | null>(null);
let unreadSeq = 0;
let unreadTimer: ReturnType<typeof setInterval>;

const navItems = [
  { to: '/', label: '备款汇总', icon: 'lucide:wallet' },
  { to: '/bills', label: '账单', icon: 'lucide:receipt-text' },
  { to: '/calendar', label: '日历', icon: 'lucide:calendar-days' },
  { to: '/reviews', label: '月度检查', icon: 'lucide:list-checks', showUnreviewed: true },
  { to: '/reports', label: '月报', icon: 'lucide:chart-no-axes-combined' },
  { to: '/manage', label: '卡片与账户', icon: 'lucide:credit-card' },
];

const settingsPaths = ['/settings', '/profile', '/backups', '/system', '/audit'];
const inSettings = computed(() => settingsPaths.includes(route.path));
const canAddBill = computed(() => store.cards.some(c => !c.archivedAt));
const unreviewedCount = computed(() => store.reviews.filter(r => r.status === 'unreviewed').length);
const displayName = computed(() => profile.value?.displayName || profile.value?.username || '账户与设置');
const avatarInitial = computed(() => displayName.value.slice(0, 1).toUpperCase());

function toggleSidebar() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(STORAGE_KEY, collapsed.value ? '1' : '0');
}

async function loadUnread() {
  if (document.hidden) return;
  const ticket = ++unreadSeq;
  try {
    const data = await api<{ unreadCount: number }>('/notifications/unread-count');
    if (ticket === unreadSeq) {
      unreadCount.value = data.unreadCount;
      unreadFailed.value = false;
    }
  } catch {
    if (ticket === unreadSeq) unreadFailed.value = true;
  }
}

async function loadProfile() {
  try {
    profile.value = await api('/profile');
  } catch {
    /* 个人资料读取失败时回退为默认占位，不阻塞主界面。 */
  }
}

watch(() => store.revision, () => void loadUnread());
watch(() => route.fullPath, () => {
  moreOpen.value = false;
});

onMounted(() => {
  void loadUnread();
  void loadProfile();
  unreadTimer = setInterval(() => void loadUnread(), 30_000);
  window.addEventListener('ccm-notifications-changed', loadUnread);
  document.addEventListener('visibilitychange', loadUnread);
});

onBeforeUnmount(() => {
  unreadSeq++;
  clearInterval(unreadTimer);
  window.removeEventListener('ccm-notifications-changed', loadUnread);
  document.removeEventListener('visibilitychange', loadUnread);
});
</script>

<template>
  <div class="app-layout">
    <!-- 桌面端轻量侧栏 -->
    <aside class="app-sidebar" :class="{ collapsed }" aria-label="主导航">
      <div class="sidebar-brand">
        <RouterLink to="/" class="sidebar-brand-link" title="useeCard 备款汇总">
          <BrandLogo :size="28" />
          <span v-if="!collapsed" class="sidebar-brand-name">useeCard</span>
        </RouterLink>
        <button
          v-if="!collapsed"
          type="button"
          class="sidebar-collapse-btn"
          aria-label="收起侧栏"
          title="收起侧栏"
          @click="toggleSidebar"
        >
          <SIcon icon="lucide:panel-left-close" />
        </button>
      </div>

      <button
        v-if="collapsed"
        type="button"
        class="sidebar-collapse-btn"
        style="width: 100%; margin-bottom: 8px"
        aria-label="展开侧栏"
        title="展开侧栏"
        @click="toggleSidebar"
      >
        <SIcon icon="lucide:panel-left-open" />
      </button>

      <button
        type="button"
        class="primary sidebar-cta"
        :disabled="!canAddBill"
        :title="canAddBill ? '录入账单' : '请先添加信用卡'"
        @click="quickEditor = true"
      >
        <SIcon icon="lucide:plus" />
        <span v-if="!collapsed">录入账单</span>
      </button>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar-link"
          :class="{ active: route.path === item.to || (item.to === '/bills' && route.path.startsWith('/bills/')) }"
          :title="collapsed ? item.label : undefined"
        >
          <SIcon :icon="item.icon" class="sidebar-link-icon" />
          <span v-if="!collapsed" class="sidebar-link-label">{{ item.label }}</span>
          <span
            v-if="item.showUnreviewed && unreviewedCount > 0"
            class="sidebar-pill"
            :title="`${unreviewedCount} 张卡待核对`"
          >
            {{ unreviewedCount }}
          </span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-utility-row">
          <RouterLink
            to="/notifications"
            class="sidebar-link"
            style="flex: 1"
            :class="{ active: route.path === '/notifications' }"
            :aria-label="unreadFailed ? '通知，暂时无法刷新' : `通知，${unreadCount} 条未读`"
            :title="collapsed ? '通知' : undefined"
          >
            <SIcon icon="lucide:bell" class="sidebar-link-icon" />
            <span v-if="!collapsed" class="sidebar-link-label">通知</span>
            <span v-if="unreadCount > 0" class="sidebar-pill brand">
              {{ unreadCount > 99 ? '99+' : unreadCount }}
            </span>
          </RouterLink>
          <ThemeModeButton />
        </div>

        <div class="sidebar-utility-row">
          <RouterLink
            to="/settings"
            class="sidebar-account-btn"
            :class="{ active: inSettings }"
            :title="collapsed ? `${displayName} · 设置` : undefined"
          >
            <span class="sidebar-avatar">
              <img v-if="profile?.hasAvatar" :src="'/api/profile/avatar'" alt="" />
              <template v-else>{{ avatarInitial }}</template>
            </span>
            <span v-if="!collapsed" class="sidebar-account-meta">
              <strong>{{ displayName }}</strong>
              <small>设置 · 备份 · 系统</small>
            </span>
          </RouterLink>
          <button
            v-if="!collapsed"
            type="button"
            class="quiet ghost icon"
            aria-label="退出登录"
            title="退出登录"
            @click="emit('logout')"
          >
            <SIcon icon="lucide:log-out" />
          </button>
        </div>
      </div>
    </aside>

    <!-- 主内容区域 -->
    <div class="app-main">
      <!-- 移动端精简顶栏 -->
      <header class="mobile-topbar">
        <div class="mobile-topbar-left">
          <RouterLink to="/" aria-label="返回备款汇总">
            <BrandLogo :size="26" />
          </RouterLink>
          <span class="mobile-topbar-title">{{ route.meta.title || 'useeCard' }}</span>
        </div>
        <div class="mobile-topbar-actions">
          <button
            type="button"
            class="primary sm"
            :disabled="!canAddBill"
            @click="quickEditor = true"
          >
            <SIcon icon="lucide:plus" />
            <span>录入</span>
          </button>
          <RouterLink
            to="/notifications"
            class="quiet ghost icon sm"
            :aria-label="`通知，${unreadCount} 条未读`"
            style="position: relative"
          >
            <SIcon icon="lucide:bell" />
            <span v-if="unreadCount > 0" class="mobile-dot" />
          </RouterLink>
          <ThemeModeButton />
        </div>
      </header>

      <main class="workspace">
        <p v-if="store.error" class="error" role="alert" style="margin-bottom: 16px">
          {{ store.error }}
        </p>
        <slot />
      </main>
    </div>

    <!-- 移动端底部 Tab 栏 -->
    <nav class="mobile-tabbar" aria-label="底部导航">
      <RouterLink to="/" class="mobile-tab" :class="{ active: route.path === '/' }">
        <SIcon icon="lucide:wallet" />
        <span>汇总</span>
      </RouterLink>
      <RouterLink to="/bills" class="mobile-tab" :class="{ active: route.path === '/bills' || route.path.startsWith('/bills/') }">
        <SIcon icon="lucide:receipt-text" />
        <span>账单</span>
      </RouterLink>
      <RouterLink to="/reviews" class="mobile-tab" :class="{ active: route.path === '/reviews' }">
        <SIcon icon="lucide:list-checks" />
        <span>检查</span>
        <span v-if="unreviewedCount > 0" class="mobile-tab-badge">{{ unreviewedCount }}</span>
      </RouterLink>
      <RouterLink to="/manage" class="mobile-tab" :class="{ active: route.path === '/manage' }">
        <SIcon icon="lucide:credit-card" />
        <span>卡片</span>
      </RouterLink>
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: moreOpen || inSettings || route.path === '/calendar' || route.path === '/reports' }"
        @click="moreOpen = true"
      >
        <SIcon icon="lucide:menu" />
        <span>更多</span>
      </button>
    </nav>

    <!-- 移动端「更多」底部菜单 -->
    <div v-if="moreOpen" class="drawer-backdrop" @click.self="moreOpen = false">
      <section class="drawer-panel" role="dialog" aria-modal="true" aria-label="更多功能">
        <header class="drawer-head">
          <div class="drawer-head-text">
            <h2>更多功能</h2>
            <small class="muted">{{ displayName }}</small>
          </div>
          <button type="button" class="quiet ghost icon sm" aria-label="关闭" @click="moreOpen = false">
            <SIcon icon="lucide:x" />
          </button>
        </header>
        <div class="drawer-body">
          <div class="stack" style="gap: 6px">
            <RouterLink to="/calendar" class="sidebar-link" :class="{ active: route.path === '/calendar' }">
              <SIcon icon="lucide:calendar-days" class="sidebar-link-icon" />
              <span class="sidebar-link-label">扣款日历</span>
            </RouterLink>
            <RouterLink to="/reports" class="sidebar-link" :class="{ active: route.path === '/reports' }">
              <SIcon icon="lucide:chart-no-axes-combined" class="sidebar-link-icon" />
              <span class="sidebar-link-label">月报</span>
            </RouterLink>
            <RouterLink to="/settings" class="sidebar-link" :class="{ active: inSettings }">
              <SIcon icon="lucide:settings" class="sidebar-link-icon" />
              <span class="sidebar-link-label">设置与系统管理</span>
            </RouterLink>
            <button
              type="button"
              class="sidebar-link danger"
              style="width: 100%; border: 0; background: transparent; text-align: left"
              @click="moreOpen = false; emit('logout')"
            >
              <SIcon icon="lucide:log-out" class="sidebar-link-icon" />
              <span class="sidebar-link-label">退出登录</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <BillEditor v-if="quickEditor" @close="quickEditor = false" />
  </div>
</template>

<style scoped>
.mobile-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand);
}
</style>
