"""Build the game's two original low-poly characters with Blender 5.2.

Run: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/create-original-characters.py
The editable .blend files and runtime GLBs are both deterministic outputs.
"""
import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
BLEND_DIR = ROOT / 'assets' / 'models' / 'original'
GLB_DIR = ROOT / 'public' / 'assets' / 'models' / 'original'
BLEND_DIR.mkdir(parents=True, exist_ok=True)
GLB_DIR.mkdir(parents=True, exist_ok=True)


def material(name, color, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Roughness'].default_value = .9
    if emission:
        node.inputs['Emission Color'].default_value = (*color, 1)
        node.inputs['Emission Strength'].default_value = emission
    return mat


def bones_for(prefix, ghost):
    height = 1.78 if ghost else 1.53
    chest = 1.28 if ghost else 1.11
    hip = .74 if ghost else .72
    pairs = {
        'Root': ((0, 0, .02), (0, 0, .2), None),
        'Torso': ((0, 0, hip), (0, 0, chest), 'Root'),
        'Skull': ((0, 0, chest), (0, 0, height), 'Torso'),
    }
    for side, sign in [('L', 1), ('R', -1)]:
        pairs[f'ArmUpper{side}'] = ((sign * .23, 0, chest - .04), (sign * .38, 0, .87), 'Torso')
        pairs[f'ArmLower{side}'] = ((sign * .38, 0, .87), (sign * .44, 0, .62), f'ArmUpper{side}')
        pairs[f'Wrist{side}'] = ((sign * .44, 0, .62), (sign * .44, 0, .56), f'ArmLower{side}')
        pairs[f'Palm{side}'] = ((sign * .44, 0, .56), (sign * .44, 0, .45), f'Wrist{side}')
        pairs[f'LegUpper{side}'] = ((sign * .13, 0, hip), (sign * .14, 0, .42), 'Root')
        pairs[f'LegLower{side}'] = ((sign * .14, 0, .42), (sign * .14, 0, .13), f'LegUpper{side}')
        pairs[f'Foot{side}'] = ((sign * .14, 0, .13), (sign * .14, -.13, .08), f'LegLower{side}')
    pairs['TorchSocketR'] = ((-.44, 0, .47), (-.44, -.12, .47), 'PalmR')
    data = bpy.data.armatures.new(f'{prefix}Armature')
    arm = bpy.data.objects.new(f'{prefix}Rig', data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail, _) in pairs.items():
        bone = data.edit_bones.new(f'{prefix}_{name}')
        bone.head = head
        bone.tail = tail
    for name, (_, _, parent) in pairs.items():
        if parent:
            data.edit_bones[f'{prefix}_{name}'].parent = data.edit_bones[f'{prefix}_{parent}']
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def attach_mesh(obj, arm, bone, mat):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    group = obj.vertex_groups.new(name=f'{arm.name.removesuffix("Rig")}_{bone}')
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    obj.parent = arm
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = arm
    return obj


def cube(arm, bone, name, position, size, mat, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('LowPolyBevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return attach_mesh(obj, arm, bone, mat)


def ico(arm, bone, name, position, scale, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return attach_mesh(obj, arm, bone, mat)


def cone(arm, bone, name, position, radius1, radius2, depth, mat, vertices=7):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=position)
    obj = bpy.context.object
    obj.name = name
    return attach_mesh(obj, arm, bone, mat)


def build_scout(arm):
    coat = material('Scout moss coat', (.17, .28, .23))
    cloak = material('Scout dark hood', (.09, .15, .18))
    skin = material('Scout warm face', (.73, .48, .32))
    brass = material('Scout brass', (.72, .52, .19))
    boot = material('Scout leather', (.19, .13, .11))
    scarf = material('Scout red scarf', (.51, .18, .16))
    cube(arm, 'Torso', 'Short adventure coat', (0, 0, .94), (.48, .3, .56), coat)
    cube(arm, 'Torso', 'Red neck scarf', (0, -.18, 1.17), (.48, .12, .14), scarf, .02)
    cube(arm, 'Torso', 'Travel backpack', (0, .22, .95), (.39, .18, .45), boot)
    ico(arm, 'Skull', 'Scout hood', (0, 0, 1.32), (.29, .25, .29), cloak)
    cube(arm, 'Skull', 'Visible face', (0, -.22, 1.31), (.34, .10, .22), skin, .03)
    for sign, side in [(1, 'L'), (-1, 'R')]:
        cube(arm, 'Skull', f'Goggle lens {side}', (sign * .09, -.282, 1.37), (.12, .035, .10), brass, .01)
        cube(arm, f'ArmUpper{side}', f'Coat sleeve {side}', (sign * .31, 0, .99), (.22, .25, .35), coat)
        cube(arm, f'ArmLower{side}', f'Glove {side}', (sign * .42, 0, .70), (.16, .19, .28), boot)
        ico(arm, f'Palm{side}', f'Hand {side}', (sign * .44, 0, .5), (.095, .09, .10), skin)
        cube(arm, f'LegUpper{side}', f'Trousers {side}', (sign * .14, 0, .54), (.20, .22, .37), cloak)
        cube(arm, f'LegLower{side}', f'Shin {side}', (sign * .14, 0, .27), (.17, .19, .27), cloak)
        cube(arm, f'Foot{side}', f'Boot {side}', (sign * .14, -.09, .09), (.2, .31, .16), boot)
    cube(arm, 'Torso', 'Brass satchel clasp', (.24, -.17, .89), (.08, .04, .09), brass, .01)


def build_wraith(arm):
    shroud = material('Wraith blue shroud', (.12, .20, .30))
    dark = material('Wraith hollow hood', (.045, .07, .11))
    edge = material('Wraith silver edge', (.39, .51, .62))
    glow = material('Wraith eyes', (.34, .76, .95), 2.5)
    cone(arm, 'Torso', 'Tapered spectral shroud', (0, 0, .87), .42, .24, 1.33, shroud, 8)
    ico(arm, 'Skull', 'Angular wraith hood', (0, 0, 1.48), (.31, .28, .29), dark)
    ico(arm, 'Skull', 'Recessed face', (0, -.22, 1.47), (.22, .08, .19), shroud)
    for sign, side in [(1, 'L'), (-1, 'R')]:
        ico(arm, 'Skull', f'Luminous eye {side}', (sign * .09, -.30, 1.51), (.045, .035, .057), glow)
        cone(arm, f'ArmUpper{side}', f'Floating sleeve {side}', (sign * .32, 0, 1.03), .16, .1, .37, shroud, 6)
        cone(arm, f'ArmLower{side}', f'Long wrist veil {side}', (sign * .42, 0, .68), .12, .04, .38, edge, 6)
        ico(arm, f'Palm{side}', f'Claw {side}', (sign * .44, -.02, .47), (.07, .11, .15), dark)
        cone(arm, f'LegUpper{side}', f'Ragged hem {side}', (sign * .14, 0, .40), .17, .05, .58, shroud, 5)
        ico(arm, f'LegLower{side}', f'Mist tail {side}', (sign * .16, 0, .16), (.15, .13, .16), edge)
        ico(arm, f'Foot{side}', f'Mist tip {side}', (sign * .15, -.09, .07), (.11, .15, .07), edge)
    for index, x in enumerate([-.22, 0, .22]):
        cone(arm, 'Skull', f'Broken crown shard {index}', (x, .025, 1.76), .07, .005, .22, edge, 5)


def animate(arm, prefix, ghost):
    arm.animation_data_create()
    names = ['Root', 'Torso', 'Skull', 'ArmUpperL', 'ArmUpperR', 'LegUpperL', 'LegUpperR']
    for name in names:
        arm.pose.bones[f'{prefix}_{name}'].rotation_mode = 'XYZ'

    def pose(frame, bob=0, sway=0, stride=0, hit=0):
        for name in names:
            pb = arm.pose.bones[f'{prefix}_{name}']
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        arm.pose.bones[f'{prefix}_Root'].location.z = bob
        arm.pose.bones[f'{prefix}_Torso'].rotation_euler.y = sway
        arm.pose.bones[f'{prefix}_Skull'].rotation_euler.x = hit * .18
        arm.pose.bones[f'{prefix}_ArmUpperL'].rotation_euler.x = stride * .55 + hit * .45
        arm.pose.bones[f'{prefix}_ArmUpperR'].rotation_euler.x = -stride * .55 + hit * .45
        arm.pose.bones[f'{prefix}_LegUpperL'].rotation_euler.x = -stride * .65
        arm.pose.bones[f'{prefix}_LegUpperR'].rotation_euler.x = stride * .65
        for name in names:
            pb = arm.pose.bones[f'{prefix}_{name}']
            pb.keyframe_insert(data_path='rotation_euler', frame=frame)
            if name == 'Root': pb.keyframe_insert(data_path='location', frame=frame)

    clips = {
        'Idle_A': [(1, 0, 0, 0, 0), (16, .025 if ghost else .012, .025, 0, 0), (31, 0, 0, 0, 0)],
        'Running_A': [(1, 0, 0, 1, 0), (8, .04, .04, -1, 0), (15, 0, 0, 1, 0)],
        'Hit_A': [(1, 0, 0, 0, 0), (7, -.035, .12, 0, 1), (15, 0, 0, 0, 0)],
    }
    for clip_name, keys in clips.items():
        action = bpy.data.actions.new(clip_name)
        arm.animation_data.action = action
        for values in keys: pose(*values)
        arm.animation_data.action = None
        track = arm.animation_data.nla_tracks.new()
        track.name = clip_name
        track.strips.new(clip_name, 1, action)
        track.mute = False


def build(kind, prefix, basename):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for data in list(bpy.data.materials): bpy.data.materials.remove(data)
    arm = bones_for(prefix, kind == 'ghost')
    (build_wraith if kind == 'ghost' else build_scout)(arm)
    animate(arm, prefix, kind == 'ghost')
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / f'{basename}.blend'))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_DIR / f'{basename}.glb'),
        export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS',
        export_force_sampling=True, export_apply=False,
    )
    print(f'Created {basename}')


build('kid', 'Scout', 'Night_Scout')
build('ghost', 'Wraith', 'Old_House_Wraith')
