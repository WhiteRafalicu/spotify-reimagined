# blender -b --python render.py -- in.glb out.png <front: -y|+y>
import bpy, sys, math
from mathutils import Vector
src, out, side = sys.argv[-3], sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
pts = [o.matrix_world @ Vector(c) for o in bpy.data.objects if o.type == 'MESH' for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
c = (mn + mx) / 2; r = (mx - mn).length
sgn = -1 if side == '-y' else 1
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
bpy.context.scene.collection.objects.link(cam)
cam.location = c + Vector((0.35 * r, sgn * 1.1 * r, 0.45 * r))
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50
sc = bpy.context.scene
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 800, 520
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
