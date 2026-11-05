#!/usr/bin/env python3
"""MaxPlus gateway helper for CreatorOps (stdlib only).

Every command prints a redacted summary. No token or key is ever printed, logged or written
anywhere except the one place `create` and `reroll` are told to put a new secret (a private
file, mode 600). Run `python3 mp.py --help`.

Where the tokens come from (first match wins):
  management token  env MAXPLUS_MGMT_TOKEN, or file named by MAXPLUS_MGMT_TOKEN_FILE
  inference key     env MAXPLUS_KEY, or file named by MAXPLUS_KEY_FILE, or --key-file
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

BASE = "https://api.maxplus-ai.cc/v1"
SECRET = re.compile(r"cc[a-z]k-[A-Za-z0-9_-]+")
CA_BUNDLE = "/root/.ccr/ca-bundle.crt"  # the cloud sandbox's proxy CA; ignored when absent
KEEP_FIELDS = (
    "id", "name", "pool", "limit_usd", "limit_period", "limit_used_usd", "used_usd",
    "active", "auto_pool_enabled", "created_at",
)


class Fail(Exception):
    pass


def scrub(value):
    """Replaces every token-like string, at any depth, with <redacted>."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        return SECRET.sub("<redacted>", value)
    return value


def find_secret(value, prefix="ccsk-"):
    if isinstance(value, str) and value.startswith(prefix) and len(value) > 20:
        return value
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, list):
        for item in value:
            found = find_secret(item, prefix)
            if found:
                return found
    return None


def read_secret(env_name, file_env, file_arg, prefix, what):
    raw = os.environ.get(env_name)
    path = file_arg or os.environ.get(file_env)
    if not raw and path:
        try:
            with open(path, encoding="utf-8") as handle:
                raw = handle.read()
        except OSError:
            raise Fail(f"cannot read the {what} file") from None
    raw = (raw or "").strip()
    if not raw:
        raise Fail(f"no {what}: set {env_name} or {file_env}")
    if not raw.startswith(prefix):
        raise Fail(f"the {what} must start with {prefix}")
    if re.search(r"\s", raw):
        raise Fail(f"the {what} contains whitespace")
    return raw


def call(method, path, token, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    context = ssl.create_default_context(cafile=CA_BUNDLE if os.path.exists(CA_BUNDLE) else None)
    try:
        with urllib.request.urlopen(request, timeout=30, context=context) as response:
            status, text = response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        status, text = error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as error:
        raise Fail(f"network error: {type(error).__name__}") from None
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = {"raw": text[:300]}
    return status, parsed


def show(status, payload):
    print(f"HTTP {status}")
    print(json.dumps(scrub(payload), ensure_ascii=False, indent=2)[:4000])


def key_rows(payload):
    data = (payload or {}).get("data", payload)
    rows = data.get("keys") if isinstance(data, dict) else data
    return rows if isinstance(rows, list) else []


def mgmt():
    return read_secret("MAXPLUS_MGMT_TOKEN", "MAXPLUS_MGMT_TOKEN_FILE", None, "ccmk-", "management token")


def inference(args):
    return read_secret("MAXPLUS_KEY", "MAXPLUS_KEY_FILE", args.key_file, "ccsk-", "inference key")


def save_secret(secret, path):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    if "/.git/" in path or os.path.abspath(path).startswith(os.path.abspath(os.getcwd())):
        # A secret inside the working tree could be committed by accident.
        raise Fail("--out must be outside the repository (for example the scratchpad directory)")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(secret + "\n")
    print(f"secret saved to {path} (mode 600), ends with {secret[-4:]}")


def cmd_list(args):
    status, payload = call("GET", "/api-keys", mgmt())
    if status != 200:
        return show(status, payload)
    rows = key_rows(payload)
    print(f"HTTP 200, {len(rows)} keys")
    for row in rows:
        print(json.dumps({k: row.get(k) for k in KEEP_FIELDS if k in row}, ensure_ascii=False))


def cmd_create(args):
    body = {"name": args.name, "limit_usd": args.limit, "limit_period": args.period, "pool": args.pool}
    if args.limit <= 0:
        raise Fail("--limit must be above 0: every CreatorOps key gets a spend limit")
    if args.dry_run:
        print("dry run, would POST /v1/api-keys with", json.dumps(body))
        return
    token = mgmt()
    status, payload = call("GET", "/api-keys", token)
    if status == 200 and any(r.get("name") == args.name for r in key_rows(payload)):
        raise Fail(f"a key named {args.name} already exists: use reroll, or pick another --name")
    status, payload = call("POST", "/api-keys", token, body)
    secret = find_secret(payload)
    show(status, payload)
    if status in (200, 201) and secret:
        save_secret(secret, args.out)
    elif status in (200, 201):
        print("WARNING: created, but no ccsk- secret was found in the reply")


def cmd_patch(args):
    body = {}
    if args.limit is not None:
        if args.limit <= 0:
            raise Fail("--limit must be above 0")
        body["limit_usd"] = args.limit
    if args.period is not None:
        body["limit_period"] = args.period
    if args.active is not None:
        body["active"] = args.active == "true"
    if not body:
        raise Fail("nothing to change")
    show(*call("PATCH", f"/api-keys/{args.id}", mgmt(), body))


def cmd_reroll(args):
    status, payload = call("POST", f"/api-keys/{args.id}/reroll", mgmt())
    secret = find_secret(payload)
    show(status, payload)
    if status in (200, 201) and secret:
        save_secret(secret, args.out)


def cmd_delete(args):
    if not args.yes:
        raise Fail("deleting a key is permanent: add --yes")
    show(*call("DELETE", f"/api-keys/{args.id}", mgmt()))


def cmd_check(args):
    key = inference(args)
    for path in ("/me", "/models"):
        status, payload = call("GET", path, key)
        if status != 200:
            print(f"GET /v1{path} -> HTTP {status}")
            show(status, payload)
            continue
        if path == "/me":
            balance = payload.get("credit_usd") if isinstance(payload, dict) else None
            print(f"GET /v1/me -> 200, balance credit_usd={balance}")
        else:
            items = payload.get("data", []) if isinstance(payload, dict) else []
            ids = [m.get("id") for m in items if isinstance(m, dict)]
            print(f"GET /v1/models -> 200, {len(ids)} models: {', '.join(map(str, ids))}")


def cmd_ping(args):
    """One tiny paid call (a few cents at most) to prove the pool answers chat completions."""
    if not args.yes:
        raise Fail("this makes one paid call: add --yes")
    body = {
        "model": args.model,
        "messages": [{"role": "user", "content": "ตอบคำเดียว: สวัสดี"}],
        "max_tokens": 16,
        "stream": False,
    }
    status, payload = call("POST", "/chat/completions", inference(args), body)
    if status != 200:
        return show(status, payload)
    choice = (payload.get("choices") or [{}])[0]
    usage = payload.get("usage", {})
    print(f"HTTP 200, finish={choice.get('finish_reason')}, reply={scrub(str(choice.get('message', {}).get('content', '')))[:60]!r}")
    print(f"usage: prompt={usage.get('prompt_tokens')} completion={usage.get('completion_tokens')} cost={usage.get('cost', 'not reported')}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="MaxPlus gateway helper (secrets never printed)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list keys (management token)").set_defaults(run=cmd_list)

    create = sub.add_parser("create", help="create a key with a spend limit (management token)")
    create.add_argument("--name", required=True)
    create.add_argument("--limit", type=float, required=True, help="limit_usd, above 0")
    create.add_argument("--period", default="lifetime")
    create.add_argument("--pool", default="native")
    create.add_argument("--out", required=True, help="private file for the one-time secret, outside the repo")
    create.add_argument("--dry-run", action="store_true")
    create.set_defaults(run=cmd_create)

    patch = sub.add_parser("patch", help="change a key's limit or turn it off (management token)")
    patch.add_argument("--id", required=True)
    patch.add_argument("--limit", type=float)
    patch.add_argument("--period")
    patch.add_argument("--active", choices=["true", "false"])
    patch.set_defaults(run=cmd_patch)

    reroll = sub.add_parser("reroll", help="replace a key's secret (management token)")
    reroll.add_argument("--id", required=True)
    reroll.add_argument("--out", required=True)
    reroll.set_defaults(run=cmd_reroll)

    delete = sub.add_parser("delete", help="delete a key for good (management token)")
    delete.add_argument("--id", required=True)
    delete.add_argument("--yes", action="store_true")
    delete.set_defaults(run=cmd_delete)

    for name, run, helptext in (
        ("check", cmd_check, "free checks with an inference key: balance and models"),
        ("ping", cmd_ping, "one tiny paid chat call with an inference key"),
    ):
        command = sub.add_parser(name, help=helptext)
        command.add_argument("--key-file")
        if name == "ping":
            command.add_argument("--model", default="claude-haiku-4-5")
            command.add_argument("--yes", action="store_true")
        command.set_defaults(run=run)

    args = parser.parse_args(argv)
    try:
        args.run(args)
    except Fail as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
