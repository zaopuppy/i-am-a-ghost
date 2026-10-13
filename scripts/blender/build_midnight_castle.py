"""Author the editable castle and a batched Y-up runtime GLB from the rules map.

Run Blender --background --python scripts/blender/build_midnight_castle.py -- --render.
Only generated artifacts are written; existing source maps are never changed.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
RNG = random.Random(71)
SCENE = json.loads((ROOT / 'assets/maps/midnight-castle.scene.json').read_text(encoding='utf-8'))
OUT = ROOT / 'public/assets/models/midnight-castle'
SOURCE = ROOT / 'assets/models/original/midnight-castle.blend'
PREVIEWS = ROOT / 'docs/images'
MATS = {}
COLLECTIONS = {}

# width/depth match FURNITURE_CATALOG's movement collider, not the old model bounds.
FOOTPRINTS = {
    'shelf_B_large_decorated': (1.82, .42),
    'table_medium': (1.72, 1.72),
    'table_low': (2.1, 1.22),
    'table_medium_long': (2.68, 1.68),
    'table_small': (.82, .82),
    'chair_A_wood': (.62, .7),
    'cabinet_medium_decorated': (1.8, .82),
}


def material(name, color, roughness=.85, metal=0, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = emission
    MATS[name] = mat
    return mat


def collection(name):
    if name not in COLLECTIONS:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
        COLLECTIONS[name] = col
    return COLLECTIONS[name]


def place(obj, name, category, mat):
    obj.name = name
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    collection(category).objects.link(obj)
    if mat:
        obj.data.materials.append(MATS[mat])
    obj['category'] = category
    return obj


def cube(name, position, size, mat, category='dressing', bevel=.025):
    x,y,z=(value/2 for value in size)
    obj=mesh(name,[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),
                   (-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
             [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,category)
    obj.location=position
    if bevel:
        mod = obj.modifiers.new('soft handcrafted edges', 'BEVEL')
        mod.width = min(bevel, min(size) * .2)
        mod.segments = 1
    return obj


def cylinder(name, pos, radius, depth, mat, category='dressing', vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=pos)
    return place(bpy.context.object, name, category, mat)


def sphere(name, pos, scale, mat, category='dressing'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1, location=pos)
    obj = place(bpy.context.object, name, category, mat)
    obj.scale = scale
    return obj


def beam(name, a, b, radius, mat, category='dressing'):
    a, b = Vector(a), Vector(b)
    obj = cylinder(name, (a + b) * .5, radius, (b-a).length, mat, category, 8)
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return obj


def mesh(name, verts, faces, mat, category='dressing'):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection(category).objects.link(obj)
    obj['category'] = category
    obj.data.materials.append(MATS[mat])
    return obj


def arch(name, x, z, axis, radius=1.14, spring=1.55, mat='stone-light', category='dressing'):
    # Individual voussoirs form a pointed Gothic arch; clear opening is unchanged.
    for side in [-1, 1]:
        points = []
        for i in range(7):
            t = i / 6
            u = side * radius * (1-t)
            h = spring + 1.1 * math.sin(t*math.pi/2)
            points.append((u, h))
        for i in range(6):
            u1, h1 = points[i]
            u2, h2 = points[i+1]
            def world(u, v, h):
                return (x+u, -z+v, h) if axis == 'h' else (x+v, -z-u, h)
            verts = [world(u, v, h) for v in [-.17,.17]
                     for u,h in [(u1,h1),(u2,h2),(u2,h2+.23),(u1,h1+.23)]]
            mesh(f'{name}-arch-{side}-{i}', verts,
                 [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],mat,category)
    for side in [-1,1]:
        pos = (x+side*(radius+.12), -z, spring/2) if axis == 'h' else (x,-z-side*(radius+.12),spring/2)
        cube(f'{name}-jamb-{side}',pos,(.24,.42,spring) if axis=='h' else (.42,.24,spring),mat,category)
        pos = (pos[0],pos[1],.1)
        cube(f'{name}-foot-{side}',pos,(.32,.46,.2) if axis=='h' else (.46,.32,.2),'stone-dark',category)


def wall(rect, boundary=False):
    x = (rect['minX']+rect['maxX'])/2
    z = (rect['minZ']+rect['maxZ'])/2
    width = rect['maxX']-rect['minX']
    depth = rect['maxZ']-rect['minZ']
    horizontal = width > depth
    height = 1.05 if horizontal and z > 0 else 1.65
    cat = 'boundary' if boundary else 'wall'
    name = rect['id']
    cube(f'{name}-mortar',(x,-z,height/2),(width,depth,height),'mortar',cat,0)
    length = width if horizontal else depth
    rows = math.ceil(height/.42)
    for row in range(rows):
        h0 = row*height/rows
        start = -length/2
        while start < length/2-.01:
            step = min(RNG.uniform(.7,1.15),length/2-start)
            if step <= .025:
                break
            along = start+step/2
            pos = (x+along,-z,h0+height/rows/2) if horizontal else (x,-z-along,h0+height/rows/2)
            size = (step-.018,depth+.035,height/rows-.02) if horizontal else (width+.035,step-.018,height/rows-.02)
            cube(f'{name}-ashlar-{row}',pos,size,RNG.choice(['stone','stone','stone-light','stone-dark']),cat,.018)
            start += step
    cube(f'{name}-cutaway-cap',(x,-z,height+.04),(width+.055,depth+.055,.08),'stone-light',cat,.015)
    cube(f'{name}-plinth',(x,-z,.10),(width+.06,depth+.06,.20),'stone-dark',cat,.015)


def floors():
    for room in SCENE['rooms']:
        x,z = room['center']['x'],room['center']['z']
        w,d = room['width'],room['depth']
        cube(f"{room['id']}-foundation",(x,-z,-.15),(w,d,.28),'mortar','floor',0)
        cols,rows = math.ceil(w/1.4),math.ceil(d/1.4)
        for i in range(cols):
            for j in range(rows):
                tx=x-w/2+(i+.5)*w/cols
                tz=z-d/2+(j+.5)*d/rows
                mat = 'tile-warm' if room['id']=='kitchen' else ('tile-dark' if (i+j)%3==0 else 'tile')
                cube(f"{room['id']}-flagstone-{i}-{j}",(tx,-tz,-.008),(w/cols-.018,d/rows-.018,.035),mat,'floor',.01)
        # Inlaid border makes individual rooms legible from the game camera.
        for side in [-1,1]:
            cube(f"{room['id']}-border-x",(x+side*(w/2-.32),-z,.018),(.075,d-.6,.015),'inlay','floor',0)
            cube(f"{room['id']}-border-z",(x,-z+side*(d/2-.32),.018),(w-.6,.075,.015),'inlay','floor',0)


def rug(name,x,z,w,d,mat='wine'):
    cube(name,(x,-z,.038),(w,d,.025),mat,'floor',0)
    for side in [-1,1]:
        cube(name+'-gold-edge',(x+side*(w/2-.06),-z,.054),(.065,d-.10,.01),'gold','floor',0)
        cube(name+'-gold-edge',(x,-z+side*(d/2-.06),.054),(w-.10,.065,.01),'gold','floor',0)
    for u in [-.3,0,.3]:
        diamond = cube(name+'-woven-diamond',(x+u*w,-z,.055),(.18,.18,.012),'gold','floor',0)
        diamond.rotation_euler.z=math.pi/4


def furniture(placement):
    room = next(r for r in SCENE['rooms'] if r['id']==placement['roomId'])
    x=room['center']['x']+placement['offsetX']
    z=room['center']['z']+placement['offsetZ']
    scale=placement.get('scale',1)
    yaw=placement.get('yawRadians',0)
    asset=placement['asset']
    w,d=FOOTPRINTS[asset]
    name=placement['id']
    before=set(bpy.data.objects)
    def box(suffix,pos,size,mat='wood',bevel=.018):
        return cube(name+'-'+suffix,pos,size,mat,'furniture',bevel)
    if 'table' in asset and placement['roomId']!='storage':
        h=.62 if asset=='table_low' else .95
        if placement['roomId']=='chapel':
            # Pew back runs within the same footprint as its authoritative low table.
            box('pew-back',(0,d/2-.08,.82),(w,.12,.8))
            h=.48
        box('top',(0,0,h),(w,d,.12),'wood-light')
        for sx in [-1,1]:
            for sy in [-1,1]:
                box('carved-leg',(sx*(w/2-.13),sy*(d/2-.13),h/2),(.15,.15,h))
        box('stretcher',(0,0,.23),(w-.2,.10,.12),'wood-dark')
        for j in range(1,5):
            box('plank-seam',(0,-d/2+j*d/5,h+.061),(w-.03,.012,.005),'wood-dark',0)
        if placement['roomId']=='banquet':
            box('table-runner',(0,0,h+.068),(w-.08,d*.3,.01),'wine',0)
            for sx in [-.28,.28]:
                cylinder(name+'-platter',(sx*w,0,h+.075),.19,.025,'pewter','furniture',12)
                cylinder(name+'-goblet',(sx*w,d*.25,h+.12),.07,.12,'gold','furniture',8)
            candle(name+'-table-candle',0,0,h+.07,'furniture')
        elif placement['roomId']=='kitchen':
            sphere(name+'-pot',(w*.22,0,h+.16),(.22,.22,.16),'iron','furniture')
            box('chopping-board',(-w*.25,0,h+.08),(.6,.45,.03),'wood-dark')
        elif placement['roomId']=='library':
            for j in range(3):
                book=box('book-stack',(.2,-.15,h+.09+j*.065),(.42,.3,.06),['wine','sage','ink'][j])
                book.rotation_euler.z=.12*j
            candle(name+'-desk-candle',-.5,.4,h+.07,'furniture')
        elif placement['roomId']=='armory':
            shield(name+'-shield',0,0,h+.12,.5,'furniture',flat=True)
    elif asset=='chair_A_wood':
        box('seat',(0,0,.46),(w,d,.12),'wood-light')
        for sx in [-1,1]:
            for sy in [-1,1]:
                box('leg',(sx*(w/2-.06),sy*(d/2-.06),.23),(.095,.095,.46))
        box('back',(0,d/2-.06,.85),(w,.1,.7))
        box('back-inlay',(0,d/2-.12,.88),(w*.65,.025,.36),'wine')
    elif asset=='shelf_B_large_decorated':
        h=1.35
        for sx in [-1,1]:
            box('side',(sx*(w/2-.055),0,h/2),(.11,d,h))
        box('back',(0,d/2-.03,h/2),(w,.06,h),'wood-dark')
        for height in [.12,.54,.96,1.35]:
            box('shelf',(0,0,height),(w,d,.07),'wood-light')
        for row in range(3):
            for i in range(9):
                bh=RNG.uniform(.22,.32)
                book=box('book',(-w/2+.18+i*(w-.3)/9,-.01,.18+row*.41+bh/2),(.09,.27,bh),RNG.choice(['wine','sage','ink','paper']),.006)
                book.rotation_euler.y=RNG.uniform(-.06,.06)
    elif placement['roomId']=='storage':
        box('crate',(0,0,.43),(w,d,.86),'wood')
        for sy in [-1,1]:
            for height in [.12,.74]:
                box('crate-band',(0,sy*(d/2+.003),height),(w,.035,.06),'iron')
            brace=box('crate-diagonal',(0,sy*(d/2+.02),.43),(w*.95,.025,.07),'wood-light')
            brace.rotation_euler.y=math.atan2(.5,w)
    else:
        h=1.25
        box('cabinet-body',(0,0,h/2),(w,d,h))
        box('cabinet-top',(0,0,h+.04),(w+.03,d+.03,.08),'wood-light')
        for sx in [-1,1]:
            box('raised-panel',(sx*w*.25,-d/2-.01,.65),(w*.44,.035,.98),'wood-light')
            sphere(name+'-handle',(sx*.1,-d/2-.055,.65),(.04,.04,.04),'gold','furniture')
        if placement['roomId']=='chapel':
            box('altar-cloth',(0,0,h+.09),(w*.65,d+.08,.035),'wine',0)
            for sx in [-.55,.55]:
                candle(name+'-altar-candle',sx,0,h+.11,'furniture')
        elif placement['roomId']=='armory':
            armor(name+'-armor',0,0,h+.09,'furniture')
    # Local (X,Y,Z-up) furniture -> map offset and Y-axis rotation in game.
    for obj in set(bpy.data.objects)-before:
        lx,ly,lz=obj.location
        obj.location=(x+scale*(math.cos(yaw)*lx-math.sin(yaw)*ly),
                      -z+scale*(math.sin(yaw)*lx+math.cos(yaw)*ly),
                      placement.get('elevation',.012)+scale*lz)
        obj.rotation_euler.z+=yaw
        obj.scale*=scale
    proxy=bpy.data.objects.new('proxy-'+name,None)
    collection('proxies').objects.link(proxy)
    proxy.location=(x,-z,0)
    proxy['placementId']=name
    proxy['asset']=asset
    proxy['roomId']=placement['roomId']
    proxy['game_x']=x
    proxy['game_z']=z
    proxy['halfWidth']=w*scale/2
    proxy['halfDepth']=d*scale/2
    proxy['yawRadians']=yaw


def candle(name,x,y,h,category='dressing'):
    cylinder(name+'-saucer',(x,y,h+.015),.09,.025,'gold',category)
    cylinder(name+'-wax',(x,y,h+.13),.045,.24,'paper',category)
    sphere(name+'-flame',(x,y,h+.28),(.025,.025,.07),'flame',category)


def shield(name,x,y,h,size,category='dressing',flat=False):
    verts=[(-.55,0,.8),(.55,0,.8),(.50,0,-.1),(0,0,-.75),(-.50,0,-.1)]
    verts=[(x+u*size,y,h+v*size) if not flat else (x+u*size,y+v*size,h) for u,_,v in verts]
    obj=mesh(name,verts,[(0,1,2,3,4)],'wine',category)
    mod=obj.modifiers.new('shield thickness','SOLIDIFY')
    mod.thickness=.04
    if not flat:
        cube(name+'-crest',(x,y-.025,h+.12),(.075,.035,size),'gold',category)
        cube(name+'-crest',(x,y-.025,h+.20),(size*.6,.035,.075),'gold',category)


def armor(name,x,y,h,category='dressing'):
    cylinder(name+'-base',(x,y,h+.025),.24,.05,'stone-dark',category)
    beam(name+'-stand',(x,y,h+.05),(x,y,h+.85),.06,'wood-dark',category)
    sphere(name+'-breastplate',(x,y,h+.55),(.24,.15,.28),'pewter',category)
    sphere(name+'-helmet',(x,y,h+.98),(.18,.17,.20),'pewter',category)
    cube(name+'-visor',(x,y-.165,h+1),(.24,.035,.04),'iron',category)
    for sx in [-1,1]:
        sphere(name+'-pauldron',(x+sx*.25,y,h+.69),(.16,.14,.13),'pewter',category)


def decor():
    rug('banquet-runner',0,1,1.45,8,'wine')
    rug('entry-runner',0,9,29,1.6,'wine')
    rug('chapel-runner',0,-7.6,1.4,4.8,'ink')
    rug('library-rug',-11,-8,4.2,3.6,'sage')
    # Northern clerestory windows: glowing panes, stone tracery and heraldic shields.
    for x in [-12,0,12]:
        cube('window-stone-surround',(x,11.77,2.25),(2.1,.20,2.2),'stone-dark')
        for i in range(4):
            for j in range(3):
                cube('stained-glass-pane',(x-.66+i*.44,11.65,1.45+j*.5),(.4,.035,.45),['glass-blue','glass-amber','glass-blue','glass-wine'][(i+j)%4],bevel=.01)
        for dx in [-.9,-.45,0,.45,.9]:
            cube('window-mullion',(x+dx,11.6,2.04),(.035,.05,1.8),'gold')
        arch('window-crown',x,-11.65,'h',.94,2.40)
    for x in [-8,8]:
        shield('entry-heraldry',x,-11.76,.65,.65)
    # Banners lie against existing walls; no extra movement obstacles.
    for x in [-3.7,3.7]:
        cube('chapel-banner',(x,11.74,.94),(.8,.04,1.25),'wine',bevel=0)
        cube('chapel-banner-cross',(x,11.70,.97),(.06,.025,.8),'gold',bevel=0)
        cube('chapel-banner-cross',(x,11.70,1.08),(.46,.025,.06),'gold',bevel=0)
    for x,z,axis in [(x,z,'h') for z in [-4,6] for x in [-12,0,12]]+[(x,-8,'v') for x in [-6,6]]+[(x,1,'v') for x in [-8,8]]:
        arch('door',x,z,axis)
    # Wall-mounted candles are small practical cues, with no new light budget.
    for x,z in [(-15.65,-10),(15.65,-10),(-15.65,4),(15.65,4),(-4,-4.23),(4,-4.23)]:
        cube('sconce-bracket',(x,-z,1.05),(.14,.2,.22),'iron')
        candle('wall-sconce',x,-z,1.17)
    # Outside-corner buttresses give the dollhouse silhouette a castle identity.
    for x in [-16.35,16.35]:
        for z in [-12.35,12.35]:
            cube('buttress-foot',(x,-z,.22),(.95,.95,.44),'stone-dark')
            cube('buttress',(x,-z,.95),(.65,.65,1.5),'stone')
            cube('buttress-cap',(x,-z,1.75),(.78,.78,.18),'stone-light')


def camera(name,pos,scale):
    bpy.ops.object.camera_add(location=pos)
    obj=bpy.context.object
    obj.name=name
    obj.rotation_euler=(Vector((0,0,.2))-obj.location).to_track_quat('-Z','Y').to_euler()
    obj.data.type='ORTHO'
    obj.data.ortho_scale=scale
    obj.data.lens=42
    return obj


def lighting():
    scene=bpy.context.scene
    if scene.world is None:
        scene.world=bpy.data.worlds.new('Castle ambient')
    scene.world.color=(.12,.15,.22)
    for name,pos,power,color,size in [('moon-key',(-10,8,22),3800,(.60,.74,1),20),('warm-fill',(10,-12,18),3000,(1,.78,.54),20),('soft-top',(0,0,25),2100,(.8,.86,1),22)]:
        bpy.ops.object.light_add(type='AREA',location=pos)
        obj=bpy.context.object
        obj.name=name
        obj.data.energy=power
        obj.data.color=color
        obj.data.shape='DISK'
        obj.data.size=size
        obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine='CYCLES'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1600
    scene.render.resolution_y=1100
    scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    return camera('Castle overview',(26,-34,38),43),camera('Layout top',(0,0,50),38)


def export_runtime():
    # Copy/apply/merge only runtime objects; keep the saved source fully editable.
    bpy.ops.object.select_all(action='DESELECT')
    authored_scene=bpy.context.scene
    depsgraph=bpy.context.evaluated_depsgraph_get()
    evaluated_meshes={obj:bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
                      for obj in authored_scene.objects if obj.type=='MESH'}
    export_scene=bpy.data.scenes.new('Runtime export')
    bpy.context.window.scene=export_scene
    groups={}
    for obj in authored_scene.objects:
        if obj.type=='MESH':
            copy=bpy.data.objects.new(obj.name,evaluated_meshes[obj])
            copy.matrix_world=obj.matrix_world.copy()
            copy['category']=obj['category']
            export_scene.collection.objects.link(copy)
            groups.setdefault((obj['category'],copy.data.materials[0].name),[]).append(copy)
        elif obj.type=='EMPTY' and obj.name.startswith('proxy-'):
            export_scene.collection.objects.link(obj.copy())
    for (category,mat),objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:
            bpy.ops.object.join()
        joined=bpy.context.object
        joined.name=f'{category}-{mat}'
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/'midnight-castle.glb'),export_format='GLB',export_yup=True,use_active_scene=True,
                              export_extras=True,export_cameras=False,export_lights=False)
    triangles=sum(sum(len(face.vertices)-2 for face in o.data.polygons) for o in export_scene.objects if o.type=='MESH')
    stats={'sceneId':SCENE['id'],'seed':71,'rooms':len(SCENE['rooms']),'furniture':len(SCENE['furniture']),
           'meshes':len(groups),'triangles':triangles,'materials':len(MATS),
           'fileBytes':(OUT/'midnight-castle.glb').stat().st_size,'blender':bpy.app.version_string,
           'source':'scripts/blender/build_midnight_castle.py','coordinateContract':'Blender (X,-Z,Y) -> glTF/game (X,Y,Z)'}
    (OUT/'manifest.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('CASTLE_ARTIFACTS '+json.dumps(stats))
    bpy.context.window.scene=authored_scene
    bpy.data.scenes.remove(export_scene)


def main():
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser()
    parser.add_argument('--render',action='store_true')
    options=parser.parse_args(args)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    OUT.mkdir(parents=True,exist_ok=True)
    SOURCE.parent.mkdir(parents=True,exist_ok=True)
    PREVIEWS.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for name,color in [('mortar',(.10,.13,.17)),('stone',(.32,.39,.47)),('stone-light',(.43,.49,.56)),('stone-dark',(.24,.29,.36)),
                       ('tile',(.32,.35,.40)),('tile-dark',(.23,.27,.33)),('tile-warm',(.38,.31,.25)),('inlay',(.47,.41,.31)),
                       ('wood',(.22,.105,.055)),('wood-light',(.35,.19,.09)),('wood-dark',(.12,.065,.04)),
                       ('wine',(.30,.055,.075)),('sage',(.12,.23,.19)),('ink',(.085,.13,.23)),('paper',(.73,.62,.42))]:
        material(name,color,emission=.08)
    material('gold',(.58,.38,.12),.4,.6,.06)
    material('iron',(.10,.12,.15),.48,.65,.07)
    material('pewter',(.43,.49,.55),.36,.7,.06)
    material('flame',(1,.55,.13),.5,0,2)
    for name,color in [('glass-blue',(.12,.35,.70)),('glass-amber',(.70,.40,.12)),('glass-wine',(.45,.10,.23))]:
        material(name,color,.42,0,.6)
    print('CASTLE_BUILD floors',flush=True)
    floors()
    print('CASTLE_BUILD walls',flush=True)
    for rect in SCENE['walls']:
        wall(rect)
    b=SCENE['bounds']
    for rect in [dict(id='north',minX=b['minX'],maxX=b['maxX'],minZ=b['minZ']-.18,maxZ=b['minZ']+.18),
                 dict(id='south',minX=b['minX'],maxX=b['maxX'],minZ=b['maxZ']-.18,maxZ=b['maxZ']+.18),
                 dict(id='west',minX=b['minX']-.18,maxX=b['minX']+.18,minZ=b['minZ'],maxZ=b['maxZ']),
                 dict(id='east',minX=b['maxX']-.18,maxX=b['maxX']+.18,minZ=b['minZ'],maxZ=b['maxZ'])]:
        wall(rect,True)
    print('CASTLE_BUILD furniture',flush=True)
    for placement in SCENE['furniture']:
        furniture(placement)
    decor()
    print('CASTLE_BUILD preview and export',flush=True)
    overview,top=lighting()
    scene=bpy.context.scene
    scene['map_id']=SCENE['id']
    scene['map_source']='assets/maps/midnight-castle.scene.json'
    scene['seed']=71
    scene.camera=overview
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.shading.color_type='MATERIAL'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
    export_runtime()
    if options.render:
        for name,cam in [('midnight-castle-overview',overview),('midnight-castle-top',top)]:
            scene.camera=cam
            scene.render.filepath=str(PREVIEWS/(name+'.png'))
            bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    main()
