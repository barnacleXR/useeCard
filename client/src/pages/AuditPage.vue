<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { SSelect } from '@vean/ui';
import { api } from '../api';
import PageShell from '../components/PageShell.vue';
import DateRangeInput from '../components/fields/DateRangeInput.vue';
type Entry={id:string;action:string;entityId:string;changes:unknown;createdAt:string;source:string;outcome:string;authMethod:string;ip:string;userAgent:string;location:string};
const items=ref<Entry[]>([]),actions=ref<string[]>([]),total=ref(0),page=ref(1),pageSize=ref(20),action=ref(''),source=ref(''),outcome=ref(''),search=ref(''),from=ref(''),to=ref(''),busy=ref(false),error=ref('');
let generation=0;
const labels:Record<string,string>={'auth.login':'浏览器登录','auth.password.change':'修改密码','auth.password.rejected':'修改密码验证失败','auth.session.revoke':'撤销浏览器登录','device.revoke':'撤销设备','device.create':'设备登录','device.pairing-code':'生成配对码','asset.create':'添加图片','bill.create':'添加账单','bill.update':'编辑账单','bill.paid':'确认已还','bill.undo-paid':'撤销已还','bill.void':'作废账单','account.create':'添加账户','account.update':'编辑账户','card.create':'添加卡片','card.update':'编辑卡片','archive':'归档卡片或账户','bank_accounts.reorder':'调整账户顺序','credit_cards.reorder':'调整卡片顺序','review.start':'建立月度检查','review.add-cards':'补充检查卡片','review.confirm':'确认检查结果','backup.schedule':'设置自动备份','backup.create':'创建备份','backup.restore':'恢复备份','backup.delete':'删除备份','auth.login.oidc':'单点登录','auth.login.failed':'登录失败','auth.login.rate_limited':'登录被限流','auth.password.failed':'修改密码验证失败','backup.password.failed':'恢复备份密码错误','auth.oidc.link':'绑定单点登录','auth.oidc.unlink':'解除单点登录','profile.update':'修改个人资料','profile.avatar.update':'更换头像','push.subscribe':'订阅浏览器推送','push.unsubscribe':'取消浏览器推送'};
const sourceLabels:Record<string,string>={web:'Web',ios:'iOS',rest:'REST API',mcp:'MCP',system:'系统',unknown:'未知来源'};
const outcomeLabels:Record<string,string>={success:'成功',failure:'失败',rate_limited:'限流'};
const authLabels:Record<string,string>={session:'浏览器会话',password:'密码',oidc:'单点登录',device:'设备令牌',api_key:'API Key',oauth:'OAuth'};
const actionItems = computed(() => [{value:'',label:'全部操作'},...actions.value.map(value => ({value,label:labels[value] || value}))]);
const pageSizeItems: {value:number;label:string}[] = [{value:20,label:'20 条'},{value:50,label:'50 条'},{value:100,label:'100 条'}];
const sourceItems=[{value:'',label:'全部来源'},{value:'web',label:'Web'},{value:'ios',label:'iOS'},{value:'rest',label:'REST'},{value:'mcp',label:'MCP'},{value:'system',label:'系统'},{value:'unknown',label:'未知'}];
const outcomeItems=[{value:'',label:'全部结果'},{value:'success',label:'成功'},{value:'failure',label:'失败'},{value:'rate_limited',label:'限流'}];
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false});
async function load(reset=false){if(reset)page.value=1;const run=++generation;busy.value=true;error.value='';try{const q=new URLSearchParams({page:String(page.value),pageSize:String(pageSize.value)});if(action.value)q.set('action',action.value);if(source.value)q.set('source',source.value);if(outcome.value)q.set('outcome',outcome.value);if(search.value)q.set('search',search.value);if(from.value)q.set('from',from.value);if(to.value)q.set('to',to.value);const data=await api<{items:Entry[];actions:string[];total:number}>('/audit?'+q);if(run!==generation)return;items.value=data.items;actions.value=data.actions;total.value=data.total;}catch(e){if(run===generation){items.value=[];total.value=0;error.value=(e as Error).message;}}finally{if(run===generation)busy.value=false;}}
function turn(delta:number){page.value+=delta;void load();}
onMounted(()=>load());onBeforeUnmount(()=>generation++);
</script>
<template>
 <PageShell :entry="false">
  <section class="panel">
   <form class="form-grid" @submit.prevent="load(true)">
    <div class="field"><span>操作</span><SSelect v-model="action" :items="actionItems" :trigger-props="{'aria-label':'操作'}"/></div>
    <div class="field"><span>来源</span><SSelect v-model="source" :items="sourceItems" :trigger-props="{'aria-label':'来源'}"/></div>
    <div class="field"><span>结果</span><SSelect v-model="outcome" :items="outcomeItems" :trigger-props="{'aria-label':'结果'}"/></div>
    <label>搜索操作、记录或 IP<input v-model="search" maxlength="100"></label>
    <div class="field"><span>日期（日本时间）</span><DateRangeInput v-model:from="from" v-model:to="to" label="日期范围"/></div>
    <div class="field"><span>每页</span><SSelect v-model="pageSize" :items="pageSizeItems" :trigger-props="{'aria-label':'每页'}"/></div>
    <div><button class="primary" :disabled="busy">查询</button></div>
   </form>
   <p v-if="error" class="error" role="alert">{{ error }}</p>
   <p v-if="busy" role="status">正在加载…</p>
   <p v-else-if="!items.length" class="muted">没有符合条件的操作记录。</p>
   <article v-for="item in items" :key="item.id" class="audit-entry">
    <div class="row"><strong>{{ labels[item.action]||item.action }}</strong><time class="muted">{{ time(item.createdAt) }}</time></div>
    <small class="muted">记录编号：{{ item.entityId }}</small>
    <small class="muted">{{sourceLabels[item.source]||item.source}} · {{outcomeLabels[item.outcome]||item.outcome}} · {{authLabels[item.authMethod]||item.authMethod||'未知认证'}} · IP {{item.ip||'未记录'}}<span v-if="item.location"> · {{item.location}}</span><span v-if="item.userAgent"> · {{item.userAgent}}</span></small>
    <details v-if="JSON.stringify(item.changes)!=='{}'"><summary>查看变更</summary><pre>{{ JSON.stringify(item.changes,null,2) }}</pre></details>
   </article>
   <div class="row"><button class="quiet" :disabled="busy||page<=1" @click="turn(-1)">上一页</button><span>第 {{ page }} 页 · 共 {{ total }} 条</span><button class="quiet" :disabled="busy||page*pageSize>=total" @click="turn(1)">下一页</button><RouterLink to="/settings">返回设置</RouterLink></div>
  </section>
 </PageShell>
</template>
<style scoped>
.audit-entry{padding:1rem 0;border-bottom:1px solid var(--border);margin-bottom:.5rem;overflow-wrap:anywhere}.audit-entry pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}.audit-entry small{display:block;margin:.4rem 0}
</style>
