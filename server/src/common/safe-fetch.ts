import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { BadRequestException, Injectable } from '@nestjs/common';

// 内网、回环、链路本地、CGNAT、保留与组播地址一律拒绝，防止借抓图访问服务器所在内网。
const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) blocked.addSubnet(net, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  return family !== 0 && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export interface FetchResult { url: string; status: number; contentType: string; body: Buffer }
export interface SafeFetchOptions { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; accept?: string }

// 只允许 http/https 与默认端口；每一跳（含重定向）都重新解析并校验地址，连接固定到已校验的 IP。
@Injectable()
export class SafeFetchService {
  constructor(private readonly allowPrivate = false) {}
  async get(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
    const {maxBytes = 512 * 1024, timeoutMs = 8000, maxRedirects = 3, accept = 'image/*'} = options;
    let url = this.validate(rawUrl);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const address = await this.resolve(url.hostname);
      const response = await this.once(url, address, timeoutMs, accept);
      const location = response.headers.location;
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        url = this.validate(new URL(location, url).toString());
        continue;
      }
      const body = await this.read(response, maxBytes);
      return {url: url.toString(), status: response.statusCode ?? 0, contentType: String(response.headers['content-type'] || ''), body};
    }
    throw new BadRequestException('重定向次数过多');
  }
  private validate(raw: string) {
    let url: URL;
    try { url = new URL(raw); } catch { throw new BadRequestException('网址格式不正确'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new BadRequestException('只支持 http 或 https 网址');
    if (url.username || url.password) throw new BadRequestException('网址不能包含用户名或密码');
    if (url.port && !(this.allowPrivate || ['80', '443'].includes(url.port))) throw new BadRequestException('只支持默认端口');
    return url;
  }
  private async resolve(hostname: string) {
    const host = hostname.replace(/^\[|\]$/g, '');
    let addresses: {address: string; family: number}[];
    try { addresses = isIP(host) ? [{address: host, family: isIP(host)}] : await lookup(host, {all: true}); }
    catch { throw new BadRequestException('无法解析该网站地址'); }
    if (!addresses.length) throw new BadRequestException('无法解析该网站地址');
    if (!this.allowPrivate && addresses.some(a => !isPublicAddress(a.address))) throw new BadRequestException('不允许访问内网或保留地址');
    return addresses[0];
  }
  private once(url: URL, address: {address: string; family: number}, timeoutMs: number, accept: string) {
    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: 'GET', timeout: timeoutMs,
        // 多数银行站点的 WAF 会静默丢弃非浏览器 UA 的请求（实测超时），因此使用常见浏览器 UA。
        headers: {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: accept},
        // 固定到已校验的地址；主机名仍用于 SNI 与证书校验。
        lookup: (_host, opts, callback) => (opts as {all?: boolean}).all ? (callback as unknown as (e: null, a: {address: string; family: number}[]) => void)(null, [address]) : callback(null, address.address, address.family),
      }, resolve);
      request.on('timeout', () => request.destroy(new BadRequestException('连接超时')));
      request.on('error', error => reject(error instanceof BadRequestException ? error : new BadRequestException('无法连接该网站')));
      request.end();
    });
  }
  private read(response: IncomingMessage, maxBytes: number) {
    return new Promise<Buffer>((resolve, reject) => {
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > maxBytes) { response.destroy(); reject(new BadRequestException('文件过大')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { response.destroy(); reject(new BadRequestException('文件过大')); } else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () => reject(new BadRequestException('读取失败')));
    });
  }
}
