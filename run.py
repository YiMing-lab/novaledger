"""
NovaLedger v2.0 本地开发与命令行入口
支持：
  python run.py           # 启动 FastAPI + React 静态前端服务 (http://127.0.0.1:8088)
  python run.py validate  # 校验 Beancount 账本平衡与语法
"""
from sidecar_entry import main

if __name__ == "__main__":
    main()
