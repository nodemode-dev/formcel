import socket
import threading
import time

from .. import config

_guard = threading.Lock()
_state: dict = {"server": None, "thread": None, "error": ""}


def addresses() -> list[str]:
    found: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return [a for a in found if not a.startswith("0.")]


def lan_state() -> dict:
    server = _state["server"]
    on = bool(server is not None and getattr(server, "started", False) and not server.should_exit)
    ips = addresses()
    base = f"http://{ips[0]}:{config.LAN_PORT}" if on and ips else f"http://127.0.0.1:{config.LAN_PORT}" if on else ""
    return {"on": on, "port": config.LAN_PORT, "base": base, "addresses": ips, "error": _state["error"]}


def lan_app():
    from fastapi import FastAPI

    from ..routers import share

    app = FastAPI(title="FormCel share listener", docs_url=None, openapi_url=None, redoc_url=None)
    app.include_router(share.router)
    return app


def lan_set(on: bool) -> dict:
    import uvicorn

    with _guard:
        server = _state["server"]
        if on and server is None:
            _state["error"] = ""
            cfg = uvicorn.Config(lan_app(), host="0.0.0.0", port=config.LAN_PORT, log_level="warning", access_log=False)
            server = uvicorn.Server(cfg)
            thread = threading.Thread(target=server.run, name="formcel-lan", daemon=True)
            thread.start()
            for _ in range(40):
                if server.started or not thread.is_alive():
                    break
                time.sleep(0.1)
            if not server.started:
                server.should_exit = True
                _state["error"] = f"FormCel could not listen on port {config.LAN_PORT}. Another program may be using it; set FORMCEL_LAN_PORT to a free port and restart."
                thread.join(2)
                return lan_state()
            _state["server"], _state["thread"] = server, thread
        elif not on and server is not None:
            server.should_exit = True
            thread = _state["thread"]
            if thread is not None:
                thread.join(5)
            _state["server"], _state["thread"] = None, None
    return lan_state()
