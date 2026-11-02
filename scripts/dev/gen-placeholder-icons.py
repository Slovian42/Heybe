#!/usr/bin/env python3
"""生成 Heybe 桌面端占位图标（纯色底 + 字母 H，RGBA）。正式图标由品牌方提供后直接覆盖同名文件。

用法: python3 scripts/dev/gen-placeholder-icons.py   （需要 Pillow：pip install pillow）
输出: apps/desktop/src-tauri/icons/ 下 tauri.conf.json bundle.icon 引用的全部文件 + icon.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "apps/desktop/src-tauri/icons"
BG = (37, 99, 235, 255)   # 占位蓝
FG = (255, 255, 255, 255)


def draw(size: int) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = size // 5
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=BG)
    # 字母 H 用矩形拼（不依赖系统字体，各平台生成结果一致）
    w, top, bot = max(1, size // 7), size * 22 // 100, size * 78 // 100
    lx, rx = size * 28 // 100, size * 72 // 100 - w
    d.rectangle((lx, top, lx + w - 1, bot), fill=FG)
    d.rectangle((rx, top, rx + w - 1, bot), fill=FG)
    my = size // 2 - w // 2
    d.rectangle((lx, my, rx + w - 1, my + w - 1), fill=FG)
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)):
        draw(size).save(OUT / name, format="PNG")
    big = draw(1024)
    big.save(OUT / "icon.icns", format="ICNS")
    big.save(OUT / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"占位图标已写入 {OUT}")


if __name__ == "__main__":
    main()
