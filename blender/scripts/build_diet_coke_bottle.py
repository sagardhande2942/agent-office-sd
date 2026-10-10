"""Reusable lightweight glass cola bottle. Blender Z-up, glTF Y-up, front toward +Z."""
import bpy, math
from pathlib import Path
from mathutils import Vector
LABEL=Path(__file__).resolve().parents[1]/'textures'/'diet-coke-label.png'
def material(name,color,rough=.3,metal=0,alpha=1):
 m=bpy.data.materials.get(name)
 if m: return m
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,alpha); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,alpha)
 p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal; p.inputs['Alpha'].default_value=alpha
 if alpha<1: m.surface_render_method='DITHERED'
 return m

def lathe(name,profile,mat,parent,segments=20):
 vertices=[]; faces=[]; uv=[]
 for z,r in profile:
  for i in range(segments+1):
   a=2*math.pi*i/segments; vertices.append((r*math.sin(a),-r*math.cos(a),z)); uv.append((i/segments,z/.23))
 for j in range(len(profile)-1):
  for i in range(segments):
   a=j*(segments+1)+i; faces.append((a,a+1,a+segments+2,a+segments+1))
 mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces); mesh.update()
 layer=mesh.uv_layers.new(name='Label UV')
 for poly in mesh.polygons:
  poly.use_smooth=True
  for idx in poly.loop_indices: layer.data[idx].uv=uv[mesh.loops[idx].vertex_index]
 o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); o.parent=parent; o.data.materials.append(mat)
 return o

def build_bottle(name='diet_coke_bottle',at=(0,0,0)):
 root=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(root); root.location=at
 amber=material('DietCoke amber cola',(.075,.013,.002),.17,.05)
 glass=material('DietCoke clear glass',(.82,.9,.82),.12,.08,.36)
 cap=material('DietCoke silver crown',(.67,.7,.72),.25,.35)
 paper=material('DietCoke printed label',(1,1,1),.57)
 p=paper.node_tree.nodes.get('Principled BSDF')
 if not p.inputs['Base Color'].is_linked:
  tex=paper.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=bpy.data.images.load(str(LABEL)); tex.image.pack(); paper.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 # Contour bottle: broad heel, curved waist, sloping shoulder and a narrow clear neck.
 lathe('DietCoke bottle body',[(0,0),(.003,.026),(.008,.030),(.025,.031),(.055,.029),(.078,.025),(.105,.025),(.132,.030),(.155,.030),(.174,.024),(.19,.015),(.197,.014),(.198,0)],amber,root)
 lathe('DietCoke glass neck',[(.184,.0155),(.193,.016),(.205,.014),(.212,.014),(.216,.016),(.218,.016),(.22,.015)],glass,root)
 # The sleeve is slightly proud of the waist, with a correct cylindrical UV unwrap.
 label=lathe('DietCoke label',[(.09,.0258),(.14,.0313)],paper,root)
 for poly in label.data.polygons:
  for idx in poly.loop_indices:
   uv=label.data.uv_layers.active.data[idx].uv; uv.x+=.25; uv.y=0 if label.data.vertices[label.data.loops[idx].vertex_index].co.z<.1 else 1
 # Twenty-one scallops around the crown instead of a plain cylinder.
 vertices=[]; faces=[]; n=42
 for z,r in [(.219,.017),(.224,.0175),(.228,.0165)]:
  for i in range(n):
   a=2*math.pi*i/n; radius=r+(.001 if i%2 else 0); vertices.append((radius*math.sin(a),-radius*math.cos(a),z))
 for j in range(2):
  for i in range(n): faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 faces.append(tuple(range(2*n,3*n)))
 mesh=bpy.data.meshes.new('Crown'); mesh.from_pydata(vertices,[],faces); mesh.update()
 o=bpy.data.objects.new('DietCoke crown cap',mesh); bpy.context.collection.objects.link(o); o.parent=root; o.data.materials.append(cap)
 # A few restrained condensation beads, kept in one mesh.
 drops=[]
 for i in range(12):
  z=.025+(i%4)*.041; a=(i*2.399); r=.03 if z<.07 or z>.125 else .026
  bpy.ops.mesh.primitive_uv_sphere_add(segments=6,ring_count=3,radius=.0015+(i%3)*.0004,location=(r*math.sin(a),-r*math.cos(a),z))
  o=bpy.context.object; o.name='DietCoke condensation'; o.scale.z=1.35; o.data.materials.append(glass); drops.append(o)
 bpy.ops.object.select_all(action='DESELECT')
 for o in drops: o.select_set(True)
 bpy.context.view_layer.objects.active=drops[0]; bpy.ops.object.join(); drops[0].parent=root
 return root

if __name__=='__main__':
 import argparse,sys
 parser=argparse.ArgumentParser(); parser.add_argument('--out',default=str(Path(__file__).resolve().parents[2]/'artifacts'/'diet-coke-bottle'))
 args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []); out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 root=build_bottle(); bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(out/'diet-coke-bottle.glb'),export_format='GLB',use_selection=True)
 scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.render.resolution_x=800; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
 bpy.ops.object.camera_add(location=(.1,-.8,.25)); cam=bpy.context.object; cam.rotation_euler=(Vector((0,0,.115))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO'; cam.data.ortho_scale=.29; scene.camera=cam
 for loc,power,size in [((-.4,-.4,.5),3.5,.4),((.4,-.1,.4),2.5,.3),((0,.4,.35),4.5,.3)]:
  bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.data.energy=power; o.data.size=size; o.rotation_euler=(Vector((0,0,.12))-o.location).to_track_quat('-Z','Y').to_euler()
 scene.world.color=(.4,.4,.4); scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=True; scene.render.filepath=str(out/'preview.png')
 bpy.ops.wm.save_as_mainfile(filepath=str(out/'diet-coke-bottle.blend')); bpy.ops.render.render(write_still=True)
