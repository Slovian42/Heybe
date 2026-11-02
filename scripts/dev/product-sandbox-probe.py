#!/usr/bin/env python3
"""product-sandbox-check.sh 的进程/端口/环境检查（Linux 读 /proc，macOS 用 ps -E 和 lsof）。
只打印 pid、端口、计数和分类结果；环境变量和 argv 里的值从不打印。

  tree <pid>            本 pid 及全部子孙 pid，一行一个
  listen <pid>          进程树里 TCP LISTEN 的「pid 地址 端口」，一行一个
  envcheck <pid>        deploy=<hosted|other|missing> allow_host_exec=<0|1>
  argvscan <pid>        known=<全部进程 argv 里已知密钥值命中数> pattern=<进程树 argv 模式命中数>
                        procs=<扫描的进程数> secrets=<已知密钥值个数>
                        已知密钥值 = 进程树环境里名字以 KEY/TOKEN/SECRET/PASSWORD 结尾的值（长度≥12）
                        + 本脚本环境 HEYBE_CHECK_SECRET_VARS 列出的变量的值
"""
import os, re, subprocess, sys

IS_LINUX = sys.platform.startswith("linux")


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, errors="replace").stdout
    except FileNotFoundError:
        return ""


def all_procs():
    """{pid: (ppid, argv 字符串)}"""
    out = {}
    for line in run(["ps", "-axww", "-o", "pid=,ppid=,command="]).splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            out[int(parts[0])] = (int(parts[1]), parts[2] if len(parts) > 2 else "")
    return out


def tree(root, procs=None):
    procs = procs if procs is not None else all_procs()
    if root not in procs:
        return []
    res, todo = [], [root]
    while todo:
        p = todo.pop()
        res.append(p)
        todo.extend(c for c, (pp, _) in procs.items() if pp == p and c not in res)
    return sorted(res)


def environ(pid):
    """{name: value}；读不到返回 {}。"""
    if IS_LINUX:
        try:
            raw = open(f"/proc/{pid}/environ", "rb").read().decode(errors="replace")
        except OSError:
            return {}
        return dict(kv.split("=", 1) for kv in raw.split("\0") if "=" in kv)
    # macOS：ps -E 把环境接在命令后面（同用户进程）；按「 NAME=值」切分，密钥里没有空格
    cmd = run(["ps", "-E", "-ww", "-o", "command=", "-p", str(pid)])
    return {m.group(1): m.group(2) for m in re.finditer(r"(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=(\S*)", cmd)}


def listen(root):
    pids = tree(root)
    rows = []
    if not pids:
        return rows
    lsof = run(["lsof", "-nP", "-a", "-p", ",".join(map(str, pids)), "-iTCP", "-sTCP:LISTEN", "-F", "pn"])
    if lsof:
        cur = None
        for line in lsof.splitlines():
            if line.startswith("p"):
                cur = int(line[1:])
            elif line.startswith("n") and cur is not None:
                addr, _, port = line[1:].rpartition(":")
                rows.append((cur, addr.strip("[]"), port))
        return rows
    want = set(pids)
    for line in run(["ss", "-Hltnp"]).splitlines():
        f = line.split()
        if len(f) < 4:
            continue
        addr, _, port = f[3].rpartition(":")
        for m in re.finditer(r"pid=(\d+)", line):
            if int(m.group(1)) in want:
                rows.append((int(m.group(1)), addr.strip("[]"), port))
    return sorted(set(rows))


# 名字以 KEY/TOKEN/SECRET/PASSWORD 结尾的变量才算密钥（PASSWORD_STORE_DIR 这类路径变量不算）
SECRET_NAME = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD)$", re.I)
PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password)[=:]\S{8,}"),
    re.compile(r"(?i)--?(api[_-]?key|token|secret|password)\s+\S{8,}"),
    re.compile(r"\bsk-[A-Za-z0-9]{16,}"),
    re.compile(r"(?i)\bBearer\s+\S{8,}"),
]


def argvscan(root):
    procs = all_procs()
    mine = tree(root, procs)
    secrets = set()
    for p in mine:
        for k, v in environ(p).items():
            if SECRET_NAME.search(k) and len(v) >= 12 and not v.startswith("/"):
                secrets.add(v)
    for name in os.environ.get("HEYBE_CHECK_SECRET_VARS", "").split():
        v = os.environ.get(name, "")
        if len(v) >= 12:
            secrets.add(v)
    me = os.getpid()
    known = sum(1 for p, (_, cmd) in procs.items() if p != me for s in secrets if s in cmd)
    pattern = sum(1 for p in mine for rx in PATTERNS if rx.search(procs[p][1]))
    print(f"known={known} pattern={pattern} procs={len(procs)} secrets={len(secrets)}")


def main():
    if len(sys.argv) != 3 or not sys.argv[2].isdigit():
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    cmd, pid = sys.argv[1], int(sys.argv[2])
    if cmd == "tree":
        print("\n".join(map(str, tree(pid))))
    elif cmd == "listen":
        for p, a, port in listen(pid):
            print(p, a, port)
    elif cmd == "envcheck":
        env = environ(pid)
        d = env.get("FASTCLAW_DEPLOY")
        print(f"deploy={'missing' if d is None else ('hosted' if d == 'hosted' else 'other')} "
              f"allow_host_exec={1 if 'FASTCLAW_ALLOW_HOST_EXEC' in env else 0} env_vars={len(env)}")
    elif cmd == "argvscan":
        argvscan(pid)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
