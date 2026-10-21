import { createRequire } from 'node:module';
import { Injectable } from '@nestjs/common';
import type { BankEntry } from '@ccm/shared';

// 全国金融机构清单：zengin-code/source-data（MIT），见 licenses/README.md。
const banks = createRequire(import.meta.url)('../data/banks.json') as {code: string; name: string; kana: string; hira: string; roma: string}[];

// 常用银行的官网域名，用于抓取网站图标（2026-10-21 实测均可抓取）；其余机构由用户自行填写域名或上传。
// 未收录：ソニー（域名无法解析）、みんなの（CDN 拒绝非浏览器 TLS）、東京スター（要求不安全的旧版 TLS 重协商）。
export const BANK_DOMAINS: Record<string, string> = {
  '0001': 'mizuhobank.co.jp', '0005': 'bk.mufg.jp', '0009': 'smbc.co.jp', '0010': 'resonabank.co.jp', '0017': 'saitamaresona.co.jp',
  '0033': 'paypay-bank.co.jp', '0034': 'sevenbank.co.jp', '0036': 'rakuten-bank.co.jp', '0039': 'jibunbank.co.jp',
  '0040': 'aeonbank.co.jp', '0041': 'bank-daiwa.co.jp', '0042': 'lawsonbank.jp', '0134': 'chibabank.co.jp',
  '0138': 'boy.co.jp', '0149': 'shizuokabank.co.jp', '0158': 'kyotobank.co.jp', '0159': 'kansaimiraibank.co.jp', '0177': 'fukuokabank.co.jp',
  '0288': 'tr.mufg.jp', '0294': 'smtb.jp', '0310': 'gmo-aozora.com', '0397': 'sbishinseibank.co.jp', '0398': 'aozorabank.co.jp',
  '0501': 'hokuyobank.co.jp', '9900': 'jp-bank.japanpost.jp',
};
// 全角转半角、统一小写，便于用片假名、平假名、罗马字或代码检索。
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s・ー－-]/g, '');
const index = banks.map(bank => ({bank, keys: [bank.code, bank.name, bank.kana, bank.hira, bank.roma].map(normalize)}));

@Injectable()
export class BanksService {
  search(query = '', limit = 20): BankEntry[] {
    const q = normalize(String(query).slice(0, 50));
    const matches = index.filter(({keys}) => !q || keys.some(key => key.includes(q)))
      // 有域名的常用行优先，其次前缀匹配，再按代码。
      .sort((a, b) => Number(!!BANK_DOMAINS[b.bank.code]) - Number(!!BANK_DOMAINS[a.bank.code]) || Number(b.keys.some(k => k.startsWith(q))) - Number(a.keys.some(k => k.startsWith(q))) || a.bank.code.localeCompare(b.bank.code));
    return matches.slice(0, Math.min(Math.max(limit, 1), 50)).map(({bank}) => ({code: bank.code, name: bank.name, kana: bank.kana, domain: BANK_DOMAINS[bank.code] ?? null}));
  }
  find(code: string): BankEntry | null { return this.search(code, 50).find(b => b.code === code) ?? null; }
}
