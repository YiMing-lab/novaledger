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

export const BUILTIN_CATEGORY_NAMES: Record<string, string> = {
  "Expenses:Travel": "旅行支出",
  "Expenses:Travel:Lodging": "酒店住宿",
  "Expenses:Travel:Tickets": "交通车票",
  "Expenses:Food:Dining": "餐饮美食",
  "Expenses:Food:Groceries": "买菜生鲜",
  "Expenses:Food:Snacks": "零食水果",
  "Expenses:Transport:Taxi": "打车出行",
  "Expenses:Transport:Transit": "交通通行",
  "Expenses:Transport:Public": "公共交通",
  "Expenses:Housing:Rent": "住房房租",
  "Expenses:Housing:Utilities": "水电物业",
  "Expenses:Shopping:Daily": "日常百货",
  "Expenses:Shopping:Digital": "数码配件",
  "Expenses:Shopping:Electronics": "数码配件",
  "Expenses:Shopping:Clothing": "服饰鞋包",
  "Expenses:Entertainment": "休闲娱乐",
  "Expenses:Entertainment:General": "休闲娱乐",
  "Expenses:Health:Medical": "医疗健康",
  "Expenses:Financial:Interest": "贷款利息",
  "Expenses:Education": "学习教育",
  "Expenses:Social": "人情社交",
  "Expenses:Other:General": "日常其他",
  "Expenses:Other": "其他杂项",
  "Income:Salary": "工资薪金",
  "Income:Investment": "投资收益",
  "Income:Invest:PnL": "理财收益",
  "Income:Sell": "物品出售",
  "Income:Other": "其他收入",
  "Income:Transfer:Incoming": "转账存入",
  "Equity:Opening-Balances": "期初余额",
};

/**
 * 统一获取分类或账户的友好中文显示名称
 * 1. 优先从用户配置的 nameMap 中查找
 * 2. 匹配内置 Beancount 常用科目字典 (如 Expenses:Travel -> 旅行支出)
 * 3. 逐级向父级回溯匹配 (如 Expenses:Travel:Sub -> 旅行支出 · Sub)
 * 4. 友好剥离 Expenses: / Income: 前缀并格式化分隔符
 */
export function getCategoryDisplayName(
  account: string | undefined | null,
  nameMap?: Record<string, string>
): string {
  if (!account) return "";
  const trimmed = account.trim();
  if (!trimmed) return "";

  // 1. 用户配置映射
  if (nameMap && nameMap[trimmed]) {
    return nameMap[trimmed];
  }

  // 2. 内置标准科目字典精确匹配 (支持大小写宽松匹配)
  if (BUILTIN_CATEGORY_NAMES[trimmed]) {
    return BUILTIN_CATEGORY_NAMES[trimmed];
  }
  const lowerTrimmed = trimmed.toLowerCase();
  for (const [acc, name] of Object.entries(BUILTIN_CATEGORY_NAMES)) {
    if (acc.toLowerCase() === lowerTrimmed) {
      return name;
    }
  }

  // 3. 父级前缀回溯匹配
  const parts = trimmed.split(":");
  if (parts.length > 2) {
    const parentAcc = parts.slice(0, 2).join(":");
    const subName = parts.slice(2).join(" · ");
    const parentDisplayName =
      (nameMap && nameMap[parentAcc]) ||
      BUILTIN_CATEGORY_NAMES[parentAcc] ||
      (parentAcc.toLowerCase() === "expenses:travel" ? "旅行支出" : null);

    if (parentDisplayName) {
      return `${parentDisplayName} · ${subName}`;
    }
  }

  // 4. 兜底清洗：剥离 Expenses: 或 Income:
  if (trimmed.startsWith("Expenses:")) {
    return trimmed.replace(/^Expenses:/, "").replace(/:/g, " · ");
  }
  if (trimmed.startsWith("Income:")) {
    return trimmed.replace(/^Income:/, "").replace(/:/g, " · ");
  }

  return trimmed;
}
