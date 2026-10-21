<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { api } from '../api';
import { notifyServices, buildNotifyUrl, type NotifyServiceId } from '../notify-services';
type Channel={id:string;name:string;service:NotifyServiceId;enabled:boolean;version:number};
type Delivery={id:string;channelName:string;notificationId:string|null;status:string;attempts:number;lastError:string|null;nextAttemptAt:string|null;updatedAt:string};
type State={gatewayConfigured:boolean;channels:Channel[];deliveries:Delivery[]};
const state=ref<State>(),service=ref<NotifyServiceId>('telegram'),values=ref<Record<string,string>>({}),name=ref(''),enabled=ref(false),busy=ref(false),error=ref(''),message=ref('');
const selected=computed(()=>notifyServices.find(v=>v.id===service.value)!);
const statuses:Record<string,string>={pending:'等待发送',sending:'正在发送',sent:'已发送（网关确认）',failed:'发送失败',cancelled:'已取消'};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false});
let sequence=0;let timer:ReturnType<typeof setInterval>;
watch(service,()=>{values.value=service.value==='email'?{port:'587',tls:'starttls'}:{};message.value='';error.value='';});
async function load(){const ticket=++sequence;try{const data=await api<State>('/notification-channels');if(ticket===sequence)state.value=data;}catch(e){if(ticket===sequence)error.value=(e as Error).message;}}
async function action(work:()=>Promise<unknown>,success:string){busy.value=true;error.value='';message.value='';try{await work();message.value=success;await load();window.dispatchEvent(new Event('ccm-notifications-changed'));}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
function draft(){return buildNotifyUrl(service.value,values.value);}
async function add(){await action(async()=>{await api('/notification-channels','POST',{name:name.value.trim()||selected.value.name,service:service.value,url:draft(),enabled:enabled.value});values.value=service.value==='email'?{port:'587',tls:'starttls'}:{};name.value='';enabled.value=false;},'通知通道已保存。密钥不再回显。');}
async function test(channel?:Channel){await action(()=>api('/notification-channels/test','POST',channel?{channelId:channel.id}:{url:draft()}),'测试发送成功，Apprise 已确认投递，请到目标服务查看。');}
async function toggle(channel:Channel){await action(()=>api(`/notification-channels/${channel.id}`,'PATCH',{enabled:!channel.enabled,version:channel.version}),'通道状态已更新。');}
async function remove(channel:Channel){if(!confirm(`移除「${channel.name}」？该通道将停止自动提醒，历史投递记录保留。`))return;await action(()=>api(`/notification-channels/${channel.id}/remove`,'POST',{version:channel.version}),'通道已移除。');}
async function retry(item:Delivery){await action(()=>api(`/notification-channels/deliveries/${item.id}/retry`,'POST'),'已重新加入发送队列。');}
onMounted(()=>{void load();timer=setInterval(()=>{if(!document.hidden&&!busy.value)void load();},30_000);});
onBeforeUnmount(()=>{sequence++;clearInterval(timer);});
</script>
<template>
 <h2>外部通知 · Apprise</h2>
 <p class="muted">将已录入账单的账户、扣款日、金额和币种发送到你选择的目标。与站内通知独立开关，沿用上方提前天数和日本提醒时间。</p>
 <p v-if="state&&!state.gatewayConfigured" class="muted">当前服务器尚未启用 Apprise，通道可以先保存。启用方式见 <a href="https://github.com/caronc/apprise-api" target="_blank" rel="noreferrer">Apprise 部署说明</a>；管理员需按项目文档配置通知服务后才能发送。</p>
 <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
 <div v-for="channel in state?.channels" :key="channel.id" class="notification-channel">
  <div><strong>{{ channel.name }}</strong><small>{{ notifyServices.find(v=>v.id===channel.service)?.name||channel.service }} · {{ channel.enabled?'自动提醒已开启':'自动提醒已关闭' }} · 密钥已保存</small></div>
  <div class="channel-actions"><button class="quiet" :disabled="busy||!state?.gatewayConfigured" @click="test(channel)">测试发送</button><button class="quiet" :disabled="busy" @click="toggle(channel)">{{ channel.enabled?'停用':'启用' }}</button><button class="quiet danger" :disabled="busy" @click="remove(channel)">移除</button></div>
 </div>
 <details class="channel-add"><summary>添加通知通道</summary>
  <form @submit.prevent="add">
   <label>通知服务<select v-model="service" :disabled="busy"><option v-for="item in notifyServices" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
   <ol class="muted"><li v-for="step in selected.steps" :key="step">{{ step }}</li></ol>
   <div class="form-grid"><label>通道名称（选填）<input v-model="name" maxlength="100" :placeholder="selected.name" :disabled="busy"></label>
    <label v-for="field in selected.fields" :key="service+field.key">{{ field.label }}<select v-if="field.options" v-model="values[field.key]" :disabled="busy" required><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select><input v-else v-model="values[field.key]" :type="field.secret?'password':'text'" :placeholder="field.placeholder" autocomplete="off" maxlength="2000" :disabled="busy" required></label>
   </div>
   <label class="channel-enabled"><input v-model="enabled" type="checkbox" :disabled="busy">保存后启用自动提醒（将发送当前符合条件的待确认账单）</label>
   <div class="channel-actions"><button type="button" class="quiet" :disabled="busy||!state?.gatewayConfigured" @click="test()">先发送测试通知</button><button class="primary" :disabled="busy">保存通道</button><a href="https://appriseit.com/services/" target="_blank" rel="noreferrer">其他服务地址格式</a></div>
  </form>
 </details>
 <details v-if="state?.deliveries.length" class="channel-history"><summary>最近投递记录（最多 50 条）</summary>
  <article v-for="item in state.deliveries" :key="item.id" class="delivery-row"><strong>{{ item.channelName }} · {{ statuses[item.status]||item.status }}</strong><small>{{ time(item.updatedAt) }} · 尝试 {{ item.attempts }} 次</small><p v-if="item.lastError" class="error">{{ item.lastError }}</p><p v-if="item.nextAttemptAt" class="muted">下次尝试 {{ time(item.nextAttemptAt) }}</p><button v-if="item.status==='failed'&&item.notificationId" class="quiet" :disabled="busy" @click="retry(item)">重试当前提醒</button></article>
 </details>
</template>
<style scoped>
.notification-channel{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:1rem 0;border-bottom:1px solid hsl(var(--border) / var(--border-alpha,1))}.notification-channel small,.delivery-row small{display:block;margin-top:.4rem}.channel-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.channel-add,.channel-history{margin:1rem 0}.channel-add summary,.channel-history summary{cursor:pointer;font-weight:600;margin-bottom:1rem}.channel-add form{max-width:760px}.channel-enabled{display:flex;align-items:center;gap:.5rem;margin:1rem 0}.channel-enabled input{width:auto}.delivery-row{padding:1rem 0;overflow-wrap:anywhere;border-bottom:1px solid hsl(var(--border) / var(--border-alpha,1))}
</style>
