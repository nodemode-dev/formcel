import os
from pathlib import Path

HOST = os.environ.get("FORMCEL_HOST", "127.0.0.1")
PORT = int(os.environ.get("FORMCEL_PORT", "8199"))
DATA_DIR = Path(os.environ.get("FORMCEL_DATA_DIR", Path.home() / "FormCel")).expanduser()
WINDOW_DIR = Path(os.environ["FORMCEL_WINDOW_DIR"]).expanduser() if os.environ.get("FORMCEL_WINDOW_DIR") else None
SUBDIRS = ("Workbooks", "Templates", "Media", "Exports", "Trash")


def ensure_data_dir() -> Path:
    for name in SUBDIRS:
        (DATA_DIR / name).mkdir(parents=True, exist_ok=True)
    return DATA_DIR
