import * as THREE from 'three';

// A WebGLRenderer for a visible <canvas>. Chromium blocks <canvas> WebGL for the whole page after
// the GPU process crashes while the page holds contexts (other Spotify extensions can trigger that).
// OffscreenCanvas isn't covered by the block, so fall back to drawing offscreen and handing each
// frame to the visible canvas: call present() after the frame's last render. Returns null when
// there's no WebGL at all.
export function createRenderer(canvas, options) {
  try {
    return { renderer: new THREE.WebGLRenderer({ canvas, ...options }), present: null };
  } catch {}
  try {
    const off = new OffscreenCanvas(1, 1);
    const renderer = new THREE.WebGLRenderer({ canvas: off, ...options });
    const blit = canvas.getContext('bitmaprenderer');
    console.info('[cd-shelf] <canvas> WebGL is blocked on this page; drawing through OffscreenCanvas');
    return { renderer, present: () => blit.transferFromImageBitmap(off.transferToImageBitmap()) };
  } catch {
    return null;
  }
}
