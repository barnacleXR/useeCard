<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { DeviceSession, PairingCode } from '@ccm/shared';
import { api } from '../api';
// 原生 App 连接：生成一次性配对码（10 分钟、单次有效），查看与撤销已登录设备。
const devices = ref<DeviceSession[]>([]); const pairing = ref<PairingCode>(); const now = ref(Date.now()); const error = ref(''); const busy = ref(false);
const server = window.location.origin;
const remaining = computed(() => pairing.value ? Math.max(0, Math.floor((Date.parse(pairing.value.expiresAt) - now.value) / 1000)) : 0);
const countdown = computed(() => `${Math.floor(remaining.value / 60)}:${String(remaining.value % 60).padStart(2, '0')}`);
// 配对码显示期间每 5 秒刷新设备列表；发现经它配对的新设备即收起配对码。
const timer = window.setInterval(() => { now.value = Date.now(); if (pairing.value && !remaining.value) pairing.value = undefined; if (pairing.value && remaining.value % 5 === 0) void load(); }, 1000);
onBeforeUnmount(() => window.clearInterval(timer));
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Tokyo', hour12: false}) : '尚未使用';
async function load() {
  try {
    devices.value = await api<DeviceSession[]>('/devices');
    const issuedAt = pairing.value ? Date.parse(pairing.value.expiresAt) - 10 * 60_000 : Infinity;
    if (devices.value.some(d => d.method === 'pairing' && Date.parse(d.createdAt) >= issuedAt)) pairing.value = undefined;
  } catch (e) { error.value = (e as Error).message; }
}
async function createCode() {
  busy.value = true; error.value = '';
  try { pairing.value = await api<PairingCode>('/devices/pairing-codes', 'POST'); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
async function revoke(device: DeviceSession) {
  if (!confirm(`撤销「${device.name}」？该设备需要重新登录或配对。`)) return;
  try { await api(`/devices/${device.id}/revoke`, 'POST'); await load(); } catch (e) { error.value = (e as Error).message; }
}
function securityChanged() { pairing.value = undefined; void load(); }
onMounted(() => { void load(); window.addEventListener('ccm-security-changed', securityChanged); });
onBeforeUnmount(() => window.removeEventListener('ccm-security-changed', securityChanged));
</script>
<template>
  <h2>iOS App 与设备</h2>
  <p class="muted">在 App 中输入服务器地址 <code>{{ server }}</code>，再输入配对码；也可以直接用账号密码登录。</p>
  <div v-if="pairing" class="pairing-code" role="status">
    <strong>{{ pairing.code }}</strong>
    <span class="muted">{{ countdown }} 后失效 · 只能使用一次</span>
  </div>
  <button class="quiet" :disabled="busy" @click="createCode">{{ pairing ? '重新生成配对码' : '生成配对码' }}</button>
  <button class="quiet" type="button" @click="load">刷新设备列表</button>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <div v-if="!devices.length" class="muted device-empty">还没有已登录的设备。</div>
  <div v-for="device in devices" :key="device.id" class="master-row">
    <div><strong>{{ device.name }}</strong><small>{{ device.method === 'pairing' ? '配对码' : '账号密码' }} · 登录于 {{ time(device.createdAt) }} · 最近使用 {{ time(device.lastUsedAt) }}</small></div>
    <button class="quiet danger" @click="revoke(device)">撤销</button>
  </div>
</template>
