<script setup lang="ts">
import { ref, computed } from 'vue';
import { SSelect, SIcon } from '@vean/ui';
import {
  currencies,
  STATEMENT_PRESETS,
  type Account,
  type Currency,
  type ParsedStatementResult,
  type StatementAmountMode,
  type StatementMapping,
  type StatementPresetId,
} from '@ccm/shared';

export interface StatementSource {
  id: string;
  label: string;
  encoding: 'utf-8' | 'shift_jis' | 'text';
  preset: StatementPresetId | null;
  rows: string[][];
  accountId: string;
  currency: Currency;
  mapping: StatementMapping;
  parsed: ParsedStatementResult;
}

const props = defineProps<{
  source: StatementSource;
  accounts: Account[];
}>();

const emit = defineEmits<{
  update: [id: string, patch: { accountId?: string; currency?: Currency; mapping?: StatementMapping }];
  remove: [id: string];
}>();

const mappingOpen = ref(props.source.preset === null);

const accountItems = computed(() =>
  props.accounts
    .filter(a => !a.archivedAt || a.id === props.source.accountId)
    .map(a => ({ value: a.id, label: a.name })),
);

const currencyItems = Object.keys(currencies).map(c => ({ value: c, label: c }));

const columnItems = computed(() => {
  const first = props.source.rows[0] ?? [];
  const count = Math.max(first.length, ...props.source.rows.slice(0, 5).map(r => r.length), 1);
  return Array.from({ length: count }, (_, idx) => {
    const header = props.source.mapping.hasHeader ? first[idx] : '';
    return {
      value: String(idx),
      label: header ? `第 ${idx + 1} 列（${header}）` : `第 ${idx + 1} 列`,
    };
  });
});

const descColumnItems = computed(() => [
  { value: 'none', label: '无摘要列' },
  ...columnItems.value,
]);

const amountModeItems: { value: StatementAmountMode; label: string }[] = [
  { value: 'separate-debit', label: '独立出金列（正数为出金）' },
  { value: 'signed-negative', label: '单列正负（负数为出金）' },
];

const presetLabel = computed(() =>
  props.source.preset ? STATEMENT_PRESETS[props.source.preset].label : '自定义映射',
);

const encodingLabel = computed(() =>
  props.source.encoding === 'shift_jis' ? 'Shift_JIS' : props.source.encoding === 'utf-8' ? 'UTF-8' : '粘贴文本',
);

const previewRows = computed(() => props.source.rows.slice(0, 4));

function patchMapping(patch: Partial<StatementMapping>) {
  emit('update', props.source.id, {
    mapping: { ...props.source.mapping, ...patch },
  });
}
</script>

<template>
  <article class="panel stack source-card">
    <div class="row wrap" style="gap: 10px">
      <div class="row wrap" style="gap: 8px; justify-content: flex-start">
        <strong>{{ source.label }}</strong>
        <span class="badge">{{ presetLabel }}</span>
        <span class="status void">{{ encodingLabel }}</span>
        <small v-if="source.parsed.dateRange" class="muted num">
          {{ source.parsed.dateRange.min }} ~ {{ source.parsed.dateRange.max }}
        </small>
        <small class="muted num">共 {{ source.parsed.transactions.length }} 笔出金</small>
      </div>
      <div class="master-actions">
        <button type="button" class="quiet sm" @click="mappingOpen = !mappingOpen">
          <SIcon icon="lucide:sliders-horizontal" />
          <span>{{ mappingOpen ? '收起映射' : '调整列映射' }}</span>
        </button>
        <button
          type="button"
          class="quiet ghost icon sm"
          aria-label="移除该流水来源"
          title="移除"
          @click="emit('remove', source.id)"
        >
          <SIcon icon="lucide:x" />
        </button>
      </div>
    </div>

    <div class="source-bindings">
      <div class="field">
        <span>对应扣款账户</span>
        <SSelect
          :model-value="source.accountId"
          :items="accountItems"
          placeholder="请选择账户"
          :trigger-props="{ 'aria-label': `${source.label} 对应扣款账户` }"
          @update:model-value="v => emit('update', source.id, { accountId: String(v) })"
        />
      </div>
      <div class="field">
        <span>流水币种</span>
        <SSelect
          :model-value="source.currency"
          :items="currencyItems"
          :trigger-props="{ 'aria-label': `${source.label} 流水币种` }"
          @update:model-value="v => emit('update', source.id, { currency: String(v) as Currency })"
        />
      </div>
    </div>

    <p v-if="!source.accountId" class="error" role="alert">请先选择该流水对应的扣款账户。</p>
    <p v-else-if="source.parsed.errors.length" class="muted">
      部分行未解析（共 {{ source.parsed.errors.length }} 条，例如：{{ source.parsed.errors[0] }}）
    </p>

    <div v-if="mappingOpen" class="mapping-box stack">
      <div class="mapping-grid">
        <label class="checkbox-inline">
          <input
            type="checkbox"
            :checked="source.mapping.hasHeader"
            @change="patchMapping({ hasHeader: ($event.target as HTMLInputElement).checked })"
          />
          <span>首行为表头</span>
        </label>
        <div class="field">
          <span>日期列</span>
          <SSelect
            :model-value="String(source.mapping.dateColumn)"
            :items="columnItems"
            @update:model-value="v => patchMapping({ dateColumn: Number(v) })"
          />
        </div>
        <div class="field">
          <span>金额列</span>
          <SSelect
            :model-value="String(source.mapping.amountColumn)"
            :items="columnItems"
            @update:model-value="v => patchMapping({ amountColumn: Number(v) })"
          />
        </div>
        <div class="field">
          <span>出金判断方式</span>
          <SSelect
            :model-value="source.mapping.amountMode"
            :items="amountModeItems"
            @update:model-value="v => patchMapping({ amountMode: String(v) as StatementAmountMode })"
          />
        </div>
        <div class="field">
          <span>摘要列</span>
          <SSelect
            :model-value="source.mapping.descriptionColumn === null ? 'none' : String(source.mapping.descriptionColumn)"
            :items="descColumnItems"
            @update:model-value="v => patchMapping({ descriptionColumn: v === 'none' ? null : Number(v) })"
          />
        </div>
      </div>

      <div v-if="previewRows.length" class="preview-table-wrap">
        <table class="preview-table">
          <tbody>
            <tr v-for="(r, ri) in previewRows" :key="ri">
              <td class="muted">{{ ri + 1 }}</td>
              <td v-for="(cell, ci) in r" :key="ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </article>
</template>

<style scoped>
.source-card {
  gap: 12px;
}

.source-bindings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.mapping-box {
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--surface-canvas);
  border: 1px solid var(--line-subtle);
  gap: 12px;
}

.mapping-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  align-items: end;
}

.checkbox-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: var(--control-h);
  font-size: 13px;
  cursor: pointer;
}

.checkbox-inline input {
  width: 16px;
  height: 16px;
}

.preview-table-wrap {
  overflow-x: auto;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.preview-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--line-subtle);
  white-space: nowrap;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
