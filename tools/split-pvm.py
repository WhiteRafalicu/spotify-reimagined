# blender -b --python tools/split-pvm.py -- pvm_dec.glb out_dir
# Splits the optimized PVM + PlayStation set (from optimize.py) into pieces the TV corner places one
# by one: monitor (with its CRTScreen tube), PlayStation, and the two controllers. The cables and
# plugs go: they only fit the set's original arrangement. Each piece is centred on its own footprint,
# standing on y = 0 and still facing -z in glTF.
import bpy, sys, os
from mathutils import Vector, Matrix
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

def owner(o):
    while o.parent and o.parent.type == 'MESH':
        o = o.parent
    return (o.parent.name if o.parent else o.name)

PIECES = {
    'pvm_monitor': ('main_body', 'front_panel', 'glass_and_fence'),
    'ps1_console': ('Ps1_body', 'ps1_cap'),
    'ps1_pad_a': ('ps_controller.001',),
    'ps1_pad_b': ('ps_controller.002',),
}
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
membership = {}
for o in meshes:
    name = owner(o)
    piece = next((p for p, keys in PIECES.items() if name.startswith(keys) or o.name.startswith(keys)), None)
    membership[o.name] = piece
    print('PIECE', f'{o.name:28s}', f'{name:24s}', piece)

# Bake every mesh's world transform so pieces can be moved on their own.
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in bpy.data.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
for o in list(meshes):
    if membership[o.name] is None:
        bpy.data.objects.remove(o, do_unlink=True)

# The monitor's power cord is modelled into its cabinet mesh: drop any loose part of the monitor whose
# middle lies outside the cabinet (the side-body shell).
import bmesh
mon = [o for o in bpy.data.objects if o.type == 'MESH' and membership.get(o.name) == 'pvm_monitor']
shell = next(o for o in mon if any(m and m.name == 'pvm_side_body_mat' for m in o.data.materials))
sp = [shell.matrix_world @ Vector(c) for c in shell.bound_box]
# The shell is the cabinet's sides only: the front panel and glass stand ~5 cm proud of it, the back
# ~4 cm behind, so the box reaches further in depth (Blender y) than across (x) and up (z).
smn = Vector([min(p[i] for p in sp) for i in range(3)]) - Vector((0.01, 0.05, 0.01))
smx = Vector([max(p[i] for p in sp) for i in range(3)]) + Vector((0.01, 0.06, 0.01))
for o in mon:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    seen = set()
    drop = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, grp = [f], []
        while stack:
            g = stack.pop()
            if g.index in seen:
                continue
            seen.add(g.index)
            grp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        stack.append(h)
        c = sum((o.matrix_world @ v.co for g in grp for v in g.verts), Vector()) / sum(len(g.verts) for g in grp)
        if not all(smn[i] <= c[i] <= smx[i] for i in range(3)):
            drop += grp
    if drop:
        print('CORD', o.name, 'dropping', len(drop), 'faces')
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        bm.to_mesh(o.data)
    bm.free()

os.makedirs(out, exist_ok=True)
for piece in PIECES:
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and membership.get(o.name) == piece]
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    # Blender is z-up: centre x/y on the footprint, put the bottom at z = 0.
    shift = Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    for o in objs:
        o.matrix_world = shift @ o.matrix_world
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, piece + '.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    size = mx - mn
    print(f'EXPORT {piece}: {len(objs)} objects, {tris} tris, size {size.x:.3f} x {size.y:.3f} x {size.z:.3f} m')
    for o in objs:
        o.matrix_world = shift.inverted() @ o.matrix_world
