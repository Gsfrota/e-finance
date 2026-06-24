#!/usr/bin/env python3
"""Gera ícones PNG para o PWA do e-finance usando apenas stdlib."""
import zlib, struct, os, math

def make_png(width, height, pixels):
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filtro: None
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += bytes([r & 0xFF, g & 0xFF, b & 0xFF])
    compressed = zlib.compress(bytes(raw), 6)

    def crc32(data):
        return zlib.crc32(data) & 0xFFFFFFFF

    def chunk(tag, data):
        c = crc32(tag + data)
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', compressed)
            + chunk(b'IEND', b''))

def lerp_int(a, b, t):
    return int(round(a + (b - a) * max(0.0, min(1.0, t))))

def mix(c1, c2, t):
    return (lerp_int(c1[0], c2[0], t),
            lerp_int(c1[1], c2[1], t),
            lerp_int(c1[2], c2[2], t))

def sign(v): return 1 if v > 0 else (-1 if v < 0 else 0)

def point_in_triangle(px, py, ax, ay, bx, by, cx, cy):
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)

# Cores do tema  ── alinhadas com o SVG do logo
BG     = (15,  29,  51)   # #0f1d33  fundo ink
LIGHT  = (240, 253, 250)  # #f0fdfa  face superior clara
TEAL   = (20,  184, 166)  # #14b8a6  destaque
MID    = (13,  148, 136)  # #0d9488  face inferior direita
DARK   = (15,  118, 110)  # #0f766e  face inferior esquerda
DARKER = (19,  78,  74)   # #134e4a  aresta inferior

def gen_pixels(size):
    # Vértices do diamante (escalonados do SVG 64×64)
    s = size / 64.0
    top    = (32*s,  2*s)
    left   = ( 8*s, 22*s)
    right  = (56*s, 22*s)
    center = (32*s, 32*s)
    bottom = (32*s, 62*s)

    px = []
    for y in range(size):
        for x in range(size):
            # Face superior: quad (top, left, center, right) = 2 triângulos
            in_upper = (
                point_in_triangle(x, y,
                    top[0], top[1], left[0], left[1], center[0], center[1]) or
                point_in_triangle(x, y,
                    top[0], top[1], right[0], right[1], center[0], center[1])
            )
            # Face inferior esquerda
            in_ll = point_in_triangle(x, y,
                left[0], left[1], center[0], center[1], bottom[0], bottom[1])
            # Face inferior direita
            in_lr = point_in_triangle(x, y,
                right[0], right[1], center[0], center[1], bottom[0], bottom[1])

            if in_upper:
                # Gradiente vertical de LIGHT (topo) → TEAL (centro)
                t = (y - top[1]) / max(1.0, center[1] - top[1])
                color = mix(LIGHT, TEAL, t)
            elif in_ll:
                # Gradiente de DARK → DARKER (de cima pra baixo)
                t = (y - center[1]) / max(1.0, bottom[1] - center[1])
                color = mix(DARK, DARKER, t)
            elif in_lr:
                # Gradiente de MID → DARK
                t = (y - center[1]) / max(1.0, bottom[1] - center[1])
                color = mix(MID, DARK, t)
            else:
                color = BG

            px.append(color)
    return px

if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
    os.makedirs(out_dir, exist_ok=True)

    for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
        pixels = gen_pixels(size)
        data = make_png(size, size, pixels)
        path = os.path.join(out_dir, name)
        with open(path, 'wb') as f:
            f.write(data)
        print(f'Gerado: {path} ({len(data)} bytes)')

    print('OK — todos os ícones gerados.')
