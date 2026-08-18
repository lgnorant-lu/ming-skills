"""web 逆向模板:纯扣代码(Python/Node,无补环境)。

适用场景:加密函数是纯计算(只用 Math/JSON/crypto 等语言级 API),无浏览器依赖。
降级顺序:先 Python 还原算法,不行则 Node.js 跑扣出的代码。
"""
import json
import subprocess


def encrypt(params: dict) -> str:
    """对外公开:生成加密参数(纯计算,无浏览器依赖)。

    调用者不需要知道:算法实现是 Python 还是 Node、密钥管理、编码转换。
    可能变化:算法类型、密钥、输入格式。
    复杂度藏在内部:Python 实现 / Node 调用 / 验证。
    """
    # 优先 Python 还原算法
    try:
        return _encrypt_py(params)
    except NotImplementedError:
        # Python 还原不了(算法不可静态还原),降级 Node.js
        return _encrypt_node(params)


# ===== 内部辅助函数 =====

def _encrypt_py(params: dict) -> str:
    """Python 还原算法。若算法不可静态还原,抛 NotImplementedError 触发降级。"""
    # 示例:标准 AES-CBC(用 cryptography 库)
    # from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    # ...
    raise NotImplementedError("算法不可静态还原,Python 无法还原,降级 Node.js")


def _encrypt_node(params: dict) -> str:
    """Node.js 跑扣出的代码(通过 subprocess 调用)。"""
    try:
        result = subprocess.run(
            ["node", "extracted_encrypt.js", json.dumps(params, ensure_ascii=False)],
            capture_output=True, text=True, encoding="utf-8", timeout=10
        )
        if result.returncode != 0:
            raise RuntimeError(f"Node.js 执行失败: {result.stderr}")
        return result.stdout.strip()
    except FileNotFoundError as e:
        raise RuntimeError("未找到 Node.js,请安装或改用 Python 还原") from e
    except Exception as e:
        raise RuntimeError(f"Node.js 调用失败: {e}") from e


def _verify(params: dict, expected: str) -> bool:
    """用 HAR 真实值验证。"""
    actual = encrypt(params)
    return actual == expected


if __name__ == "__main__":
    # 用 HAR 真实值验证
    test_params = {"ts": 1700000000}
    expected = "expected_sign_from_har"
    if _verify(test_params, expected):
        print("验证通过")
    else:
        print("验证失败,检查算法实现")
