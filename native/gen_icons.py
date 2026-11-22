import math
import os
import struct
import zlib

BG = (15, 20, 25, 255)        # #0f1419
AMBER = (217, 119, 6, 255)    # #d97706
CREAM = (254, 243, 199, 255)  # #fef3c7
BROWN = (120, 53, 15, 255)    # #78350f


def write_png(path, w, h, rgba_bytes):
    def chunk(tag, data):
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba_bytes[y * stride : (y + 1) * stride])

    ihdr = struct.pack("!IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 6)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def render_icon(size, round_mask=False, transparent_bg=False):
    buf = bytearray(size * size * 4)
    for py in range(size):
        for px in range(size):
            # Normalize to 0..108 coordinate space
            x = (px + 0.5) * 108.0 / size
            y = (py + 0.5) * 108.0 / size

            if round_mask:
                if math.hypot(x - 54.0, y - 54.0) > 52.0:
                    continue

            col = (0, 0, 0, 0) if transparent_bg else BG

            # Golden Map Pin: circle top (cx=54, cy=45, r=26) + tapered bottom to (54, 88)
            in_pin = False
            if y <= 48.0:
                if math.hypot(x - 54.0, y - 45.0) <= 26.0:
                    in_pin = True
            elif y <= 88.0:
                # Smooth taper from width 25.8 at y=48 to 0 at y=88
                t = (y - 48.0) / 40.0
                half_w = 25.8 * ((1.0 - t) ** 0.72)
                if abs(x - 54.0) <= half_w:
                    in_pin = True

            if in_pin:
                col = AMBER

            # Cream inner circle (cx=54, cy=45, r=15.5)
            if math.hypot(x - 54.0, y - 45.0) <= 15.5:
                col = CREAM

            # Brown historic arch silhouette inside cream circle
            if 43.0 <= x <= 65.0 and 39.0 <= y <= 53.0:
                arch_top = 39.0 + ((x - 54.0) / 11.0) ** 2 * 6.0
                if y >= arch_top:
                    # Cutout inner arch door
                    if not (48.5 <= x <= 59.5 and y >= 45.5 + ((x - 54.0) / 5.5) ** 2 * 3.0):
                        col = BROWN

            idx = (py * size + px) * 4
            buf[idx : idx + 4] = bytes(col)
    return buf


DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def main(res_dir):
    for d, px in DENSITIES.items():
        mip = os.path.join(res_dir, f"mipmap-{d}")
        write_png(os.path.join(mip, "ic_launcher.png"), px, px, render_icon(px, round_mask=False, transparent_bg=False))
        write_png(os.path.join(mip, "ic_launcher_round.png"), px, px, render_icon(px, round_mask=True, transparent_bg=False))
        fg_px = int(px * 108 / 48) if px == 48 else int(px * 2.25)
        write_png(os.path.join(mip, "ic_launcher_foreground.png"), fg_px, fg_px, render_icon(fg_px, round_mask=False, transparent_bg=True))


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "android/app/src/main/res")
