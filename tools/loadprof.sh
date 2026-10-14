#!/bin/bash
# Times the TV corner's models on a fresh shelf and on a return visit (Search -> shelf), plus the
# longest main-thread stalls while they load.
cd ~/Work/cd-shelf
E() { timeout 90 node tools/cdp.mjs eval "$1"; }
visit() {
  E 'window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __lt.push(Math.round(e.duration)); }).observe({ type: "longtask" }); } catch {} Spicetify.Platform.History.push("/search"); await new Promise(r => setTimeout(r, 2500)); const t0 = performance.now(); Spicetify.Platform.History.push("/cd-shelf"); let s = null; while (performance.now() - t0 < 12000) { await new Promise(r => setTimeout(r, 100)); const d = window.__cdShelf?.debug?.(); s = d?.screen?.timing; if (s && s.tv && s.ps2 && s.pad && s.table && s.tray) break; } const d = window.__cdShelf.debug(); return JSON.stringify({ firstFrame: d.firstFrameMs, models: d.screen.timing, longTasksMs: __lt.sort((a, b) => b - a).slice(0, 6) })'
}
echo "visit 1: $(visit)"
echo "visit 2: $(visit)"
