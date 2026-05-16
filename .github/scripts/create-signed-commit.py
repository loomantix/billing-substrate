#!/usr/bin/env python3
"""Create a verified commit via the GitHub Contents API.

Vendored fork — reads change-set from a manifest produced by an upstream
Job A and reads upsert contents from a payload directory, rather than
calling `git status` against a local working tree. This decoupling is
what lets Job B run *without* executing any upstream-cloned code.

Commits created via the Contents API (`git/blobs`, `git/trees`,
`git/commits`, `git/refs`) are auto-signed by GitHub when invoked with a
GitHub App installation token — committer is `GitHub`, `verified: true`.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, NamedTuple

# GitHub's blob endpoint rejects payloads over 100MB. Fail fast at 50MB
# with a clear message rather than emitting a confusing API error.
MAX_BLOB_BYTES = 50 * 1024 * 1024

# Bounded retry for transient network/5xx errors. The sync workflow
# fires daily; a single transient blip shouldn't fail the whole run.
RETRY_HTTP_STATUS = {500, 502, 503, 504}
RETRY_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_S = 1.5


class StatusChanges(NamedTuple):
    """Result of `parse_manifest`: paths to upsert + paths to delete."""

    upserts: list[str]
    deletes: list[str]


def _is_safe_repo_path(path: str) -> bool:
    """Reject absolute paths and any `..` component — defense in depth.

    The manifest is produced by untrusted Job A. Even though `git status`
    output shouldn't contain absolute paths or `..`, the GitHub API would
    otherwise be the only line of defense for delete entries. Apply the
    same shape-check to upserts and deletes so the script never asks the
    API to operate on a path the consumer maintainer can't see in PR diff.
    """
    if not path or path.startswith("/"):
        return False
    parts = path.replace("\\", "/").split("/")
    return ".." not in parts


def _github_request(
    method: str,
    path: str,
    token: str,
    body: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Internal: issue a GitHub REST request. Returns parsed JSON, or raises HTTPError / URLError.

    Callers should use `github_api` (errors are fatal) or `github_api_optional`
    (404 returns None, other errors fatal) — both surface a clear contract at
    the call site.
    """
    url = f"https://api.github.com{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    # Bound network wait — a hung connection on the runner shouldn't
    # consume the entire job's timeout-minutes.
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _request_with_retry(
    method: str,
    path: str,
    token: str,
    body: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Wrap `_github_request` with bounded retry on 5xx + URLError."""
    last_exc: Exception | None = None
    for attempt in range(1, RETRY_MAX_ATTEMPTS + 1):
        try:
            return _github_request(method, path, token, body)
        except urllib.error.HTTPError as e:
            if e.code in RETRY_HTTP_STATUS and attempt < RETRY_MAX_ATTEMPTS:
                last_exc = e
                sys.stderr.write(
                    f"GitHub API {method} {path}: {e.code} (attempt {attempt}/{RETRY_MAX_ATTEMPTS}); retrying\n"
                )
                time.sleep(RETRY_BASE_DELAY_S * attempt)
                continue
            raise
        except urllib.error.URLError as e:
            if attempt < RETRY_MAX_ATTEMPTS:
                last_exc = e
                sys.stderr.write(
                    f"GitHub API {method} {path}: network error {e.reason!r} (attempt {attempt}/{RETRY_MAX_ATTEMPTS}); retrying\n"
                )
                time.sleep(RETRY_BASE_DELAY_S * attempt)
                continue
            sys.stderr.write(f"GitHub API {method} {path}: network error after {RETRY_MAX_ATTEMPTS} attempts: {e.reason!r}\n")
            sys.exit(1)
    # Defensive: should be unreachable since the loop either returns or raises.
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("unreachable: retry loop exited without returning or raising")


def _exit_on_http_error(method: str, path: str, e: urllib.error.HTTPError) -> None:
    sys.stderr.write(f"GitHub API {method} {path}: {e.code} {e.reason}\n")
    try:
        sys.stderr.write(e.read().decode() + "\n")
    except (UnicodeDecodeError, OSError) as body_err:
        sys.stderr.write(f"<could not decode error body: {type(body_err).__name__}: {body_err}>\n")
    sys.exit(1)


def github_api(
    method: str,
    path: str,
    token: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Issue a GitHub REST request. Returns parsed JSON. Exits on any error."""
    try:
        result = _request_with_retry(method, path, token, body)
    except urllib.error.HTTPError as e:
        _exit_on_http_error(method, path, e)
        raise  # unreachable; satisfies the type checker
    assert result is not None  # _github_request only returns None when raising
    return result


def github_api_optional(
    method: str,
    path: str,
    token: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Issue a GitHub REST request. Returns None on 404. Exits on other errors."""
    try:
        return _request_with_retry(method, path, token, body)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        _exit_on_http_error(method, path, e)
        raise  # unreachable; satisfies the type checker


def parse_manifest(manifest_path: Path) -> StatusChanges:
    """Return (upserts, deletes) from `git status --porcelain=v1 -z -uall` bytes.

    Renames (R) emit upsert(new) + delete(old) so `base_tree` doesn't
    preserve the old path. Copies (C) emit upsert(new) only. R/C with an
    empty source path is a manifest corruption and aborts the script.
    """
    raw = manifest_path.read_bytes().decode("utf-8", errors="surrogateescape")
    if not raw:
        return StatusChanges(upserts=[], deletes=[])

    upserts: list[str] = []
    deletes: list[str] = []

    parts = raw.split("\0")
    i = 0
    while i < len(parts):
        entry = parts[i]
        i += 1
        if not entry:
            continue
        code = entry[:2]
        path = entry[3:]

        if "R" in code or "C" in code:
            if i >= len(parts):
                raise ValueError(f"manifest corruption: {code!r} entry has no source path")
            old_path = parts[i]
            i += 1
            if not old_path:
                raise ValueError(f"manifest corruption: {code!r} entry has empty source path for {path!r}")
            upserts.append(path)
            if "R" in code:
                deletes.append(old_path)
            continue

        # Trust the status code — re-checking via `.exists()` would TOCTOU-
        # misclassify a recreated path as an upsert.
        if "D" in code:
            deletes.append(path)
        else:
            upserts.append(path)

    return StatusChanges(upserts=upserts, deletes=deletes)


def derive_signoff_trailer(app_slug: str) -> str:
    """Build `Signed-off-by: <slug>[bot] <<slug>[bot]@users.noreply.github.com>`.

    The bot's numeric user id is omitted — the DCO regex accepts the
    slug-only form, and `GET /app` / `GET /user` aren't callable with an
    installation token to fetch it.
    """
    name = f"{app_slug}[bot]"
    return f"Signed-off-by: {name} <{name}@users.noreply.github.com>"


def with_signoff(message: str, trailer: str) -> str:
    """Append a Signed-off-by trailer if not already present.

    Idempotent: if the caller already supplied a `Signed-off-by:` line in
    `--message`, returns the message unchanged. Otherwise appends with a
    blank-line separator so the trailer parses as a footer.
    """
    if "Signed-off-by:" in message:
        return message
    return f"{message.rstrip()}\n\n{trailer}\n"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--owner", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--base-branch", required=True, help="branch to fork the sync commit from")
    p.add_argument("--new-branch", required=True, help="branch to create with the new commit")
    p.add_argument("--message", required=True, help="commit message")
    p.add_argument(
        "--payload-dir",
        required=True,
        type=Path,
        help="extracted post-sync working tree from Job A — upsert paths are read relative to this dir",
    )
    p.add_argument(
        "--manifest",
        required=True,
        type=Path,
        help="path to the `git status --porcelain=v1 -z -uall` bytes captured by Job A",
    )
    p.add_argument("--token-env", default="GH_APP_TOKEN", help="env var holding the App installation token")
    p.add_argument(
        "--app-slug",
        default=None,
        help=(
            "App slug (e.g. 'loomantix') for the Signed-off-by trailer. "
            "Pass `${{ steps.app-token.outputs.app-slug }}` from the workflow. "
            "If omitted, no DCO trailer is appended (consumers that enforce "
            "DCO will then need a per-repo bot exemption)."
        ),
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    token = os.environ.get(args.token_env)
    if not token:
        sys.stderr.write(f"missing token in env var {args.token_env}\n")
        return 2

    # An empty/whitespace --app-slug would produce `[bot] <[bot]@…>` —
    # passes the DCO regex but attributes the commit to a non-existent
    # bot. Reject up front; the workflow always has a real slug or omits
    # the flag entirely.
    app_slug = args.app_slug.strip() if args.app_slug else None
    if args.app_slug is not None and not app_slug:
        sys.stderr.write("--app-slug, when given, must be non-empty\n")
        return 2

    payload_dir = args.payload_dir.resolve()
    if not payload_dir.is_dir():
        sys.stderr.write(f"--payload-dir is not a directory: {payload_dir}\n")
        return 2
    if not args.manifest.is_file():
        sys.stderr.write(f"--manifest is not a file: {args.manifest}\n")
        return 2

    owner_repo = f"{args.owner}/{args.repo}"

    # A typo / hostile caller passing --new-branch == --base-branch would
    # force-PATCH main onto the sync commit at the end. Refuse.
    if args.new_branch == args.base_branch:
        sys.stderr.write(
            f"refusing to operate: --new-branch and --base-branch are the same ({args.new_branch})\n"
        )
        return 2

    try:
        changes = parse_manifest(args.manifest)
    except ValueError as e:
        sys.stderr.write(f"❌ {e}\n")
        return 1

    if not changes.upserts and not changes.deletes:
        print("No changes to commit.")
        return 0
    print(f"Changes detected: {len(changes.upserts)} upsert, {len(changes.deletes)} delete")

    base_ref = github_api("GET", f"/repos/{owner_repo}/git/ref/heads/{args.base_branch}", token)
    base_sha = base_ref["object"]["sha"]
    base_commit = github_api("GET", f"/repos/{owner_repo}/git/commits/{base_sha}", token)
    base_tree_sha = base_commit["tree"]["sha"]

    tree: list[dict[str, Any]] = []

    for path in changes.upserts:
        if not _is_safe_repo_path(path):
            sys.stderr.write(f"  ❌ upsert path rejected (absolute or contains '..'): {path}\n")
            return 1
        full = payload_dir / path
        # OSError catches symlink loops (ELOOP), name-too-long, permission
        # weirdness; ValueError catches the cross-boundary escape.
        try:
            full.resolve().relative_to(payload_dir)
        except (ValueError, OSError) as e:
            sys.stderr.write(f"  ❌ upsert path escapes payload dir or is unreadable: {path}: {type(e).__name__}: {e}\n")
            return 1
        if not full.is_file():
            kind = "symlink" if full.is_symlink() else ("missing" if not full.exists() else "not-a-regular-file")
            sys.stderr.write(f"  ❌ upsert path is {kind} in payload-dir: {path}\n")
            return 1
        content = full.read_bytes()
        if len(content) > MAX_BLOB_BYTES:
            sys.stderr.write(
                f"  ❌ upsert blob exceeds {MAX_BLOB_BYTES} bytes: {path} ({len(content)} bytes)\n"
            )
            return 1
        blob = github_api(
            "POST",
            f"/repos/{owner_repo}/git/blobs",
            token,
            {"content": base64.b64encode(content).decode("ascii"), "encoding": "base64"},
        )
        # Preserve executable bit; `tar -czf` + `tar -xzf` round-trip the
        # mode so X_OK on the extracted file reflects the source.
        mode = "100755" if os.access(full, os.X_OK) else "100644"
        tree.append({"path": path, "mode": mode, "type": "blob", "sha": blob["sha"]})

    for path in changes.deletes:
        if not _is_safe_repo_path(path):
            sys.stderr.write(f"  ❌ delete path rejected (absolute or contains '..'): {path}\n")
            return 1
        tree.append({"path": path, "mode": "100644", "type": "blob", "sha": None})

    new_tree = github_api(
        "POST",
        f"/repos/{owner_repo}/git/trees",
        token,
        {"base_tree": base_tree_sha, "tree": tree},
    )

    full_message = (
        with_signoff(args.message, derive_signoff_trailer(app_slug))
        if app_slug
        else args.message
    )
    new_commit = github_api(
        "POST",
        f"/repos/{owner_repo}/git/commits",
        token,
        {"message": full_message, "tree": new_tree["sha"], "parents": [base_sha]},
    )

    existing = github_api_optional(
        "GET", f"/repos/{owner_repo}/git/ref/heads/{args.new_branch}", token
    )
    if existing is None:
        github_api(
            "POST",
            f"/repos/{owner_repo}/git/refs",
            token,
            {"ref": f"refs/heads/{args.new_branch}", "sha": new_commit["sha"]},
        )
    else:
        # Same-day reruns reuse the date-stamped branch — force-update is documented.
        github_api(
            "PATCH",
            f"/repos/{owner_repo}/git/refs/heads/{args.new_branch}",
            token,
            {"sha": new_commit["sha"], "force": True},
        )

    print(f"✓ signed commit {new_commit['sha']} on branch {args.new_branch}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
