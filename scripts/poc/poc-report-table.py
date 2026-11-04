#!/usr/bin/env python3
r"""boxlite-poc.sh report 的「回填表（自动）」：从 results.tsv 的 METRIC 行生成 Markdown 表。

用法: poc-report-table.py <results.tsv> [status 目录]
METRIC 行格式：METRIC<TAB>时间<TAB>[后端] key=value key2=value2 …
值可能带前导空格（macOS du -sh | cut -f1 → "install_size_boxlite= 96M"）：
旧解析 (\w+)=(\S+) 遇到空格就丢值，表里出现 "lima_install=" 和 "| / 5.7G |"。
现在按 key 的位置切段，每段去掉首尾空白再取第一个词。
"""
import os
import re
import sys

# key 只能出现在行首或空白之后（值里的 a=b 不当成 key），可带 "[backend] " 前缀
KEY = re.compile(r'(?:^|(?<=\s))(\[\w+\] )?(\w+)=')


def parse_metrics(payload):
    """'[boxlite] a= 96M b=x' → {'[boxlite]a': '96M', 'b': 'x'}（key 带后端前缀时去掉中间空格）"""
    out = {}
    hits = list(KEY.finditer(payload))
    for i, h in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(payload)
        seg = payload[h.end():end].strip()
        out[(h.group(1) or "").strip() + h.group(2)] = seg.split()[0] if seg else ""
    return out


def load(res):
    lines = open(res, encoding="utf-8", errors="replace").read().splitlines() if os.path.exists(res) else []
    m = {}
    for l in lines:
        p = l.split("\t", 2)
        if len(p) == 3 and p[0] == "METRIC":
            m.update(parse_metrics(p[2]))
    return lines, m


def main(argv):
    res = argv[1]
    lines, m = load(res)
    def r(kind,b,n):
        pat=f"[{b}] 验证{n}"
        hit=[l.split("\t")[0] for l in lines if pat in l]
        return hit[-1] if hit else "未运行"
    g=lambda k: m.get(k,"")
    rows=[("macOS / 芯片 / 内存",f"{g('macos')} / {g('arch')} / {g('mem_gb')}GB","同左"),
    ("组件版本",f"boxlite={g('boxlite_version')} / {g('fastclaw_version')}",f"lima_install={g('lima_install')}"),
    ("REST 前缀（探测命中，GET <前缀>/boxes）",f"{g('boxlite_rest_prefix')} → {g('boxlite_rest_list_http') or '—'}（/v1/me prefix={g('boxlite_me_prefix')}）","—"),
    ("FastClaw v1.4.0 创建请求体",f"{g('fastclaw_create_compat')}（HTTP {g('fastclaw_create_probe_http')}）","—"),
    ("FastClaw 连接参数",f"URL={g('fastclaw_boxlite_url')} PREFIX={g('fastclaw_boxlite_prefix')} 代理={g('boxlite_proxy') or ('旧垫片'+g('boxlite_shim') if g('boxlite_shim') else '未启用')} 出网={g('boxlite_proxy_outbound') or '未知'}","—"),
    ("Lima 镜像","—",g('lima_image')),
    ("验证1 /v1 流式输出",r(0,'boxlite',1),r(0,'docker',1)),
    ("验证2 ~/Documents 不可读",r(0,'boxlite',2),r(0,'docker',2)),
    ("验证3 出网被拦",r(0,'boxlite',3),r(0,'docker',3)),
    ("冷启动 ms",g('boxlite_cold_create_start_ms'),g('lima_cold_start_ms') or g('lima_restart_ms')),
    ("热启动 ms",g('boxlite_warm_exec_submit_ms'),g('lima_warm_container_ms')),
    ("首轮对话 ms",g('[boxlite]first_turn_ms'),g('[docker]first_turn_ms')),
    ("安装/数据体积",f"{g('install_size_boxlite')} / {g('boxlite_data_size')}",f"{g('lima_install')} / {g('lima_disk')}"),
    ("内存 MB",f"serve={g('boxlite_serve_rss_mb')} vm={g('boxlite_vm_rss_mb')}",g('lima_vm_rss_mb'))]
    print("| 项 | BoxLite | Lima+docker |\n|---|---|---|")
    for a,b,c in rows: print(f"| {a} | {b or '—'} | {c or '—'} |")


if __name__ == "__main__":
    main(sys.argv)
