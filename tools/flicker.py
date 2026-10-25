# uv run --with pillow --with numpy python tools/flicker.py <sweep dir> [threshold]: how often each pixel flips
# between brighter and darker across the frames tools/sweep.mjs recorded; writes heatmap.png (red = flicker).
import sys, glob, numpy as np
from PIL import Image
d = sys.argv[1]; thr = float(sys.argv[2]) if len(sys.argv) > 2 else 12
fs = sorted(glob.glob(d + '/frames/*.jpg'))
L = np.stack([np.asarray(Image.open(f).convert('L'), dtype=np.float32) for f in fs])
D = np.diff(L, axis=0)
S = np.where(D > thr, 1, np.where(D < -thr, -1, 0))
rev = np.zeros(L.shape[1:], np.int32); last = np.zeros(L.shape[1:], np.int8)
for s in S:
    m = s != 0
    rev += (m & (last != 0) & (s != last)).astype(np.int32)
    last = np.where(m, s, last)
print('frames', len(fs), 'max reversals', rev.max(), 'pixels with >=6 reversals', int((rev >= 6).sum()), 'mean |dL|', float(np.abs(D).mean()))
h = np.clip(rev * 20, 0, 255).astype(np.uint8)
base = (L[len(L)//2] * 0.5).astype(np.uint8)
Image.fromarray(np.stack([np.maximum(base, h), base, base], -1)).save(d + '/heatmap.png')
