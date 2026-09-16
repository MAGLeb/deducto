#!/usr/bin/env python3
"""WCAG contrast + CVD simulation helper for the Deducto D3 palette."""
import sys, math, itertools

def hex2rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgb2hex(rgb):
    return '#%02X%02X%02X' % tuple(max(0, min(255, int(round(c)))) for c in rgb)

def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(h):
    r, g, b = hex2rgb(h)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    if la < lb: la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)

def cr(a, b):
    return round(ratio(a, b), 2)

def mix(fg, bg, alpha):
    """alpha in 0..1, fg over bg, simple sRGB blend (what color-mix in srgb does)."""
    f, b = hex2rgb(fg), hex2rgb(bg)
    return rgb2hex([f[i] * alpha + b[i] * (1 - alpha) for i in range(3)])

# ---------- CVD simulation (Viénot, Brettel & Mollon 1999 LMS approach) ----------
RGB2LMS = [[0.31399022, 0.63951294, 0.04649755],
           [0.15537241, 0.75789446, 0.08670142],
           [0.01775239, 0.10944209, 0.87256922]]
LMS2RGB = [[ 5.47221206, -4.6419601 ,  0.16963708],
           [-1.1252419 ,  2.29317094, -0.1678952 ],
           [ 0.02980165, -0.19318073,  1.16364789]]
SIM = {
 'protan':  [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
 'deutan':  [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
 'tritan':  [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]],
}

def matmul(m, v):
    return [sum(m[i][j] * v[j] for j in range(3)) for i in range(3)]

def cvd(h, kind):
    rgb = [lin(c) for c in hex2rgb(h)]
    lms = matmul(RGB2LMS, rgb)
    lms = matmul(SIM[kind], lms)
    out = matmul(LMS2RGB, lms)
    def unlin(c):
        c = max(0.0, min(1.0, c))
        return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1/2.4) - 0.055)
    return rgb2hex([unlin(c) for c in out])

# ---------- CIE Lab / CIEDE2000 ----------
def rgb2xyz(h):
    r, g, b = [lin(c) for c in hex2rgb(h)]
    return (0.4124*r + 0.3576*g + 0.1805*b,
            0.2126*r + 0.7152*g + 0.0722*b,
            0.0193*r + 0.1192*g + 0.9505*b)

def xyz2lab(xyz):
    ref = (0.95047, 1.0, 1.08883)
    def f(t):
        return t ** (1/3) if t > 0.008856 else (7.787 * t + 16/116)
    x, y, z = [f(xyz[i] / ref[i]) for i in range(3)]
    return (116*y - 16, 500*(x - y), 200*(y - z))

def lab(h): return xyz2lab(rgb2xyz(h))

def de2000(h1, h2):
    L1, a1, b1 = lab(h1); L2, a2, b2 = lab(h2)
    avgL = (L1 + L2) / 2
    C1 = math.hypot(a1, b1); C2 = math.hypot(a2, b2)
    avgC = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(avgC**7 / (avgC**7 + 25**7))) if avgC > 0 else 0
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    avgCp = (C1p + C2p) / 2
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp = L2 - L1; dCp = C2p - C1p
    if C1p * C2p == 0: dhp = 0
    elif abs(h2p - h1p) <= 180: dhp = h2p - h1p
    elif h2p - h1p > 180: dhp = h2p - h1p - 360
    else: dhp = h2p - h1p + 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2)
    if C1p * C2p == 0: avghp = h1p + h2p
    elif abs(h1p - h2p) <= 180: avghp = (h1p + h2p) / 2
    elif h1p + h2p < 360: avghp = (h1p + h2p + 360) / 2
    else: avghp = (h1p + h2p - 360) / 2
    T = (1 - 0.17*math.cos(math.radians(avghp - 30)) + 0.24*math.cos(math.radians(2*avghp))
         + 0.32*math.cos(math.radians(3*avghp + 6)) - 0.20*math.cos(math.radians(4*avghp - 63)))
    dTh = 30 * math.exp(-(((avghp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(avgCp**7 / (avgCp**7 + 25**7)) if avgCp > 0 else 0
    Sl = 1 + (0.015 * (avgL - 50)**2) / math.sqrt(20 + (avgL - 50)**2)
    Sc = 1 + 0.045 * avgCp
    Sh = 1 + 0.015 * avgCp * T
    Rt = -math.sin(math.radians(2 * dTh)) * Rc
    return math.sqrt((dLp/Sl)**2 + (dCp/Sc)**2 + (dHp/Sh)**2 + Rt*(dCp/Sc)*(dHp/Sh))

def cvd_report(colors, names=None):
    names = names or colors
    out = []
    for kind in ('normal', 'deutan', 'protan', 'tritan'):
        sim = [c if kind == 'normal' else cvd(c, kind) for c in colors]
        worst = None
        for (i, j) in itertools.combinations(range(len(colors)), 2):
            d = de2000(sim[i], sim[j])
            if worst is None or d < worst[0]:
                worst = (d, names[i], names[j])
        out.append((kind, round(worst[0], 1), worst[1], worst[2], [s for s in sim]))
    return out

if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == 'cvd':
        for row in cvd_report(args[1:]):
            print(f"{row[0]:8s} worst ΔE00 = {row[1]:5.1f}  ({row[2]} vs {row[3]})   sim: {' '.join(row[4])}")
    else:
        for i in range(0, len(args) - 1, 2):
            print(f"{args[i]} on {args[i+1]}: {cr(args[i], args[i+1])}:1")
