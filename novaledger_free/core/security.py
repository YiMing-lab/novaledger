import base64
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import secrets
from typing import Any, Dict, Optional


# Windows DPAPI structures via ctypes
class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte))
    ]


def _win32_dpapi_encrypt(plaintext: bytes) -> bytes:
    """使用 Windows 原生 DPAPI (CryptProtectData) 对凭据进行机器+用户级加密"""
    try:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32

        in_blob = DATA_BLOB()
        in_blob.cbData = len(plaintext)
        in_blob.pbData = ctypes.cast(ctypes.create_string_buffer(plaintext), ctypes.POINTER(ctypes.c_byte))

        out_blob = DATA_BLOB()
        flags = 0x01  # CRYPTPROTECT_UI_FORBIDDEN

        success = crypt32.CryptProtectData(
            ctypes.byref(in_blob),
            "NovaLedgerCredential",
            None,
            None,
            None,
            flags,
            ctypes.byref(out_blob)
        )
        if not success:
            raise OSError("DPAPI 加密调用失败")

        ciphertext = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        kernel32.LocalFree(out_blob.pbData)
        return ciphertext
    except Exception:
        # Fallback to local obfuscated XOR + secret salt
        salt = b"NovaLedgerLocalSalt_v1"
        return bytes(b ^ salt[i % len(salt)] for i, b in enumerate(plaintext))


def _win32_dpapi_decrypt(ciphertext: bytes) -> bytes:
    """使用 Windows 原生 DPAPI (CryptUnprotectData) 解密凭据"""
    try:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32

        in_blob = DATA_BLOB()
        in_blob.cbData = len(ciphertext)
        in_blob.pbData = ctypes.cast(ctypes.create_string_buffer(ciphertext), ctypes.POINTER(ctypes.c_byte))

        out_blob = DATA_BLOB()
        flags = 0x01

        success = crypt32.CryptUnprotectData(
            ctypes.byref(in_blob),
            None,
            None,
            None,
            None,
            flags,
            ctypes.byref(out_blob)
        )
        if not success:
            raise OSError("DPAPI 解密调用失败")

        plaintext = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        kernel32.LocalFree(out_blob.pbData)
        return plaintext
    except Exception:
        salt = b"NovaLedgerLocalSalt_v1"
        return bytes(b ^ salt[i % len(salt)] for i, b in enumerate(ciphertext))


def mask_secret(secret: str) -> str:
    """生成只包含头尾的脱敏掩码，防止向前端或日志暴露明文密钥"""
    if not secret:
        return ""
    s = secret.strip()
    if len(s) <= 6:
        return "******"
    return f"{s[:3]}...****...{s[-2:]}"


class SecurityManager:
    """凭据安全存储与本地会话防护管理器"""

    def __init__(self, secrets_file: Path):
        self.secrets_file = secrets_file
        # 本地会话 Token，用于防御浏览器内 CSRF 和未授权本地接口扫描
        self.session_token = f"nl_tok_{secrets.token_hex(24)}"

    def save_credential(self, key_name: str, secret: str) -> None:
        """加密持久化指定凭据"""
        vault = self._load_vault()
        if not secret:
            vault.pop(key_name, None)
        else:
            enc_bytes = _win32_dpapi_encrypt(secret.strip().encode("utf-8"))
            vault[key_name] = base64.b64encode(enc_bytes).decode("ascii")
        self._save_vault(vault)

    def get_credential(self, key_name: str) -> str:
        """获取并解密指定凭据 (绝不可直接序列化返回给 HTTP 请求)"""
        vault = self._load_vault()
        enc_b64 = vault.get(key_name)
        if not enc_b64:
            return ""
        try:
            raw_bytes = base64.b64decode(enc_b64.encode("ascii"))
            plain_bytes = _win32_dpapi_decrypt(raw_bytes)
            return plain_bytes.decode("utf-8")
        except Exception:
            return ""

    def has_credential(self, key_name: str) -> bool:
        return bool(self.get_credential(key_name))

    def get_credentials_status(self) -> Dict[str, Any]:
        """对外 API 安全输出：仅返回是否已配置及脱敏掩码，绝不明文回传"""
        deepseek_key = self.get_credential("deepseek_api_key")
        gemini_key = self.get_credential("gemini_api_key")
        openai_key = self.get_credential("openai_api_key")
        mail_code = self.get_credential("email_auth_code")
        return {
            "deepseek_api_key": {
                "configured": bool(deepseek_key),
                "masked": mask_secret(deepseek_key)
            },
            "gemini_api_key": {
                "configured": bool(gemini_key),
                "masked": mask_secret(gemini_key)
            },
            "openai_api_key": {
                "configured": bool(openai_key),
                "masked": mask_secret(openai_key)
            },
            "email_auth_code": {
                "configured": bool(mail_code),
                "masked": mask_secret(mail_code)
            }
        }

    def verify_token(self, token: Optional[str]) -> bool:
        if not token:
            return False
        return secrets.compare_digest(self.session_token, token)

    def _load_vault(self) -> Dict[str, str]:
        if not self.secrets_file.exists():
            return {}
        try:
            import json
            return json.loads(self.secrets_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_vault(self, vault: Dict[str, str]) -> None:
        import json
        self.secrets_file.parent.mkdir(parents=True, exist_ok=True)
        self.secrets_file.write_text(json.dumps(vault, indent=2), encoding="utf-8")
