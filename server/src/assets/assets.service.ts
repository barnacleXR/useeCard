import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { assetFetchInput, assetUploadInput, siteIconInput, type Asset } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';
import { SafeFetchService } from '../common/safe-fetch.js';

export const ASSET_MAX_BYTES = 512 * 1024;
// 按文件头识别格式，不信任扩展名或 Content-Type；不接受 SVG（可携带脚本）。
export function sniffImage(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (data.length >= 4 && data.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
  return null;
}
type Source = Asset['source'];
const PUBLIC_FIELDS = 'id,mime,size,source,sourceUrl';

// 账户/卡片图标的图片资产：存在 SQLite 中，随数据库一起备份；同一用户相同内容只存一份。
@Injectable()
export class AssetsService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService, @Inject(SafeFetchService) private readonly fetcher: SafeFetchService) {}
  private get db() { return this.ledger.db; }
  private store(owner: string, data: Buffer, source: Source, sourceUrl: string | null): Asset {
    if (!data.length) throw new BadRequestException('图片为空');
    if (data.length > ASSET_MAX_BYTES) throw new BadRequestException('图片不能超过 512 KB');
    const mime = sniffImage(data);
    if (!mime) throw new BadRequestException('只支持 PNG、JPEG、GIF、WebP 或 ICO 图片');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const existing = this.db.prepare(`SELECT ${PUBLIC_FIELDS} FROM assets WHERE ownerId=? AND sha256=?`).get(owner, sha256) as Asset | undefined;
    if (existing) return existing;
    const id = randomUUID();
    this.db.prepare('INSERT INTO assets(id,ownerId,mime,size,sha256,data,source,sourceUrl,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(id, owner, mime, data.length, sha256, data, source, sourceUrl, new Date().toISOString());
    this.ledger.audit(owner, 'asset.create', id, {source, sourceUrl, mime, size: data.length});
    return {id, mime, size: data.length, source, sourceUrl};
  }
  upload(owner: string, body: unknown) {
    const {dataUrl} = assetUploadInput.parse(body);
    return this.store(owner, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), 'upload', null);
  }
  async fromUrl(owner: string, body: unknown) {
    const {url} = assetFetchInput.parse(body);
    const result = await this.fetcher.get(url, {maxBytes: ASSET_MAX_BYTES});
    if (result.status !== 200) throw new BadRequestException(`图片下载失败（HTTP ${result.status}）`);
    return this.store(owner, result.body, 'url', result.url);
  }
  // 抓取网站图标：优先页面声明的 apple-touch-icon（通常 180px），其次声明的 icon，最后常见默认路径。
  async fromSite(owner: string, body: unknown) {
    const {domain} = siteIconInput.parse(body);
    // 不少银行的裸域名没有 DNS 记录，只有 www 子域可访问。
    const hosts = domain.startsWith('www.') ? [domain] : [domain, `www.${domain}`];
    const candidates: string[] = [];
    for (const host of hosts) {
      try {
        const page = await this.fetcher.get(`https://${host}/`, {maxBytes: 512 * 1024, accept: 'text/html'});
        if (page.status === 200) { candidates.push(...iconLinks(page.body.toString('utf8'), page.url)); break; }
      } catch { /* 换下一个主机名 */ }
    }
    for (const host of hosts) candidates.push(`https://${host}/apple-touch-icon.png`, `https://${host}/favicon.ico`);
    for (const candidate of [...new Set(candidates)].slice(0, 8)) {
      try {
        const result = await this.fetcher.get(candidate, {maxBytes: ASSET_MAX_BYTES});
        if (result.status === 200 && sniffImage(result.body)) return this.store(owner, result.body, 'site', result.url);
      } catch { /* 换下一个候选 */ }
    }
    throw new BadRequestException(`没有在 ${domain} 找到可用的图标，可以改为上传或填写图片网址`);
  }
  file(owner: string, id: string) {
    const row = this.db.prepare('SELECT mime,data FROM assets WHERE id=? AND ownerId=?').get(id, owner) as {mime: string; data: Buffer} | undefined;
    if (!row) throw new NotFoundException('图片不存在');
    return row;
  }
}

// 从 HTML 中提取图标链接，按 apple-touch-icon → 声明尺寸大的 icon 排序；SVG 图标跳过。
export function iconLinks(html: string, pageUrl: string): string[] {
  const found: {href: string; score: number}[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(v => v !== undefined) ?? '';
    const rel = attr('rel').toLowerCase(); const href = attr('href');
    if (!href || !/(^|\s)(apple-touch-icon|apple-touch-icon-precomposed|icon|shortcut)(\s|$)/.test(rel)) continue;
    if (/\.svg(\?|$)/i.test(href) || /svg/i.test(attr('type'))) continue;
    const size = Math.max(0, ...attr('sizes').split(/\s+/).map(s => Number(s.split('x')[0]) || 0));
    try { found.push({href: new URL(href, pageUrl).toString(), score: (rel.includes('apple-touch-icon') ? 1000 : 0) + size}); } catch { /* 忽略非法链接 */ }
  }
  return found.sort((a, b) => b.score - a.score).map(f => f.href);
}
