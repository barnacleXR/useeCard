<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { SPopover } from '@vean/ui';
import {
  PhBell,
  PhCalendarDots,
  PhCaretUpDown,
  PhChartBar,
  PhCheckSquare,
  PhCreditCard,
  PhDotsThreeCircle,
  PhGearSix,
  PhPlus,
  PhReceipt,
  PhSidebarSimple,
  PhSignOut,
  PhUserCircle,
  PhWallet,
  PhX,
} from '@phosphor-icons/vue';
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
const accountOpen = ref(false);

const unreadCount = ref(0);
const unreadFailed = ref(false);
const profile = ref<{ username: string; displayName: string; hasAvatar: number } | null>(null);
let unreadSeq = 0;
let unreadTimer: ReturnType<typeof setInterval>;

const navItems = [
  { to: '/', label: '备款汇总', icon: PhWallet },
  { to: '/bills', label: '账单', icon: PhReceipt },
  { to: '/calendar', label: '日历', icon: PhCalendarDots },
  { to: '/reviews', label: '月度检查', icon: PhCheckSquare, showUnreviewed: true },
  { to: '/notifications', label: '通知', icon: PhBell, showUnread: true },
  { to: '/reports', label: '月报', icon: PhChartBar },
  { to: '/manage', label: '卡片与账户', icon: PhCreditCard },
];

const settingsPaths = ['/settings', '/profile', '/backups', '/system', '/audit'];
const inSettings = computed(() => settingsPaths.includes(route.path));
const mobileMoreActive = computed(() => moreOpen.value || inSettings.value || ['/calendar', '/reports'].includes(route.path));
const canAddBill = computed(() => store.cards.some(c => !c.archivedAt));
const unreviewedCount = computed(() => store.reviews.filter(r => r.status === 'unreviewed').length);
const displayName = computed(() => profile.value?.displayName || profile.value?.username || '账户与设置');
const avatarInitial = computed(() => displayName.value.slice(0, 1).toUpperCase());
const notificationLabel = computed(() =>
  unreadFailed.value ? '通知，暂时无法刷新' : `通知，${unreadCount.value} 条未读`,
);

function isNavActive(path: string) {
  return route.path === path || (path === '/bills' && route.path.startsWith('/bills/'));
}

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
  accountOpen.value = false;
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
        <RouterLink to="/" class="sidebar-brand-link" aria-label="useeCard 备款汇总" title="useeCard 备款汇总">
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
          <PhSidebarSimple :size="18" aria-hidden="true" />
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
        <PhSidebarSimple :size="18" aria-hidden="true" />
      </button>

      <button
        v-if="route.path !== '/' || collapsed"
        type="button"
        class="quiet sidebar-cta"
        :disabled="!canAddBill"
        :title="canAddBill ? '录入账单' : '请先添加信用卡'"
        @click="quickEditor = true"
      >
        <PhPlus :size="16" aria-hidden="true" />
        <span v-if="!collapsed">录入账单</span>
      </button>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar-link"
          :class="{ active: isNavActive(item.to) }"
          :aria-label="item.showUnread ? notificationLabel : collapsed ? item.label : undefined"
          :title="collapsed ? item.label : undefined"
        >
          <component
            :is="item.icon"
            :size="20"
            :weight="isNavActive(item.to) ? 'fill' : 'regular'"
            class="sidebar-link-icon"
            aria-hidden="true"
          />
          <span v-if="!collapsed" class="sidebar-link-label">{{ item.label }}</span>
          <span
            v-if="item.showUnreviewed && unreviewedCount > 0"
            class="sidebar-pill"
            :title="`${unreviewedCount} 张卡待核对`"
          >
            {{ unreviewedCount }}
          </span>
          <span v-if="item.showUnread && unreadCount > 0" class="sidebar-pill brand" aria-hidden="true">
            {{ unreadCount > 99 ? '99+' : unreadCount }}
          </span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <SPopover
          v-model:open="accountOpen"
          placement="top-start"
          :show-arrow="false"
          :positioner-props="{ sideOffset: 8, hideWhenDetached: true }"
        >
          <template #trigger>
            <button
              type="button"
              class="sidebar-account-btn"
              :class="{ active: inSettings || accountOpen }"
              :aria-label="`${displayName}，账户与设置`"
              :title="collapsed ? '账户与设置' : undefined"
            >
              <span class="sidebar-avatar">
                <img v-if="profile?.hasAvatar" :src="'/api/profile/avatar'" alt="" />
                <template v-else>{{ avatarInitial }}</template>
              </span>
              <span v-if="!collapsed" class="sidebar-account-meta">
                <strong>{{ displayName }}</strong>
                <small>账户与设置</small>
              </span>
              <PhCaretUpDown v-if="!collapsed" :size="16" class="sidebar-link-icon" aria-hidden="true" />
            </button>
          </template>
          <nav class="sidebar-account-menu" aria-label="账户与设置">
            <RouterLink to="/profile" class="sidebar-link" @click="accountOpen = false">
              <PhUserCircle :size="18" class="sidebar-link-icon" aria-hidden="true" />
              个人中心
            </RouterLink>
            <RouterLink to="/settings" class="sidebar-link" @click="accountOpen = false">
              <PhGearSix :size="18" class="sidebar-link-icon" aria-hidden="true" />
              设置
            </RouterLink>
            <ThemeModeButton show-label class="sidebar-link" />
            <button type="button" class="sidebar-link danger" @click="accountOpen = false; emit('logout')">
              <PhSignOut :size="18" class="sidebar-link-icon" aria-hidden="true" />
              退出登录
            </button>
          </nav>
        </SPopover>
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
          <span class="mobile-topbar-title">{{ route.path === '/' ? 'useeCard' : route.meta.title || 'useeCard' }}</span>
        </div>
        <div class="mobile-topbar-actions">
          <button
            type="button"
            class="primary sm"
            :disabled="!canAddBill"
            @click="quickEditor = true"
          >
            <PhPlus :size="16" aria-hidden="true" />
            <span>录入</span>
          </button>
          <RouterLink
            to="/notifications"
            class="quiet ghost icon sm"
            :aria-label="notificationLabel"
            style="position: relative"
          >
            <PhBell :size="18" aria-hidden="true" />
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
      <RouterLink to="/" class="mobile-tab" :class="{ active: isNavActive('/') }">
        <PhWallet :size="20" :weight="isNavActive('/') ? 'fill' : 'regular'" aria-hidden="true" />
        <span>汇总</span>
      </RouterLink>
      <RouterLink to="/bills" class="mobile-tab" :class="{ active: isNavActive('/bills') }">
        <PhReceipt :size="20" :weight="isNavActive('/bills') ? 'fill' : 'regular'" aria-hidden="true" />
        <span>账单</span>
      </RouterLink>
      <RouterLink to="/reviews" class="mobile-tab" :class="{ active: isNavActive('/reviews') }">
        <PhCheckSquare :size="20" :weight="isNavActive('/reviews') ? 'fill' : 'regular'" aria-hidden="true" />
        <span>检查</span>
        <span v-if="unreviewedCount > 0" class="mobile-tab-badge">{{ unreviewedCount }}</span>
      </RouterLink>
      <RouterLink to="/manage" class="mobile-tab" :class="{ active: isNavActive('/manage') }">
        <PhCreditCard :size="20" :weight="isNavActive('/manage') ? 'fill' : 'regular'" aria-hidden="true" />
        <span>卡片</span>
      </RouterLink>
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: mobileMoreActive }"
        @click="moreOpen = true"
      >
        <PhDotsThreeCircle :size="20" :weight="mobileMoreActive ? 'fill' : 'regular'" aria-hidden="true" />
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
            <PhX :size="18" aria-hidden="true" />
          </button>
        </header>
        <div class="drawer-body">
          <div class="stack" style="gap: 6px">
            <RouterLink to="/calendar" class="sidebar-link" :class="{ active: route.path === '/calendar' }">
              <PhCalendarDots :size="18" class="sidebar-link-icon" aria-hidden="true" />
              <span class="sidebar-link-label">扣款日历</span>
            </RouterLink>
            <RouterLink to="/reports" class="sidebar-link" :class="{ active: route.path === '/reports' }">
              <PhChartBar :size="18" class="sidebar-link-icon" aria-hidden="true" />
              <span class="sidebar-link-label">月报</span>
            </RouterLink>
            <RouterLink to="/settings" class="sidebar-link" :class="{ active: inSettings }">
              <PhGearSix :size="18" class="sidebar-link-icon" aria-hidden="true" />
              <span class="sidebar-link-label">设置与系统管理</span>
            </RouterLink>
            <button
              type="button"
              class="sidebar-link danger"
              style="width: 100%; border: 0; background: transparent; text-align: left"
              @click="moreOpen = false; emit('logout')"
            >
              <PhSignOut :size="18" class="sidebar-link-icon" aria-hidden="true" />
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
