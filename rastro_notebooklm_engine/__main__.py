from __future__ import annotations

import argparse
import os
from pathlib import Path

from .server import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the NotebookLM local engine")
    parser.add_argument("--host", default=os.environ.get("RASTRO_NOTEBOOKLM_ENGINE_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("RASTRO_NOTEBOOKLM_ENGINE_PORT", "8891")),
    )
    parser.add_argument(
        "--data-dir",
        default=os.environ.get("RASTRO_NOTEBOOKLM_DATA_DIR", ".rastro_notebooklm"),
    )
    args = parser.parse_args()
    run_server(args.host, args.port, Path(args.data_dir))


if __name__ == "__main__":
    main()
