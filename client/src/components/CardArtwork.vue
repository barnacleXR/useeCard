<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = withDefaults(defineProps<{name:string;assetId?:string|null;last4?:string;width?:number}>(),{assetId:null,last4:'',width:120});
const failed=ref(false);
watch(()=>props.assetId,()=>{failed.value=false;});
const hue=computed(()=>[...props.name].reduce((value,char)=>(value*31+char.codePointAt(0)!)%360,7));
</script>
<template>
  <span class="card-artwork" :class="{'has-artwork':assetId&&!failed}" :style="{'--card-width':`${width}px`,'--card-hue':hue}" :title="name">
    <img v-if="assetId&&!failed" :src="`/api/assets/${assetId}`" :alt="`${name} 卡面`" loading="lazy" @error="failed=true">
    <span v-else class="card-artwork-default" role="img" :aria-label="`${name} 默认卡面`">
      <span class="card-artwork-name">{{name||'信用卡'}}</span>
      <span class="card-artwork-chip" aria-hidden="true"/>
      <span class="card-artwork-digits">•••• {{last4||'••••'}}</span>
    </span>
  </span>
</template>
