<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import TimeInput from './fields/TimeInput.vue';
import { SSelect } from '@vean/ui';
interface Backup {id:string;createdAt:string;bytes:number;reason:'manual'|'automatic'|'before-restore';counts:Record<string,number>}
interface Schedule {frequency:'off'|'daily'|'weekly';time:string;weekday:number;retentionDays:number}
interface Status {schedule:Schedule;latest:{ok:boolean;at:string;message?:string}|null;backups:Backup[];maxDatabaseBytes:number}
const status=ref<Status>();const schedule=ref<Schedule>({frequency:'off',time:'03:00',weekday:0,retentionDays:30});
const busy=ref(false),error=ref(''),message=ref('');
const restoreOpen=ref(false),selectedFile=ref<File>(),password=ref(''),confirmed=ref(false);
const result=ref<{requiresLogin:boolean;safetyBackup:string}>();
const date=(raw:string)=>new Date(raw).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo'});
const size=(bytes:number)=>bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;
const reasons={manual:'手动备份',automatic:'自动备份','before-restore':'恢复前快照'};
const frequencyItems = [{value:'off',label:'关闭'},{value:'daily',label:'每天'},{value:'weekly',label:'每周'}];
const weekdayItems: {value:number;label:string}[] = ['日','一','二','三','四','五','六'].map((day,value) => ({value,label:`星期${day}`}));
async function load(){status.value=await api<Status>('/data/backups');schedule.value={...status.value.schedule};}
onMounted(()=>{void load().catch(e=>error.value=(e as Error).message);});
async function create(){busy.value=true;error.value='';message.value='';try{await api('/data/backups','POST',{});await load();message.value='完整备份已保存，可在下方下载。';}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
async function save(){busy.value=true;error.value='';message.value='';try{await api('/data/schedule','POST',schedule.value);await load();message.value='自动备份设置已保存。';}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
function selectFile(event:Event){selectedFile.value=(event.target as HTMLInputElement).files?.[0];error.value='';}
async function restore(){
  if(!confirmed.value||!selectedFile.value||!password.value)return;
  busy.value=true;error.value='';
  try{
    if(selectedFile.value.size>90*1024*1024)throw new Error('备份文件超过 90 MB');
    let backup:unknown;try{backup=JSON.parse(await selectedFile.value.text());}catch{throw new Error('无法读取备份文件，请选择 useeCard 完整备份。');}
    result.value=await api('/data/restore','POST',{password:password.value,backup});password.value='';
  }catch(e){error.value=(e as Error).message;}finally{busy.value=false;}
}
</script>
<template>
  <h2>数据导出与备份</h2>
  <p class="muted">业务导出包含账单、账户、卡片和检查记录，不含密码或登录凭证。图标包含在完整业务导出中。</p>
  <div class="data-actions"><a class="quiet" href="/api/data/export.json" download>导出完整业务 JSON</a><a class="quiet" href="/api/data/bills.csv" download>导出账单 CSV</a></div>
  <p class="muted">完整备份可恢复整个实例，包括图标和账号资料。请妥善保存备份文件，并定期下载到其他设备；同机备份无法防范磁盘损坏。</p>
  <div class="data-actions"><button class="primary" :disabled="busy" @click="create">{{ busy ? '处理中…' : '创建完整备份' }}</button><button class="quiet" :disabled="busy" @click="restoreOpen=true;error='';message=''">从备份恢复</button></div>
  <form class="form-grid backup-schedule" @submit.prevent="save">
    <div class="field"><span>自动备份</span><SSelect v-model="schedule.frequency" :items="frequencyItems" :trigger-props="{'aria-label':'自动备份'}"/></div>
    <div v-if="schedule.frequency!=='off'" class="field"><span>时间（日本时间）</span><TimeInput v-model="schedule.time" label="自动备份时间"/></div>
    <div v-if="schedule.frequency==='weekly'" class="field"><span>每周</span><SSelect v-model="schedule.weekday" :items="weekdayItems" :trigger-props="{'aria-label':'每周'}"/></div>
    <label>保留天数<input v-model.number="schedule.retentionDays" type="number" min="1" max="365" required></label>
    <div class="full"><button class="quiet" :disabled="busy || !status">保存备份设置</button></div>
  </form>
  <p v-if="status?.latest" class="muted">最近结果：{{status.latest.ok?'成功':'失败'}} · {{date(status.latest.at)}}<span v-if="status.latest.message"> · {{status.latest.message}}</span></p>
  <p v-if="message" role="status">{{message}}</p><p v-if="error&&!restoreOpen" class="error" role="alert">{{error}}</p>
  <div v-if="status?.backups.length" class="backup-list">
    <div v-for="b in status.backups" :key="b.id" class="backup-row"><div><strong>{{reasons[b.reason]}}</strong><small>{{date(b.createdAt)}} · {{size(b.bytes)}} · {{b.counts.bills??0}} 笔账单</small></div><a class="quiet" :href="`/api/data/backups/${b.id}`" download>下载</a></div>
  </div>
  <p v-else class="muted">还没有完整备份。</p>
  <p class="muted">备份与恢复支持不超过 64 MB 的数据库。恢复前快照单独保留；过期备份在自动备份成功后清理。</p>
  <div v-if="restoreOpen" class="modal-backdrop" @click.self="!busy&&!result&&(restoreOpen=false)">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <template v-if="result"><h2 id="restore-title">恢复完成</h2><p>数据已恢复，旧登录已失效。请用备份中的账号重新登录；恢复前的数据已另存为快照。</p><a href="/" class="primary">重新登录</a></template>
      <form v-else class="form-grid" @submit.prevent="restore">
        <div class="row full"><h2 id="restore-title">从完整备份恢复</h2><button class="quiet" type="button" :disabled="busy" @click="restoreOpen=false;password='';selectedFile=undefined;confirmed=false">关闭</button></div>
        <p class="full muted">恢复会替换当前实例的数据。系统先校验文件并保存当前快照，恢复成功后所有浏览器和 App 都需要重新登录。自动备份会关闭，请登录后重新确认设置。部署地址与环境配置保持当前值。</p>
        <label class="full">useeCard 完整备份文件<input type="file" accept=".json,application/json" required :disabled="busy" @change="selectFile"></label>
        <label class="full">当前管理员密码<input v-model="password" type="password" autocomplete="current-password" required :disabled="busy"></label>
        <label class="checkbox full"><input v-model="confirmed" type="checkbox" :disabled="busy">我确认用备份中的数据替换当前数据</label>
        <p v-if="error" class="error full" role="alert">{{error}}</p>
        <button class="primary full" :disabled="busy||!confirmed||!selectedFile||!password">{{busy?'正在校验并恢复，请勿关闭页面…':'校验并恢复'}}</button>
      </form>
    </section>
  </div>
</template>
