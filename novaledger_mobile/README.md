# 星芒账本 · NovaLedger 移动端 (Android App)

基于 **Flutter + 本地 SQLite 复式记账引擎 + Beancount 纯文本导出生态** 构建的独立安卓手机端记账客户端。

---

## 一、架构特性与亮点

1. **秒级冷启动与零服务器依赖**：
   - 采用纯本地 SQLite 作为运行时的唯一真相源，启动时间 < 300ms，无需拉起 Python 虚拟机，告别白屏等待；
   - 彻底单机离线运行，所有个人财务隐私数据均保存在安卓设备私有沙箱内。
2. **严格复式记账平衡保证**：
   - 实时校验每笔分录的借贷平衡（`sum(postings.amount) == 0`）；
   - 支持日常收支、内部转账、退款红字冲减、贷款债务追踪与多笔分拆。
3. **Beancount 纯文本生态无缝导出**：
   - 内置纯 Dart 高性能 Beancount 语法生成器；
   - 在设置中点击「导出 Beancount 纯文本账本」，一键生成 `.bean` 文件并调起安卓系统原生分享面板（直接发送至微信传输助手、QQ 或另存为本地文件）。
4. **电脑端全量数据无损平滑迁移**：
   - 支持直接读取电脑端生成的 `NovaLedger_Mobile_Migration.nlmobile` 或 `.json` 迁移包；
   - 自动导入全量账户、贷款债务、二级分类树与全部历史交易，借贷差额精确对齐至 0。
5. **Google Material Design 3 移动端极速录入体验**：
   - 定制极速数字记账键盘（支持加减法计算与即时确认）；
   - 支持微信/支付宝 CSV 账单解析导入；
   - 接入 Google Gemini AI 智能分类建议。

---

## 二、从电脑端无缝迁移数据到手机

### 步骤 1：在电脑端导出迁移包
1. 启动电脑端星芒账本，进入 **「设置与维护」 -> 「账本与备份」**；
2. 点击 **「📱 导出安卓手机端专属迁移包 (.nlmobile)」** 按钮；
   *(或在电脑端命令行执行 `python -m novaledger_free.migration.export_mobile`)*；
3. 将下载得到的 `NovaLedger_Mobile_Migration_xxxx.nlmobile` 发送到手机（通过微信文件传输助手、QQ、网盘或数据线）。

### 步骤 2：在手机端一键导入
1. 在手机上打开「星芒账本」App；
2. 切换到底部 **「设置」** Tab；
3. 点击 **「从电脑端导入数据 (.nlmobile / .json)」**；
4. 选择刚才接收到的迁移包文件，系统将在 1 秒内完成全量数据还原与校验！

---

## 三、编译与打包 APK 指引

### 1. 环境准备
- 确保已安装 [Flutter SDK](https://flutter.dev/docs/get-started/install) (>= 3.2.0) 与 [Android SDK / Android Studio]；
- 检查运行环境：
  ```bash
  flutter doctor
  ```

### 2. 获取依赖与构建 Release APK
在 `novaledger_mobile/` 目录下执行：

```bash
# 获取依赖
flutter pub get

# 构建通用 APK
flutter build apk --release

# 或构建更小体积的按 CPU 架构分包 APK (推荐 arm64-v8a，体积仅 ~15MB)
flutter build apk --split-per-abi
```

构建成功后，生成的 APK 位于：
`build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`
复制到安卓手机即可直接点击安装！

---

## 四、代码目录结构

```text
novaledger_mobile/
├── pubspec.yaml                 # Flutter 依赖清单
├── README.md                    # 本文档
├── android/                     # 安卓原生配置与清单文件 (AndroidManifest.xml)
└── lib/
    ├── main.dart                # 应用统一入口
    ├── core/                    # 核心业务底座
    │   ├── models/              # 数据模型 (Account, Category, Debt, TransactionItem, Posting)
    │   ├── database/            # 本地 SQLite 驱动 (DatabaseHelper)
    │   ├── accounting/          # 复式记账引擎 (AccountingService)
    │   ├── migration/           # 电脑端全量数据导入器 (MigrationImporter)
    │   ├── export/              # Beancount 语法导出与系统分享器 (BeancountSerializer)
    │   ├── parsers/             # 微信/支付宝 CSV 账单解析器 (CsvBillParser)
    │   └── ai/                  # Gemini AI 智能分类服务 (GeminiService)
    └── ui/                      # Material Design 3 界面层
        ├── theme/               # MD3 配色与主题配置 (AppTheme)
        ├── widgets/             # 定制极速数字键盘、统计卡片、分类选择抽屉
        └── screens/             # 页面 (概览、明细、统计图表、资产债务、设置、极速记账)
```
