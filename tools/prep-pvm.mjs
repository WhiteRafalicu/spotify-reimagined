// node tools/prep-pvm.mjs <in.glb> <out.glb>: slims dark_igorek's Sony PVM-1341 + PlayStation set for
// the TV corner. Removes parts that face the wall or sit inside the console, then simplifies each
// remaining part by how big it is on screen. Run gltf-transform optimize afterwards for textures.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
// Never seen from the room: the monitor's back panel and rear connectors, and the console's insides.
const DROP = /^(back_pannel|input_out|adapters|body_inner|laser_disc_rotor|laser_plate)/;
// How much of each part to keep (fraction of vertices).
const KEEP = [
  [/^ps_controller/, 0.12],
  [/^connector/, 0.2],
  [/^power/, 0.25],
  [/^ps_cable/, 0.3],
  [/^Ps1_body_details/, 0.3],
  [/^Ps1_body/, 0.35],
  [/^ps1_cap/, 0.35],
  [/^main_body/, 0.4],
  [/^front_panel/, 0.45],
  [/^glass_and_fence/, 1],
];

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
let before = 0;
let after = 0;
const tris = (prim) => (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
for (const prim of root.listMeshes().flatMap((m) => m.listPrimitives())) before += tris(prim);

for (const node of root.listNodes()) {
  const name = node.getName();
  if (DROP.test(name)) {
    node.dispose();
    continue;
  }
  // The console's lid is posed 50° open; its pivot is the hinge, so closing it is just no rotation.
  if (/^ps1_cap/.test(name)) node.setRotation([0, 0, 0, 1]);
}
await doc.transform(weld(), prune());
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  // Sketchfab names the mesh's parent node (e.g. "ps_controller.001_4") and the mesh node "Object_12".
  const parent = node.getParentNode();
  const label = (parent && parent.getName()) || node.getName();
  const keep = KEEP.find(([re]) => re.test(label))?.[1] ?? 0.5;
  if (keep >= 1) continue;
  for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: keep, error: 0.004, lockBorder: false });
}
await doc.transform(prune());
for (const prim of root.listMeshes().flatMap((m) => m.listPrimitives())) after += tris(prim);
await io.write(output, doc);
console.log(`triangles ${before} -> ${after}`);
