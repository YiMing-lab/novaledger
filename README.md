# 星芒账本 · NovaLedger (Community Edition)

基于 **Beancount 复式记账核心** 与 **SQLite 双轨元数据引擎** 的个人财务桌面客户端，采用 **Google Material Design 3** 视觉规范，支持原生桌面窗口（WebView2）与浏览器双模式运行。

---

## 一、核心特性与架构亮点

1. **Beancount + SQLite 双轨协同架构**：
   - **Beancount 纯文本账本**：作为正式记账与借贷平衡的唯一真相源（Single Source of Truth）；
   - **SQLite 元数据索引库**：管理导入批次、原始交易指纹、待确认存疑队列、证据链关联与操作回滚日志。
2. **高可靠财务底座**：
   - **单写者原子提交**：候选账本在独立沙箱中加载并校验 0 错误后，通过操作系统原子重命名（`os.replace`）提交，杜绝非法输入破坏现有账本；
   - **同日多次真实消费精准区分**：通过内部稳定 ID（`nl_tx_...`）与 Beancount metadata 记录，支持同日同商户等额交易无损入账；
   - **截止日财务核算**：资产负债表、净资产与储蓄率严格以指定月末截止日统计，未来月份交易不渗透；
   - **全场景账务引擎**：支持日常收支、内部转账、信用卡/贷款核销还款、退款冲减、分拆记账、月末余额断言对账及二级分类树自定义管理。
3. **多源账单导入与自动化同步**：
   - **四态导入管道**：支持微信支付 CSV、支付宝 CSV、通用 CSV 自定义列映射与 EML 邮件凭单导入，自动识别「新增、已匹配/重复、待确认、失败」四态并支持按批次一键撤销；
   - **IMAP 邮件后台同步**：支持 `UIDVALIDITY` 游标检查点、分页补拉与断网自愈。
4. **隐私隔离与本地安全**：
   - **代码与私有数据彻底物理隔离**：所有账本、数据库、备份及凭据均保存在本地 `data/` 目录（已被 `.gitignore` 严格忽略）；
   - **Windows DPAPI 凭据加密**：API Key 与邮箱授权码采用系统级加密存储，接口层仅回传掩码；
   - **零外部 CDN 依赖**：前端所有静态资源随包内置，支持纯离线环境使用。

---

## 二、快速开始

### 1. 环境准备

要求 Python 3.10+，安装项目依赖：

```bash
pip install -r requirements.txt
```

### 2. 启动程序

- **Windows 快捷启动**：
  - 双击 `星芒账本.bat`：以 **原生桌面窗口模式** 启动；
  - 双击 `星芒账本(浏览器模式).bat`：启动本地服务并在系统默认浏览器中打开。
- **命令行启动**：
  ```bash
  # 默认启动（优先原生桌面窗口，若无 WebView2 环境自动回退浏览器）
  python run.py

  # 指定浏览器模式启动
  python run.py --mode browser

  # 指定无头服务模式启动
  python run.py --mode headless --port 8088

  # 校验本地账本借贷平衡
  python run.py validate
  ```

---

## 三、目录结构

```text
novaledger/
├── run.py                     # 统一启动入口（支持 desktop / browser / headless 模式与账本校验）
├── desktop.py                 # 基于 Edge WebView2 (pywebview) 的原生桌面窗口启动器
├── 星芒账本.bat               # Windows 桌面模式快捷启动脚本
├── 星芒账本(浏览器模式).bat    # Windows 浏览器模式快捷启动脚本
├── requirements.txt           # Python 依赖清单
└── novaledger_free/           # 核心源码包
    ├── core/                  # 可信账本底层 (配置、安全凭据、模型、SQLite元数据、原子账本管理器、操作日志)
    ├── accounting/            # 业务账务引擎 (账户管理、分类树、债务管理、收支/内转/还款/退款/拆分、对账)
    ├── parsers/               # 账单格式解析 (微信CSV、支付宝CSV、通用CSV自定义列、EML邮件凭单)
    ├── deduplication/         # 四态导入管道与批次一键撤销引擎
    ├── mail_sync/             # IMAP 邮件同步客户端与后台定时调度器
    ├── ai/                    # 可选 AI 适配层 (Gemini 智能分类、财务诊断、XSS清洗与离线降级)
    ├── migration/             # 旧版账本平滑迁移、全量备份与沙箱恢复
    ├── web/                   # FastAPI 本地网关与 Material Design 3 纯本地前端静态资源
    ├── packaging/             # 独立 EXE 构建脚本 (build_exe.py) 与纯净便携包打包工具 (package_zip.py)
    └── tests/                 # 自动化单元测试与回归测试套件 (M0 ~ M8)
```

---

## 四、运行测试与打包分发

### 1. 运行自动化测试套件

```bash
python -m unittest discover -s novaledger_free/tests -p "test_*.py"
```

### 2. 构建独立 EXE 与便携分发包

```bash
# 编译单文件可执行程序
python novaledger_free/packaging/build_exe.py

# 制作零个人数据的纯净免安装 ZIP 分发包
python novaledger_free/packaging/package_zip.py
```
