# 星芒账本 · 社区免费版 (NovaLedger Community Edition v1.0)

基于 Beancount 复式记账核心与 SQLite 双轨元数据引擎的个人财务桌面客户端。

---

## 一、系统架构与设计原则

1. **Beancount + SQLite 双轨协同**：
   - **Beancount 纯文本账本**：作为官方正式记账与借贷平衡的唯一真相源；
   - **SQLite 元数据索引库**：管理导入批次、原始交易指纹、待确认存疑队列、证据链关联与操作回滚日志。
2. **彻底解决历史缺陷**：
   - **同日多次真实消费**：通过内部稳定 ID（`nl_tx_...`）与 Beancount metadata 记录，支持同日同商户等额交易无损入账；
   - **单写者原子提交**：候选账本在独立沙箱中加载并校验 0 错误后，通过操作系统原子重命名（`os.replace`）提交，非法输入不破坏现有账本；
   - **截止日财务核算**：资产负债表与储蓄率严格以指定月末截止日统计，未来月份交易绝不渗透；
   - **凭据 Windows 安全保护**：API Key 与邮箱授权码采用 DPAPI 加密存储，对外接口只提供掩码，杜绝明文回传。
3. **零外部 CDN 依赖**：
   - 前端采用 Google Material 3 极简设计规范，所有静态资源随包内置，彻底离线可用。

---

## 二、目录结构

```text
novaledger_free/
├── core/                  # 可信账本底层 (配置注入、安全凭据、模型、SQLite元数据、原子账本管理器、操作回滚)
├── accounting/            # 业务账务引擎 (账户管理、全场景收支/内转/还款核销/退款冲减/拆分、月末对账)
├── parsers/               # 账单格式解析 (微信CSV、支付宝CSV、通用CSV自定义列、EML邮件凭单)
├── deduplication/         # 四态导入管道 (新增、已匹配/重复、待确认、失败) 与批次一键撤销
├── mail_sync/             # IMAP 后台自动化同步 (UIDVALIDITY 游标检查点、分页补拉、断网自愈)
├── ai/                    # 可选 AI 适配层 (Gemini、XSS安全清洗、科目白名单、离线优雅降级)
├── migration/             # 旧版账本无损平滑迁移、全量加密备份与沙箱校验灾难恢复
├── web/                   # FastAPI 本地服务、安全网关、纯本地 Material 3 界面
├── packaging/             # 独立可执行程序构建 (PyInstaller) 与零个人数据纯净便携 ZIP 打包
├── tests/                 # 自动化测试套件 (覆盖 M0 至 M6 全部阶段)
└── run.py                 # 主程序启动入口与 CLI 工具
```

---

## 三、开发与测试运行

### 1. 运行全量测试套件
```bash
# M0 & M1 基线回归测试 (覆盖审查报告复现的 7 大缺陷)
python -m unittest novaledger_free.tests.test_m0_m1_baseline

# M2 完整复式记账业务流与对账测试
python -m unittest novaledger_free.tests.test_m2_accounting

# M3 四态导入去重与批次撤销测试
python -m unittest novaledger_free.tests.test_m3_import_dedup

# M4 邮件检查点与后台调度测试
python -m unittest novaledger_free.tests.test_m4_mail_sync

# M5 XSS防御、离线降级与API安全测试
python -m unittest novaledger_free.tests.test_m5_ai_security

# M6 旧版迁移、全量备份与沙箱恢复测试
python -m unittest novaledger_free.tests.test_m6_backup_migr
```

### 2. 启动本地开发服务
```bash
python novaledger_free/run.py
```

### 3. 构建独立程序与便携分发包
```bash
# 编译独立 EXE
python novaledger_free/packaging/build_exe.py

# 制作纯净免安装 ZIP 分发包
python novaledger_free/packaging/package_zip.py
```
