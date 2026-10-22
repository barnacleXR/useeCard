<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { SThemeModeSegment, SSelect } from '@vean/ui';
import { currencies, type Preferences } from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import NotificationChannels from '../components/NotificationChannels.vue';
import SecurityPanel from '../components/SecurityPanel.vue';
import DevicesPanel from '../components/DevicesPanel.vue';
import DataPanel from '../components/DataPanel.vue';
import ApiKeysPanel from '../components/ApiKeysPanel.vue';
import McpPanel from '../components/McpPanel.vue';
import ThemeColorSelect from '../components/ThemeColorSelect.vue';
import TimeInput from '../components/fields/TimeInput.vue';
const store = useWorkspace();
const currencyItems = Object.keys(currencies).map(value => ({value, label: value}));
const notificationItems = [{value: 'true', label: '开启'}, {value: 'false', label: '关闭'}];
const reminder = ref({reminderDaysBefore: 1, reminderTime: '09:00', inAppNotifications: true}); const saved = ref('');
onMounted(async () => { try { const p = await api<Preferences>('/settings'); reminder.value = {reminderDaysBefore: p.reminderDaysBefore, reminderTime: p.reminderTime, inAppNotifications: p.inAppNotifications}; } catch {} });
async function preference(value: string | number) { try { await store.mutate('/settings', {defaultCurrency: String(value)}, 'PATCH'); } catch {} }
async function saveReminder() {
  saved.value = '';
  try { const p = await store.mutate('/settings', {reminderDaysBefore: Number(reminder.value.reminderDaysBefore), reminderTime: reminder.value.reminderTime, inAppNotifications: reminder.value.inAppNotifications}, 'PATCH') as Preferences; reminder.value = {reminderDaysBefore: p.reminderDaysBefore, reminderTime: p.reminderTime, inAppNotifications: p.inAppNotifications}; saved.value = '已保存'; window.dispatchEvent(new Event('ccm-notifications-changed')); } catch {}
}
async function testNotification() { saved.value = ''; try { await api('/notifications/test','POST'); saved.value = '测试通知已创建，请点击右上角通知查看。'; window.dispatchEvent(new Event('ccm-notifications-changed')); } catch (e) { store.error = (e as Error).message; } }
</script>
<template>
  <PageShell :entry="false">
    <section class="panel settings-panel">
      <h2>外观</h2>
      <div class="setting-row"><span>显示模式</span><SThemeModeSegment show-label/></div>
      <div class="setting-row"><span>主题色</span><ThemeColorSelect/></div>
      <p class="muted">外观保存在当前浏览器，不同设备可分别设置。<button class="link-button" type="button" @click="store.themePanel = true">更多外观设置（圆角、尺寸、配色方案）→</button></p>
      <hr>
      <h2>金额与币种</h2>
      <div class="field"><span>新建卡片默认币种</span><SSelect :model-value="store.defaultCurrency" :items="currencyItems" :trigger-props="{'aria-label': '新建卡片默认币种'}" @update:model-value="preference"/></div>
      <p class="muted">只影响新建卡片，不改历史账单。各币种独立汇总，不连接汇率 API。</p>
      <hr>
      <h2>扣款提醒</h2>
      <form class="form-grid reminder-form" @submit.prevent="saveReminder">
        <div class="field"><span>站内通知</span><SSelect :model-value="String(reminder.inAppNotifications)" :items="notificationItems" :trigger-props="{'aria-label': '站内通知'}" @update:model-value="value => reminder.inAppNotifications = value === 'true'"/></div>
        <label>提前天数<input v-model.number="reminder.reminderDaysBefore" type="number" min="0" max="30" required></label>
        <div class="field"><span>提醒时间（日本时间）</span><TimeInput v-model="reminder.reminderTime" label="提醒时间"/></div>
        <div class="row"><button class="primary">保存提醒设置</button><span class="muted" role="status">{{ saved }}</span></div>
      </form>
      <p class="muted">按“扣款账户＋日期＋币种”合并已录入的待还账单，按自然日提前，不考虑节假日。iOS App 同步后在本机排程通知；外部通知通过下方 Apprise 通道发送。</p>
      <button class="quiet" @click="testNotification">创建测试通知</button> <RouterLink to="/notifications">查看通知 →</RouterLink>
      <p class="muted">站内提醒在服务器运行时每 30 秒检查；页面刷新也会读取最新账单。通知保留历史记录，金额或日期修改后更新，已还或作废后移入历史。关闭站内通知不影响 iOS 本地提醒。</p>
      <hr>
      <NotificationChannels/>
      <hr>
      <SecurityPanel/>
      <hr>
      <DevicesPanel/>
      <hr>
      <DataPanel/>
      <hr>
      <ApiKeysPanel/>
      <hr>
      <McpPanel/>
    </section>
  </PageShell>
</template>
