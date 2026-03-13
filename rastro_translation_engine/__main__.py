"""CLI 入口：python -m rastro_translation_engine --host 127.0.0.1 --port 8890"""

from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rastro Translation Engine HTTP 服务"
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=8890, help="监听端口")
    args = parser.parse_args()

    # 延迟导入避免启动时依赖检查失败
    from .server import run_server
    run_server(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
