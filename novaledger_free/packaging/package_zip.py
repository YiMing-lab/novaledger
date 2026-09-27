# -*- coding: utf-8 -*-
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

root_dir = Path(__file__).resolve().parent.parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from novaledger_free.accounting.categories import DEFAULT_CATEGORIES
from novaledger_free.core.config import DEFAULT_ACCOUNTS, DEFAULT_SYSTEM_CONFIG


def create_clean_data(data_dir: Path):
    """创建纯净初始化的数据模板，杜绝任何个人隐私泄露"""
    if data_dir.exists():
        shutil.rmtree(data_dir, ignore_errors=True)

    ledger_dir = data_dir / "ledger"
    sqlite_dir = data_dir / "sqlite"
    backups_dir = data_dir / "backups"
    imports_dir = data_dir / "imports"
    logs_dir = data_dir / "logs"

    for d in (ledger_dir, sqlite_dir, backups_dir, imports_dir, logs_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 1. 账本主文件
    (ledger_dir / "main.bean").write_text(
        '; -*- mode: beancount -*-\n'
        'option "title" "星芒账本 · NovaLedger"\n'
        'option "operating_currency" "CNY"\n\n'
        'include "accounts.bean"\n'
        'include "debts.bean"\n'
        'include "transactions.bean"\n',
        encoding="utf-8"
    )

    # 2. 基础科目定义
    initial_accounts = (
        '; -*- mode: beancount -*-\n'
        '2020-01-01 open Assets:Cash:Wallet CNY\n'
        '2020-01-01 open Assets:Bank:Default:Card001 CNY\n'
        '2020-01-01 open Assets:EWallet:WeChat CNY\n'
        '2020-01-01 open Assets:EWallet:Alipay CNY\n'
        '2020-01-01 open Liabilities:CreditCard:Default:Card001 CNY\n'
        '2020-01-01 open Income:Salary CNY\n'
        '2020-01-01 open Income:Investment CNY\n'
        '2020-01-01 open Income:Other CNY\n'
        '2020-01-01 open Expenses:Food:Dining CNY\n'
        '2020-01-01 open Expenses:Food:Groceries CNY\n'
        '2020-01-01 open Expenses:Food:Snacks CNY\n'
        '2020-01-01 open Expenses:Housing:Rent CNY\n'
        '2020-01-01 open Expenses:Housing:Utilities CNY\n'
        '2020-01-01 open Expenses:Transport:Transit CNY\n'
        '2020-01-01 open Expenses:Shopping:Daily CNY\n'
        '2020-01-01 open Expenses:Shopping:Electronics CNY\n'
        '2020-01-01 open Expenses:Entertainment:General CNY\n'
        '2020-01-01 open Expenses:Health:Medical CNY\n'
        '2020-01-01 open Expenses:Financial:Interest CNY\n'
        '2020-01-01 open Expenses:Other:General CNY\n'
        '2020-01-01 open Equity:Opening-Balances CNY\n'
    )
    (ledger_dir / "accounts.bean").write_text(initial_accounts, encoding="utf-8")

    # 3. 空白债务与流水文件
    (ledger_dir / "debts.bean").write_text('; -*- mode: beancount -*-\n', encoding="utf-8")
    (ledger_dir / "transactions.bean").write_text('; -*- mode: beancount -*-\n', encoding="utf-8")

    # 4. 纯净默认配置文件
    clean_config = {
        "system": dict(DEFAULT_SYSTEM_CONFIG),
        "accounts": [dict(acc) for acc in DEFAULT_ACCOUNTS],
        "categories": [dict(cat) for cat in DEFAULT_CATEGORIES],
    }
    (data_dir / "config.json").write_text(
        json.dumps(clean_config, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # 保持空目录结构
    for d in (backups_dir, imports_dir, logs_dir, sqlite_dir):
        (d / ".gitkeep").write_text("", encoding="utf-8")


def package():
    free_dir = Path(__file__).resolve().parent.parent
    dist_dir = free_dir / "dist"
    exe_file = dist_dir / "NovaLedger.exe"

    if not exe_file.exists():
        print(f"[!] 找不到构建文件: {exe_file}，请先执行 build_exe.py")
        sys.exit(1)

    release_folder_name = "NovaLedger-v1.0-便携版"
    release_dir = dist_dir / release_folder_name
    if release_dir.exists():
        shutil.rmtree(release_dir, ignore_errors=True)
    release_dir.mkdir(parents=True, exist_ok=True)

    print("==================================================")
    print("  开始打包制作 NovaLedger 纯净分发包...")
    print("==================================================")

    # 1. 复制独立单一主程序 EXE
    print("[1/5] 复制主程序 NovaLedger.exe...")
    shutil.copy2(exe_file, release_dir / "NovaLedger.exe")

    # 2. 生成标准化一键启动批处理脚本
    print("[2/5] 生成启动脚本 启动星芒账本.bat...")
    bat_content = (
        "@echo off\r\n"
        "chcp 65001 >nul\r\n"
        "title 星芒账本 · NovaLedger\r\n"
        "echo =========================================================\r\n"
        "echo       正在启动 星芒账本 · NovaLedger...\r\n"
        "echo =========================================================\r\n"
        "\r\n"
        "if exist \"%~dp0NovaLedger.exe\" (\r\n"
        "    start \"\" \"%~dp0NovaLedger.exe\"\r\n"
        "    exit /b 0\r\n"
        ") else (\r\n"
        "    echo [错误] 未在当前目录下找到 NovaLedger.exe！\r\n"
        "    pause\r\n"
        ")\r\n"
    )
    (release_dir / "启动星芒账本.bat").write_text(bat_content, encoding="utf-8")

    # 3. 生成详尽新手与分发使用说明
    print("[3/5] 生成使用指南 快速上手与使用指南.txt...")
    readme_content = (
        "========================================================================\r\n"
        "      ✧ 星芒账本 · NovaLedger (社区便携版 v1.0.0)\r\n"
        "========================================================================\r\n\r\n"
        "【软件简介】\r\n"
        "星芒账本 (NovaLedger) 是一款面向个人与家庭的专业复式记账桌面软件。\r\n"
        "底层依托严谨的 Beancount 开源复式记账引擎，提供现代化的 Web 控制台界面。\r\n"
        "无需配置 Python 环境，零依赖、解压即用、纯本地离线运行，100% 保护财务隐私。\r\n\r\n"
        "【快速上手】\r\n"
        "1. 启动方式：\r\n"
        "   - 直接双击运行 'NovaLedger.exe'，或双击 '启动星芒账本.bat'；\r\n"
        "   - 程序启动后将自动寻找可用端口（默认 8088）并在默认浏览器中唤起控制台；\r\n"
        "   - 如需在局域网其他设备访问，请在控制台或启动参数中指定 host/port。\r\n\r\n"
        "2. 基础流程推荐：\r\n"
        "   - 「我的账户」：预设现金、默认银行卡、微信零钱、支付宝。可点击编辑重命名为您真实的账户名；\r\n"
        "   - 「分类管理」：预置常用 20+ 收支分类，可自由新增、修改图标或归档；\r\n"
        "   - 「账单导入」：支持微信/支付宝账单 CSV 与银行账单，一键导入并智能分类；\r\n"
        "   - 「日常账单」：全要素修改账单（账户、分类、金额、商户、备注），支持记忆商户分类规则；\r\n"
        "   - 「支出统计」：日/周/月柱状图切换、分类支出排行、单笔大额监控、渠道分布；\r\n"
        "   - 「财务分析」：多维趋势图（资产/负债/分类走势折线面积图），支持配置 Gemini 3.8 Flash AI 智能分析；\r\n"
        "   - 「邮件同步」：支持配置各大邮箱（QQ/网易/Gmail等）IMAP 授权码自动拉取银行对账单；\r\n"
        "   - 「月末对账」：按月核对账实差额，轻松实现平账。\r\n\r\n"
        "【数据安全与备份】\r\n"
        "1. 数据全本地存储：所有账本（.bean）、元数据库（.db）与配置文件均保存在程序同级目录的 data/ 文件夹中；\r\n"
        "2. 绿色便携换机：只需将整个软件目录（或仅 data/ 文件夹）复制到新电脑，即可无缝迁移所有数据；\r\n"
        "3. 安全备份导出：在系统设置中支持「一键导出 Zip 备份」及历史快照还原；\r\n"
        "4. 绝不上云：默认关闭外部网络请求，在完全断网环境下所有复式记账与统计功能均 100% 完整可用。\r\n\r\n"
        "【常见问题排查】\r\n"
        "1. 浏览器未自动打开？\r\n"
        "   - 可在浏览器中手动输入地址：http://127.0.0.1:8088 打开。\r\n"
        "2. 端口被占用？\r\n"
        "   - 程序会自动检测并顺延尝试端口（如 8089, 8090 等），请留意黑窗口控制台提示。\r\n"
        "3. 杀毒软件误报？\r\n"
        "   - 本程序为 PyInstaller 本地单文件打包，完全开源安全，请放心添加信任。\r\n"
        "========================================================================\r\n"
    )
    (release_dir / "快速上手与使用指南.txt").write_text(readme_content, encoding="utf-8")

    # 4. 生成纯净初始数据模板
    print("[4/5] 部署纯净初始化数据模板...")
    data_template_dir = release_dir / "data"
    create_clean_data(data_template_dir)

    # 5. 纯净性与安全性深度审计
    print("[5/5] 执行严格安全审计与账本平衡验证...")
    sensitive_markers = ["8225", "2566", "6835", "小姨", "李海", "secrets.json", "authorization_code"]
    for root, _, files in os.walk(data_template_dir):
        for f in files:
            p = Path(root) / f
            if p.name == ".gitkeep":
                continue
            txt = p.read_text(encoding="utf-8", errors="ignore")
            for marker in sensitive_markers:
                if marker in txt:
                    raise RuntimeError(f"[FATAL SECURITY ERROR] 模版数据包含敏感隐私信息: {marker} in {p}")

    verify_cmd = [str(release_dir / "NovaLedger.exe"), "--data-dir", str(data_template_dir), "validate"]
    proc = subprocess.run(verify_cmd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(f"[FATAL ERROR] 模版账本校验失败: {proc.stderr or proc.stdout}")
    print("  -> 模版账本校验通过：0 错误，借贷完全平衡！")

    tmp_db = data_template_dir / "sqlite" / "metadata.db"
    if tmp_db.exists():
        tmp_db.unlink()

    # 6. 制作 ZIP 压缩包
    zip_dest = dist_dir / "NovaLedger-v1.0-便携分发包.zip"
    if zip_dest.exists():
        zip_dest.unlink()

    print(f"[*] 压缩生成发布包: {zip_dest.name}...")
    with zipfile.ZipFile(zip_dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(release_dir):
            for file in files:
                full_path = Path(root) / file
                rel_path = full_path.relative_to(dist_dir)
                zf.write(full_path, arcname=str(rel_path))

    # 7. 审计生成的 ZIP 文件内列表
    with zipfile.ZipFile(zip_dest, "r") as zf:
        namelist = zf.namelist()
        for name in namelist:
            if "secrets.json" in name or name.endswith(".db"):
                raise RuntimeError(f"[FATAL SECURITY ERROR] ZIP 包含意外的敏感或数据文件: {name}")

    # 8. 同步复制一份到本地 Documents\Nova 方便取用
    nova_user_dir = Path.home() / "Documents" / "Nova"
    if nova_user_dir.exists():
        dest_in_nova = nova_user_dir / "NovaLedger-v1.0-便携分发包.zip"
        shutil.copy2(zip_dest, dest_in_nova)
        print(f"[*] 已同步拷贝一份到用户目录: {dest_in_nova}")

    print("==================================================")
    print("  [SUCCESS] 纯净便携分发包制作成功！")
    print(f"  解压发布目录: {release_dir}")
    print(f"  分发 ZIP 路径: {zip_dest}")
    print(f"  ZIP 大小: {zip_dest.stat().st_size / (1024*1024):.2f} MB")
    print("  安全状态: 100% 纯净，零真实银行卡/流水/凭据数据！")
    print("==================================================")


if __name__ == "__main__":
    package()
