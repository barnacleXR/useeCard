<script setup lang="ts">
import { ref, computed } from 'vue';
import { SSelect } from '@vean/ui';
import { currencies, type Account, type BankEntry, type Card } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import { CARD_NETWORKS } from '../icons';
import ModalDialog from './ModalDialog.vue';
import BankSearch from './BankSearch.vue';
import IconPicker from './IconPicker.vue';

type Kind = 'accounts' | 'cards';
const props = defineProps<{ kind: Kind; item?: Account | Card }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();

const busy = ref(false);
const error = ref('');
const picker = ref<InstanceType<typeof IconPicker>>();
const a = props.kind === 'accounts' ? (props.item as Account | undefined) : undefined;
const c = props.kind === 'cards' ? (props.item as Card | undefined) : undefined;

const account = ref({
  name: a?.name ?? '',
  bankName: a?.bankName ?? '',
  bankCode: a?.bankCode ?? '',
  iconAssetId: a?.iconAssetId ?? (null as string | null),
  note: a?.note ?? '',
});

const card = ref({
  name: c?.name ?? '',
  issuer: c?.issuer ?? '',
  last4: c?.last4 ?? '',
  defaultDebitAccountId: c?.defaultDebitAccountId ?? store.accounts.find(x => !x.archivedAt)?.id ?? '',
  defaultCurrency: c?.defaultCurrency ?? store.defaultCurrency,
  defaultDueDay: c?.defaultDueDay ?? (null as number | null),
  frequency: c?.frequency ?? ('regular' as Card['frequency']),
  brand: c?.brand ?? ('' as Card['brand']),
  iconAssetId: c?.iconAssetId ?? (null as string | null),
  note: c?.note ?? '',
});

const NONE = '__none__';
const dueDayModel = computed({
  get: () => (card.value.defaultDueDay ? String(card.value.defaultDueDay) : NONE),
  set: (v: string) => {
    card.value.defaultDueDay = v && v !== NONE ? Number(v) : null;
  },
});
const brandModel = computed({
  get: () => card.value.brand || NONE,
  set: (v: string) => {
    card.value.brand = (v === NONE ? '' : v) as Card['brand'];
  },
});

const dueDayItems = [
  { value: NONE, label: '未设置' },
  ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `每月 ${i + 1} 日` })),
];
const brandItems = [
  { value: NONE, label: '未指定' },
  ...Object.entries(CARD_NETWORKS).map(([value, network]) => ({ value, label: network.label })),
];
const accountItems = computed(() =>
  store.accounts
    .filter(x => !x.archivedAt || x.id === c?.defaultDebitAccountId)
    .map(x => ({ value: x.id, label: x.name })),
);
const currencyItems = Object.keys(currencies).map(value => ({ value, label: value }));
const frequencyItems = [
  { value: 'regular', label: '常用' },
  { value: 'low', label: '低频' },
];
const title = computed(() => `${props.item ? '编辑' : '添加'}${props.kind === 'accounts' ? '银行账户' : '信用卡'}`);

// 清单名称不含后缀；信金、信組、農協等合作金融机构保持原名。
const displayName = (bank: BankEntry) =>
  /信金|信組|農協|漁協|信漁連|信連|労金|銀行|ゆうちょ|ＪＡ/.test(bank.name) ? bank.name : `${bank.name}銀行`;

// 选中银行：带入名称；尚未设置图标且该行有已知官网时自动抓取。
async function selectBank(bank: BankEntry | null) {
  account.value.bankCode = bank?.code ?? '';
  account.value.bankName = bank ? displayName(bank) : '';
  if (bank && !account.value.name) account.value.name = displayName(bank);
  if (bank?.domain && !account.value.iconAssetId) await picker.value?.fromDomain(bank.domain);
}

async function save() {
  if (props.kind === 'cards' && !card.value.defaultDebitAccountId) {
    error.value = '请选择默认扣款账户';
    return;
  }
  busy.value = true;
  error.value = '';
  const body = props.kind === 'accounts' ? account.value : card.value;
  try {
    await store.mutate(
      props.item ? `/${props.kind}/${props.item.id}` : `/${props.kind}`,
      props.item ? { ...body, version: props.item.version } : body,
      props.item ? 'PATCH' : 'POST',
    );
    emit('close');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="title" :busy="busy" title-id="master-title" @close="emit('close')">
    <form v-if="kind === 'accounts'" id="master-editor-form" class="stack" @submit.prevent="save">
      <label>
        所属银行
        <BankSearch :bank-code="account.bankCode" :bank-name="account.bankName" @select="selectBank" />
      </label>
      <label>
        账户名称
        <input v-model="account.name" required maxlength="100" placeholder="例如：三井住友 生活费账户" />
      </label>
      <div class="field">
        <span class="field-label">图标</span>
        <IconPicker ref="picker" v-model:asset-id="account.iconAssetId" :name="account.name || account.bankName" />
      </div>
      <label>
        备注
        <input v-model="account.note" maxlength="1000" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <form v-else id="master-editor-form" class="stack" @submit.prevent="save">
      <label>
        信用卡名称
        <input v-model="card.name" required maxlength="100" placeholder="例如：楽天カード" />
      </label>
      <div class="form-grid">
        <div class="field">
          <span>卡组织</span>
          <SSelect v-model="brandModel" :items="brandItems" :trigger-props="{ 'aria-label': '卡组织' }" />
        </div>
        <label>
          末四位（可选）
          <input v-model="card.last4" inputmode="numeric" pattern="\d{4}" maxlength="4" placeholder="1234" />
        </label>
      </div>
      <div class="field">
        <span class="field-label">
          卡面图片 <small class="muted">上传卡面或填写图片网址；卡组织标志单独显示</small>
        </span>
        <IconPicker
          v-model:asset-id="card.iconAssetId"
          presentation="card"
          :name="card.name"
          :last4="card.last4"
          :brand="card.brand"
        />
      </div>
      <label>
        发卡机构
        <input v-model="card.issuer" maxlength="100" placeholder="例如：楽天カード株式会社" />
      </label>
      <div class="field">
        <span>默认扣款账户</span>
        <SSelect
          v-model="card.defaultDebitAccountId"
          :items="accountItems"
          placeholder="选择账户"
          :trigger-props="{ 'aria-label': '默认扣款账户' }"
        />
      </div>
      <div class="form-grid">
        <div class="field">
          <span>默认币种</span>
          <SSelect
            v-model="card.defaultCurrency"
            :items="currencyItems"
            :trigger-props="{ 'aria-label': '默认币种' }"
          />
        </div>
        <div class="field">
          <span>常规扣款日（可选）</span>
          <SSelect v-model="dueDayModel" :items="dueDayItems" :trigger-props="{ 'aria-label': '常规扣款日' }" />
        </div>
      </div>
      <div class="field">
        <span>使用频率</span>
        <SSelect v-model="card.frequency" :items="frequencyItems" :trigger-props="{ 'aria-label': '使用频率' }" />
      </div>
      <label>
        备注
        <input v-model="card.note" maxlength="1000" />
      </label>
      <small v-if="item" class="muted">修改默认账户、币种或常规扣款日只影响之后录入的账单。</small>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <button type="button" class="quiet" :disabled="busy" @click="emit('close')">取消</button>
      <button
        type="submit"
        form="master-editor-form"
        class="primary"
        :disabled="busy || (kind === 'cards' && !store.accounts.some(x => !x.archivedAt))"
      >
        {{ busy ? '正在保存…' : kind === 'accounts' ? '保存账户' : '保存信用卡' }}
      </button>
    </template>
  </ModalDialog>
</template>
