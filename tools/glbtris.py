# python3 -I tools/glbtris.py a.glb [b.glb ...]: triangles per model (reads the glTF JSON chunk only).
import json, struct, sys
for path in sys.argv[1:]:
    data = open(path, 'rb').read()
    clen, _ = struct.unpack_from('<II', data, 12)
    j = json.loads(data[20:20 + clen])
    acc = j.get('accessors', [])
    tris = sum((acc[p['indices']]['count'] if 'indices' in p else acc[p['attributes']['POSITION']]['count']) // 3
               for m in j.get('meshes', []) for p in m['primitives'])
    print(f"{path.split('/')[-1]}: {tris} triangles, {len(data)/1024:.0f} KB")
