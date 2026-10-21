import { HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

export class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof ZodError) { res.status(400).json({message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；')}); return; }
    if (error instanceof HttpException) { res.status(error.getStatus()).json({message: error.message}); return; }
    // body-parser 等抛出的 http-errors（如请求体过大、JSON 格式错误）是客户端错误，不应变成 500。
    const status = (error as {status?: number; expose?: boolean}).status;
    if (typeof status === 'number' && status >= 400 && status < 500 && (error as {expose?: boolean}).expose) {
      res.status(status).json({message: status === 413 ? '请求内容过大' : '请求格式不正确'}); return;
    }
    console.error('服务端请求失败', error);
    res.status(500).json({message: '服务暂时无法完成请求，请稍后重试'});
  }
}
