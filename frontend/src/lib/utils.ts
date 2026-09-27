import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(val: number | string | undefined | null, showSign = false): string {
  const num = Number(val ?? 0);
  if (isNaN(num)) return "¥0.00";
  const absFormatted = Math.abs(num).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (showSign) {
    if (num > 0) return `+¥${absFormatted}`;
    if (num < 0) return `-¥${absFormatted}`;
  }
  return num < 0 ? `-¥${absFormatted}` : `¥${absFormatted}`;
}

export function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getCurrentMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}
