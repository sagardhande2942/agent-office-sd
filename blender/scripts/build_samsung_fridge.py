import bpy, math, os
from mathutils import Vector
import argparse, sys
from pathlib import Path
parser=argparse.ArgumentParser(); parser.add_argument('--out', default=str(Path(__file__).resolve().parents[2] / 'artifacts' / 'samsung-fridge'))
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=args.out; os.makedirs(OUT,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(name,color,metal=0,rough=.4):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
 return m
silver=mat('Brushed stainless steel',(.43,.46,.49),.8,.32)
black=mat('Dark trim',(.018,.022,.027),.2,.3)
inner=mat('Dispenser interior',(.035,.04,.045),.25,.4)
chrome=mat('Metal edges',(.55,.58,.6),.85,.23)
display=mat('Dispenser screen',(.01,.025,.035),.3,.2)
white=mat('Printed silver lettering',(.8,.82,.84),.3,.4)
green=mat('Energy label green',(.19,.46,.13),0,.65)
cream=mat('Energy label paper',(.85,.87,.55),0,.7)
red=mat('Energy label header',(.52,.025,.018),0,.5)
def box(name,loc,scale,material,bevel=.006):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.name=name; o.dimensions=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(material)
 if bevel:
  m=o.modifiers.new('Soft manufactured edges','BEVEL'); m.width=bevel; m.segments=3
  bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=m.name)
  m=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=m.name)
 return o
# Front faces -Y; footprint 0.91 x 0.72 metres, height 1.79 metres.
liner=mat('White insulated liner',(.82,.87,.9),0,.4)
box('Cabinet back',(0,.344,.91),(.91,.048,1.74),silver)
box('Interior back',(0,.309,.91),(.82,.016,1.64),liner)
box('Cabinet floor',(0,.025,.105),(.88,.65,.10),liner)
box('Cabinet ceiling',(0,.025,1.738),(.88,.65,.075),liner)
for xx in [-.417,.417]: box('Cabinet side insulation',(xx,.025,.92),(.065,.65,1.65),liner)
box('Compartment divider',(-.016,.023,.92),(.032,.64,1.65),liner)

box('Left steel side',(-.452,.025,.91),(.012,.67,1.72),silver)
box('Right steel side',(.452,.025,.91),(.012,.67,1.72),silver)
box('Steel top',(0,.025,1.78),(.90,.68,.015),silver)
# Left door is split into panels around a genuinely recessed dispenser cavity.
x=-.241; width=.412; bottom=.055; top=1.785; hole_b=.96; hole_t=1.235; hole_w=.218
door=box('Freezer door',(x,-.349,(top+bottom)/2),(width,.075,top-bottom),silver,0)
cutter=box('Temporary dispenser cutout',(x,-.38,(hole_t+hole_b)/2),(hole_w,.12,hole_t-hole_b),black,0)
bpy.context.view_layer.objects.active=door
modifier=door.modifiers.new('Recessed dispenser opening','BOOLEAN'); modifier.operation='DIFFERENCE'; modifier.object=cutter
bpy.ops.object.modifier_apply(modifier=modifier.name); bpy.data.objects.remove(cutter,do_unlink=True)
modifier=door.modifiers.new('Continuous door edges','BEVEL'); modifier.width=.004; modifier.segments=3
bpy.ops.object.modifier_apply(modifier=modifier.name)
modifier=door.modifiers.new('Door normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=modifier.name)
box('Refrigerator door',(.232,-.349,.92),(.43,.075,1.73),silver,.01)
box('Center shadow gap',(-.011,-.338,.92),(.026,.022,1.735),black,.001)
for xx in [-.027,.005]: box('Recessed full height grip',(xx,-.383,.92),(.012,.014,1.70),black,.003)
# Recessed water dispenser, black surround, screen, paddle, nozzle and drip tray.
box('Dispenser cavity back',(x,-.305,1.0975),(hole_w,.012,.275),inner,.003)
for xx in [x-hole_w/2+.007,x+hole_w/2-.007]: box('Dispenser vertical bezel',(xx,-.361,1.0975),(.014,.065,.275),black,.003)
box('Dispenser upper bezel',(x,-.367,1.223),(hole_w,.065,.024),black,.003)
box('Dispenser lower lip',(x,-.374,.973),(hole_w,.065,.025),black,.003)
box('Control face',(x,-.369,1.2),(.105,.014,.043),black,.004)
box('Control screen',(x,-.379,1.205),(.084,.004,.022),display,.002)
for dx in [-.024,0,.024]: box('Control indicator',(x+dx,-.382,1.194),(.012,.002,.0025),white,.0005)
box('Water lever',(x,-.331,1.079),(.073,.018,.145),black,.009)
box('Water outlet',(x,-.34,1.166),(.022,.03,.018),chrome,.003)
box('Drip tray',(x,-.349,.987),(.174,.06,.009),inner,.002)
for i in range(9): box('Drip tray grate',(x-.072+i*.018,-.353,.993),(.004,.044,.003),chrome,.0005)
for xx in [-.395,.395]:
 for yy in [-.255,.275]: box('Adjustable foot',(xx,yy,.035),(.055,.07,.055),black,.008)
box('Lower kick plate',(0,-.32,.054),(.84,.026,.025),chrome,.003)
def text(name,body,loc,size,material):
 c=bpy.data.curves.new(name,'FONT'); c.body=body; c.size=size; c.align_x='CENTER'; c.extrude=.00015
 o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o); o.location=loc; o.rotation_euler=(math.pi/2,0,0); o.data.materials.append(material)
 bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o.select_set(False)
text('Samsung wordmark','SAMSUNG',(.347,-.389,1.728),.016,white)
box('Energy sticker',(.347,-.389,1.616),(.077,.001,.145),cream,.0005)
box('Energy sticker green border',(.347,-.390,1.669),(.077,.001,.019),green,.0005)
box('Energy sticker header',(.347,-.391,1.681),(.07,.001,.014),red,.0005)
text('Energy label title','ENERGY',(.347,-.392,1.658),.010,black)
text('Energy label rating','***',(.347,-.392,1.639),.013,black)
for i in range(5): box('Energy label printed line',(.347,-.392,1.617-i*.012),(.058-i%2*.01,.001,.0015),green,0)
# Door hinges: Blender Z becomes glTF Y. Preserve world transforms while parenting.
def parent_to(o,p):
 world=o.matrix_world.copy(); o.parent=p; o.matrix_world=world
bpy.context.view_layer.update()
def empty(name,loc):
 o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.location=loc; return o
left=empty('fridge_left_hinge',(-.447,-.349,0))
right=empty('fridge_right_hinge',(.447,-.349,0))
bpy.context.view_layer.update()
for o in list(bpy.context.scene.objects):
 n=o.name
 if n.startswith(('Freezer door','Dispenser','Control','Water','Drip')): parent_to(o,left)
 elif n.startswith(('Refrigerator door','Samsung','Energy')): parent_to(o,right)
 elif n.startswith('Recessed full height grip'): parent_to(o,left if o.location.x<0 else right)
for hinge,xx in [(left,-.241),(right,.232)]:
 o=box('Door inside liner',(xx,-.302,.92),(.37,.013,1.64),liner,.005); parent_to(o,hinge)
 for zz in [.36,.68,1.42]:
  o=box('Door rack base',(xx,-.255,zz),(.32,.08,.018),liner,.003); parent_to(o,hinge)
  o=box('Door rack guard',(xx,-.22,zz+.04),(.32,.012,.08),liner,.003); parent_to(o,hinge)
# Shelves and stock, with independently named removable front-row cans.
for xx,width in [(-.229,.35),(.215,.37)]:
 for zz in [.37,.71,1.05,1.39]:
  box('Interior shelf',(xx,.01,zz),(width,.55,.018),liner,.002)
  box('Shelf front trim',(xx,-.263,zz+.005),(width,.012,.022),chrome,.002)
# Use the same bottle geometry/materials as the held drink, with linked meshes for stock.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_diet_coke_bottle import build_bottle
template=build_bottle('fridge_can_0',(.065,-.21,.725))
def stock(name,at):
 root=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(root); root.location=at
 for child in template.children:
  clone=child.copy(); clone.data=child.data; bpy.context.collection.objects.link(clone); clone.parent=root
 return root
for row,yy in [('front',-.21),('back',-.06)]:
 for i in range(5):
  if row=='front' and i==0: continue
  stock('fridge_can_'+str(i) if row=='front' else 'back_can_'+str(i),(.065+i*.071,yy,.725))
for i,xx in enumerate([.085,.215,.345]): stock('stock_bottle_'+str(i),(xx,.05,1.065))
def cylinder(name,loc,radius,depth,material):
 bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=depth,location=loc); o=bpy.context.object; o.name=name; o.data.materials.append(material); return o
flavors=[mat('Ice cream '+str(i),c,0,.6) for i,c in enumerate([(.8,.25,.4),(.4,.7,.6),(.8,.65,.3),(.5,.3,.7)])]
for i in range(4):
 xx=-.31+(i%2)*.155; yy=-.12+(i//2)*.22
 cylinder('Ice cream tub',(xx,yy,1.10),.054,.084,liner)
 cylinder('Ice cream lid',(xx,yy,1.147),.058,.012,flavors[i])
for i in range(3): box('Ice cream sandwich',(-.30+i*.09,-.06,.42),(.065,.10,.055),flavors[i],.008)
box('Fresh food drawer',(.214,.055,.235),(.35,.48,.20),liner,.008)
# Merge meshes by material under each fixed parent to keep draw calls low.
parents={o.parent for o in bpy.context.scene.objects if o.type=='MESH'}
for parent in parents:
 if parent and parent.name.startswith(('fridge_can_', 'back_can_', 'stock_bottle_')): continue
 buckets={}
 for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and o.parent==parent: buckets.setdefault(o.data.materials[0].name,[]).append(o)
 for name,objects in buckets.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects: o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); objects[0].name=(parent.name if parent else 'cabinet')+'_'+name
# A reusable open/close clip; office controls the hinge nodes directly for reversible easing.
scene=bpy.context.scene; scene.render.fps=30; scene.frame_start=1; scene.frame_end=90
for hinge,sign in [(left,-1),(right,1)]:
 for frame,angle in [(1,0),(18,2.02),(60,2.02),(78,0),(90,0)]:
  hinge.rotation_euler.z=sign*angle; hinge.keyframe_insert(data_path='rotation_euler',frame=frame)
 if hinge.animation_data: hinge.animation_data.action.name=hinge.name+'_open_close'
scene.frame_set(1)
model=list(bpy.context.scene.objects)
bpy.ops.object.select_all(action='DESELECT')
for o in model: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'samsung-double-door-fridge.glb'),export_format='GLB',use_selection=True,export_yup=True)
# Studio preview.
floor=mat('Studio floor',(.12,.14,.17),0,.8)
box('Preview floor',(0,0,-.015),(200,200,.02),floor,0)
bpy.ops.object.camera_add(location=(2.55,-4.6,2.42)); camera=bpy.context.object; camera.rotation_euler=(Vector((0,0,.91))-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=2.5; bpy.context.scene.camera=camera
for name,loc,power,size in [('Large softbox',(-3,-4,4),650,4),('Right fill',(3,-2,3),450,3),('Top rim',(0,2,4),700,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc); light=bpy.context.object; light.name=name; light.data.energy=power; light.data.shape='DISK'; light.data.size=size; light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.render.resolution_x=900; scene.render.resolution_y=1100; scene.render.resolution_percentage=100; scene.world.color=(.2,.2,.2)
scene.render.filepath=os.path.join(OUT,'preview.png'); bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'samsung-double-door-fridge.blend')); bpy.ops.render.render(write_still=True)
scene.frame_set(40); scene.render.filepath=os.path.join(OUT,'preview-open.png'); bpy.ops.render.render(write_still=True); scene.frame_set(1)
triangles=sum(len(o.data.polygons) for o in model if o.type=='MESH'); print('MODEL_POLYGONS',triangles); print('GLB_BYTES',os.path.getsize(os.path.join(OUT,'samsung-double-door-fridge.glb')))
