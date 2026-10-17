import bpy, sys
from mathutils import Vector
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
keep = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent and (o.parent.name.startswith('ps1_cap') or o.parent.name.startswith('Ps1_body_18'))]
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o not in keep: bpy.data.objects.remove(o, do_unlink=True)
pts = [o.matrix_world @ Vector(c) for o in keep for c in o.bound_box]
c = sum(pts, Vector()) / len(pts)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'; w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 1.5; sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sc.collection.objects.link(sun); sun.rotation_euler = (0.6, 0.2, 0.8)
sc.render.resolution_x, sc.render.resolution_y = 500, 400
for name, off in [('top', Vector((0.05, -0.15, 0.5))), ('side', Vector((0.4, -0.3, 0.12)))]:
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cam)
    cam.location = c + off; cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam; sc.render.filepath = out.replace('.png', f'_{name}.png'); bpy.ops.render.render(write_still=True)
