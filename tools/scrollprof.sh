#!/bin/bash
# GPU ms per frame while scrolling continuously (shadows re-rendering), vs at rest.
cd "$(dirname "$0")/.."
E() { timeout 90 node tools/cdp.mjs eval "$1"; }
POS=$(E 'const r=document.querySelector(".cds-world-gl").getBoundingClientRect(); return Math.round(r.left+r.width*0.5)+" "+Math.round(r.top+r.height*0.4)')
timeout 20 node tools/wheel.mjs $POS -9000 8; sleep 2
E 'window.__cdShelf.profile({ busy: true, timing: true }); return 1' >/dev/null
( for i in $(seq 1 30); do timeout 5 node tools/wheel.mjs $POS 60 1; sleep 0.05; done ) &
sleep 0.5; E 'window.__cdShelf.profile(); await new Promise(r => setTimeout(r, 2500)); return "scrolling: " + JSON.stringify(window.__cdShelf.profile().gpuMs)'
wait
sleep 2; E 'window.__cdShelf.profile(); await new Promise(r => setTimeout(r, 2500)); const p = window.__cdShelf.profile(); window.__cdShelf.profile({ busy: false, timing: false }); return "at rest:   " + JSON.stringify(p.gpuMs)'
