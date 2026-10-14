#!/bin/bash
# tools/prof.sh <label>: GPU ms per pass, CPU ms, triangles at the shelf top, the TV corner, 2x
# resolution, and a fake 2000-disc library. Needs Spotify with DevTools on :9222.
cd ~/Work/cd-shelf
E() { timeout 40 node tools/cdp.mjs eval "$1"; }
E 'if (!location.pathname.includes("cd-shelf")) Spicetify.Platform.History.push("/cd-shelf"); await new Promise(r => setTimeout(r, 9000)); return 1' >/dev/null
POS=$(E 'const r=document.querySelector(".cds-world-gl").getBoundingClientRect(); return Math.round(r.left+r.width*0.5)+" "+Math.round(r.top+r.height*0.4)')
M='window.__cdShelf.profile({ busy: true, timing: true }); await new Promise(r => setTimeout(r, 3500)); return JSON.stringify(window.__cdShelf.profile())'
timeout 20 node tools/wheel.mjs $POS -9000 10; timeout 10 node tools/click.mjs 3 3 move; sleep 2
echo "$1 top:       $(E "$M")"
DPR=$(E 'return window.devicePixelRatio')
E 'window.__cdShelf.profile({ pixelRatio: 1.4 }); return 1' >/dev/null; sleep 1
echo "$1 top@1.4x:  $(E "$M")"
E "window.__cdShelf.profile({ pixelRatio: $DPR }); return 1" >/dev/null
timeout 20 node tools/wheel.mjs $POS 9000 10; sleep 3
echo "$1 corner:    $(E "$M")"
timeout 20 node tools/wheel.mjs $POS -9000 10; sleep 2
E 'const base = await (async () => { const L = Spicetify.Platform.LibraryAPI; const r = await L.getContents({ filters: ["0"], limit: 50, offset: 0 }); return r.items.filter(i => i.type === "album"); })(); const fake = []; for (let i = 0; i < 2000; i++) { const a = base[i % base.length]; const img = a.images?.[0]?.url; fake.push({ kind: "album", uri: a.uri + ":fake" + i, name: a.name + " " + i, artist: a.artists?.[0]?.name || "", thumb: img, art: img, addedAt: "" }); } window.__cdShelf.setItems(fake); await new Promise(r => setTimeout(r, 15000)); return 1' >/dev/null
echo "$1 2000 discs: $(E "$M") heap=$(E 'return (performance.memory.usedJSHeapSize/1e6).toFixed(0)+"MB"')"
E 'window.__cdShelf.profile({ busy: false, timing: false }); location.reload(); return 1' >/dev/null
