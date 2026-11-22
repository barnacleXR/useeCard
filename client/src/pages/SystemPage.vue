<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SettingsShell from '../components/SettingsShell.vue';
import { api } from '../api';

interface Status {
  version: string;
  disk: { total: number; free: number; usage: number };
  databaseBytes: number;
  backup: {
    schedule: { frequency: string };
    running: boolean;
    latest: { ok: boolean; at: string; message?: string } | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    nextRun: string | null;
    backups: number;
  };
  jobs: Record<string, number>;
  failedLogins: number;
  activeGrants: number;
  apiKeys: number;
  alerts: { key: string; severity: string; message: string; active: number; changedAt: string }[];
}

const status = ref<Status>();
const error = ref('');

async function load() {
  try {
    status.value = await api('/system');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(load);

const size = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const jobLabels: Record<string, string> = {
  backup: '自动备份',
  notifications: '站内提醒',
  apprise: '外部通知',
  push: '浏览器推送',
  system: '系统检查',
};
const severityLabels: Record<string, string> = { warning: '提醒', critical: '告警' };
</script>

<template>
  <SettingsShell>
    <section class="panel stack">
      <div class="row">
        <div>
          <h2>系统状态</h2>
          <small class="muted">自托管服务健康状态、后台任务心跳与活动告警。</small>
        </div>
        <button type="button" class="quiet sm" @click="load">刷新</button>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <template v-if="status">
        <dl class="status-grid">
          <div class="status-tile">
            <dt>版本</dt>
            <dd class="num">{{ status.version }}</dd>
          </div>
          <div class="status-tile">
            <dt>磁盘使用</dt>
            <dd class="num">{{ Math.round(status.disk.usage * 100) }}% · 剩余 {{ size(status.disk.free) }}</dd>
          </div>
          <div class="status-tile">
            <dt>数据库体积</dt>
            <dd class="num">{{ size(status.databaseBytes) }}</dd>
          </div>
          <div class="status-tile">
            <dt>备份任务</dt>
            <dd>{{ status.backup.running ? '正在运行' : '空闲' }}</dd>
          </div>
          <div class="status-tile">
            <dt>最近成功 / 失败</dt>
            <dd class="num">
              {{ status.backup.lastSuccessAt ? new Date(status.backup.lastSuccessAt).toLocaleString('zh-CN') : '无' }} /
              {{ status.backup.lastFailureAt ? new Date(status.backup.lastFailureAt).toLocaleString('zh-CN') : '无' }}
            </dd>
          </div>
          <div class="status-tile">
            <dt>下次备份</dt>
            <dd class="num">
              {{ status.backup.nextRun ? new Date(status.backup.nextRun).toLocaleString('zh-CN') : '未计划' }}
            </dd>
          </div>
          <div class="status-tile">
            <dt>近一小时失败登录</dt>
            <dd class="num">{{ status.failedLogins }}</dd>
          </div>
          <div class="status-tile">
            <dt>MCP 授权 / API Key</dt>
            <dd class="num">{{ status.activeGrants }} / {{ status.apiKeys }}</dd>
          </div>
        </dl>

        <div>
          <h3 style="margin-bottom: 8px">后台任务</h3>
          <div class="job-list">
            <div v-for="(heartbeat, name) in status.jobs" :key="name" class="job-row">
              <span>{{ jobLabels[name] || name }}</span>
              <small class="num muted">最近运行 {{ new Date(heartbeat).toLocaleString('zh-CN') }}</small>
            </div>
          </div>
        </div>

        <div>
          <h3 style="margin-bottom: 8px">活动告警</h3>
          <p v-if="!status.alerts.some(v => v.active)" class="muted">当前没有活动告警。</p>
          <div v-else class="stack" style="gap: 8px">
            <p v-for="alert in status.alerts.filter(v => v.active)" :key="alert.key" class="error">
              {{ severityLabels[alert.severity] || alert.severity }}：{{ alert.message }}
            </p>
          </div>
        </div>

        <div>
          <RouterLink to="/backups" class="link" style="font-size: 13px">前往备份管理 →</RouterLink>
        </div>
      </template>
    </section>
  </SettingsShell>
</template>

<style scoped>
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 0;
}

.status-tile {
  padding: 12px 14px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
}

.status-tile dt {
  font-size: 11.5px;
  color: var(--text-muted);
}

.status-tile dd {
  margin: 5px 0 0;
  font-size: 13.5px;
  font-weight: 600;
}

.job-list {
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.job-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-subtle);
  font-size: 13px;
}

.job-row:last-child {
  border-bottom: 0;
}
</style>
