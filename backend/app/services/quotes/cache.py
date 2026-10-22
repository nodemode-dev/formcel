import threading
import time

_lock = threading.Lock()
_store: dict[str, tuple[float, object]] = {}
MAX = 3000


def get(key: str, ttl: float, fresh: bool = False):
    if fresh:
        return None
    with _lock:
        hit = _store.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    return None


def put(key: str, value) -> None:
    with _lock:
        if len(_store) >= MAX:
            for k, _ in sorted(_store.items(), key=lambda kv: kv[1][0])[: MAX // 4]:
                _store.pop(k, None)
        _store[key] = (time.time(), value)


def clear() -> None:
    with _lock:
        _store.clear()


def size() -> int:
    with _lock:
        return len(_store)
