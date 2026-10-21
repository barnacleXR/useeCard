<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
const store=useWorkspace(),count=ref(0),failed=ref(false);let sequence=0;let timer:ReturnType<typeof setInterval>;
async function load(){if(document.hidden)return;const ticket=++sequence;try{const data=await api<{unreadCount:number}>('/notifications/unread-count');if(ticket===sequence){count.value=data.unreadCount;failed.value=false;}}catch{if(ticket===sequence)failed.value=true;}}
watch(()=>store.revision,()=>void load());
onMounted(()=>{void load();timer=setInterval(()=>void load(),30_000);window.addEventListener('ccm-notifications-changed',load);document.addEventListener('visibilitychange',load);});
onBeforeUnmount(()=>{sequence++;clearInterval(timer);window.removeEventListener('ccm-notifications-changed',load);document.removeEventListener('visibilitychange',load);});
</script>
<template><RouterLink class="quiet notification-button" to="/notifications" :aria-label="failed?'通知，暂时无法刷新':`通知，${count} 条未读`">通知<span v-if="count" class="notification-count">{{ count>99?'99+':count }}</span><span v-else-if="failed" title="暂时无法刷新">!</span></RouterLink></template>
<style scoped>
.notification-button{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;white-space:nowrap}.notification-count{border-radius:999px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));padding:.1rem .4rem;font-size:.7rem;font-weight:700}
</style>
