<script setup lang="ts">
import { SSheet, SThemeCustomizer, SThemeBaseSelect, type ThemeCustomizerSection } from '@vean/ui';
import ThemeColorSelect from './ThemeColorSelect.vue';
import { useWorkspace } from '../stores/workspace';
// 外观抽屉：设置写入浏览器本地（SConfigProvider persist-theme），不上传服务器。
const store = useWorkspace();
const sections: ThemeCustomizerSection[] = ['mode', 'scheme', 'size', 'spacing', 'radius', 'advanced'];
</script>
<template>
  <SSheet v-model:open="store.themePanel" side="right" title="外观设置" description="主题仅保存在当前浏览器。">
    <div class="theme-palette-fields"><div class="setting-row"><span>主题色</span><ThemeColorSelect/></div><div class="setting-row"><span>基础色</span><SThemeBaseSelect/></div></div>
    <SThemeCustomizer :sections="sections" :ui="{root: 'w-full h-full'}"/>
  </SSheet>
</template>
