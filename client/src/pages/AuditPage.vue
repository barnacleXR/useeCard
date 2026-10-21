<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api';
import PageShell from '../components/PageShell.vue';
type Entry={id:string;action:string;entityId:string;changes:unknown;createdAt:string};
const items=ref<Entry[]>([]),actions=ref<string[]>([]),total=ref(0),page=ref(1),pageSize=ref(20),action=ref(''),from=ref(''),to=ref(''),busy=ref(false),error=ref('');
let generation=0;
const labels:Record<string,string>={'auth.login':'浏览器登录','auth.password.change':'修改密码','auth.password.rejected':'修改密码验证失败','auth.session.revoke':'撤销浏览器登录','device.revoke':'撤销设备','device.create':'设备登录','device.pairing-code':'生成配对码','asset.create':'添加图片','bill.create':'添加账单','bill.update':'编辑账单','bill.paid':'确认已还','bill.undo-paid':'撤销已还','bill.void':'作废账单','account.create':'添加账户','account.update':'编辑账户','card.create':'添加卡片','card.update':'编辑卡片','archive':'归档卡片或账户','bank_accounts.reorder':'调整账户顺序','credit_cards.reorder':'调整卡片顺序','review.start':'建立月度检查','review.add-cards':'补充检查卡片','review.confirm':'确认检查结果','backup.schedule':'设置自动备份','backup.create':'创建备份','backup.restore':'恢复备份'};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false});
async function load(reset=false){if(reset)page.value=1;const run=++generation;busy.value=true;error.value='';try{const q=new URLSearchParams({page:String(page.value),pageSize:String(pageSize.value)});if(action.value)q.set('action',action.value);if(from.value)q.set('from',from.value);if(to.value)q.set('to',to.value);const data=await api<{items:Entry[];actions:string[];total:number}>('/audit?'+q);if(run!==generation)return;items.value=data.items;actions.value=data.actions;total.value=data.total;}catch(e){if(run===generation){items.value=[];total.value=0;error.value=(e as Error).message;}}finally{if(run===generation)busy.value=false;}}
function turn(delta:number){page.value+=delta;void load();}
onMounted(()=>load());onBeforeUnmount(()=>generation++);
</script>
<template>
 <PageShell :entry="false">
  <section class="panel">
   <form class="form-grid" @submit.prevent="load(true)">
    <label>操作<select v-model="action"><option value="">全部操作</option><option v-for="item in actions" :key="item" :value="item">{{ labels[item]||item }}</option></select></label>
    <label>开始日期（日本时间）<input v-model="from" type="date"></label>
    <label>结束日期（日本时间）<input v-model="to" type="date" :min="from"></label>
    <label>每页<select v-model.number="pageSize"><option :value="20">20 条</option><option :value="50">50 条</option><option :value="100">100 条</option></select></label>
    <div><button class="primary" :disabled="busy">查询</button></div>
   </form>
   <p v-if="error" class="error" role="alert">{{ error }}</p>
   <p v-if="busy" role="status">正在加载…</p>
   <p v-else-if="!items.length" class="muted">没有符合条件的操作记录。</p>
   <article v-for="item in items" :key="item.id" class="audit-entry">
    <div class="row"><strong>{{ labels[item.action]||item.action }}</strong><time class="muted">{{ time(item.createdAt) }}</time></div>
    <small class="muted">记录编号：{{ item.entityId }}</small>
    <details v-if="JSON.stringify(item.changes)!=='{}'"><summary>查看变更</summary><pre>{{ JSON.stringify(item.changes,null,2) }}</pre></details>
   </article>
   <div class="row"><button class="quiet" :disabled="busy||page<=1" @click="turn(-1)">上一页</button><span>第 {{ page }} 页 · 共 {{ total }} 条</span><button class="quiet" :disabled="busy||page*pageSize>=total" @click="turn(1)">下一页</button><RouterLink to="/settings">返回设置</RouterLink></div>
  </section>
 </PageShell>
</template>
<style scoped>
.audit-entry{padding:1rem 0;border-bottom:1px solid var(--border);margin-bottom:.5rem;overflow-wrap:anywhere}.audit-entry pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}.audit-entry small{display:block;margin:.4rem 0}
</style>
