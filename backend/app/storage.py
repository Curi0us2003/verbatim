"""Audio files on disk, optionally encrypted at rest with Fernet (ENCRYPTION_KEY in .env).

Encrypted files are a sequence of blocks: [4-byte length][Fernet token], each token holding
1 MiB of audio. Blocks let us encrypt uploads while they stream in and decrypt only the part
of the file the audio player asks for, instead of loading whole recordings into memory.
"""

from __future__ import annotations

import shutil
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from cryptography.fernet import Fernet

from .config import settings

BLOCK = 1024 * 1024
ENC_SUFFIX = ".enc"


def _fernet() -> Fernet | None:
    key = settings.encryption_key.strip()
    return Fernet(key.encode()) if key else None


def encryption_enabled() -> bool:
    return _fernet() is not None


def session_dir(session_id: int) -> Path:
    path = settings.audio_dir / str(session_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def stored_name(name: str) -> str:
    """The on-disk file name: encrypted files get an .enc suffix."""
    return name + ENC_SUFFIX if encryption_enabled() else name


def is_encrypted(path: Path) -> bool:
    return path.suffix == ENC_SUFFIX


class AudioWriter:
    """Write a file in pieces, encrypting block by block when a key is set."""

    def __init__(self, path: Path):
        self.path = path
        self._f: BinaryIO = open(path, "wb")
        self._fernet = _fernet() if is_encrypted(path) else None
        self._buf = bytearray()
        self.size = 0

    def write(self, data: bytes) -> None:
        self.size += len(data)
        if self._fernet is None:
            self._f.write(data)
            return
        self._buf.extend(data)
        while len(self._buf) >= BLOCK:
            self._write_block(bytes(self._buf[:BLOCK]))
            del self._buf[:BLOCK]

    def _write_block(self, plain: bytes) -> None:
        token = self._fernet.encrypt(plain)  # type: ignore[union-attr]
        self._f.write(struct.pack(">I", len(token)))
        self._f.write(token)

    def close(self) -> None:
        if self._fernet is not None and self._buf:
            self._write_block(bytes(self._buf))
            self._buf.clear()
        self._f.close()

    def __enter__(self) -> "AudioWriter":
        return self

    def __exit__(self, exc_type, *_):
        self.close()
        if exc_type is not None:
            self.path.unlink(missing_ok=True)


def write_bytes(path: Path, data: bytes) -> None:
    with AudioWriter(path) as w:
        w.write(data)


def _blocks(path: Path) -> Iterator[bytes]:
    """Yield the plaintext blocks of a stored file."""
    if not is_encrypted(path):
        with open(path, "rb") as f:
            while chunk := f.read(BLOCK):
                yield chunk
        return
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("This audio is encrypted but ENCRYPTION_KEY is missing from .env.")
    with open(path, "rb") as f:
        while header := f.read(4):
            (n,) = struct.unpack(">I", header)
            yield fernet.decrypt(f.read(n))


def read_bytes(path: Path) -> bytes:
    return b"".join(_blocks(path))


def decrypt_to(path: Path, dst: Path) -> Path:
    """Write a plaintext copy (for tools such as ffmpeg that need a real file)."""
    if not is_encrypted(path):
        shutil.copyfile(path, dst)
        return dst
    with open(dst, "wb") as out:
        for block in _blocks(path):
            out.write(block)
    return dst


def plain_size(path: Path) -> int:
    if not is_encrypted(path):
        return path.stat().st_size
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("This audio is encrypted but ENCRYPTION_KEY is missing from .env.")
    total, last_len = 0, 0
    with open(path, "rb") as f:
        offsets = []
        while header := f.read(4):
            (n,) = struct.unpack(">I", header)
            offsets.append((f.tell(), n))
            f.seek(n, 1)
        if not offsets:
            return 0
        pos, n = offsets[-1]
        f.seek(pos)
        last_len = len(fernet.decrypt(f.read(n)))
    total = (len(offsets) - 1) * BLOCK + last_len
    return total


def read_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    """Yield plaintext bytes start..end (inclusive), decrypting only the blocks needed."""
    if not is_encrypted(path):
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(BLOCK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        return
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("This audio is encrypted but ENCRYPTION_KEY is missing from .env.")
    first, last = start // BLOCK, end // BLOCK
    with open(path, "rb") as f:
        index = 0
        while header := f.read(4):
            (n,) = struct.unpack(">I", header)
            if index < first:
                f.seek(n, 1)
            else:
                block = fernet.decrypt(f.read(n))
                lo = start - index * BLOCK if index == first else 0
                hi = end - index * BLOCK + 1 if index == last else len(block)
                yield block[lo:hi]
                if index == last:
                    return
            index += 1


def delete_session_audio(session_id: int) -> None:
    shutil.rmtree(settings.audio_dir / str(session_id), ignore_errors=True)
