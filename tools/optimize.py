# blender -b --python optimize.py -- in.glb out.glb
# Sony PVM-1341 + PlayStation (dark_igorek, CC BY 4.0) for the CD Shelf TV corner: drops parts that
# can't be seen from the front (console insides, back-panel plugs), decimates the rest, makes the
# CRT tube its own "CRTScreen" mesh (the flat front glass goes) and turns the set to face -Z in glTF.
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix
src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

def owner(o):
    return o.parent.name if o.parent else o.name
def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
before = sum(tris(o) for o in meshes)

HIDDEN = ('body_inner', 'laser_disc_rotor', 'laser_plate', 'back_pannel', 'input_out', 'input_in', 'adapters', 'ps1_plugs', 'pvm_plugs', 'power')
for o in list(meshes):
    if owner(o).startswith(HIDDEN):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# The screen: the curved tube is the largest loose part of the glass object; the flat front sheet
# (second largest) is removed. Remaining glass/grille faces keep a renamed material.
for o in meshes:
    if not owner(o).startswith('glass_and_fence'):
        continue
    bm = bmesh.new(); bm.from_mesh(o.data)
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
        parts.append((sum(x.calc_area() for x in grp), grp))
    parts.sort(key=lambda p: -p[0])
    tube, sheet = parts[0][1], parts[1][1]
    old = o.data.materials[0]
    old.name = 'pvm_glass_details_mat'
    crt = bpy.data.materials.new('CRTScreen')
    o.data.materials.append(crt)
    for f in tube: f.material_index = len(o.data.materials) - 1
    bmesh.ops.delete(bm, geom=sheet, context='FACES')
    bm.to_mesh(o.data); bm.free()
    # Split the tube into its own object so it's its own mesh in glTF.
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT')
    o.active_material_index = len(o.data.materials) - 1
    bpy.ops.object.material_slot_select(); bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Close the PlayStation's lid (it's modelled standing open): find its plane, then turn it about its
# hinge (the edge nearest the console top) until it lies flat on the body.
import numpy as np
cap = next(o for o in bpy.data.objects if o.type == 'MESH' and owner(o).startswith('ps1_cap'))
body = next(o for o in bpy.data.objects if o.type == 'MESH' and owner(o).startswith('Ps1_body_1'))
V = np.array([cap.matrix_world @ v.co for v in cap.data.vertices])
ctr = V.mean(axis=0)
_, _, vt = np.linalg.svd(V - ctr)
n = Vector(vt[2]).normalized()
up = Vector((0, 0, 1))
if n.dot(up) < 0: n = -n
body_top = max((body.matrix_world @ Vector(c)).z for c in body.bound_box)
low = V[V[:, 2] < V[:, 2].min() + 0.012]
hinge = Vector(low.mean(axis=0))
axis = n.cross(up)
ang = n.angle(up)
if axis.length > 1e-6 and ang > math.radians(3):
    axis.normalize()
    R = Matrix.Translation(hinge) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-hinge)
    cap.matrix_world = R @ cap.matrix_world
    # Rest it on the body (small lift so it doesn't sink in).
    zmin = min((cap.matrix_world @ v.co).z for v in cap.data.vertices)
    cap.matrix_world = Matrix.Translation((0, 0, body_top - zmin - 0.0015)) @ cap.matrix_world
    print(f'LID closed by {math.degrees(ang):.1f} deg')

# Decimation per part: small-on-screen pieces hardest.
RATIO = [
    ('ps_controller', 0.12), ('connector', 0.3), ('Ps1_body_details', 0.2), ('Ps1_body', 0.2), ('ps1_cap', 0.3),
    ('ps_cable', 0.15), ('main_body', 0.18), ('front_panel', 0.3),
]
for o in meshes:
    if any(m and m.name == 'CRTScreen' for m in o.data.materials): continue
    r = next((r for k, r in RATIO if owner(o).startswith(k)), None)
    if not r: continue
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'; mod.ratio = r; mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='dec')

# Face -Z in glTF: Blender's front is -Y, which exports as +Z; turn 180 degrees about Z.
roots = [o for o in bpy.data.objects if o.parent is None]
for o in roots:
    o.matrix_world = Matrix.Rotation(math.pi, 4, 'Z') @ o.matrix_world

after = sum(tris(o) for o in bpy.data.objects if o.type == 'MESH')
print(f'TRIS before {before} after {after}')
for o in sorted([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: -tris(o))[:14]:
    print(f'  {tris(o):6d}  {owner(o)}  {[m.name for m in o.data.materials if m]}')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_apply=True, export_yup=True)
