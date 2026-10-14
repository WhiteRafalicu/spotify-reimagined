#!/bin/bash
# tools/bench.sh <label>: 4 s of perf numbers at the shelf top, while hovering, and at the TV corner.
cd ~/Work/cd-shelf
POS=$(node tools/cdp.mjs eval 'const r=document.querySelector(".cds-world-gl").getBoundingClientRect(); return Math.round(r.left+r.width*0.5)+" "+Math.round(r.top+r.height*0.4)')
measure() { node tools/cdp.mjs eval 'window.__cdShelf.perf(); await new Promise(r=>setTimeout(r,4000)); return JSON.stringify(window.__cdShelf.perf())'; }
node tools/wheel.mjs $POS -3000 6; node tools/click.mjs 5 5 move; sleep 2
echo "$1 top-idle:  $(measure) gpu=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader)"
node tools/click.mjs $POS move; sleep 1
echo "$1 hover:     $(measure) gpu=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader)"
node tools/wheel.mjs $POS 3000 6; node tools/click.mjs 5 5 move; sleep 3
echo "$1 corner:    $(measure) gpu=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader)"
