<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { formatMoney, type NotificationItem, type NotificationPage } from '@ccm/shared';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import { SSelect } from '@vean/ui';
const store=useWorkspace();
const filterItems: {value:string;label:string}[] = [{value:'active',label:'当前提醒'},{value:'unread',label:'未读提醒'},{value:'history',label:'全部记录'}];
const filter=ref('active'),page=ref(1),result=ref<NotificationPage>({items:[],total:0,unreadCount:0,page:1,pageSize:20}),busy=ref(false),writing=ref(false),error=ref('');
let sequence=0;let timer:ReturnType<typeof setInterval>;
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false});
const label=(item:NotificationItem)=>item.kind==='test'?'测试通知':item.kind==='overdue'?'扣款日已过，待确认':'即将扣款，请准备资金';
const link=(item:NotificationItem)=>({path:'/bills',query:{from:item.dueDate!,to:item.dueDate!,accountId:item.accountId!,currency:item.currency!,status:'pending'}});
async function load(){const ticket=++sequence;busy.value=true;error.value='';try{const data=await api<NotificationPage>(`/notifications?filter=${filter.value}&page=${page.value}&pageSize=20`);if(ticket===sequence){result.value=data;if(page.value>1&&!data.items.length){page.value=Math.max(1,Math.ceil(data.total/20));void load();}}}catch(e){if(ticket===sequence)error.value=(e as Error).message;}finally{if(ticket===sequence)busy.value=false;}}
async function read(item?:NotificationItem){writing.value=true;error.value='';try{await api(item?'/notifications/read':'/notifications/read-all','POST',item?{items:[{id:item.id,version:item.version}]}:undefined);await load();window.dispatchEvent(new Event('ccm-notifications-changed'));}catch(e){error.value=(e as Error).message;}finally{writing.value=false;}}
function changeFilter(){page.value=1;void load();}
function turn(delta:number){page.value+=delta;void load();}
watch(()=>store.revision,()=>void load());
watch(filter, changeFilter);
onMounted(()=>{void load();timer=setInterval(()=>{if(!document.hidden&&!writing.value)void load();},30_000);});
onBeforeUnmount(()=>{sequence++;clearInterval(timer);});
</script>
<template>
 <PageShell :entry="false">
  <section class="panel">
   <div class="toolbar"><div class="field filter-select"><span>显示</span><SSelect v-model="filter" :items="filterItems" :trigger-props="{'aria-label':'显示通知'}"/></div><button class="quiet" :disabled="busy||writing" @click="load">刷新</button><button class="quiet" :disabled="busy||writing||!result.unreadCount" @click="read()">全部标为已读</button><RouterLink to="/settings">提醒设置</RouterLink></div>
   <p class="muted">{{ result.unreadCount }} 条未读。只统计已录入的待确认账单，各币种独立提醒；已读不表示已扣款。</p>
   <p v-if="error" class="error" role="alert">{{ error }}</p>
   <p v-if="busy&&!result.items.length" role="status">正在加载通知…</p><p v-else-if="!result.items.length" class="muted">没有符合条件的通知。</p>
   <article v-for="item in result.items" :key="item.id" class="notification-entry" :class="{'is-unread':!item.readAt&&!item.resolvedAt}">
    <div class="row"><strong>{{ label(item) }}</strong><span class="muted">{{ item.resolvedAt?'已失效':item.readAt?'已读':'未读' }}</span></div>
    <template v-if="item.kind!=='test'"><p>{{ item.accountName }} · 扣款日 {{ item.dueDate }}</p><p>已录入 {{ item.billCount }} 笔，合计 <strong>{{ formatMoney(item.amountMinor!,item.currency!) }}</strong></p><p v-if="item.kind==='overdue'&&!item.resolvedAt" class="muted">请到银行确认是否已扣款；这里的待确认状态不代表银行逾期。</p></template>
    <p v-else>站内通知正常。此消息不对应账单，也不会改变账单状态。</p>
    <p v-if="item.resolvedAt" class="muted">账单或提醒设置已变化，此记录仅供历史查看。</p>
    <small class="muted">首次提醒 {{ time(item.createdAt) }}<template v-if="item.updatedAt!==item.createdAt"> · 最近更新 {{ time(item.updatedAt) }}</template></small>
    <div class="row"><RouterLink v-if="item.kind!=='test'&&!item.resolvedAt" :to="link(item)">查看相关账单 →</RouterLink><button v-if="!item.readAt" class="quiet" :disabled="writing||busy" @click="read(item)">标为已读</button></div>
   </article>
   <nav class="pager" aria-label="通知分页"><span class="muted">共 {{ result.total }} 条 · 第 {{ page }} / {{ Math.max(1,Math.ceil(result.total/20)) }} 页</span><div class="row"><button class="quiet" :disabled="busy||page<=1" @click="turn(-1)">上一页</button><button class="quiet" :disabled="busy||page*20>=result.total" @click="turn(1)">下一页</button></div></nav>
  </section>
 </PageShell>
</template>
<style scoped>
.notification-entry{padding:1.1rem;margin:1rem 0;border:1px solid hsl(var(--border) / var(--border-alpha,1));border-radius:12px;overflow-wrap:anywhere}.notification-entry.is-unread{border-inline-start:3px solid hsl(var(--primary))}.notification-entry p{margin:.5rem 0}.notification-entry small{display:block;margin:.6rem 0}.toolbar{flex-wrap:wrap}
</style>
