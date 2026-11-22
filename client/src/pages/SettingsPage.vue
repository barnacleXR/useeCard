<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { SThemeModeSegment, SSelect } from '@vean/ui';
import { currencies, type Preferences } from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import SettingsShell from '../components/SettingsShell.vue';
import NotificationChannels from '../components/NotificationChannels.vue';
import DevicesPanel from '../components/DevicesPanel.vue';
import ApiKeysPanel from '../components/ApiKeysPanel.vue';
import McpPanel from '../components/McpPanel.vue';
import ConnectivityPanel from '../components/ConnectivityPanel.vue';
import TimeInput from '../components/fields/TimeInput.vue';

const route = useRoute();
const store = useWorkspace();
const section = computed(() => {
  const tab = String(route.query.tab || 'general');
  if (tab === 'notifications' || tab === 'connections' || tab === 'devices' || tab === 'offline') return tab;
  return 'general';
});

const currencyItems = Object.keys(currencies).map(value => ({ value, label: value }));
const notificationItems = [
  { value: 'true', label: '开启' },
  { value: 'false', label: '关闭' },
];
const reminder = ref({ reminderDaysBefore: 1, reminderTime: '09:00', inAppNotifications: true });
const saved = ref('');

onMounted(async () => {
  try {
    const p = await api<Preferences>('/settings');
    reminder.value = {
      reminderDaysBefore: p.reminderDaysBefore,
      reminderTime: p.reminderTime,
      inAppNotifications: p.inAppNotifications,
    };
  } catch {}
});

async function preference(value: string | number) {
  try {
    await store.mutate('/settings', { defaultCurrency: String(value) }, 'PATCH');
  } catch {}
}

async function saveReminder() {
  saved.value = '';
  try {
    const p = (await store.mutate(
      '/settings',
      {
        reminderDaysBefore: Number(reminder.value.reminderDaysBefore),
        reminderTime: reminder.value.reminderTime,
        inAppNotifications: reminder.value.inAppNotifications,
      },
      'PATCH',
    )) as Preferences;
    reminder.value = {
      reminderDaysBefore: p.reminderDaysBefore,
      reminderTime: p.reminderTime,
      inAppNotifications: p.inAppNotifications,
    };
    saved.value = '已保存';
    window.dispatchEvent(new Event('ccm-notifications-changed'));
  } catch {}
}

async function testNotification() {
  saved.value = '';
  try {
    await api('/notifications/test', 'POST');
    saved.value = '测试通知已创建，可在通知中心查看。';
    window.dispatchEvent(new Event('ccm-notifications-changed'));
  } catch (e) {
    store.error = (e as Error).message;
  }
}
</script>

<template>
  <SettingsShell>
    <!-- 常规与外观 -->
    <template v-if="section === 'general'">
      <section class="panel stack">
        <div>
          <h2>外观模式</h2>
          <small class="muted">仅保存在当前浏览器，支持浅色、深色或跟随系统。</small>
        </div>
        <div class="setting-row">
          <span>显示模式</span>
          <SThemeModeSegment show-label />
        </div>
      </section>

      <section class="panel stack">
        <div>
          <h2>金额与币种</h2>
          <small class="muted">只影响新建卡片，不修改历史账单。各币种独立汇总，不连接汇率 API。</small>
        </div>
        <div class="field" style="max-width: 260px">
          <span>新建卡片默认币种</span>
          <SSelect
            :model-value="store.defaultCurrency"
            :items="currencyItems"
            :trigger-props="{ 'aria-label': '新建卡片默认币种' }"
            @update:model-value="preference"
          />
        </div>
      </section>
    </template>

    <!-- 扣款提醒与通道 -->
    <template v-else-if="section === 'notifications'">
      <section class="panel stack">
        <div>
          <h2>扣款提醒</h2>
          <small class="muted">
            按「扣款账户＋日期＋币种」合并已录入的待还账单，按自然日提前，不考虑节假日。
          </small>
        </div>
        <form class="form-grid reminder-form" @submit.prevent="saveReminder">
          <div class="field">
            <span>站内通知</span>
            <SSelect
              :model-value="String(reminder.inAppNotifications)"
              :items="notificationItems"
              :trigger-props="{ 'aria-label': '站内通知' }"
              @update:model-value="value => (reminder.inAppNotifications = value === 'true')"
            />
          </div>
          <label>
            提前天数
            <input v-model.number="reminder.reminderDaysBefore" type="number" min="0" max="30" required />
          </label>
          <div class="field">
            <span>提醒时间（日本时间）</span>
            <TimeInput v-model="reminder.reminderTime" label="提醒时间" />
          </div>
          <div class="row" style="justify-content: flex-start; gap: 10px">
            <button class="primary">保存提醒设置</button>
            <button type="button" class="quiet" @click="testNotification">创建测试通知</button>
            <RouterLink to="/notifications" class="link" style="font-size: 13px">查看通知 →</RouterLink>
          </div>
          <p v-if="saved" class="saved-notice full" role="status">{{ saved }}</p>
        </form>
        <small class="muted">
          站内提醒在服务器运行时每 30 秒检查；页面刷新也会读取最新账单。关闭站内通知不影响 iOS 本地提醒。
        </small>
      </section>

      <section class="panel">
        <NotificationChannels />
      </section>
    </template>

    <!-- 外部连接 -->
    <template v-else-if="section === 'connections'">
      <section class="panel">
        <ApiKeysPanel />
      </section>
      <section class="panel">
        <McpPanel />
      </section>
    </template>

    <!-- 设备与离线 -->
    <template v-else>
      <section class="panel">
        <DevicesPanel />
      </section>
      <section class="panel">
        <ConnectivityPanel />
      </section>
    </template>
  </SettingsShell>
</template>
