import os
import sys

if sys.stdin is None:
    sys.stdin = open(os.devnull, encoding="utf-8")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import json
import logging
import threading
import time
from pathlib import Path

PORT_FILE = "engine.port"


def resource_dir() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def selfcheck() -> int:
    info = {"python": sys.version.split()[0]}
    try:
        import formcel_engine

        info["engine"] = formcel_engine.version()
        import app.main  # noqa: F401

        info["app"] = "ok"
    except Exception as exc:
        info["app"] = f"failed: {exc!r}"
        print(json.dumps(info))
        return 1
    info["window_bundled"] = os.path.isdir(os.path.join(resource_dir(), "frontend_dist"))
    print(json.dumps(info))
    return 0


def watch_shell(data) -> None:
    from app import runtime, startup

    shell = startup.shell_pid()
    if not shell and os.name == "posix":
        shell = os.getppid()
    if shell <= 1:
        return

    def leave() -> None:
        logging.getLogger("formcel").info("the app that started this engine is gone (process %s), stopping", shell)
        runtime.release(data)
        os._exit(0)

    startup.watch(shell, leave)


def announce_port(server) -> None:
    def run() -> None:
        for _ in range(600):
            if server.started and server.servers:
                break
            time.sleep(0.05)
        try:
            port = server.servers[0].sockets[0].getsockname()[1]
        except (IndexError, AttributeError):
            return
        from app import config

        config.PORT = port
        os.environ["FORMCEL_PORT"] = str(port)
        try:
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            (config.DATA_DIR / PORT_FILE).write_text(str(port), encoding="utf-8")
        except OSError:
            pass

    threading.Thread(target=run, name="formcel-port", daemon=True).start()


def main() -> int:
    if "--selfcheck" in sys.argv:
        return selfcheck()
    if sys.argv[1:2] == ["-I"] and len(sys.argv) > 2:
        import runpy

        sys.argv = sys.argv[2:]
        runpy.run_path(sys.argv[0], run_name="__main__")
        return 0
    if sys.argv[1:3] == ["-m", "app.refresh_cli"]:
        from app.services import ossched

        return ossched.main()
    bundled =os.path.join(resource_dir(), "frontend_dist")
    if os.path.isdir(bundled):
        os.environ.setdefault("FORMCEL_WINDOW_DIR", bundled)
    try:
        return serve()
    except Exception:
        logging.getLogger("formcel").exception("the engine stopped on an error")
        raise


def serve() -> int:
    from app import config, runtime, startup

    data = config.DATA_DIR
    try:
        logs = runtime.start_logging(data).parent
    except OSError as err:
        print(f"formcel cannot use its data folder: {err}", file=sys.stderr)
        return 5
    startup.keep_errors(logs)
    log = logging.getLogger("formcel")
    if startup.alone():
        beside = startup.app_beside(Path(sys.executable))
        if beside is not None and startup.open_app(beside):
            log.info("started without its app, so it opened %s and stopped", beside)
            return 0
        log.error("started without its app, and no app program was found near %s", sys.executable)
        print("formcel-engine is a part of FormCel and serves nothing on its own. Open FormCel instead.", file=sys.stderr)
        return 4
    try:
        runtime.claim(data)
    except startup.Busy as err:
        log.error("%s", err)
        print(err, file=sys.stderr)
        return 2
    watch_shell(data)
    import uvicorn

    from app.main import app

    raw = os.environ.get("FORMCEL_PORT", "8199")
    port = int(raw) if raw.strip() else 8199
    host = os.environ.get("FORMCEL_HOST", "127.0.0.1")
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="info"))
    runtime.start_logging(data)
    announce_port(server)
    from app import window_key

    if window_key.stdout_mode():
        print(window_key.LINE + window_key.KEY, flush=True)
    try:
        server.run()
    finally:
        runtime.release(data)
    return 0 if server.started else 3


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    sys.exit(main())
