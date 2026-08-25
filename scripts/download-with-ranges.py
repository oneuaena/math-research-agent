from __future__ import annotations

import os
import re
import socket
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor


CHUNK_SIZE = 1024 * 1024
RETRIES = 6
WORKERS = 8


def open_request(request: urllib.request.Request):
    return urllib.request.urlopen(request, timeout=90)


def main() -> None:
    url, target = sys.argv[1:3]
    socket.setdefaulttimeout(90)
    total: int | None = None
    try:
        head = urllib.request.Request(url, method="HEAD")
        with open_request(head) as response:
            length = response.headers.get("Content-Length")
            total = int(length) if length and length.isdigit() else None
    except Exception:
        # Some package CDNs deliberately omit HEAD metadata.  A one-byte range
        # response normally carries Content-Range with the authoritative size.
        pass
    if total is None:
        try:
            probe = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
            with open_request(probe) as response:
                match = re.search(r"/(\d+)$", response.headers.get("Content-Range", ""))
                total = int(match.group(1)) if match else None
        except Exception:
            pass

    partial = f"{target}.part"
    if total is None:
        # Correctness beats resumability when a server supplies neither HEAD
        # nor range metadata.  Do not guess a size or silently accept a short
        # archive; stream a fresh download and let the caller verify its hash.
        with open_request(urllib.request.Request(url)) as response, open(partial, "wb") as output:
            while data := response.read(CHUNK_SIZE):
                output.write(data)
                print(f"DOWNLOAD_STREAM {output.tell()}", flush=True)
        os.replace(partial, target)
        return

    if os.path.exists(target) and not os.path.exists(partial) and os.path.getsize(target) < total:
        os.replace(target, partial)
    completed = os.path.getsize(partial) if os.path.exists(partial) else 0
    completed -= completed % CHUNK_SIZE
    if os.path.exists(partial):
        with open(partial, "r+b") as output:
            output.truncate(completed)

    def fetch(start: int) -> tuple[int, bytes]:
        end = min(start + CHUNK_SIZE, total) - 1
        expected = end - start + 1
        for attempt in range(1, RETRIES + 1):
            try:
                request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
                with open_request(request) as response:
                    data = response.read()
                if len(data) != expected:
                    raise OSError(f"range {start}-{end} returned {len(data)} bytes")
                return end, data
            except Exception:
                if attempt == RETRIES:
                    raise
                time.sleep(attempt * 2)
        raise RuntimeError("unreachable")

    starts = list(range(completed, total, CHUNK_SIZE))
    with open(partial, "ab") as output, ThreadPoolExecutor(max_workers=WORKERS) as executor:
        for end, data in executor.map(fetch, starts):
            output.write(data)
            output.flush()
            print(f"DOWNLOAD_RANGE {end + 1}/{total}", flush=True)
    if os.path.getsize(partial) != total:
        raise OSError(f"download size mismatch: {os.path.getsize(partial)} != {total}")
    os.replace(partial, target)


if __name__ == "__main__":
    main()
