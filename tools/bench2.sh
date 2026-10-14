#!/bin/bash
# tools/bench2.sh <label>: frames per second (rAF count) and GPU load at the shelf top idle,
# hovering, at the TV corner, and with Spotify unfocused.
cd ~/Work/cd-shelf
node tools/cdp.mjs eval 'if (!location.pathname.includes("cd-shelf")) Spicetify.Platform.History.push("/cd-shelf"); await new Promise(r=>setTimeout(r,2500)); return 1' >/dev/null
POS=$(node tools/cdp.mjs eval 'const r=document.querySelector(".cds-world-gl").getBoundingClientRect(); return Math.round(r.left+r.width*0.5)+" "+Math.round(r.top+r.height*0.4)')
gpu() { nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits; }
measure() { node tools/cdp.mjs eval 'window.__cdShelf?.perf?.(); let n = 0; const t0 = performance.now(); await new Promise(r => { const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); const p = window.__cdShelf?.perf?.(); return "raf " + (n / 4).toFixed(0) + "/s" + (p ? " rendered " + p.fps + " fps, cpu " + p.cpuMsPerFrame + " ms/frame, draws " + p.calls : "")' > /tmp/claude-1000/-home-rafalicu-Work/8da326fe-67e3-4076-8d25-58af27c0c491/scratchpad/m.out & local s=0; for i in 1 2 3 4; do sleep 0.9; s=$((s + $(gpu))); done; wait; echo "gpu~$((s/4))% $(cat /tmp/claude-1000/-home-rafalicu-Work/8da326fe-67e3-4076-8d25-58af27c0c491/scratchpad/m.out)"; }
node tools/wheel.mjs $POS -3000 6; node tools/click.mjs 3 3 move; sleep 3
echo "$1 top-idle: $(measure)"
node tools/click.mjs $POS move; sleep 0.5
echo "$1 hovering: $(measure)"
node tools/wheel.mjs $POS 3000 6; node tools/click.mjs 3 3 move; sleep 3
echo "$1 corner:   $(measure)"
