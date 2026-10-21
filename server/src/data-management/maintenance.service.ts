import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';

// 恢复期间阻止新请求，并等待在途请求完成，避免异步图标抓取等在恢复后继续写入。
@Injectable()
export class MaintenanceService {
  private active = 0;
  private locked = false;
  get restoring() { return this.locked; }
  track(res: Response): boolean {
    if (this.locked) return false;
    this.active++;
    let released = false;
    const release = () => { if (!released) { released = true; this.active--; } };
    res.once('finish', release); res.once('close', release);
    return true;
  }
  background() {
    if (this.locked) return null;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
  async enter() {
    if (this.locked) throw new ServiceUnavailableException('已有恢复任务正在进行');
    this.locked = true;
    const deadline = Date.now() + 15_000;
    // 当前恢复请求本身占一个位置。
    while (this.active > 1) {
      if (Date.now() >= deadline) { this.locked = false; throw new ServiceUnavailableException('仍有请求正在处理，请稍后重试'); }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  leave() { this.locked = false; }
}
