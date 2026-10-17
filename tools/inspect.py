import bpy, bmesh, sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[-1])
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    par = o.parent.name if o.parent else ''
    if 'glass' not in par and 'front_panel' not in par: continue
    bm = bmesh.new(); bm.from_mesh(o.data); bm.transform(o.matrix_world)
    # loose parts
    seen = set(); parts = []
    for f in bm.faces:
        if f.index in seen: continue
        stack = [f]; grp = []
        while stack:
            g = stack.pop()
            if g.index in seen: continue
            seen.add(g.index); grp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: stack.append(h)
        area = sum(x.calc_area() for x in grp)
        mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
        for x in grp:
            for v in x.verts:
                for k in range(3): mn[k] = min(mn[k], v.co[k]); mx[k] = max(mx[k], v.co[k])
        nz = sum(x.normal.y * x.calc_area() for x in grp) / max(area, 1e-9)
        mats = {o.data.materials[x.material_index].name for x in grp}
        parts.append((area, len(grp), mn, mx, nz, mats))
    parts.sort(key=lambda p: -p[0])
    print('==', par, o.name, len(bm.faces), 'faces')
    for p in parts[:8]:
        print(f'  area {p[0]:.4f} faces {p[1]} min {tuple(round(c,3) for c in p[2])} max {tuple(round(c,3) for c in p[3])} meanNy {p[4]:.2f} {p[5]}')
