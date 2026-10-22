<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { api } from '../api';
import { clearSnapshot, loadSnapshot, saveSnapshot, type OfflineSnapshot } from '../offline';
type PushState={configured:boolean;reason:string|null;publicKey:string|null;subscriptions:{id:string;endpointHash:string;createdAt:string}[]};
const push=ref<PushState>(),currentHash=ref(''),snapshot=ref<OfflineSnapshot|null>(null),error=ref(''),message=ref(''),installPrompt=ref<Event&{prompt:()=>Promise<void>}|null>(null);
const onInstall=(event:Event)=>{event.preventDefault();installPrompt.value=event as typeof installPrompt.value;};
const onChecked=()=>{void loadSnapshot().then(value=>snapshot.value=value);};
// 用端点哈希识别本浏览器的订阅，取消其他设备时不影响本机。
async function endpointHash(){const reg=await navigator.serviceWorker?.getRegistration();const sub=await reg?.pushManager.getSubscription();if(!sub)return '';const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
onMounted(async()=>{window.addEventListener('beforeinstallprompt',onInstall);window.addEventListener('useecard-offline-checked',onChecked);try{push.value=await api('/push');snapshot.value=await loadSnapshot();currentHash.value=await endpointHash().catch(()=>'');}catch(e){error.value=(e as Error).message;}});
onBeforeUnmount(()=>{window.removeEventListener('beforeinstallprompt',onInstall);window.removeEventListener('useecard-offline-checked',onChecked);});
function base64url(value:string){const pad='='.repeat((4-value.length%4)%4);return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+pad),c=>c.charCodeAt(0));}
async function subscribe(){error.value='';try{if(!push.value?.publicKey||!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('此浏览器不支持推送');if(await Notification.requestPermission()!=='granted')throw new Error('尚未授予通知权限');const registration=await navigator.serviceWorker.ready;const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64url(push.value.publicKey)});push.value=await api('/push','POST',sub.toJSON());currentHash.value=await endpointHash();message.value='此设备已订阅提醒。';}catch(e){error.value=(e as Error).message;}}
async function unsubscribe(item:{id:string;endpointHash:string}){error.value='';try{if(item.endpointHash&&item.endpointHash===currentHash.value){const reg=await navigator.serviceWorker.ready;await (await reg.pushManager.getSubscription())?.unsubscribe();currentHash.value='';}push.value=await api(`/push/${item.id}`,'DELETE');}catch(e){error.value=(e as Error).message;}}
async function enableOffline(){error.value='';try{if(!window.confirm('离线快照会在本机以未加密形式保存账户、卡片、账单金额及扣款日，最多保留七天。确认启用？'))return;const value=await api<OfflineSnapshot>('/offline/snapshot');await saveSnapshot(value);snapshot.value=value;message.value='离线快照已保存。';}catch(e){error.value=(e as Error).message;}}
async function disableOffline(){await clearSnapshot();snapshot.value=null;message.value='已删除本机离线快照。';}
async function install(){await installPrompt.value?.prompt();installPrompt.value=null;}
</script>
<template>
  <h2>安装与离线</h2>
  <p class="muted">可把 useeCard 安装到主屏幕。离线模式只供查看，不能修改数据。</p>
  <button v-if="installPrompt" class="quiet" @click="install">安装应用</button>
  <p v-else class="muted">如未显示安装按钮，请在浏览器菜单选择“安装应用”或“添加到主屏幕”。</p>
  <div class="setting-row"><span>本机离线快照</span><button class="quiet" @click="snapshot?disableOffline():enableOffline()">{{snapshot?'删除快照':'同意并保存快照'}}</button></div>
  <p v-if="snapshot" class="muted">保存于 {{new Date(snapshot.createdAt).toLocaleString('zh-CN')}}，七天后失效。本机数据未加密；服务器恢复后，下次联网会清除旧快照。</p>
  <h2>浏览器推送</h2>
  <p class="muted">推送只提示有新提醒或系统故障，不包含金额。</p>
  <p v-if="push&&!push.configured" class="muted">{{push.reason}}</p>
  <button v-if="push?.configured" class="quiet" @click="subscribe">订阅此设备</button>
  <div v-for="item in push?.subscriptions||[]" :key="item.id" class="row"><span>{{item.endpointHash===currentHash?'此设备':'其他设备'}} · {{new Date(item.createdAt).toLocaleString('zh-CN')}}</span><button class="quiet" @click="unsubscribe(item)">取消</button></div>
  <p v-if="message" role="status">{{message}}</p><p v-if="error" class="error" role="alert">{{error}}</p>
</template>
