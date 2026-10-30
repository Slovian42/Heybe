#!/usr/bin/env python3
"""Heybe PoC 本地兼容垫片：FastClaw v1.4.0 ↔ BoxLite serve 0.10.x。

只做一件事：把 `POST …/boxes` 请求体里的 `auto_remove` 字段去掉再转发。
原因（均已对照源码）：
  - FastClaw v1.4.0 internal/sandbox/boxlite_executor.go createBox() 固定发送
    {"image": ..., "auto_remove": true}
  - BoxLite v0.10.0 起 CreateBoxRequest 删除了 auto_remove，且带
    #[serde(deny_unknown_fields)]（src/cli/src/commands/serve/types.rs），
    多一个字段就整体拒绝（axum Json 422 "unknown field `auto_remove`"）。
  - FastClaw 关闭时会显式 DELETE /boxes/{id}?force=true，所以去掉 auto_remove
    只影响"FastClaw 崩溃时残留的 box 不会自动回收"，PoC 可接受。
其余字节（含 WebSocket attach 升级后的帧）原样透传。只监听 127.0.0.1。

用法: boxlite-shim.py <listen_port> <upstream_port>
"""
import asyncio
import json
import sys

HOST = "127.0.0.1"


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def rewrite(method, path, body):
    if method != "POST" or not path.split("?", 1)[0].endswith("/boxes"):
        return body, False
    try:
        obj = json.loads(body.decode() or "null")
    except ValueError:
        return body, False
    if isinstance(obj, dict) and "auto_remove" in obj:
        obj.pop("auto_remove")
        return json.dumps(obj).encode(), True
    return body, False


async def client_to_upstream(cr, uw):
    try:
        while True:
            head = await cr.readuntil(b"\r\n\r\n")
            lines = head.decode("latin-1").split("\r\n")
            method, path = (lines[0].split(" ") + ["", ""])[:2]
            headers = [l for l in lines[1:] if l]
            lower = {}
            for l in headers:
                k, _, v = l.partition(":")
                lower[k.strip().lower()] = v.strip()
            if "chunked" in lower.get("transfer-encoding", "").lower():
                uw.write(head)  # 不改写分块请求，之后整条连接原样透传
                await uw.drain()
                await pipe(cr, uw)
                return
            n = int(lower.get("content-length", "0") or 0)
            body = await cr.readexactly(n) if n else b""
            body, changed = rewrite(method, path, body)
            if changed:
                headers = [l for l in headers if not l.lower().startswith("content-length:")]
                headers.append("Content-Length: %d" % len(body))
                sys.stderr.write("shim: %s %s 去掉 auto_remove\n" % (method, path.split("?", 1)[0]))
                sys.stderr.flush()
            uw.write(("\r\n".join([lines[0]] + headers) + "\r\n\r\n").encode("latin-1") + body)
            await uw.drain()
            if "websocket" in lower.get("upgrade", "").lower():
                await pipe(cr, uw)
                return
    except (asyncio.IncompleteReadError, ConnectionError, asyncio.LimitOverrunError):
        pass
    finally:
        try:
            uw.close()
        except Exception:
            pass


async def handle(cr, cw, upstream_port):
    try:
        ur, uw = await asyncio.open_connection(HOST, upstream_port)
    except OSError:
        cw.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        await cw.drain()
        cw.close()
        return
    await asyncio.gather(client_to_upstream(cr, uw), pipe(ur, cw))


async def main():
    listen_port, upstream_port = int(sys.argv[1]), int(sys.argv[2])
    srv = await asyncio.start_server(lambda r, w: handle(r, w, upstream_port), HOST, listen_port)
    sys.stderr.write("shim: listening %s:%d -> %s:%d\n" % (HOST, listen_port, HOST, upstream_port))
    sys.stderr.flush()
    async with srv:
        await srv.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
