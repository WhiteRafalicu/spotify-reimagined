# blender -b --python optimize.py -- in.glb out.glb
# Sony PVM-1341 + PlayStation (dark_igorek, CC BY 4.0) for the CD Shelf TV corner: drops parts that
# can't be seen from the front (console insides, back-panel plugs), decimates the rest, makes the
# CRT tube its own "CRTScreen" mesh (the flat front glass goes) and turns the set to face -Z in glTF.
import bpy, bmesh, sys, math
import numpy as np
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

# Close the PlayStation's lid. It's modelled standing 50 degrees open, and its node's pivot is the
# hinge, so clearing that node's rotation lays it in its recess exactly as modelled.
cap_node = next(o for o in bpy.data.objects if o.name.startswith('ps1_cap'))
cap_node.rotation_mode = 'QUATERNION'
cap_node.rotation_quaternion = (1, 0, 0, 0)
bpy.context.view_layer.update()
print('LID closed at its hinge pivot')

# One controller is modelled standing on its edge in front of the monitor with nothing holding it.
# The other one (the same model) lies flat, face up: give the standing one that orientation, turned a
# little so they don't look copy-pasted, keep it where it is, and rest it on the floor (Blender: z up).
pad = next(o for o in bpy.data.objects if o.type == 'MESH' and owner(o).startswith('ps_controller.002'))
flat = next(o for o in bpy.data.objects if o.type == 'MESH' and owner(o).startswith('ps_controller.001'))
floor = min((o.matrix_world @ Vector(c)).z for o in bpy.data.objects if o.type == 'MESH' for c in o.bound_box)
def centre(o):
    P = [o.matrix_world @ v.co for v in o.data.vertices]
    return sum(P, Vector()) / len(P)
here = centre(pad)
loc, rot, scl = flat.matrix_world.decompose()
pad.matrix_world = Matrix.LocRotScale(Vector(), Matrix.Rotation(math.radians(35), 4, 'Z').to_quaternion() @ rot, scl)
now = centre(pad)
pad.matrix_world = Matrix.Translation((here.x - now.x, here.y - now.y, 0)) @ pad.matrix_world
zmin = min((pad.matrix_world @ v.co).z for v in pad.data.vertices)
pad.matrix_world = Matrix.Translation((0, 0, floor - zmin + 0.0005)) @ pad.matrix_world
zs = [(pad.matrix_world @ v.co).z for v in pad.data.vertices]
print(f'PAD laid flat like the other one: now {(max(zs) - min(zs)) * 1000:.0f} mm tall')

# Its cable was modelled to plug into the controller's top while it stood: the end now sticks up in
# a hook. Trim the cable faces that rise above the controller's height around where it lies.
cable = next(o for o in bpy.data.objects if o.type == 'MESH' and owner(o).startswith('ps_cable'))
PP = [pad.matrix_world @ v.co for v in pad.data.vertices]
bx0, bx1 = min(p.x for p in PP) - 0.04, max(p.x for p in PP) + 0.04
by0, by1 = min(p.y for p in PP) - 0.04, max(p.y for p in PP) + 0.04
ztop = max(p.z for p in PP)
bm = bmesh.new()
bm.from_mesh(cable.data)
mw = cable.matrix_world
cut = [f for f in bm.faces if any((lambda w: bx0 < w.x < bx1 and by0 < w.y < by1 and w.z > ztop - 0.004)(mw @ v.co) for v in f.verts)]
bmesh.ops.delete(bm, geom=cut, context='FACES')
bm.to_mesh(cable.data)
bm.free()
print(f'CABLE trimmed {len(cut)} faces above the laid-down controller')

# Lived in: the artist's arrangement is squared up like a product shot. Knock each piece a little off
# true, turning it about the point where its cable meets it so nothing comes unplugged.
def turn(objs, pivot, deg):
    M = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, 'Z') @ Matrix.Translation(-pivot)
    for o in objs:
        o.matrix_world = M @ o.matrix_world
def parts(*names):
    return [o for o in bpy.data.objects if o.type == 'MESH' and owner(o).startswith(names)]
CW = [mw @ v.co for v in cable.data.vertices]
def cable_end(o):
    # The pad's point nearest the cable, at floor level.
    P = [o.matrix_world @ v.co for v in o.data.vertices]
    a, b = min(((p, q) for p in P[::7] for q in CW[::5]), key=lambda pq: (pq[0] - pq[1]).length_squared)
    return Vector((a.x, a.y, 0))
port = centre(next(iter(parts('connector.001'))))
turn(parts('Ps1_body', 'ps1_cap', 'connector.001'), Vector((port.x, port.y, 0)), 7)
turn([flat], cable_end(flat), -16)
turn([pad], cable_end(pad), 12)
monitor = parts('main_body', 'front_panel', 'glass_and_fence')
mc = sum((centre(o) for o in monitor), Vector()) / len(monitor)
turn(monitor, Vector((mc.x, mc.y, 0)), -2.5)
print('MESS console +7, pads -16/+12, monitor -2.5 degrees')

# Decimation per part: small-on-screen pieces hardest.
RATIO = [
    ('ps_controller', 0.12), ('connector', 0.3), ('Ps1_body_details', 0.35), ('Ps1_body', 0.35), ('ps1_cap', 0.6),
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
