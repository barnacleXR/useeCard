import { createHash, randomBytes } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';

// 令牌、配对码只存不可逆哈希。
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

// 进程内失败尝试限流：命中计数，成功后清零；窗口过期自动重置。
@Injectable()
export class RateLimitService {
  private buckets = new Map<string, {count: number; until: number}>();
  hit(key: string, limit = 10, windowMs = 900000) {
    const now = Date.now();
    if (this.buckets.size > 1000) for (const [id, value] of this.buckets) if (value.until < now) this.buckets.delete(id);
    const bucket = this.buckets.get(key);
    if (bucket && bucket.until > now && bucket.count >= limit) throw new HttpException(`尝试次数过多，请 ${Math.ceil(windowMs / 60000)} 分钟后重试`, 429);
    this.buckets.set(key, {count: bucket && bucket.until > now ? bucket.count + 1 : 1, until: now + windowMs});
  }
  clear(key: string) { this.buckets.delete(key); }
}

/** 会话 Cookie 是否带 Secure：显式设置 COOKIE_SECURE 时以其为准，否则按 BASE_URL 是否为 https 判断。 */
export function secureCookies() {
  const explicit = process.env.COOKIE_SECURE;
  return explicit ? explicit !== 'false' : (process.env.BASE_URL || '').startsWith('https://');
}
