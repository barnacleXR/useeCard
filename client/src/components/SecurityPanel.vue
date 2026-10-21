<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { OidcIdentityInfo } from '@ccm/shared';
import { api, setCsrf } from '../api';
import { oidcMessage, takeHashParam } from '../oidc';
type Session={id:string;createdAt:number;lastUsedAt:number;expiresAt:number;userAgent:string;current:boolean};
const sessions=ref<Session[]>([]),error=ref(''),message=ref(''),busy=ref(false);
const currentPassword=ref(''),newPassword=ref(''),confirmPassword=ref('');
const time=(value:number)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false});
function browser(ua:string){const name=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'浏览器';const os=/iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Macintosh/.test(ua)?'macOS':/Windows/.test(ua)?'Windows':'';return [name,os].filter(Boolean).join(' · ');}
const oidc=ref<OidcIdentityInfo>(),oidcNote=ref(''),oidcError=ref('');
async function load(){try{[sessions.value,oidc.value]=await Promise.all([api<Session[]>('/auth/sessions'),api<OidcIdentityInfo>('/auth/oidc/identity')]);}catch(e){error.value=(e as Error).message;}}
async function link(){oidcError.value='';busy.value=true;try{const {url}=await api<{url:string}>('/auth/oidc/link','POST');window.location.assign(url);if(url.startsWith('/'))window.location.reload();}catch(e){oidcError.value=(e as Error).message;busy.value=false;}}
async function unlink(){if(!confirm('解除绑定后将不能再用该身份登录 useeCard，密码登录不受影响。继续？'))return;busy.value=true;oidcError.value='';try{await api('/auth/oidc/unlink','POST');oidcNote.value='已解除绑定。';await load();}catch(e){oidcError.value=(e as Error).message;}finally{busy.value=false;}}
const linkResult=takeHashParam('oidc-link');
if(linkResult==='ok')oidcNote.value='已绑定，之后可在登录页使用单点登录。';else if(linkResult)oidcError.value=oidcMessage(linkResult);
async function change(){
 error.value='';message.value='';
 if(newPassword.value!==confirmPassword.value){error.value='两次输入的新密码不一致';return;}
 if(!confirm('修改密码后，其他浏览器、所有 App 设备和未使用的配对码将失效，当前浏览器保留登录。继续？'))return;
 busy.value=true;
 try{const result=await api<{csrf:string}>('/auth/password','POST',{currentPassword:currentPassword.value,newPassword:newPassword.value});setCsrf(result.csrf);currentPassword.value='';newPassword.value='';confirmPassword.value='';message.value='密码已修改，其他登录及配对码已撤销。';await load();window.dispatchEvent(new Event('ccm-security-changed'));}
 catch(e){error.value=(e as Error).message;}finally{busy.value=false;}
}
async function revoke(session:Session){if(!confirm('撤销此浏览器登录？该浏览器需要重新输入账号密码。'))return;busy.value=true;error.value='';try{await api(`/auth/sessions/${session.id}/revoke`,'POST');await load();}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
onMounted(load);
</script>
<template>
 <h2>账号安全</h2>
 <form class="form-grid" @submit.prevent="change">
  <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="128" required :disabled="busy"></label>
  <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :disabled="busy"></label>
  <label>确认新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :disabled="busy"></label>
  <div class="row"><button class="primary" :disabled="busy">修改密码</button><span class="muted">12–128 个字符。修改后其他浏览器和 App 需要重新登录。</span></div>
 </form>
 <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
 <h3 id="oidc">单点登录（OIDC）</h3>
 <template v-if="oidc">
  <template v-if="oidc.configured">
   <div v-if="oidc.identity" class="master-row">
    <div><strong>已绑定 {{ oidc.name }}</strong><small>{{ oidc.identity.email || '提供方未返回已验证邮箱' }} · 绑定于 {{ new Date(oidc.identity.linkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false}) }} · 最近登录 {{ oidc.identity.lastLoginAt ? new Date(oidc.identity.lastLoginAt).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false}) : '尚未使用' }}</small></div>
    <button class="quiet danger" :disabled="busy" @click="unlink">解除绑定</button>
   </div>
   <div v-else class="row oidc-link"><span class="muted">绑定后可在登录页通过 {{ oidc.name }} 登录，密码登录仍然可用。</span><button class="primary" :disabled="busy" @click="link">绑定 {{ oidc.name }}</button></div>
  </template>
  <p v-else-if="oidc.configError" class="error">OIDC 配置未生效：{{ oidc.configError }}</p>
  <p v-else class="muted">未启用。在服务器设置 <code>OIDC_ISSUER</code>、<code>OIDC_CLIENT_ID</code> 与 <code>BASE_URL</code> 后，可绑定 Authelia、Authentik、Keycloak、Pocket ID 等身份提供方，详见 README。</p>
  <p v-if="oidcError" class="error" role="alert">{{ oidcError }}</p><p v-if="oidcNote" role="status">{{ oidcNote }}</p>
 </template>
 <h3>浏览器登录</h3>
 <button class="quiet" :disabled="busy" @click="load">刷新登录列表</button>
 <div v-for="session in sessions" :key="session.id" class="master-row">
  <div><strong>{{ browser(session.userAgent) }}{{ session.current?' · 当前浏览器':'' }}</strong><small>登录于 {{ time(session.createdAt) }} · 最近使用 {{ time(session.lastUsedAt) }} · 到期 {{ time(session.expiresAt) }}</small></div>
  <button v-if="!session.current" class="quiet danger" :disabled="busy" @click="revoke(session)">撤销</button>
 </div>
 <p class="muted">浏览器名称根据客户端提供的信息识别。<RouterLink to="/audit">查看操作记录 →</RouterLink></p>
</template>
