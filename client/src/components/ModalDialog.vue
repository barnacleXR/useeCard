<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { SIcon } from '@vean/ui';

// 统一业务弹窗容器：桌面端居中模态弹窗（自适应高度），移动端自动切换为底部 Sheet。
// 不使用 Teleport 到 body，且 z-index 低于 @vean/ui 弹层，确保表单内 SSelect/日期选择弹层始终浮在最上层。
const props = withDefaults(
  defineProps<{ title: string; subtitle?: string; busy?: boolean; titleId?: string }>(),
  { subtitle: '', busy: false, titleId: 'dialog-title' },
);
const emit = defineEmits<{ close: [] }>();

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || props.busy) return;
  // 弹窗内有打开的下拉/日期弹层时，Escape 仅关闭弹层，不误关整个弹窗。
  if (event.defaultPrevented || document.querySelector('[data-dismissable-layer]')) return;
  emit('close');
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.body.style.overflow = 'hidden';
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <div class="drawer-backdrop" @click.self="!busy && emit('close')">
    <section class="drawer-panel" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <header class="drawer-head">
        <div class="drawer-head-text">
          <h2 :id="titleId">{{ title }}</h2>
          <small v-if="subtitle" class="muted">{{ subtitle }}</small>
        </div>
        <button
          type="button"
          class="quiet ghost icon sm"
          :disabled="busy"
          aria-label="关闭"
          @click="emit('close')"
        >
          <SIcon icon="lucide:x" />
        </button>
      </header>
      <div class="drawer-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="drawer-foot">
        <slot name="footer" />
      </footer>
    </section>
  </div>
</template>
