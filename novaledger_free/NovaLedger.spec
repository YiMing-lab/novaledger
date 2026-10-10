# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import copy_metadata

datas = [('C:/Users/Li-ha/Documents/I-Billrecoder-v3/novaledger_free/web/static', 'novaledger_free/web/static')]
hiddenimports = ['uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'fastapi', 'pydantic', 'sqlite3']
datas += collect_data_files('beancount')
datas += copy_metadata('beancount')
hiddenimports += collect_submodules('beancount')
hiddenimports += collect_submodules('uvicorn')


a = Analysis(
    ['C:/Users/Li-ha/Documents/I-Billrecoder-v3/novaledger_free/run.py'],
    pathex=['C:/Users/Li-ha/Documents/I-Billrecoder-v3'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='NovaLedger',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['C:/Users/Li-ha/Documents/I-Billrecoder-v3/app/src/static/app.ico'],
)
