"""Acquire the pinned public Wyscout 2017/18 release files for P0 feasibility only.

Research tooling for Kanban card t_44597dd8 (P0 of docs/IMPLEMENTATION_PLAN.md).
It is NOT a ScoutBoy adapter, does not write to any ScoutBoy database, and is not
a Make target. Files land in the gitignored ``data/raw/wyscout/`` directory.

Every file is pinned by Figshare article ID + article version + file ID + byte
size + the MD5 that the Figshare metadata API reported for that exact version
(retrieved 2026-09-26). A mismatch is a hard stop, never a warning. SHA-256 is
computed over the acquired bytes and written to a local acquisition record.

Usage (from repo root, any Python >= 3.9, stdlib only):

    python3 scripts/wyscout_p0/fetch_sources.py [--dest data/raw/wyscout]
    python3 scripts/wyscout_p0/fetch_sources.py --verify-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

DOWNLOAD_BASE = "https://ndownloader.figshare.com/files/"
METADATA_BASE = "https://api.figshare.com/v2/articles/"
LICENSE = "CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"


@dataclass(frozen=True)
class PinnedFile:
    role: str
    article_id: int
    article_version: int
    doi: str
    file_id: int
    name: str
    size: int
    md5: str


# Pins recorded from https://api.figshare.com/v2/articles/<id>/versions/<v> on 2026-09-26.
PINNED_FILES: tuple[PinnedFile, ...] = (
    PinnedFile(
        "events",
        7770599,
        1,
        "10.6084/m9.figshare.7770599.v1",
        14464685,
        "events.zip",
        77323413,
        "7c20e8647e7eda58d7838a0c7b1ec6ab",
    ),
    PinnedFile(
        "matches",
        7770422,
        1,
        "10.6084/m9.figshare.7770422.v1",
        14464622,
        "matches.zip",
        645097,
        "51d80beb17480919f69a53a0152c2d71",
    ),
    PinnedFile(
        "players",
        7765196,
        3,
        "10.6084/m9.figshare.7765196.v3",
        15073721,
        "players.json",
        1737347,
        "f28ddf6326281efeda6488b2169f5609",
    ),
    PinnedFile(
        "teams",
        7765310,
        3,
        "10.6084/m9.figshare.7765310.v3",
        15073697,
        "teams.json",
        27404,
        "1381ff9449f21105090729cf0e086b5b",
    ),
    PinnedFile(
        "competitions",
        7765316,
        4,
        "10.6084/m9.figshare.7765316.v4",
        15073685,
        "competitions.json",
        1209,
        "3dc210a4805dda5337b0ff9f7eaa407a",
    ),
    PinnedFile(
        "event_dictionary",
        11743836,
        1,
        "10.6084/m9.figshare.11743836.v1",
        21385245,
        "eventid2name.csv",
        1001,
        "46daf16100ece0c743eedc9adcfea162",
    ),
    PinnedFile(
        "tag_dictionary",
        11743818,
        1,
        "10.6084/m9.figshare.11743818.v1",
        21385239,
        "tags2name.csv",
        1754,
        "e7acb14918d00e40c80a898b1da8fc39",
    ),
)

CHUNK = 1 << 20


class PinMismatch(RuntimeError):
    """Raised when acquired bytes or live metadata disagree with a pin."""


def hash_file(path: Path) -> tuple[int, str, str]:
    md5 = hashlib.md5()  # noqa: S324 - integrity comparison with Figshare's published MD5
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while True:
            block = fh.read(CHUNK)
            if not block:
                break
            size += len(block)
            md5.update(block)
            sha.update(block)
    return size, md5.hexdigest(), sha.hexdigest()


def verify_file(pin: PinnedFile, path: Path) -> dict:
    size, md5, sha = hash_file(path)
    if size != pin.size or md5 != pin.md5:
        raise PinMismatch(
            f"{pin.name}: expected size={pin.size} md5={pin.md5}, got size={size} md5={md5}"
        )
    return {**asdict(pin), "sha256": sha, "local_path": path.name}


def check_live_metadata(pin: PinnedFile, timeout: float = 60.0) -> None:
    """Confirm the pinned article version still lists the same file/size/md5/licence."""
    url = f"{METADATA_BASE}{pin.article_id}/versions/{pin.article_version}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310 - fixed https host
        meta = json.load(resp)
    lic = (meta.get("license") or {}).get("name")
    if lic != LICENSE:
        raise PinMismatch(f"{pin.name}: licence changed to {lic!r}")
    files = {f["id"]: f for f in meta.get("files", [])}
    live = files.get(pin.file_id)
    if not live or live.get("size") != pin.size or live.get("computed_md5") != pin.md5:
        raise PinMismatch(f"{pin.name}: live metadata no longer matches pin: {live!r}")


def download(pin: PinnedFile, dest: Path, retries: int = 3, timeout: float = 120.0) -> Path:
    target = dest / pin.name
    tmp = dest / (pin.name + ".part")
    url = f"{DOWNLOAD_BASE}{pin.file_id}"
    last_error: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "scoutboy-p0-feasibility"})
            with (
                urllib.request.urlopen(req, timeout=timeout) as resp,
                tmp.open("wb") as out,
            ):  # noqa: S310
                while True:
                    block = resp.read(CHUNK)
                    if not block:
                        break
                    out.write(block)
            os.replace(tmp, target)
            return target
        except (OSError, urllib.error.URLError) as exc:  # transient network only
            last_error = exc
            time.sleep(2**attempt)
    raise RuntimeError(f"download failed for {pin.name}: {last_error}")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch/verify pinned Wyscout P0 inputs")
    parser.add_argument("--dest", default="data/raw/wyscout")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--skip-live-metadata", action="store_true")
    args = parser.parse_args(argv)

    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    records = []
    for pin in PINNED_FILES:
        if not args.skip_live_metadata:
            check_live_metadata(pin)
        path = dest / pin.name
        if not path.exists():
            if args.verify_only:
                raise PinMismatch(f"{pin.name}: missing locally")
            download(pin, dest)
        rec = verify_file(pin, path)
        records.append(rec)
        print(f"ok {pin.name} size={rec['size']} sha256={rec['sha256']}")
    record = {
        "purpose": "P0 private read-only feasibility (t_44597dd8); not a ScoutBoy manifest",
        "license": LICENSE,
        "license_url": LICENSE_URL,
        "retrieved_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "files": records,
    }
    (dest / "acquisition_record.json").write_text(json.dumps(record, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
