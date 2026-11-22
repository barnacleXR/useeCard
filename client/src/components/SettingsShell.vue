<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { SIcon } from '@vean/ui';
import PageShell from './PageShell.vue';

// 统一「设置空间」二级布局：收敛偏好、通知、外部连接、设备与离线、个人与安全、备份、系统状态与操作记录。
const route = useRoute();
const activeTab = computed(() => String(route.query.tab || 'general'));

interface NavItem {
  label: string;
  icon: string;
  to: string | { path: string; query?: Record<string, string> };
  isActive: () => boolean;
}

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: '空间偏好',
    items: [
      {
        label: '常规与外观',
        icon: 'lucide:sliders-horizontal',
        to: { path: '/settings', query: { tab: 'general' } },
        isActive: () => route.path === '/settings' && activeTab.value === 'general',
      },
      {
        label: '扣款提醒与通道',
        icon: 'lucide:bell',
        to: { path: '/settings', query: { tab: 'notifications' } },
        isActive: () => route.path === '/settings' && activeTab.value === 'notifications',
      },
      {
        label: '外部连接',
        icon: 'lucide:plug',
        to: { path: '/settings', query: { tab: 'connections' } },
        isActive: () => route.path === '/settings' && activeTab.value === 'connections',
      },
      {
        label: '设备与离线',
        icon: 'lucide:smartphone',
        to: { path: '/settings', query: { tab: 'devices' } },
        isActive: () =>
          route.path === '/settings' && (activeTab.value === 'devices' || activeTab.value === 'offline'),
      },
    ],
  },
  {
    title: '账户与运维',
    items: [
      {
        label: '个人与安全',
        icon: 'lucide:shield-user',
        to: '/profile',
        isActive: () => route.path === '/profile',
      },
      {
        label: '备份管理',
        icon: 'lucide:database-backup',
        to: '/backups',
        isActive: () => route.path === '/backups',
      },
      {
        label: '系统状态',
        icon: 'lucide:activity',
        to: '/system',
        isActive: () => route.path === '/system',
      },
      {
        label: '操作记录',
        icon: 'lucide:history',
        to: '/audit',
        isActive: () => route.path === '/audit',
      },
    ],
  },
];
</script>

<template>
  <PageShell :entry="false" title="设置" subtitle="管理你的自托管空间、账户安全与系统状态。">
    <div class="settings-shell">
      <nav class="settings-sidebar" aria-label="设置分类">
        <template v-for="group in groups" :key="group.title">
          <div class="settings-group-label">{{ group.title }}</div>
          <RouterLink
            v-for="item in group.items"
            :key="item.label"
            :to="item.to"
            class="settings-nav-item"
            :class="{ active: item.isActive() }"
          >
            <SIcon :icon="item.icon" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </template>
      </nav>
      <div class="settings-content">
        <slot />
      </div>
    </div>
  </PageShell>
</template>
