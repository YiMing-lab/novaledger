import React, { useEffect, useState } from "react";
import {
  AccountItem,
  CategoryItem,
  DebtItem,
  ImportBatchItem,
  PendingItem,
} from "../api/types";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DialogModal,
  Input,
  Label,
  Select,
  Switch,
  Textarea,
  useToast,
} from "../components/ui/primitives";
import { formatCurrency, getTodayStr } from "../lib/utils";
import {
  Clock,
  Upload,
  Tags,
  Mail,
  Database,
  Scale,
  Check,
  X,
  Plus,
  Trash2,
  Edit3,
  Download,
  FileCode2,
  FileSpreadsheet,
  FlaskConical,
  RotateCcw,
} from "lucide-react";

interface SettingsViewProps {
  activeSubTab: string;
  onSubTabChange: (tab: string) => void;
  accounts: AccountItem[];
  categories: CategoryItem[];
  debts: DebtItem[];
  pendingItems: PendingItem[];
  ledgerValid: boolean;
  validationErrors: string[];
  onRefresh: () => void;
  onTriggerMailSync: () => void;
}

const FOURTEEN_BANKS = [
  "工商银行",
  "农业银行",
  "中国银行",
  "建设银行",
  "交通银行",
  "邮储银行",
  "招商银行",
  "中信银行",
  "浦发银行",
  "广发银行",
  "平安银行",
  "兴业银行",
  "民生银行",
  "光大银行",
];

type AIProviderKey = "deepseek" | "gemini" | "openai";

interface AIProfileItem {
  base_url: string;
  model: string;
  proxy: string;
}

interface PendingEditState {
  type: "expense" | "income" | "transfer";
  is_offset: boolean;
  account: string;
  category: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeSubTab,
  onSubTabChange,
  accounts,
  categories,
  debts,
  pendingItems,
  ledgerValid,
  validationErrors,
  onRefresh,
  onTriggerMailSync,
}) => {
  const toast = useToast();
  const activeAccounts = accounts.filter((a) => !a.is_archived);
  const activeCategories = categories.filter((c) => !c.is_archived);
  const activeDebts = debts.filter((d) => !d.is_archived);
  const expenseCats = activeCategories.filter((c) => c.type === "expense");
  const incomeCats = activeCategories.filter((c) => c.type === "income");

  // Pending overrides
  const [pendingEdits, setPendingEdits] = useState<Record<string, PendingEditState>>({});

  // Import state
  const [importSourceType, setImportSourceType] = useState("wechat_csv");
  const [importDefaultAcc, setImportDefaultAcc] = useState(activeAccounts[0]?.account || "Assets:Bank:Default:Card001");
  const [importBatches, setImportBatches] = useState<ImportBatchItem[]>([]);
  const [uploadingImport, setUploadingImport] = useState(false);

  // Category modal state
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryItem | null>(null);
  const [catName, setCatName] = useState("");
  const [catType, setCatType] = useState<"expense" | "income">("expense");
  const [catAccount, setCatAccount] = useState("Expenses:Custom:Item");

  // Mail & AI Config state
  const [imapHost, setImapHost] = useState("imap.qq.com");
  const [imapPort, setImapPort] = useState("993");
  const [imapUser, setImapUser] = useState("");
  const [imapCode, setImapCode] = useState("");
  const [mailCodeConfigured, setMailCodeConfigured] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState<AIProviderKey>("deepseek");
  const [aiProfiles, setAiProfiles] = useState<Record<AIProviderKey, AIProfileItem>>({
    deepseek: {
      base_url: "https://api.deepseek.com",
      model: "deepseek-chat",
      proxy: "",
    },
    gemini: {
      base_url: "https://generativelanguage.googleapis.com",
      model: "gemini-3.8-flash",
      proxy: "",
    },
    openai: {
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      proxy: "",
    },
  });
  const [aiKeys, setAiKeys] = useState<Record<AIProviderKey, string>>({
    deepseek: "",
    gemini: "",
    openai: "",
  });
  const [aiKeyStatus, setAiKeyStatus] = useState<
    Record<AIProviderKey, { configured: boolean; masked: string }>
  >({
    deepseek: { configured: false, masked: "" },
    gemini: { configured: false, masked: "" },
    openai: { configured: false, masked: "" },
  });
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{
    success: boolean;
    message: string;
    latency_ms?: number;
    endpoint?: string;
    model?: string;
  } | null>(null);

  // 14-Bank Sample Tester state
  const [sampleSubject, setSampleSubject] = useState("");
  const [sampleSender, setSampleSender] = useState("");
  const [sampleBody, setSampleBody] = useState("");
  const [sampleResult, setSampleResult] = useState<any>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  // Reconciliation state
  const [reconAcc, setReconAcc] = useState(activeAccounts[0]?.account || "");
  const [reconDate, setReconDate] = useState(getTodayStr());
  const [reconActual, setReconActual] = useState("");
  const [reconResult, setReconResult] = useState<any>(null);

  useEffect(() => {
    loadConfigAndBatches();
  }, [activeSubTab]);

  const loadConfigAndBatches = async () => {
    try {
      const cfgData = await api.getConfig();
      const cfg = cfgData.config || cfgData || {};
      const creds = cfgData.credentials || cfgData.credentials_status || {};
      const ms = cfg.mail_sync || {};
      setImapHost(ms.imap_host || "imap.qq.com");
      setImapPort(String(ms.imap_port || 993));
      setImapUser(ms.username || "");
      setMailCodeConfigured(Boolean(creds.email_auth_code?.configured));

      const sys = cfg.system || {};
      setAiEnabled(sys.ai_enabled !== false);

      let rawProv = String(sys.ai_provider || "gemini").toLowerCase();
      if (rawProv === "openai_compatible") {
        const legacyUrl = String(sys.ai_base_url || "").toLowerCase();
        rawProv = legacyUrl.includes("deepseek") ? "deepseek" : "openai";
      }
      const normProv: AIProviderKey =
        rawProv === "gemini" ? "gemini" : rawProv === "openai" ? "openai" : "deepseek";
      setAiProvider(normProv);

      const savedProfiles = sys.ai_profiles || {};
      const rawGeminiModel = savedProfiles.gemini?.model || sys.ai_model || "gemini-3.8-flash";
      const normalizedGeminiModel =
        !String(rawGeminiModel).startsWith("gemini") ||
        rawGeminiModel === "gemini-2.5-flash" ||
        rawGeminiModel === "gemini-2.0-flash"
          ? "gemini-3.8-flash"
          : String(rawGeminiModel);

      setAiProfiles({
        deepseek: {
          base_url:
            savedProfiles.deepseek?.base_url ||
            (normProv === "deepseek" && sys.ai_base_url ? sys.ai_base_url : "https://api.deepseek.com"),
          model:
            savedProfiles.deepseek?.model ||
            (normProv === "deepseek" && sys.ai_model && !String(sys.ai_model).startsWith("gemini")
              ? sys.ai_model
              : "deepseek-chat"),
          proxy: savedProfiles.deepseek?.proxy ?? "",
        },
        gemini: {
          base_url:
            savedProfiles.gemini?.base_url ||
            (normProv === "gemini" && sys.ai_base_url && !String(sys.ai_base_url).includes("deepseek")
              ? sys.ai_base_url
              : "https://generativelanguage.googleapis.com"),
          model: normalizedGeminiModel,
          proxy: savedProfiles.gemini?.proxy ?? sys.ai_proxy ?? "",
        },
        openai: {
          base_url:
            savedProfiles.openai?.base_url ||
            (normProv === "openai" && sys.ai_base_url ? sys.ai_base_url : "https://api.openai.com/v1"),
          model:
            savedProfiles.openai?.model ||
            (normProv === "openai" && sys.ai_model ? sys.ai_model : "gpt-4o-mini"),
          proxy: savedProfiles.openai?.proxy ?? sys.ai_proxy ?? "",
        },
      });

      const geminiCred = creds.gemini_api_key || { configured: false, masked: "" };
      const deepseekCred = creds.deepseek_api_key?.configured
        ? creds.deepseek_api_key
        : normProv === "deepseek"
        ? geminiCred
        : { configured: false, masked: "" };
      const openaiCred = creds.openai_api_key?.configured
        ? creds.openai_api_key
        : normProv === "openai"
        ? geminiCred
        : { configured: false, masked: "" };

      setAiKeyStatus({
        deepseek: {
          configured: Boolean(deepseekCred.configured),
          masked: deepseekCred.masked || "",
        },
        gemini: {
          configured: Boolean(geminiCred.configured),
          masked: geminiCred.masked || "",
        },
        openai: {
          configured: Boolean(openaiCred.configured),
          masked: openaiCred.masked || "",
        },
      });
    } catch {
      // ignore
    }
    try {
      const bList = await api.getImportBatches();
      if (Array.isArray(bList)) setImportBatches(bList);
    } catch {
      // ignore
    }
  };

  const getDefaultPendingState = (item: PendingItem): PendingEditState => {
    const sugCat = item.suggested_category || "";
    const textHint = `${item.reason || ""} ${item.narration || ""} ${item.payee || ""}`;
    const isRefund = textHint.includes("退款") || textHint.includes("退货");
    const isTransferOrRepay =
      sugCat.startsWith("Assets:") ||
      sugCat.startsWith("Liabilities:") ||
      textHint.includes("还款") ||
      textHint.includes("归还贷款");

    if (isTransferOrRepay) {
      const defaultTarget =
        sugCat.startsWith("Assets:") || sugCat.startsWith("Liabilities:")
          ? sugCat
          : activeDebts[0]?.account || activeAccounts[1]?.account || activeAccounts[0]?.account || "";
      return {
        type: "transfer",
        is_offset: false,
        account: item.suggested_account || activeAccounts[0]?.account || "",
        category: defaultTarget,
      };
    }
    if (sugCat.startsWith("Income:")) {
      return {
        type: "income",
        is_offset: false,
        account: item.suggested_account || activeAccounts[0]?.account || "",
        category: sugCat,
      };
    }
    return {
      type: "expense",
      is_offset: isRefund,
      account: item.suggested_account || activeAccounts[0]?.account || "",
      category: sugCat || expenseCats[0]?.account || "Expenses:Other:General",
    };
  };

  // 1. Pending handlers
  const handleResolvePending = async (item: PendingItem, action: "confirm" | "ignore") => {
    const editState = pendingEdits[item.item_id] || getDefaultPendingState(item);
    try {
      const res = await api.resolvePending(
        item.item_id,
        action,
        editState.account,
        editState.category,
        editState.type,
        editState.is_offset
      );
      toast.success(res.message || "已处理待确认账目");
      onRefresh();
    } catch (e: any) {
      toast.error(`处理失败: ${e.message}`);
    }
  };

  // 2. Import handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImport(true);
    try {
      const res = await api.uploadImportFile(file, importSourceType, importDefaultAcc);
      const s = res.summary || {};
      toast.success(
        `导入完成：新增 ${s.added || 0} 笔，跳过重复 ${s.duplicate || 0} 笔，待确认 ${s.pending || 0} 笔`
      );
      e.target.value = "";
      onRefresh();
      loadConfigAndBatches();
    } catch (err: any) {
      toast.error(`导入失败: ${err.message}`);
    } finally {
      setUploadingImport(false);
    }
  };

  const handleRollbackBatch = async (batchId: string) => {
    if (!window.confirm(`确定要撤销批次 ${batchId} 导入的所有账单吗？`)) return;
    try {
      const res = await api.rollbackImportBatch(batchId);
      toast.success(res.message || "已撤销该批次账单");
      onRefresh();
      loadConfigAndBatches();
    } catch (e: any) {
      toast.error(`撤销失败: ${e.message}`);
    }
  };

  // 3. Category handlers
  const openAddCategory = (type: "expense" | "income") => {
    setEditingCat(null);
    setCatName("");
    setCatType(type);
    setCatAccount(type === "expense" ? "Expenses:Custom:NewItem" : "Income:Custom:NewItem");
    setCatModalOpen(true);
  };

  const openEditCategory = (cat: CategoryItem) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatType(cat.type);
    setCatAccount(cat.account);
    setCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      if (editingCat) {
        await api.updateCategory(editingCat.id, { name: catName.trim() });
        toast.success("分类名称已更新");
      } else {
        await api.createCategory({
          name: catName.trim(),
          type: catType,
          account: catAccount.trim(),
          icon: "tag",
        });
        toast.success("新增分类成功");
      }
      setCatModalOpen(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`保存分类失败: ${err.message}`);
    }
  };

  const handleDeleteCategory = async (cat: CategoryItem) => {
    if (!window.confirm(`确定要删除分类「${cat.name}」吗？`)) return;
    try {
      await api.deleteCategory(cat.id);
      toast.success("分类已删除");
      onRefresh();
    } catch (e: any) {
      toast.error(`删除失败: ${e.message}`);
    }
  };

  // 4. Mail & AI handlers
  const handleSaveMail = async () => {
    try {
      await api.updateConfig({
        mail_sync: {
          imap_host: imapHost.trim(),
          imap_port: parseInt(imapPort || "993", 10),
          username: imapUser.trim(),
          enabled: true,
        },
        credentials: imapCode.trim() ? { email_auth_code: imapCode.trim() } : {},
      });
      setImapCode("");
      toast.success("邮箱设置已保存");
      loadConfigAndBatches();
    } catch (e: any) {
      toast.error(`保存失败: ${e.message}`);
    }
  };

  const handleTestMail = async () => {
    toast.info("正在测试邮箱连接...");
    try {
      const res = await api.testMailSync({
        imap_host: imapHost.trim(),
        imap_port: parseInt(imapPort || "993", 10),
        username: imapUser.trim(),
        auth_code: imapCode.trim() || undefined,
      });
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (e: any) {
      toast.error(`连接失败: ${e.message}`);
    }
  };

  const updateCurrentAiProfile = (field: keyof AIProfileItem, value: string) => {
    setAiProfiles((prev) => ({
      ...prev,
      [aiProvider]: {
        ...prev[aiProvider],
        [field]: value,
      },
    }));
  };

  const handleSaveAI = async () => {
    const activeProf = aiProfiles[aiProvider];
    const credPayload: Record<string, string> = {};
    if (aiKeys.deepseek.trim()) credPayload.deepseek_api_key = aiKeys.deepseek.trim();
    if (aiKeys.gemini.trim()) credPayload.gemini_api_key = aiKeys.gemini.trim();
    if (aiKeys.openai.trim()) credPayload.openai_api_key = aiKeys.openai.trim();
    const currentTypedKey = aiKeys[aiProvider].trim();
    if (currentTypedKey) {
      credPayload.gemini_api_key = currentTypedKey;
    }

    try {
      await api.updateConfig({
        system: {
          ai_enabled: aiEnabled,
          ai_provider: aiProvider,
          ai_base_url: activeProf.base_url.trim(),
          ai_model: activeProf.model.trim(),
          ai_proxy: activeProf.proxy.trim(),
          ai_profiles: aiProfiles,
        },
        credentials: credPayload,
      });
      setAiKeys({ deepseek: "", gemini: "", openai: "" });
      toast.success(`已保存 ${aiProvider.toUpperCase()} 设置`);
      loadConfigAndBatches();
    } catch (e: any) {
      toast.error(`保存失败: ${e.message}`);
    }
  };

  const handleTestAI = async () => {
    const activeProf = aiProfiles[aiProvider];
    const typedKey = aiKeys[aiProvider].trim();
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const res = await api.testAIKey({
        provider: aiProvider,
        base_url: activeProf.base_url.trim(),
        model: activeProf.model.trim(),
        proxy: activeProf.proxy.trim(),
        api_key: typedKey || undefined,
      });
      setAiTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (e: any) {
      const msg = `测试失败: ${e.message}`;
      setAiTestResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setAiTesting(false);
    }
  };

  // 14-Bank Sample Tester
  const fillDemoSample = async (key: "ccb" | "icbc" | "boc_refund" | "spdb_html") => {
    const map = {
      ccb: {
        subject: "中国建设银行龙卡信用卡消费提醒",
        sender: "service@vip.ccb.com",
        body: "尊敬的客户，您尾号8821的龙卡信用卡于2026年09月16日14:20在【山姆会员商店】消费人民币628.50元，当前可用余额18,371.50元。【建设银行】",
      },
      icbc: {
        subject: "中国工商银行融e联交易提醒",
        sender: "webmaster@icbc.com.cn",
        body: "您尾号3309卡于09月16日18:45快捷支付人民币125.00元，对方为美团外卖，交易后余额8,420.00元。【工商银行】",
      },
      boc_refund: {
        subject: "中国银行交易通知",
        sender: "95566@bankofchina.com",
        body: "您的中国银行信用卡(尾号5120)于2026-09-16 11:15在京东商城的退货人民币1,400.00元已入账。【中国银行】",
      },
      spdb_html: {
        subject: "浦发银行信用卡电子日账单",
        sender: "service@spdbccc.com.cn",
        body: "<table><tr><th>交易日期</th><th>卡号末四位</th><th>交易摘要</th><th>交易金额</th></tr><tr><td>2026-09-15</td><td>6612</td><td>星巴克咖啡</td><td>CNY 38.00</td></tr><tr><td>2026-09-16</td><td>6612</td><td>Apple Store 退货</td><td>-1,299.00</td></tr></table>",
      },
    };
    const item = map[key];
    setSampleSubject(item.subject);
    setSampleSender(item.sender);
    setSampleBody(item.body);
    setSampleLoading(true);
    try {
      const res = await api.parseMailSample({
        subject: item.subject,
        sender: item.sender,
        body: item.body,
        use_ai_fallback: true,
      });
      setSampleResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSampleLoading(false);
    }
  };

  const handleRunSampleParse = async () => {
    if (!sampleBody.trim()) {
      toast.info("请先粘贴银行邮件内容或点击右上角示例按钮");
      return;
    }
    setSampleLoading(true);
    try {
      const res = await api.parseMailSample({
        subject: sampleSubject.trim(),
        sender: sampleSender.trim(),
        body: sampleBody.trim(),
        use_ai_fallback: true,
      });
      setSampleResult(res);
    } catch (e: any) {
      toast.error(`解析异常: ${e.message}`);
    } finally {
      setSampleLoading(false);
    }
  };

  // Reconciliation handlers
  const handleCheckRecon = async () => {
    const val = parseFloat(reconActual);
    if (!reconAcc || !reconDate || isNaN(val)) {
      toast.error("请选择账户、日期并输入实际余额");
      return;
    }
    try {
      const res = await api.checkReconciliation(reconAcc, reconDate, val);
      setReconResult(res);
    } catch (e: any) {
      toast.error(`核对失败: ${e.message}`);
    }
  };

  const handleApplyRecon = async () => {
    const val = parseFloat(reconActual);
    try {
      await api.adjustReconciliation({
        account: reconAcc,
        date: reconDate,
        actual_balance: val,
        reason: "余额校准",
      });
      toast.success("已补充差额调整记录，余额已对齐");
      setReconResult(null);
      onRefresh();
    } catch (e: any) {
      toast.error(`校准失败: ${e.message}`);
    }
  };

  const tabs = [
    { id: "pending", label: "待确认账目", icon: Clock, badge: pendingItems.length },
    { id: "import", label: "导入账单", icon: Upload },
    { id: "categories", label: "记账分类", icon: Tags },
    { id: "services", label: "邮箱与AI设置", icon: Mail },
    { id: "backup", label: "导出与备份", icon: Database },
    { id: "recon", label: "余额校准", icon: Scale },
  ];

  const formatAccOption = (a: AccountItem) =>
    `${a.name}${a.card_tail ? ` (尾号${a.card_tail})` : ""}`;

  return (
    <div className="space-y-5">
      {/* 顶部子标签页切换 */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/50 p-1.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeSubTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onSubTabChange(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
              {t.badge ? (
                <Badge variant="warning" className="ml-1 px-1.5 py-0 text-[10px]">
                  {t.badge}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Tab 1: 待确认账目 */}
      {activeSubTab === "pending" && (
        <Card>
          <CardHeader>
            <CardTitle>⏳ 待确认账目 ({pendingItems.length})</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              来自账单导入或邮件同步的待核对记录，确认类型、账户与资金去向后即可入账
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingItems.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground border rounded-xl border-dashed">
                暂无待确认账目
              </div>
            ) : (
              pendingItems.map((item) => {
                const editState = pendingEdits[item.item_id] || getDefaultPendingState(item);

                const handlePendingTypeChange = (newType: "expense" | "income" | "transfer") => {
                  let nextCat = editState.category;
                  if (newType === "expense" && !nextCat.startsWith("Expenses:")) {
                    nextCat = expenseCats[0]?.account || "Expenses:Other:General";
                  } else if (newType === "income" && !nextCat.startsWith("Income:")) {
                    nextCat = incomeCats[0]?.account || "Income:Salary";
                  } else if (
                    newType === "transfer" &&
                    !nextCat.startsWith("Assets:") &&
                    !nextCat.startsWith("Liabilities:")
                  ) {
                    nextCat =
                      activeDebts[0]?.account ||
                      activeAccounts.find((a) => a.account !== editState.account)?.account ||
                      activeAccounts[0]?.account ||
                      "";
                  }
                  setPendingEdits((prev) => ({
                    ...prev,
                    [item.item_id]: {
                      ...editState,
                      type: newType,
                      is_offset: false,
                      category: nextCat,
                    },
                  }));
                };

                const handlePendingCategoryChange = (newCat: string) => {
                  let nextType = editState.type;
                  let nextOffset = editState.is_offset;
                  if (newCat.startsWith("Assets:") || newCat.startsWith("Liabilities:")) {
                    nextType = "transfer";
                    nextOffset = false;
                  } else if (newCat.startsWith("Income:")) {
                    nextType = "income";
                  } else if (newCat.startsWith("Expenses:")) {
                    nextType = "expense";
                  }
                  setPendingEdits((prev) => ({
                    ...prev,
                    [item.item_id]: {
                      ...editState,
                      type: nextType,
                      is_offset: nextOffset,
                      category: newCat,
                    },
                  }));
                };

                return (
                  <div
                    key={item.item_id}
                    className="rounded-xl border bg-background/50 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="warning">待确认</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{item.date}</span>
                        <span className="font-bold text-sm">{item.payee}</span>
                        <span className="text-xs text-muted-foreground">{item.narration}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* 统一类型切换：支出 / 收入 / 转账 */}
                        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                          {(
                            [
                              { id: "expense", label: "支出" },
                              { id: "income", label: "收入" },
                              { id: "transfer", label: "转账" },
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => handlePendingTypeChange(tab.id)}
                              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                                editState.type === tab.id
                                  ? "bg-background text-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        {(editState.type === "expense" || editState.type === "income") && (
                          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={editState.is_offset}
                              onChange={(e) =>
                                setPendingEdits((prev) => ({
                                  ...prev,
                                  [item.item_id]: {
                                    ...editState,
                                    is_offset: e.target.checked,
                                  },
                                }))
                              }
                              className="rounded border-input"
                            />
                            <span className={editState.is_offset ? "text-sky-400 font-semibold" : "text-muted-foreground"}>
                              {editState.type === "expense" ? "记为退款(抵扣支出)" : "记为退回(抵扣收入)"}
                            </span>
                          </label>
                        )}

                        <div className="text-base font-bold font-mono text-sky-400">
                          {formatCurrency(item.amount)}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-amber-400/90 bg-amber-500/10 rounded-md px-3 py-1.5">
                      提示：{item.reason}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-1">
                      <div className="space-y-1">
                        <Label>
                          {editState.type === "transfer"
                            ? "转出账户"
                            : editState.type === "income"
                            ? editState.is_offset
                              ? "扣款账户"
                              : "收款账户"
                            : editState.is_offset
                            ? "退回账户"
                            : "付款账户"}
                        </Label>
                        <Select
                          value={editState.account}
                          onChange={(e) =>
                            setPendingEdits((prev) => ({
                              ...prev,
                              [item.item_id]: { ...editState, account: e.target.value },
                            }))
                          }
                        >
                          {activeAccounts.map((a) => (
                            <option key={a.id} value={a.account}>
                              {formatAccOption(a)}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label>
                          {editState.type === "transfer"
                            ? "转入账户（含银行卡 / 信用卡 / 归还贷款）"
                            : editState.is_offset
                            ? "抵扣分类"
                            : "记账分类 / 资金去向"}
                        </Label>
                        <Select
                          value={editState.category}
                          onChange={(e) => handlePendingCategoryChange(e.target.value)}
                        >
                          {editState.type === "expense" && (
                            <optgroup label="支出分类">
                              {expenseCats.map((c) => (
                                <option key={c.id} value={c.account}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {editState.type === "income" && (
                            <optgroup label="收入分类">
                              {incomeCats.map((c) => (
                                <option key={c.id} value={c.account}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {activeDebts.length > 0 && (
                            <optgroup label="归还贷款 / 负债账户">
                              {activeDebts.map((d) => (
                                <option key={`debt_${d.id}`} value={d.account}>
                                  [归还贷款] {d.name} (待还 {formatCurrency(d.current_balance)})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="转入其他资金或信用卡账户">
                            {activeAccounts.map((a) => (
                              <option key={`acc_${a.id}`} value={a.account}>
                                [账户] {formatAccOption(a)}
                              </option>
                            ))}
                          </optgroup>
                        </Select>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResolvePending(item, "ignore")}
                        >
                          <X className="h-3.5 w-3.5" /> 忽略
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleResolvePending(item, "confirm")}
                        >
                          <Check className="h-3.5 w-3.5" /> 确认入账
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 2: 导入账单与批次管理 */}
      {activeSubTab === "import" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>📤 导入外部账单</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                支持微信支付、支付宝 CSV 账单及银行邮件 (.eml)，自动跳过重复记录
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>账单来源</Label>
                <Select
                  value={importSourceType}
                  onChange={(e) => setImportSourceType(e.target.value)}
                >
                  <option value="wechat_csv">微信支付账单 (.csv)</option>
                  <option value="alipay_csv">支付宝交易明细 (.csv)</option>
                  <option value="bank_email">银行账单邮件 (.eml)</option>
                  <option value="generic_csv">通用表格 (.csv)</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>默认关联账户</Label>
                <Select
                  value={importDefaultAcc}
                  onChange={(e) => setImportDefaultAcc(e.target.value)}
                >
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.account}>
                      {formatAccOption(a)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="pt-2">
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-6 hover:border-primary/60 cursor-pointer transition-colors bg-muted/20">
                  <Upload className="h-7 w-7 text-primary mb-2" />
                  <span className="text-xs font-semibold">
                    {uploadingImport ? "正在导入..." : "点击选择账单文件上传 (.csv / .eml)"}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-1">
                    已导入过的相同记录会自动跳过
                  </span>
                  <input
                    type="file"
                    accept=".csv,.eml"
                    onChange={handleFileUpload}
                    disabled={uploadingImport}
                    className="hidden"
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle>🗂️ 导入历史记录</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                如选错账户或导入有误，可按批次撤销已导入的账单
              </p>
            </CardHeader>
            <CardContent>
              {importBatches.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">暂无导入记录</div>
              ) : (
                <div className="space-y-2 max-h-[380px] overflow-y-auto">
                  {importBatches.map((b) => (
                    <div
                      key={b.batch_id}
                      className="flex items-center justify-between rounded-lg border p-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold">{b.filename}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          新增 {b.added_count} 笔 · 跳过重复 {b.duplicate_count} 笔 · 待确认 {b.pending_count} 笔 ·{" "}
                          {b.created_at?.slice(0, 19).replace("T", " ")}
                        </div>
                      </div>
                      {b.added_count > 0 && (
                        <Button
                          variant="outline"
                          size="xs"
                          className="text-rose-400"
                          onClick={() => handleRollbackBatch(b.batch_id)}
                        >
                          <RotateCcw className="h-3 w-3" /> 撤销该批导入
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 3: 记账分类管理 */}
      {activeSubTab === "categories" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {(["expense", "income"] as const).map((typeKey) => {
            const list = activeCategories.filter((c) => c.type === typeKey);
            return (
              <Card key={typeKey}>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle>{typeKey === "expense" ? "💸 支出分类" : "💰 收入分类"}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">共 {list.length} 个分类</p>
                  </div>
                  <Button size="sm" onClick={() => openAddCategory(typeKey)}>
                    <Plus className="h-4 w-4" /> 新增分类
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                    {list.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded-lg border bg-background/40 px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-sm">{c.name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{c.account}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="xs" onClick={() => openEditCategory(c)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-rose-400"
                            onClick={() => handleDeleteCategory(c)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tab 4: 邮箱与 AI 设置 */}
      {activeSubTab === "services" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* IMAP 邮箱配置 */}
            <Card>
              <CardHeader>
                <CardTitle>📬 邮箱自动同步 (IMAP)</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  连接邮箱自动拉取银行账单邮件，授权码加密保存在本地
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label>IMAP 服务器地址</Label>
                    <Input
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      placeholder="imap.qq.com 或 imap.163.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>SSL 端口</Label>
                    <Input
                      type="number"
                      value={imapPort}
                      onChange={(e) => setImapPort(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>邮箱账号</Label>
                  <Input
                    value={imapUser}
                    onChange={(e) => setImapUser(e.target.value)}
                    placeholder="your_email@qq.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label>
                    邮箱授权码 (状态:{" "}
                    <span className={mailCodeConfigured ? "text-emerald-400" : "text-amber-400"}>
                      {mailCodeConfigured ? "已配置" : "未配置"}
                    </span>
                    )
                  </Label>
                  <Input
                    type="password"
                    value={imapCode}
                    onChange={(e) => setImapCode(e.target.value)}
                    placeholder="留空则保持原授权码不变"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={onTriggerMailSync}>
                    立即同步邮件
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleTestMail}>
                    测试连接
                  </Button>
                  <Button size="sm" onClick={handleSaveMail}>
                    保存设置
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* AI 智能辅助设置 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>🤖 AI 辅助设置</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      用于推荐记账分类、辅助解析银行邮件与生成月度分析，各服务商配置独立保存
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {aiEnabled ? "已启用" : "已关闭"}
                    </span>
                    <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3.5">
                {/* 1. 三大服务商独立预设卡片切换 */}
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      {
                        key: "deepseek" as AIProviderKey,
                        title: "DeepSeek",
                        sub: "国内直连 · V3/R1",
                        badge: "推荐",
                      },
                      {
                        key: "gemini" as AIProviderKey,
                        title: "Google Gemini",
                        sub: "3.8 / 3.6 Flash",
                        badge: "官方/反代",
                      },
                      {
                        key: "openai" as AIProviderKey,
                        title: "OpenAI / 中转",
                        sub: "GPT / 硅基 / 千问",
                        badge: "通用协议",
                      },
                    ] as const
                  ).map((item) => {
                    const isSelected = aiProvider === item.key;
                    const keyConfigured = aiKeyStatus[item.key]?.configured;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setAiProvider(item.key);
                          setAiTestResult(null);
                        }}
                        className={`flex flex-col items-start justify-between rounded-xl border p-2.5 text-left transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
                            : "bg-background/50 hover:bg-accent/40 border-border"
                        }`}
                      >
                        <div className="w-full flex items-center justify-between gap-1">
                          <span className="font-bold text-xs">{item.title}</span>
                          <span
                            className={`h-2 w-2 rounded-full ${
                              keyConfigured ? "bg-emerald-400" : "bg-muted-foreground/40"
                            }`}
                            title={keyConfigured ? "已保存 API Key" : "尚未保存 API Key"}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 truncate w-full">
                          {item.sub}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 2. 接口地址 (Base URL) 与快捷填充 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>接口地址 (Base URL)</Label>
                    <div className="flex flex-wrap gap-1">
                      {aiProvider === "deepseek" && (
                        <button
                          type="button"
                          onClick={() => updateCurrentAiProfile("base_url", "https://api.deepseek.com")}
                          className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                        >
                          重置官方地址
                        </button>
                      )}
                      {aiProvider === "gemini" && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentAiProfile("base_url", "https://generativelanguage.googleapis.com")
                            }
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            Google官方
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentAiProfile(
                                "base_url",
                                "https://generativelanguage.googleapis.com/v1beta/openai"
                              )
                            }
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            OpenAI兼容端点
                          </button>
                        </>
                      )}
                      {aiProvider === "openai" && (
                        <>
                          <button
                            type="button"
                            onClick={() => updateCurrentAiProfile("base_url", "https://api.openai.com/v1")}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            OpenAI
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateCurrentAiProfile("base_url", "https://api.siliconflow.cn/v1");
                              updateCurrentAiProfile("model", "deepseek-ai/DeepSeek-V3");
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            硅基流动
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateCurrentAiProfile(
                                "base_url",
                                "https://dashscope.aliyuncs.com/compatible-mode/v1"
                              );
                              updateCurrentAiProfile("model", "qwen-plus");
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            通义千问
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateCurrentAiProfile("base_url", "https://api.moonshot.cn/v1");
                              updateCurrentAiProfile("model", "moonshot-v1-8k");
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            Kimi
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <Input
                    value={aiProfiles[aiProvider].base_url}
                    onChange={(e) => updateCurrentAiProfile("base_url", e.target.value)}
                    placeholder={
                      aiProvider === "deepseek"
                        ? "https://api.deepseek.com (自动兼容 /v1)"
                        : aiProvider === "gemini"
                        ? "https://generativelanguage.googleapis.com 或自建反代域名"
                        : "https://api.openai.com/v1 或中转站地址"
                    }
                  />
                </div>

                {/* 3. 模型名称 (Model Name) 与常用模型快捷标签 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>模型名称 (Model ID)</Label>
                    <div className="flex flex-wrap gap-1">
                      {aiProvider === "deepseek" &&
                        ["deepseek-chat", "deepseek-reasoner"].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => updateCurrentAiProfile("model", m)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                              aiProfiles.deepseek.model === m
                                ? "border-primary bg-primary/15 text-primary"
                                : "bg-muted/60 hover:bg-muted text-muted-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      {aiProvider === "gemini" &&
                        ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => updateCurrentAiProfile("model", m)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                              aiProfiles.gemini.model === m
                                ? "border-primary bg-primary/15 text-primary"
                                : "bg-muted/60 hover:bg-muted text-muted-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      {aiProvider === "openai" &&
                        ["gpt-4o-mini", "gpt-4o", "qwen-plus"].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => updateCurrentAiProfile("model", m)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                              aiProfiles.openai.model === m
                                ? "border-primary bg-primary/15 text-primary"
                                : "bg-muted/60 hover:bg-muted text-muted-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                    </div>
                  </div>
                  <Input
                    value={aiProfiles[aiProvider].model}
                    onChange={(e) => updateCurrentAiProfile("model", e.target.value)}
                    placeholder="可直接选择上方标签或手动输入任意模型名称"
                    className="font-mono text-xs"
                  />
                </div>

                {/* 4. 独立 API Key 凭据框 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>
                      {aiProvider.toUpperCase()} API Key (状态:{" "}
                      <span
                        className={
                          aiKeyStatus[aiProvider]?.configured ? "text-emerald-400" : "text-amber-400"
                        }
                      >
                        {aiKeyStatus[aiProvider]?.configured
                          ? `已配置 ${aiKeyStatus[aiProvider].masked}`
                          : "未配置"}
                      </span>
                      )
                    </Label>
                    <button
                      type="button"
                      onClick={() => setShowAiKey((v) => !v)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {showAiKey ? "🙈 隐藏明文" : "👁️ 显示明文"}
                    </button>
                  </div>
                  <Input
                    type={showAiKey ? "text" : "password"}
                    value={aiKeys[aiProvider]}
                    onChange={(e) =>
                      setAiKeys((prev) => ({
                        ...prev,
                        [aiProvider]: e.target.value,
                      }))
                    }
                    placeholder={
                      aiKeyStatus[aiProvider]?.configured
                        ? "已加密保存，留空则保持原 Key 不变（也可直接点下方测试连接）"
                        : `粘贴 ${aiProvider.toUpperCase()} API Key (本地加密存储)`
                    }
                  />
                </div>

                {/* 5. 可选本地代理 (Proxy) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-muted-foreground">
                      本地网络代理 HTTP Proxy (可选，国内直连 Gemini/OpenAI 官方时填写)
                    </Label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateCurrentAiProfile("proxy", "http://127.0.0.1:7890")}
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                      >
                        Clash(7890)
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCurrentAiProfile("proxy", "http://127.0.0.1:10809")}
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-muted-foreground"
                      >
                        v2rayN(10809)
                      </button>
                      {aiProfiles[aiProvider].proxy && (
                        <button
                          type="button"
                          onClick={() => updateCurrentAiProfile("proxy", "")}
                          className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/60 hover:bg-muted text-rose-400"
                        >
                          清空(直连)
                        </button>
                      )}
                    </div>
                  </div>
                  <Input
                    value={aiProfiles[aiProvider].proxy}
                    onChange={(e) => updateCurrentAiProfile("proxy", e.target.value)}
                    placeholder="国内直连 DeepSeek 或国内中转站请留空；访问 Google 官方可填 http://127.0.0.1:7890"
                    className="font-mono text-xs"
                  />
                </div>

                {/* 6. 实时连通性测试结果面板 */}
                {aiTestResult && (
                  <div
                    className={`rounded-xl border p-3 text-xs leading-relaxed ${
                      aiTestResult.success
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    }`}
                  >
                    <div className="font-semibold">
                      {aiTestResult.success ? "✓ 连接测试通过" : "✗ 连接测试未通过"}
                    </div>
                    <div className="mt-1 break-all opacity-90">{aiTestResult.message}</div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestAI}
                    disabled={aiTesting}
                  >
                    {aiTesting ? "正在连接测试..." : "⚡ 测试当前连接"}
                  </Button>
                  <Button size="sm" onClick={handleSaveAI}>
                    💾 保存 AI 设置
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 🧪 银行邮件解析测试器 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-primary" />
                    🧪 银行邮件解析测试
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    粘贴银行账单邮件正文或 HTML 源码，预览识别结果（仅作测试，不会写入账本）
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="xs" onClick={() => fillDemoSample("ccb")}>
                    示例: 建行消费
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => fillDemoSample("icbc")}>
                    示例: 工行支出
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => fillDemoSample("boc_refund")}>
                    示例: 中行退款
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => fillDemoSample("spdb_html")}>
                    示例: 浦发HTML账单
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <div className="flex flex-wrap gap-1.5">
                {FOURTEEN_BANKS.map((b) => (
                  <Badge key={b} variant="secondary" className="text-[11px]">
                    {b}
                  </Badge>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>邮件标题 (可选)</Label>
                  <Input
                    value={sampleSubject}
                    onChange={(e) => setSampleSubject(e.target.value)}
                    placeholder="例如: 中国建设银行龙卡信用卡消费提醒"
                  />
                </div>
                <div className="space-y-1">
                  <Label>发件人 (可选)</Label>
                  <Input
                    value={sampleSender}
                    onChange={(e) => setSampleSender(e.target.value)}
                    placeholder="例如: service@vip.ccb.com"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>粘贴邮件正文或 HTML 源码</Label>
                <Textarea
                  rows={3}
                  value={sampleBody}
                  onChange={(e) => setSampleBody(e.target.value)}
                  placeholder="在此粘贴银行邮件正文，例如：您尾号8821的龙卡信用卡于09月16日14:20在【山姆会员商店】消费人民币628.50元..."
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  💡 遇到特殊版式邮件时，若已配置 AI 服务会自动辅助识别。
                </span>
                <Button size="sm" onClick={handleRunSampleParse} disabled={sampleLoading}>
                  ⚡ {sampleLoading ? "正在解析..." : "测试解析"}
                </Button>
              </div>

              {sampleResult && (
                <div className="rounded-xl border bg-muted/30 p-4 text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-semibold ${
                        sampleResult.success ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {sampleResult.success ? "✓ " : "⚠ "}
                      {sampleResult.message}
                    </span>
                    <Badge variant="outline">解析方式: {sampleResult.engine}</Badge>
                  </div>

                  {Array.isArray(sampleResult.records) && sampleResult.records.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="py-1.5 px-2">交易时间</th>
                            <th className="py-1.5 px-2">识别银行/尾号</th>
                            <th className="py-1.5 px-2">类型</th>
                            <th className="py-1.5 px-2">商户/对手</th>
                            <th className="py-1.5 px-2">摘要</th>
                            <th className="py-1.5 px-2 text-right">提取金额</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {sampleResult.records.map((r: any, i: number) => (
                            <tr key={i}>
                              <td className="py-2 px-2 font-mono">
                                {r.date} {r.time_str}
                              </td>
                              <td className="py-2 px-2">{r.channel}</td>
                              <td className="py-2 px-2">
                                {r.is_refund ? (
                                  <Badge variant="info">退款 (抵扣支出)</Badge>
                                ) : r.is_repayment ? (
                                  <Badge variant="warning">转账 / 还款</Badge>
                                ) : r.direction === "收入" ? (
                                  <Badge variant="success">收入</Badge>
                                ) : (
                                  <Badge variant="destructive">支出</Badge>
                                )}
                              </td>
                              <td className="py-2 px-2 font-semibold">{r.payee}</td>
                              <td className="py-2 px-2 text-muted-foreground">{r.narration}</td>
                              <td className="py-2 px-2 text-right font-mono font-bold">
                                {formatCurrency(r.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 5: 账本导出 (.bean / .csv) 与备份恢复 (.zip) */}
      {activeSubTab === "backup" && (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>🔐 账本导出与备份还原</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              支持导出 Beancount (.bean) 账本、Excel 表格 (.csv) 或完整数据备份包 (.zip)
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`rounded-xl border p-3.5 text-xs font-medium ${
                ledgerValid
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {ledgerValid
                ? "✓ 账本状态正常：借贷平衡无误"
                : `⚠ 账本存在校验告警: ${validationErrors.join("; ")}`}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border bg-background/50 p-4">
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-primary" />
                    导出 Beancount 账本文件 (.bean)
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    合并全部账户、债务与交易记录，兼容 Fava 与 Beancount 工具
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.exportBeanFile();
                      toast.success("Beancount (.bean) 账本已成功导出！");
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                >
                  📄 导出 .bean 账本
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-xl border bg-background/50 p-4">
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                    导出 Excel 账单明细表 (.csv)
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    可直接用 Excel 打开查看或做表格统计
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.exportCsvFile();
                      toast.success("Excel (.csv) 账单表已成功导出！");
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                >
                  📊 导出 .csv 表格
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-xl border bg-background/50 p-4">
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    <Download className="h-4 w-4 text-sky-400" />
                    导出完整备份包 (.zip)
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    打包全部账本文件与账户设置，方便迁移或备份
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.exportBackup();
                      toast.success("完整备份包 (.zip) 已成功导出！");
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                >
                  ⬇️ 导出完整备份包
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-xl border bg-background/50 p-4">
                <div>
                  <div className="font-semibold text-sm">从备份包还原数据 (.zip)</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    上传历史 .zip 备份包还原账本数据（还原前会自动备份当前数据）
                  </div>
                </div>
                <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent">
                  ⬆️ 上传并还原
                  <input
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (!window.confirm(`确定要从备份包 ${f.name} 还原账本吗？`)) {
                        e.target.value = "";
                        return;
                      }
                      try {
                        const res = await api.importBackup(f);
                        toast.success(res.message || "账本还原成功！");
                        onRefresh();
                      } catch (err: any) {
                        toast.error(`还原失败: ${err.message}`);
                      } finally {
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 6: 对账校准 */}
      {activeSubTab === "recon" && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>⚖️ 账户余额核对与校准</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              当账面余额与银行卡实际余额不一致时，可在此核对差额并自动补齐差额记录
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>选择要核对的账户</Label>
              <Select value={reconAcc} onChange={(e) => setReconAcc(e.target.value)}>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.account}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>核对日期</Label>
                <Input type="date" value={reconDate} onChange={(e) => setReconDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>账户实际余额 (¥)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={reconActual}
                  onChange={(e) => setReconActual(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleCheckRecon}>计算差额</Button>
            </div>

            {reconResult && (
              <div className="rounded-xl border bg-muted/30 p-4 text-xs space-y-3">
                <div>
                  账面余额: <b className="font-mono">{formatCurrency(reconResult.book_balance)}</b> · 实际余额:{" "}
                  <b className="font-mono">{formatCurrency(reconActual)}</b> · 差额:{" "}
                  <b className="font-mono text-amber-400">{formatCurrency(reconResult.difference)}</b>
                </div>
                {Number(reconResult.difference) === 0 ? (
                  <div className="text-emerald-400 font-semibold">✓ 账面余额与实际余额一致，无需调整！</div>
                ) : (
                  <Button size="sm" onClick={handleApplyRecon}>
                    自动补齐差额
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 新增/编辑分类弹窗 */}
      <DialogModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        title={editingCat ? "编辑记账分类" : "新增记账分类"}
      >
        <form onSubmit={handleSaveCategory} className="space-y-4">
          <div className="space-y-1.5">
            <Label>分类名称</Label>
            <Input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="例如: 宠物医疗 / 咖啡茶饮"
              required
            />
          </div>
          {!editingCat && (
            <>
              <div className="space-y-1.5">
                <Label>收支类型</Label>
                <Select value={catType} onChange={(e) => setCatType(e.target.value as any)}>
                  <option value="expense">支出分类 (Expenses)</option>
                  <option value="income">收入分类 (Income)</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Beancount 科目路径 (英文冒号分隔)</Label>
                <Input
                  value={catAccount}
                  onChange={(e) => setCatAccount(e.target.value)}
                  placeholder="例如: Expenses:Pet:Medical"
                  required
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={() => setCatModalOpen(false)}>
              取消
            </Button>
            <Button type="submit">保存分类</Button>
          </div>
        </form>
      </DialogModal>
    </div>
  );
};
