<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { SIcon } from '@vean/ui';
import type { Account, Card } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import { CARD_NETWORKS } from '../icons';
import CardArtwork from '../components/CardArtwork.vue';
import CardBrandBadge from '../components/CardBrandBadge.vue';
import PageShell from '../components/PageShell.vue';
import EntityIcon from '../components/EntityIcon.vue';
import MasterEditor from '../components/MasterEditor.vue';

type Kind = 'accounts' | 'cards';
const store = useWorkspace();
const ordering = ref(false);
const menu = ref('');
const editor = ref<{ kind: Kind; item?: Account | Card }>();

async function archive(kind: Kind, id: string) {
  menu.value = '';
  if (confirm('归档后不再用于新账单，已有未还账单继续统计。确定？')) {
    try {
      await store.mutate(`/${kind}/${id}/archive`);
    } catch {}
  }
}

// 上移/下移后提交完整顺序；服务端校验列表与现有记录一致。
async function move(kind: Kind, index: number, delta: -1 | 1) {
  const ids = (kind === 'accounts' ? store.accounts : store.cards).map(item => item.id);
  [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
  ordering.value = true;
  try {
    await store.mutate(`/${kind}/order`, { ids });
  } catch {
  } finally {
    ordering.value = false;
  }
}

function open(kind: Kind, item?: Account | Card) {
  menu.value = '';
  editor.value = { kind, item };
}

const close = (event: Event) => {
  if (!(event.target as Element).closest?.('.row-actions')) menu.value = '';
};

onMounted(() => document.addEventListener('click', close));
onBeforeUnmount(() => document.removeEventListener('click', close));
</script>

<template>
  <PageShell :entry="false">
    <template #actions>
      <button type="button" class="quiet" @click="open('accounts')">
        <SIcon icon="lucide:landmark" />
        <span>添加账户</span>
      </button>
      <button
        type="button"
        class="primary"
        :disabled="!store.accounts.some(a => !a.archivedAt)"
        @click="open('cards')"
      >
        <SIcon icon="lucide:plus" />
        <span>添加信用卡</span>
      </button>
    </template>

    <!-- 信用卡：可视化卡面网格 -->
    <section class="list-section">
      <div class="section-head">
        <h2 class="section-title">信用卡 · {{ store.cards.filter(c => !c.archivedAt).length }}</h2>
      </div>
      <div v-if="!store.cards.length" class="panel empty">还没有信用卡。先添加扣款账户，再添加信用卡。</div>
      <div v-else class="wallet-card-grid">
        <article
          v-for="(item, index) in store.cards"
          :key="item.id"
          class="wallet-card"
          :class="{ inactive: item.archivedAt }"
        >
          <div class="wallet-card-top">
            <CardArtwork :name="item.name" :asset-id="item.iconAssetId" :last4="item.last4" :width="96" />
            <div class="wallet-card-meta">
              <strong>{{ item.name }}</strong>
              <span class="card-network-line">
                <CardBrandBadge :brand="item.brand" />
                <small>
                  {{ item.brand ? CARD_NETWORKS[item.brand].label : '未指定卡组织' }}
                  {{ item.last4 ? ` · •••• ${item.last4}` : '' }}
                </small>
              </span>
              <div>
                <span class="status" :class="{ void: item.archivedAt }">
                  {{ item.archivedAt ? '已归档' : item.frequency === 'low' ? '低频' : '常用' }}
                </span>
              </div>
            </div>
            <div class="row-actions">
              <button
                type="button"
                class="menu-trigger"
                :aria-expanded="menu === item.id"
                :aria-label="`${item.name} 的操作`"
                @click="menu = menu === item.id ? '' : item.id"
              >
                ⋮
              </button>
              <div v-if="menu === item.id" class="row-menu" role="menu">
                <button type="button" role="menuitem" @click="open('cards', item)">编辑</button>
                <button
                  v-if="!item.archivedAt"
                  type="button"
                  role="menuitem"
                  class="danger"
                  @click="archive('cards', item.id)"
                >
                  归档
                </button>
              </div>
            </div>
          </div>

          <div class="wallet-card-details">
            <div class="wallet-detail-item">
              <small>默认扣款账户</small>
              <div class="wallet-detail-value">
                <EntityIcon
                  :name="store.accountById.get(item.defaultDebitAccountId)?.name ?? '?'"
                  :asset-id="store.accountById.get(item.defaultDebitAccountId)?.iconAssetId"
                  :size="18"
                />
                <span>{{ store.accountById.get(item.defaultDebitAccountId)?.name }}</span>
              </div>
            </div>
            <div class="wallet-detail-item">
              <small>币种与扣款日</small>
              <div class="wallet-detail-value num">
                <span>{{ item.defaultCurrency }}{{ item.defaultDueDay ? ` · 每月 ${item.defaultDueDay} 日` : '' }}</span>
              </div>
            </div>
          </div>

          <div class="wallet-card-foot">
            <small class="muted">{{ item.issuer || '未填写发卡机构' }}</small>
            <div class="row-order">
              <button
                type="button"
                class="quiet icon sm"
                :disabled="ordering || index === 0"
                :aria-label="`上移 ${item.name}`"
                @click="move('cards', index, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="quiet icon sm"
                :disabled="ordering || index === store.cards.length - 1"
                :aria-label="`下移 ${item.name}`"
                @click="move('cards', index, 1)"
              >
                ↓
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 银行账户：统一容器精细分隔列表 -->
    <section class="list-section">
      <div class="section-head">
        <h2 class="section-title">银行账户 · {{ store.accounts.filter(a => !a.archivedAt).length }}</h2>
      </div>
      <div v-if="!store.accounts.length" class="panel empty">还没有扣款账户。</div>
      <div v-else class="data-table">
        <div class="data-table-head account-cols" aria-hidden="true">
          <span />
          <span>账户</span>
          <span>关联卡片</span>
          <span>状态</span>
          <span>顺序</span>
          <span />
        </div>

        <article
          v-for="(item, index) in store.accounts"
          :key="item.id"
          class="data-row account-cols"
          :class="{ inactive: item.archivedAt }"
        >
          <EntityIcon class="row-logo" :name="item.name" :asset-id="item.iconAssetId" :size="34" />
          <div class="row-name">
            <strong>{{ item.name }}</strong>
            <small>{{ item.bankName || '未关联银行' }}{{ item.bankCode ? ` · ${item.bankCode}` : '' }}</small>
          </div>
          <div class="row-account">
            <span class="muted">
              {{ store.cards.filter(c => c.defaultDebitAccountId === item.id && !c.archivedAt).length }} 张卡默认扣款
            </span>
          </div>
          <div class="row-status">
            <span v-if="item.archivedAt" class="status void">已归档</span>
            <span v-else class="status paid">使用中</span>
          </div>
          <div class="row-order">
            <button
              type="button"
              class="quiet icon sm"
              :disabled="ordering || index === 0"
              :aria-label="`上移 ${item.name}`"
              @click="move('accounts', index, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="quiet icon sm"
              :disabled="ordering || index === store.accounts.length - 1"
              :aria-label="`下移 ${item.name}`"
              @click="move('accounts', index, 1)"
            >
              ↓
            </button>
          </div>
          <div class="row-actions">
            <button
              type="button"
              class="menu-trigger"
              :aria-expanded="menu === item.id"
              :aria-label="`${item.name} 的操作`"
              @click="menu = menu === item.id ? '' : item.id"
            >
              ⋮
            </button>
            <div v-if="menu === item.id" class="row-menu" role="menu">
              <button type="button" role="menuitem" @click="open('accounts', item)">编辑</button>
              <button
                v-if="!item.archivedAt"
                type="button"
                role="menuitem"
                class="danger"
                @click="archive('accounts', item.id)"
              >
                归档
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <MasterEditor v-if="editor" :kind="editor.kind" :item="editor.item" @close="editor = undefined" />
  </PageShell>
</template>
