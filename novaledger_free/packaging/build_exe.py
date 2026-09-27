import os
from pathlib import Path
import shutil
import subprocess
import sys


def build():
    root_dir = Path(__file__).resolve().parent.parent.parent
    free_dir = root_dir / "novaledger_free"
    dist_dir = free_dir / "dist"
    build_dir = free_dir / "build"
    static_dir = free_dir / "web" / "static"
    icon_file = root_dir / "app" / "src" / "static" / "app.ico"
    entry_script = free_dir / "run.py"

    print("==================================================")
    print("  NovaLedger Community Edition (免费版) 构建程序")
    print("==================================================")

    # 清理旧构建目录
    if dist_dir.exists():
        shutil.rmtree(dist_dir, ignore_errors=True)
    if build_dir.exists():
        shutil.rmtree(build_dir, ignore_errors=True)

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name", "NovaLedger",
        "--onefile",
        f"--add-data={static_dir}{os.pathsep}novaledger_free/web/static",
        f"--paths={root_dir}",
        "--collect-data=beancount",
        "--copy-metadata=beancount",
        "--collect-submodules=beancount",
        "--collect-submodules=uvicorn",
        "--hidden-import=uvicorn",
        "--hidden-import=uvicorn.logging",
        "--hidden-import=uvicorn.loops",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.protocols.websockets",
        "--hidden-import=uvicorn.protocols.websockets.auto",
        "--hidden-import=uvicorn.lifespan",
        "--hidden-import=uvicorn.lifespan.on",
        "--hidden-import=fastapi",
        "--hidden-import=pydantic",
        "--hidden-import=sqlite3",
        "--distpath", str(dist_dir),
        "--workpath", str(build_dir),
        "--specpath", str(free_dir),
    ]

    if icon_file.exists():
        cmd.extend(["--icon", str(icon_file)])

    cmd.append(str(entry_script))

    print(f"[*] 执行打包指令: {' '.join(cmd)}")
    ret = subprocess.run(cmd)
    if ret.returncode != 0:
        print(f"[!] PyInstaller 构建失败，退出码: {ret.returncode}")
        sys.exit(ret.returncode)

    built_exe = dist_dir / "NovaLedger.exe"
    if built_exe.exists():
        print("==================================================")
        print(f"  [OK] 统一独立可执行程序构建成功: {built_exe}")
        print(f"  大小: {built_exe.stat().st_size / (1024*1024):.2f} MB")
        print("==================================================")

    else:
        print("[!] 未能找到生成的 EXE 文件！")
        sys.exit(1)


if __name__ == "__main__":
    build()
