import json
import os
import sys
import threading
import time


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


def watch_parent() -> None:
    if os.name != "posix":
        return
    parent = os.getppid()
    if parent <= 1:
        return

    def run() -> None:
        while os.getppid() == parent:
            time.sleep(2)
        os._exit(0)

    threading.Thread(target=run, name="formcel-parent-watch", daemon=True).start()


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
    watch_parent()
    import uvicorn

    from app.main import app

    raw = os.environ.get("FORMCEL_PORT", "8199")
    port = int(raw) if raw.strip() else 8199
    host = os.environ.get("FORMCEL_HOST", "127.0.0.1")
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="info"))
    announce_port(server)
    server.run()
    return 0 if server.started else 3


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    sys.exit(main())
