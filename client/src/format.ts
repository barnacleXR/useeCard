const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// date-only 字符串按 UTC 解析，避免浏览器时区把日期挪到前一天。
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日 周${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
}
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
