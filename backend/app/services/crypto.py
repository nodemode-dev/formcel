import io

import msoffcrypto
from msoffcrypto.exceptions import DecryptionError, FileFormatError, InvalidKeyError
from msoffcrypto.format.ooxml import OOXMLFile

OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


class PasswordNeeded(Exception):
    pass


class WrongPassword(Exception):
    pass


def locked(data: bytes) -> bool:
    if not data.startswith(OLE):
        return False
    try:
        return msoffcrypto.OfficeFile(io.BytesIO(data)).is_encrypted()
    except (FileFormatError, OSError, ValueError, AssertionError):
        return False


def unlock(data: bytes, password: str | None) -> bytes:
    if not locked(data):
        return data
    if not password:
        raise PasswordNeeded()
    f = msoffcrypto.OfficeFile(io.BytesIO(data))
    try:
        f.load_key(password=password)
        out = io.BytesIO()
        f.decrypt(out)
    except (InvalidKeyError, DecryptionError) as e:
        raise WrongPassword() from e
    return out.getvalue()


def lock(data: bytes, password: str) -> bytes:
    out = io.BytesIO()
    OOXMLFile(io.BytesIO(data)).encrypt(password, out)
    return out.getvalue()
