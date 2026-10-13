"""Author the editable castle and a batched Y-up runtime GLB from the rules map.

Run Blender --background --python scripts/blender/build_midnight_castle.py -- --render.
Only generated artifacts are written; existing source maps are never changed.
"""
import argparse
import json
import math
from pathlib import Path
import random
import shutil
import struct
import subprocess
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from castle_props import build_furniture
from castle_architecture import build_decor
from castle_surfaces import attach_surface_maps

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
        mod.segments = 2 if bevel >= .015 else 1
        mod.harden_normals = True
    return obj


def cylinder(name, pos, radius, depth, mat, category='dressing', vertices=16):
    if radius < .025:
        vertices=min(vertices,8)
    verts=[(radius*math.cos(i*math.tau/vertices),radius*math.sin(i*math.tau/vertices),z)
           for z in [-depth/2,depth/2] for i in range(vertices)]
    faces=[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
    faces += [tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]
    obj=mesh(name,verts,faces,mat,category)
    obj.location=pos
    for face in obj.data.polygons:
        face.use_smooth=len(face.vertices)==4
    return obj


def sphere(name, pos, scale, mat, category='dressing'):
    # Tiny rivets need a highlight, not 224 triangles each. Larger silhouettes
    # retain the finer profile, including helmets, pottery and carved bosses.
    segments,rings=(8,4) if max(scale)<=.055 else ((12,6) if max(scale)<=.12 else (16,8))
    verts=[(0,0,1)]
    verts += [(math.sin(row*math.pi/rings)*math.cos(i*math.tau/segments),
               math.sin(row*math.pi/rings)*math.sin(i*math.tau/segments),math.cos(row*math.pi/rings))
              for row in range(1,rings) for i in range(segments)]
    bottom=len(verts)
    verts.append((0,0,-1))
    faces=[(0,1+i,1+(i+1)%segments) for i in range(segments)]
    for row in range(rings-2):
        start=1+row*segments
        faces += [(start+i,start+segments+i,start+segments+(i+1)%segments,start+(i+1)%segments) for i in range(segments)]
    last=1+(rings-2)*segments
    faces += [(bottom,last+(i+1)%segments,last+i) for i in range(segments)]
    obj=mesh(name,verts,faces,mat,category)
    obj.location=pos
    obj.scale = scale
    for face in obj.data.polygons:
        face.use_smooth=True
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
    uv = data.uv_layers.new(name='Surface coordinates')
    for face in data.polygons:
        normal = face.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        axes = [i for i in range(3) if i != axis]
        for index in face.loop_indices:
            point = data.vertices[data.loops[index].vertex_index].co
            uv.data[index].uv = (point[axes[0]], point[axes[1]])
    return obj


def lathe(name, profile, pos, mat, category='dressing', segments=16):
    verts = [(r * math.cos(i * math.tau / segments), r * math.sin(i * math.tau / segments), h)
             for r, h in profile for i in range(segments)]
    faces = [(j * segments + i, j * segments + (i + 1) % segments,
              (j + 1) * segments + (i + 1) % segments, (j + 1) * segments + i)
             for j in range(len(profile) - 1) for i in range(segments)]
    faces += [tuple(reversed(range(segments))), tuple((len(profile) - 1) * segments + i for i in range(segments))]
    obj = mesh(name, verts, faces, mat, category)
    obj.location = pos
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def tube(name, points, radius, mat, category='dressing', sides=6):
    verts = []
    for i, point in enumerate(points):
        center = Vector(point)
        tangent = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])
        tangent.normalize()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((0, 1, 0))
        side = tangent.cross(reference).normalized()
        up = tangent.cross(side).normalized()
        verts.extend(tuple(center + radius * (math.cos(j * math.tau / sides) * side + math.sin(j * math.tau / sides) * up))
                     for j in range(sides))
    faces = [(i * sides + j, i * sides + (j + 1) % sides,
              (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
             for i in range(len(points) - 1) for j in range(sides)]
    obj = mesh(name, verts, faces, mat, category)
    for face in obj.data.polygons:
        face.use_smooth = True
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
    height = 3.15 if boundary and horizontal and z < 0 else (1.05 if horizontal and z > 0 else 1.55)
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
            cube(f'{name}-ashlar-{row}',pos,size,RNG.choice(['stone','stone','stone-light','stone-dark']),cat,.012)
            start += step
    cube(f'{name}-cutaway-cap',(x,-z,height+.04),(width+.055,depth+.055,.08),'stone-light',cat,.015)
    cube(f'{name}-plinth',(x,-z,.10),(width+.06,depth+.06,.20),'stone-dark',cat,.015)


def floors():
    for room in SCENE['rooms']:
        x,z = room['center']['x'],room['center']['z']
        w,d = room['width'],room['depth']
        cube(f"{room['id']}-foundation",(x,-z,-.15),(w,d,.28),'mortar','floor',0)
        cols,rows = math.ceil(w/1.65),math.ceil(d/1.65)
        for i in range(cols):
            for j in range(rows):
                tx=x-w/2+(i+.5)*w/cols
                tz=z-d/2+(j+.5)*d/rows
                mat = 'tile-warm' if room['id']=='kitchen' else ('tile-dark' if (i+j)%3==0 else 'tile')
                cube(f"{room['id']}-flagstone-{i}-{j}",(tx,-tz,-.008),(w/cols-.014,d/rows-.014,.035),mat,'floor',.005)
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


def model_api():
    return {name: globals()[name] for name in [
        'cube', 'cylinder', 'sphere', 'mesh', 'beam', 'lathe', 'tube',
        'arch', 'rug', 'candle', 'shield', 'armor',
    ]}


def furniture(placement):
    room = next(r for r in SCENE['rooms'] if r['id'] == placement['roomId'])
    x = room['center']['x'] + placement['offsetX']
    z = room['center']['z'] + placement['offsetZ']
    scale = placement.get('scale', 1)
    yaw = placement.get('yawRadians', 0)
    before = set(bpy.data.objects)
    build_furniture(model_api(), placement)
    for obj in set(bpy.data.objects) - before:
        lx, ly, lz = obj.location
        obj.location = (
            x + scale * (math.cos(yaw) * lx - math.sin(yaw) * ly),
            -z + scale * (math.sin(yaw) * lx + math.cos(yaw) * ly),
            placement.get('elevation', .012) + scale * lz,
        )
        obj.rotation_euler.z += yaw
        obj.scale *= scale
    proxy = bpy.data.objects.new('proxy-' + placement['id'], None)
    collection('proxies').objects.link(proxy)
    proxy.location = (x, -z, 0)
    w, d = FOOTPRINTS[placement['asset']]
    for key, value in {
        'placementId': placement['id'], 'asset': placement['asset'],
        'roomId': placement['roomId'], 'game_x': x, 'game_z': z,
        'halfWidth': w * scale / 2, 'halfDepth': d * scale / 2, 'yawRadians': yaw,
    }.items():
        proxy[key] = value


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
    scene.render.resolution_x=2200
    scene.render.resolution_y=1500
    scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    return camera('Castle overview',(26,-34,38),43),camera('Layout top',(0,0,50),38)


def export_runtime(compress=True):
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
    binary=(OUT/'midnight-castle.glb').read_bytes()
    json_length=struct.unpack_from('<I',binary,12)[0]
    gltf=json.loads(binary[20:20+json_length])
    # Blender 5.2 drops the constant multiplier from a MixRGB->BaseColor
    # chain. Keep source shading and runtime tint identical, then deduplicate
    # samplers so twelve tinted materials still share three normal maps.
    for mat in gltf['materials']:
        pbr=mat.get('pbrMetallicRoughness',{})
        if 'baseColorTexture' in pbr and mat['name'] != 'moon-glass':
            pbr['baseColorFactor']=list(MATS[mat['name']].diffuse_color)
    textures=[]
    texture_keys={}
    remap={}
    for index,texture in enumerate(gltf.get('textures',[])):
        key=json.dumps(texture,sort_keys=True)
        if key not in texture_keys:
            texture_keys[key]=len(textures)
            textures.append(texture)
        remap[index]=texture_keys[key]
    for mat in gltf['materials']:
        for owner in [mat,mat.get('pbrMetallicRoughness',{})]:
            for key,value in owner.items():
                if key.endswith('Texture') and isinstance(value,dict) and 'index' in value:
                    value['index']=remap[value['index']]
    gltf['textures']=textures
    encoded=json.dumps(gltf,separators=(',',':')).encode('utf-8')
    encoded+=b' '*((-len(encoded))%4)
    remainder=binary[20+json_length:]
    binary=struct.pack('<III',0x46546c67,2,20+len(encoded)+len(remainder))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+remainder
    (OUT/'midnight-castle.glb').write_bytes(binary)
    uncompressed_bytes=len(binary)
    if compress:
        node=shutil.which('node')
        if node is None:
            raise RuntimeError('Node.js is needed for Meshopt; pass --uncompressed for a raw GLB.')
        subprocess.run([node,str(ROOT/'scripts/blender/optimize_castle.mjs')],cwd=ROOT,check=True)
        binary=(OUT/'midnight-castle.glb').read_bytes()
        gltf=json.loads(binary[20:20+struct.unpack_from('<I',binary,12)[0]])
    stats={'sceneId':SCENE['id'],'refinement':2,'seed':71,'rooms':len(SCENE['rooms']),'furniture':len(SCENE['furniture']),
           'meshes':len(gltf['meshes']),'triangles':triangles,'materials':len(gltf['materials']),
           'textures':len(gltf.get('textures',[])),
           'compression':'meshopt' if compress else 'none','uncompressedBytes':uncompressed_bytes,
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
    parser.add_argument('--uncompressed',action='store_true',help='Skip the Node/Meshopt packaging step.')
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
    material('gold',(.58,.38,.12),.28,.6,.08)
    material('iron',(.10,.12,.15),.48,.65,.07)
    material('pewter',(.43,.49,.55),.36,.7,.06)
    material('flame',(1,.55,.13),.5,0,2)
    material('bone',(.73,.65,.46),.8,0,.06)
    material('ceramic',(.59,.47,.29),.28,0,.06)
    material('copper',(.52,.22,.075),.35,.6,.07)
    material('moon-glass',(1,1,1),.36,0,.35)
    material('stained-pool',(1,1,1),1,0,.4)
    material('wear',(.06,.045,.028),1,0,0)
    for name,alpha in [('stained-pool',.19),('wear',.18)]:
        mat=MATS[name]
        mat.diffuse_color=(*mat.diffuse_color[:3],alpha)
        mat.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=alpha
        mat.surface_render_method='DITHERED'
    print('CASTLE_BUILD shared surface maps',flush=True)
    attach_surface_maps(MATS,OUT/'textures')
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
    build_decor(model_api(), SCENE)
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
    export_runtime(compress=not options.uncompressed)
    if options.render:
        detail=camera('Chapel workmanship',(9,-2,13),18)
        detail.rotation_euler=(Vector((0,8,1.2))-detail.location).to_track_quat('-Z','Y').to_euler()
        for name,cam in [('midnight-castle-refined-overview',overview),('midnight-castle-refined-top',top),('midnight-castle-refined-chapel',detail)]:
            scene.camera=cam
            scene.render.filepath=str(PREVIEWS/(name+'.png'))
            bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    main()
