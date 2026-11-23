<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { PhPlus } from '@phosphor-icons/vue';
import { useWorkspace } from '../stores/workspace';
import BillEditor from './BillEditor.vue';

// 紧凑页头与可选的“录入账单”入口；支持通过 props 覆盖标题与副标题，或通过 #actions 插槽嵌入筛选与操作。
const props = withDefaults(
  defineProps<{ entry?: boolean; title?: string; subtitle?: string }>(),
  { entry: true, title: '', subtitle: '' },
);
const route = useRoute();
const store = useWorkspace();
const editor = ref(false);
const heading = computed(() => props.title || String(route.meta.title || ''));
const description = computed(() => props.subtitle || String(route.meta.subtitle || ''));
const canAddBill = computed(() => store.cards.some(c => !c.archivedAt));
</script>

<template>
  <header class="page-heading">
    <div class="page-heading-text">
      <h1>{{ heading }}</h1>
      <p v-if="description" class="muted">{{ description }}</p>
    </div>
    <div v-if="entry || $slots.actions" class="page-heading-actions">
      <slot name="actions" />
      <button
        v-if="entry"
        type="button"
        class="primary"
        :disabled="!canAddBill"
        :title="canAddBill ? '录入新账单' : '请先在「卡片与账户」中添加信用卡'"
        @click="editor = true"
      >
        <PhPlus :size="16" aria-hidden="true" />
        <span>录入账单</span>
      </button>
    </div>
  </header>
  <slot />
  <BillEditor v-if="editor" @close="editor = false" />
</template>
