#!/bin/bash
# tools/seq.sh <album title prefix> <prefix> : open album, screenshot at a few moments
cd ~/Work/cd-shelf
SP=/tmp/claude-1000/-home-rafalicu-Work/8da326fe-67e3-4076-8d25-58af27c0c491/scratchpad
node tools/watch.mjs "Spicetify.Platform.History.push('/cd-shelf'); await new Promise(r=>setTimeout(r,2500)); const c=[...document.querySelectorAll('.cds-case')].find(b=>b.title.startsWith('$1')); c.click(); return c.title;" 1.4
node tools/cdp.mjs shot $SP/$2-a.png >/dev/null
sleep 1.2; node tools/cdp.mjs shot $SP/$2-b.png >/dev/null
sleep 3.5; node tools/cdp.mjs shot $SP/$2-c.png >/dev/null
echo done
