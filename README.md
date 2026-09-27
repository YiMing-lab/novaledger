# ✨ 星芒账本 · NovaLedger v2.0

**本地优先 (Local-First) 的中文个人复式记账桌面软件**  
底层采用标准 **Beancount** 纯文本复式记账引擎，前端基于 **React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui** 构建，桌面端通过 **Tauri 2 (Rust + WebView2)** 原生封装。

---

## 🌟 核心亮点

- **零门槛使用 + 专业 Beancount 内核**
  - 界面统一为直观的 **「支出 / 收入 / 转账」** 三大操作（内部卡互转、信用卡还款、归还贷款统一在「转账」中完成）。
  - 支持 **「记为退款（抵扣支出）」**，退款直接冲减原支出分类，不虚增收入。
  - 所有账单落盘为标准 `.bean` 纯文本复式分录，并在侧边栏实时预览与编辑 Beancount 分录。
- **支持国内 14 家主流银行邮件账单同步 + 微信/支付宝导入**
  - 内置工商、农业、中国、建设、交通、邮储、招商、中信、浦发、广发、平安、兴业、民生、光大 14 家银行动账邮件与电子账单解析规则。
  - 支持微信支付、支付宝账单 CSV/XLSX 导入与多维指纹自动去重。
- **灵活的 AI 辅助识别与月度分析（可选）**
  - 原生适配 **DeepSeek**、**Google Gemini**、**OpenAI 兼容接口（硅基流动 / 通义千问 / Ollama 等）**。
  - 支持自定义 API 地址、模型名称、本地代理（Clash / v2rayN）与一键连接测试。
- **完整的数据主权与开放导出**
  - 所有账本数据与 API 密钥均加密保存在本地 `data/` 目录，无需注册账号，绝不上传云端。
  - 支持一键导出单文件 **Beancount (`.bean`)** 账本、Excel 兼容 **(`.csv`)** 账单表及完整备份包 **(`.zip`)**。

---

## 🏗️ 项目结构

```text
NovaLedger/
├── frontend/                  # React 18 + TypeScript + Vite + Tailwind CSS 前端工程
│   ├── src/
│   │   ├── api/               # REST API 客户端与数据归一化层
│   │   ├── components/        # 基础 UI 组件与快速记账/命令面板弹窗
│   │   ├── views/             # 四大主视图 (账单明细、账户与负债、统计分析、设置与工具)
│   │   └── App.tsx            # 桌面端主框架 (侧边栏导航、主题切换、全局快捷键)
├── src-tauri/                 # Tauri 2 (Rust) 桌面端宿主工程
│   ├── src/main.rs            # 自动管理 Python Sidecar 生命周期与端口探活
│   ├── icons/                 # 四芒星应用图标资源
│   └── tauri.conf.json        # Tauri 2 窗口与打包配置
├── novaledger_free/           # Python 核心记账后端 (FastAPI + Beancount + SQLite)
│   ├── accounting/            # 账户、分类、个人债务、交易分录与余额对账
│   ├── core/                  # Beancount 账本管理、SQLite 数据库与本地加密存储
│   ├── parsers/               # 微信/支付宝 CSV 及 14 家银行邮件解析器
│   ├── ai/                    # DeepSeek / Gemini / OpenAI 兼容 AI 服务
│   └── web/                   # FastAPI 路由层
├── tests/                     # 自动化单元测试套件
├── run.py                     # 本地开发启动入口
└── sidecar_entry.py           # 桌面端 Sidecar 启动入口
```

---

## 🚀 快速开始

### 方式一：直接运行安装包 / 便携版（普通用户推荐）
前往 GitHub **Releases** 页面下载：
- **单文件安装版**：运行 `NovaLedger_2.0.0_x64-setup.exe` 即可一键安装。
- **绿色便携版**：解压后双击 `NovaLedger.exe` 即可使用，所有数据保存在同级 `data/` 文件夹下。

### 方式二：从源码运行（开发者）

#### 1. 启动后端与 Web 端开发服务
```bash
# 安装 Python 依赖
pip install -r requirements.txt

# 编译前端静态资源
cd frontend
npm install
npm run build
cd ..

# 启动本地服务 (默认 http://127.0.0.1:8088)
python run.py
```

#### 2. 打包 Tauri 2 桌面客户端
```bash
# 1. 使用 PyInstaller 打包 Python 引擎 Sidecar
pyinstaller novaledger-engine.spec --noconfirm
cp dist/novaledger-engine.exe src-tauri/binaries/novaledger-engine-x86_64-pc-windows-gnu.exe

# 2. 编译 Tauri 桌面安装包
cd frontend
npx tauri build
```

---

## ⌨️ 常用快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `N` | 随时呼出「记一笔」弹窗 |
| `Ctrl + K` | 呼出全局搜索与快捷导航面板 |
| `ESC` | 关闭当前弹窗或右侧编辑抽屉 |

---

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源。
