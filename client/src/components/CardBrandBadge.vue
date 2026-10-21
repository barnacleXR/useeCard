<script setup lang="ts">
import type { CardBrand } from '@ccm/shared';
import { CARD_NETWORKS } from '../icons';
defineProps<{brand:CardBrand|''}>();
</script>
<template>
  <span v-if="brand" class="card-brand-badge" :title="CARD_NETWORKS[brand].label">
    <img :src="CARD_NETWORKS[brand].icon" :alt="`${CARD_NETWORKS[brand].label} 卡组织`" loading="lazy">
  </span>
</template>
