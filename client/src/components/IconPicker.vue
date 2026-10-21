<script setup lang="ts">
import { ref } from 'vue';
import type { Asset, CardBrand } from '@ccm/shared';
import { api } from '../api';
import EntityIcon from './EntityIcon.vue';
import CardArtwork from './CardArtwork.vue';
import CardBrandBadge from './CardBrandBadge.vue';
// 自定义图标：按官网域名抓取、填写图片网址或上传；图片保存在自己的服务器上。
const assetId = defineModel<string | null>('assetId', {default: null});
const props = withDefaults(defineProps<{name:string;brand?:CardBrand|'';last4?:string;presentation?:'icon'|'card';domainSuggestions?:{label:string;domain:string}[]}>(),{presentation:'icon',last4:''});
type Mode = 'site' | 'url' | 'upload';
const mode = ref<Mode>(props.presentation==='card'?'upload':'site'); const domain = ref(''); const url = ref(''); const busy = ref(false); const error = ref('');
const listId = `icon-domains-${Math.random().toString(36).slice(2)}`;
async function run(task: () => Promise<Asset>) {
  busy.value = true; error.value = '';
  try { assetId.value = (await task()).id; } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
const fetchSite = () => run(() => api<Asset>('/assets/site-icon', 'POST', {domain: domain.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')}));
const fetchUrl = () => run(() => api<Asset>('/assets/fetch', 'POST', {url: url.value.trim()}));
// 浏览器端先缩放到最长边 768px（卡面）或 256px（图标） 的 PNG，原图再大也能上传，服务器只保存小图。
function resize(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image(); const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, (props.presentation==='card'?768:256) / Math.max(image.width, image.height)); const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(objectUrl); resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('无法读取这张图片')); };
    image.src = objectUrl;
  });
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; (event.target as HTMLInputElement).value = '';
  if (!file) return;
  if (file.type === 'image/svg+xml') { error.value = '不支持 SVG，请使用 PNG、JPEG 或 WebP'; return; }
  await run(async () => api<Asset>('/assets', 'POST', {dataUrl: await resize(file)}));
}
// 供父组件在选中银行后自动抓取官网图标。
async function fromDomain(value: string) { domain.value = value; mode.value = 'site'; await fetchSite(); return !error.value; }
defineExpose({fromDomain});
</script>
<template>
  <div class="icon-picker" :class="{'card-art-picker':presentation==='card'}">
    <div v-if="presentation==='card'" class="card-art-preview"><CardArtwork :name="name" :asset-id="assetId" :last4="last4"/><CardBrandBadge :brand="brand ?? ''"/></div>
    <EntityIcon v-else :name="name || '?'" :asset-id="assetId" :brand="brand" :size="48"/>
    <div class="icon-picker-body">
      <div class="segmented" role="tablist" :aria-label="presentation==='card'?'卡面来源':'图标来源'">
        <button v-for="[value, label] in (presentation==='card' ? [['upload', '上传卡面'], ['url', '卡面网址']] as const : [['site', '官网图标'], ['url', '图片网址'], ['upload', '上传']] as const)" :key="value" type="button" role="tab" :aria-selected="mode === value" :class="{active: mode === value}" @click="mode = value; error = ''">{{ label }}</button>
        <button v-if="assetId" type="button" class="danger" @click="assetId = null; error = ''">{{presentation==='card'?'清除卡面':'清除图标'}}</button>
      </div>
      <div v-if="mode === 'site'" class="icon-picker-row">
        <input v-model="domain" :list="listId" placeholder="官网域名，例如 smbc.co.jp" inputmode="url" autocomplete="off" @keydown.enter.prevent="domain && fetchSite()">
        <datalist :id="listId"><option v-for="item in domainSuggestions ?? []" :key="item.domain" :value="item.domain">{{ item.label }}</option></datalist>
        <button type="button" class="quiet" :disabled="busy || !domain" @click="fetchSite">{{ busy ? '抓取中…' : '抓取' }}</button>
      </div>
      <div v-else-if="mode === 'url'" class="icon-picker-row">
        <input v-model="url" type="url" placeholder="https://… 图片地址" autocomplete="off" @keydown.enter.prevent="url && fetchUrl()">
        <button type="button" class="quiet" :disabled="busy || !url" @click="fetchUrl">{{ busy ? '下载中…' : '使用' }}</button>
      </div>
      <label v-else class="icon-picker-row upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="busy" @change="upload"><span class="muted">{{ busy ? '上传中…' : presentation==='card'?'PNG / JPEG / WebP，最长边 768px。请使用无完整卡号、安全码的展示卡面。':'PNG / JPEG / WebP，自动缩放为 256px' }}</span></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
