export interface AccountItem {
  id: string;
  name: string;
  type: "cash" | "debit" | "e_wallet" | "credit" | "investment" | "invest" | string;
  account: string;
  card_tail?: string;
  initial_balance?: number;
  is_archived?: boolean;
  current_balance?: number;
  balance?: number;
}

export interface CategoryItem {
  id: string;
  name: string;
  account: string;
  type: "expense" | "income";
  icon?: string;
  is_archived?: boolean;
}

export interface DebtItem {
  id: string;
  name: string;
  type: string;
  account: string;
  initial_amount: number;
  current_balance: number;
  repaid_amount: number;
  progress_pct: number;
  monthly_payment: number;
  due_date: string;
  total_periods: number;
  remaining_periods: number;
  note?: string;
  is_archived?: boolean;
}

export interface PostingItem {
  account: string;
  amount: number;
  currency: string;
}

export interface TransactionItem {
  id: string;
  date: string;
  payee: string;
  narration: string;
  amount: number;
  category: string;
  account: string;
  type: "expense" | "income" | "transfer" | "repayment" | "debt_repayment";
  is_offset: boolean;
  postings: PostingItem[];
  source_type?: string;
  tags?: string[];
}

export interface PendingItem {
  item_id: string;
  batch_id?: string;
  source_type: string;
  source_tx_id?: string;
  date: string;
  payee: string;
  narration: string;
  amount: string | number;
  currency: string;
  suggested_account: string;
  suggested_category: string;
  reason: string;
  raw_payload?: Record<string, any>;
  status: string;
}

export interface ImportBatchItem {
  batch_id: string;
  filename: string;
  source_type: string;
  total_count: number;
  added_count: number;
  duplicate_count: number;
  pending_count: number;
  failed_count: number;
  created_at: string;
}

export interface CategoryMerchantItem {
  payee: string;
  amount: number;
  count: number;
  percentage?: number;
  ratio?: number;
}

export interface CategoryRankingItem {
  rank?: number;
  category: string;
  amount: number;
  percentage?: number;
  ratio?: number;
  count?: number;
  merchants?: CategoryMerchantItem[];
}

export interface MerchantRankingItem {
  rank?: number;
  payee: string;
  amount: number;
  count: number;
  avg_amount: number;
  percentage?: number;
  ratio?: number;
  categories: string[];
  last_date?: string;
}

export interface AssetDailyTrendAccount {
  id?: string;
  name?: string;
  account: string;
  balances: number[];
}

export interface DailySeriesItem {
  date: string;
  day: number;
  amount: number;
  is_peak?: boolean;
}

export interface FinancialReport {
  month: string;
  cutoff_date?: string;
  balance_sheet: {
    total_assets: number;
    credit_card_liabilities?: number;
    personal_debts?: number;
    total_liabilities: number;
    net_worth: number;
    net_worth_ex_debt?: number;
    liquid_assets?: number;
    account_balances?: Record<string, number>;
  };
  income_statement: {
    total_income: number;
    total_expenses: number;
    monthly_surplus: number;
    savings_rate: number;
    categories?: Record<string, number>;
    expense_breakdown?: Record<string, number>;
    income_breakdown?: Record<string, number>;
  };
  category_ranking: CategoryRankingItem[];
  top_payees: { payee: string; amount: number; count?: number; percentage?: number; ratio?: number }[];
  merchant_ranking: MerchantRankingItem[];
  daily_series?: DailySeriesItem[];
  daily_spending?: {
    days: (number | string)[];
    amounts: number[];
  };
  asset_daily_trends?: {
    days: (number | string)[];
    dates: string[];
    accounts: AssetDailyTrendAccount[];
  };
  daily_burn_rate: {
    elapsed_days: number;
    total_days?: number;
    days_in_month?: number;
    daily_run_rate: number;
    projected_month_expense: number;
    peak_day: { date: string; amount: number };
    daily_breakdown?: Record<string, number>;
  };
  needs_wants_savings: {
    needs_amount: number;
    wants_amount: number;
    savings_amount?: number;
    needs_ratio: number;
    wants_ratio: number;
  };
  emergency_runway: {
    liquid_assets: number;
    monthly_needs?: number;
    monthly_baseline_need?: number;
    runway_months: number;
    health_status: string;
  };
}

export interface AssetTrendItem {
  id: string;
  name: string;
  account: string;
  balances: number[];
}

export interface HistoricalTrends {
  months: string[];
  income_series?: number[];
  expense_series?: number[];
  surplus_series?: number[];
  savings_rate_series?: number[];
  asset_trends:
    | AssetTrendItem[]
    | {
        total_assets?: number[];
        net_worth?: number[];
        accounts?: Record<string, number[]>;
      };
  debt_trends?: any;
  category_trends?: any;
  net_worth_trend?: Array<{
    month: string;
    total_assets: number;
    total_liabilities: number;
    net_worth: number;
  }>;
}
