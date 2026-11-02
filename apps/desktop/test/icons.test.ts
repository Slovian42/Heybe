import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// tauri::generate_context! 在编译期读取图标：缺文件会直接 panic（2026-11-02 Mac：icons/icon.png 不存在）。
// 这里保证 tauri.conf.json 引用的每个图标都在，PNG 是 RGBA（Tauri 要求）。目前是占位图标，见 icons/README.md。
const tauriDir = new URL("../src-tauri/", import.meta.url);
const conf = JSON.parse(readFileSync(new URL("tauri.conf.json", tauriDir), "utf8")) as {
  bundle?: { icon?: string[] };
};
// 未配置 bundle.icon 时 Tauri 默认读 icons/icon.png；配置了也保留它（窗口/托盘默认图标）。
const icons = [...new Set([...(conf.bundle?.icon ?? []), "icons/icon.png"])];

function pngInfo(buf: Buffer): { width: number; height: number; colorType: number } {
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(buf.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

describe("tauri icons", () => {
  it("bundle.icon lists png, icns and ico", () => {
    const list = conf.bundle?.icon ?? [];
    expect(list.some((f) => f.endsWith(".png"))).toBe(true);
    expect(list.some((f) => f.endsWith(".icns"))).toBe(true);
    expect(list.some((f) => f.endsWith(".ico"))).toBe(true);
  });

  it.each(icons)("%s exists and is valid", (rel) => {
    const url = new URL(rel, tauriDir);
    expect(existsSync(url), `${rel} missing; run python3 scripts/dev/gen-placeholder-icons.py`).toBe(true);
    const buf = readFileSync(url);
    if (rel.endsWith(".png")) {
      const { width, height, colorType } = pngInfo(buf);
      expect(colorType, `${rel} must be RGBA (PNG color type 6)`).toBe(6);
      expect(width).toBe(height);
      const m = /(\d+)x(\d+)(@2x)?\.png$/.exec(rel);
      if (m) expect(width).toBe(Number(m[1]) * (m[3] ? 2 : 1));
    } else if (rel.endsWith(".icns")) {
      expect(buf.subarray(0, 4).toString("latin1")).toBe("icns");
      expect(buf.readUInt32BE(4)).toBe(buf.length);
    } else if (rel.endsWith(".ico")) {
      expect(buf.readUInt16LE(0)).toBe(0);
      expect(buf.readUInt16LE(2)).toBe(1);
      expect(buf.readUInt16LE(4)).toBeGreaterThan(0);
    }
  });
});
