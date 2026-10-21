<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useWorkspace } from '../stores/workspace';
import BillEditor from './BillEditor.vue';
// 各页面共用的标题区与“录入账单”入口；标题来自路由 meta。
withDefaults(defineProps<{entry?: boolean}>(), {entry: true});
const route = useRoute(); const store = useWorkspace(); const editor = ref(false);
</script>
<template>
  <header class="page-heading">
    <div><p class="eyebrow">CREDIT CARD MANAGEMENT</p><h1>{{ route.meta.title }}</h1><p class="muted">{{ route.meta.subtitle }}</p></div>
    <button v-if="entry" class="primary" :disabled="!store.cards.some(c => !c.archivedAt)" @click="editor = true">＋ 录入账单</button>
  </header>
  <slot/>
  <BillEditor v-if="editor" @close="editor = false"/>
</template>
