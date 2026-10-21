import type { NextFunction, Request, Response } from 'express';
import type { OAuthService } from './oauth.service.js';

/**
 * 放在 SDK 的 /token、/revoke 之前：
 * 1. 支持 client_secret_basic（SDK 只读表单里的 client_id/client_secret）；
 * 2. 按哈希校验机密客户端的密钥（SDK 需要明文才能比对，而 useeCard 只保存哈希）；
 * 3. 校验通过后移除表单中的密钥，SDK 把该客户端当作公共客户端处理，PKCE 仍强制执行。
 */
export function oauthClientAuth(oauth: OAuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    req.body = body;
    const basic = req.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
    if (basic) {
      const decoded = Buffer.from(basic, 'base64').toString('utf8'); const split = decoded.indexOf(':');
      if (split > 0) {
        body.client_id ||= decodeURIComponent(decoded.slice(0, split));
        body.client_secret ||= decodeURIComponent(decoded.slice(split + 1));
      }
    }
    const clientId = typeof body.client_id === 'string' ? body.client_id : '';
    if (!clientId) { next(); return; } // 交给 SDK 返回标准的 invalid_request
    const result = oauth.verifyClientSecret(clientId, typeof body.client_secret === 'string' ? body.client_secret : undefined);
    if (result === 'missing' || result === 'invalid') {
      res.setHeader('WWW-Authenticate', 'Basic realm="useecard"');
      res.status(401).json({error: 'invalid_client', error_description: result === 'missing' ? 'client_secret is required' : 'client_secret is incorrect'});
      return;
    }
    delete body.client_secret;
    next();
  };
}
