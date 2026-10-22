import { createDate, createTime, type DateValue } from '@vean/aria/date';

// 表单值统一用字符串：日期 YYYY-MM-DD、月份 YYYY-MM、时间 HH:MM；只在组件边界与 Vean 的 Date 值互转。
// 一周从周一开始。Vean 日历的 weekStartsOn 以 0 表示周一；不传时按语言推断会错位到周二，因此显式指定。
export const WEEK_STARTS_ON = 0;
const pad = (n: number) => String(n).padStart(2, '0');

export function parseDay(value?: string | null): Date | undefined {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? createDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
}

export function formatDay(value?: DateValue | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : (value as {date: Date}).date;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseTime(value?: string | null): Date | undefined {
  const m = value?.match(/^(\d{2}):(\d{2})$/);
  return m ? createTime(Number(m[1]), Number(m[2])) : undefined;
}

export function formatTime(value?: Date | null): string {
  return value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : '';
}

export function parseMonth(value?: string | null): {year: number; month: number} | undefined {
  const m = value?.match(/^(\d{4})-(\d{2})$/);
  return m ? {year: Number(m[1]), month: Number(m[2])} : undefined;
}

export const formatMonth = (year: number, month: number) => `${year}-${pad(month)}`;
