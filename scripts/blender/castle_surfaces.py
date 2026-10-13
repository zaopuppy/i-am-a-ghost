"""Small shared PBR maps: chisel marks, oak grain and woven cloth.

These maps are authored deterministically, not baked photographic lighting.
The moon-stag illustration is a separately retained ImageGen artwork.
"""
import math
from pathlib import Path

import bpy
import numpy as np


def save_map(name, values, directory, non_color=False):
    height, width = values.shape[:2]
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(values, 0, 1)
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    if non_color:
        image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(directory / (name + '.png'))
    image.file_format = 'PNG'
    image.save()
    image.pack()
    return image


def normal_from_height(height, strength):
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    normal = np.stack((-dx * strength, -dy * strength, np.ones_like(height)), axis=2)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    return normal * .5 + .5


def map_material(material, albedo, normal=None):
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    color = tuple(bsdf.inputs['Base Color'].default_value)
    source = nodes.new('ShaderNodeTexImage')
    source.image = albedo
    source.label = 'Shared handcrafted albedo'
    source.extension = 'REPEAT'
    multiply = nodes.new('ShaderNodeMixRGB')
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs[0].default_value = 1
    multiply.inputs[1].default_value = color
    links.new(source.outputs['Color'], multiply.inputs[2])
    links.new(multiply.outputs[0], bsdf.inputs['Base Color'])
    if normal is not None:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = normal
        texture.extension = 'REPEAT'
        converter = nodes.new('ShaderNodeNormalMap')
        converter.inputs['Strength'].default_value = .55
        links.new(texture.outputs['Color'], converter.inputs['Color'])
        links.new(converter.outputs['Normal'], bsdf.inputs['Normal'])


def attach_surface_maps(materials, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(71)
    size = 512
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    grain = rng.random((size, size), dtype=np.float32)
    # Periodic, filtered random fields avoid a visible plaid/sinusoidal grid.
    frequency = np.fft.fftfreq(size)
    radius = frequency[:, None] ** 2 + frequency[None, :] ** 2
    smooth = np.fft.ifft2(np.fft.fft2(rng.normal(size=(size, size))) * np.exp(-radius * 18000)).real
    smooth /= max(float(smooth.std()), .0001)
    broad = .5 + np.clip(smooth, -2, 2) * .055
    chisel = np.sin((x * 42 + .4 * np.sin(y * math.tau * 5)) * math.tau)
    pits = np.maximum(grain - .975, 0) * 12
    stone_height = broad * .08 + grain * .012 + chisel * .002 - pits * .04
    stone_color = .86 + (broad - .5) * .28 + (grain - .5) * .035 - pits * .06
    stone = save_map('cut-limestone-albedo', np.repeat(stone_color[:, :, None], 3, axis=2), directory)
    stone_normal = save_map('cut-limestone-normal', normal_from_height(stone_height, 5), directory, True)
    for name in ['stone', 'stone-light', 'stone-dark', 'tile', 'tile-dark', 'tile-warm']:
        map_material(materials[name], stone, stone_normal)

    waviness = .06 * np.sin(y * math.tau * 2) + .018 * np.sin(y * math.tau * 7)
    rings = np.sin((x + waviness) * math.tau * 34)
    pores = np.sin((x + waviness * .5) * math.tau * 110)
    wood_height = rings * .018 + pores * .006 + grain * .02
    wood_color = .80 + rings * .075 + pores * .025 + (grain - .5) * .05
    wood = save_map('aged-oak-albedo', np.repeat(wood_color[:, :, None], 3, axis=2), directory)
    wood_normal = save_map('aged-oak-normal', normal_from_height(wood_height, 3), directory, True)
    for name in ['wood', 'wood-light', 'wood-dark']:
        map_material(materials[name], wood, wood_normal)

    warp = np.sin(x * math.tau * 96)
    weft = np.sin(y * math.tau * 96)
    cloth_height = (warp + weft) * .012 + grain * .006
    cloth_color = .88 + (warp + weft) * .025 + (grain - .5) * .03
    cloth = save_map('velvet-weave-albedo', np.repeat(cloth_color[:, :, None], 3, axis=2), directory)
    cloth_normal = save_map('velvet-weave-normal', normal_from_height(cloth_height, 3), directory, True)
    for name in ['wine', 'sage', 'ink']:
        map_material(materials[name], cloth, cloth_normal)

    artwork_path = directory / 'moon-stag-glass.png'
    if not artwork_path.is_file():
        raise FileNotFoundError('Retain the moon-stag ImageGen artwork beside the procedural maps.')
    artwork = bpy.data.images.load(str(artwork_path), check_existing=True)
    artwork.pack()
    glass = materials['moon-glass']
    bsdf = glass.node_tree.nodes.get('Principled BSDF')
    source = glass.node_tree.nodes.new('ShaderNodeTexImage')
    source.image = artwork
    source.extension = 'EXTEND'
    glass.node_tree.links.new(source.outputs['Color'], bsdf.inputs['Base Color'])
    glass.node_tree.links.new(source.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = .35
    bsdf.inputs['Roughness'].default_value = .36
    pool = materials['stained-pool']
    pool_bsdf = pool.node_tree.nodes.get('Principled BSDF')
    pool_source = pool.node_tree.nodes.new('ShaderNodeTexImage')
    pool_source.image = artwork
    pool_source.extension = 'EXTEND'
    pool.node_tree.links.new(pool_source.outputs['Color'], pool_bsdf.inputs['Base Color'])
    pool.node_tree.links.new(pool_source.outputs['Color'], pool_bsdf.inputs['Emission Color'])
    pool_bsdf.inputs['Emission Strength'].default_value = .4
