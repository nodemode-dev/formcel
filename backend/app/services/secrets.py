SERVICE = "formcel"


def _store():
    try:
        import keyring
        from keyring.backends import fail, null

        kr = keyring.get_keyring()
    except Exception:
        return None
    if isinstance(kr, (fail.Keyring, null.Keyring)) or getattr(kr, "priority", 1) <= 0:
        return None
    return kr


def where() -> dict:
    kr = _store()
    return {"store": "system" if kr else "file", "backend": type(kr).__name__ if kr else "file readable only by you"}


def get(name: str, file_read, file_clear) -> str | None:
    kr = _store()
    if not kr:
        return file_read()
    try:
        value = kr.get_password(SERVICE, name)
    except Exception:
        value = None
    if value:
        return value
    legacy = file_read()
    if legacy:
        try:
            kr.set_password(SERVICE, name, legacy)
            if kr.get_password(SERVICE, name) == legacy:
                file_clear()
        except Exception:
            pass
    return legacy


def put(name: str, value: str, file_write, file_clear) -> str:
    kr = _store()
    if kr:
        try:
            kr.set_password(SERVICE, name, value)
            if kr.get_password(SERVICE, name) == value:
                file_clear()
                return "system"
        except Exception:
            pass
    file_write(value)
    return "file"


def delete(name: str, file_clear) -> None:
    kr = _store()
    if kr:
        try:
            kr.delete_password(SERVICE, name)
        except Exception:
            pass
    file_clear()
