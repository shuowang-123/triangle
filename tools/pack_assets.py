#!/usr/bin/env python3
"""把 Poly Haven（CC0）的材质、模型、天空打包成 assets/*.js（base64），
这样双击 index.html（file://）也能加载，GitHub Pages 上也一样。
用法：python3 tools/pack_assets.py <forest-game 仓库的 assets 目录> <旧 photos.js>
"""
import sys, os, io, json, base64, re
from PIL import Image

SRC = sys.argv[1]
OLD = sys.argv[2] if len(sys.argv) > 2 else None
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')

def webp(im, size=None, q=82, mode=None):
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    if mode: im = im.convert(mode)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=6); return b.getvalue()

def tex_set(name, dsize=1024, nsize=1024, asize=512):
    d = os.path.join(SRC, 'textures', name)
    def pick(kind):
        for f in (f'{name}_{kind}_1k.jpg', f'{name}_{kind}.webp'):
            p = os.path.join(d, f)
            if os.path.exists(p): return Image.open(p).convert('RGB')
        return None
    out = {}
    out[f'tex/{name}/diff'] = ('image/webp', webp(pick('diff'), dsize, 80))
    out[f'tex/{name}/nor'] = ('image/webp', webp(pick('nor_gl'), nsize, 80))
    a = pick('arm')
    if a: out[f'tex/{name}/arm'] = ('image/webp', webp(a, asize, 80))
    return out

def raw(path, key, mime):
    return {key: (mime, open(os.path.join(SRC, path), 'rb').read())}

def prop_dir(folder, files, texs=('diff', 'nor', 'arm')):
    out = {}
    for f in files:
        out[f'glb/{folder}/{f}'] = ('model/gltf-binary', open(os.path.join(SRC, 'props', folder, f + '.glb'), 'rb').read())
    for t in texs:
        p = os.path.join(SRC, 'props', folder, f'{folder}_{t}.webp')
        if os.path.exists(p) and os.path.getsize(p) > 200:
            out[f'tex/{folder}/{t}'] = ('image/webp', open(p, 'rb').read())
    return out

def sky(name):
    out = {}
    out[f'sky/{name}/img'] = ('image/webp', open(os.path.join(SRC, 'sky', name + '_sky.webp'), 'rb').read())
    out[f'sky/{name}/light'] = ('application/octet-stream', open(os.path.join(SRC, 'sky', name + '_light.f16'), 'rb').read())
    out[f'sky/{name}/json'] = ('application/json', open(os.path.join(SRC, 'sky', name + '.json'), 'rb').read())
    return out

def write(pack, items):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, pack + '.js')
    tot = 0
    with open(path, 'w') as f:
        f.write('// 自动生成（tools/pack_assets.py）：Poly Haven CC0 素材，见 assets/CREDITS.md\n')
        f.write('(window.ASSET_PACKS=window.ASSET_PACKS||{})[%s]={\n' % json.dumps(pack))
        for k, (mime, data) in items.items():
            tot += len(data)
            f.write('%s:"data:%s;base64,%s",\n' % (json.dumps(k), mime, base64.b64encode(data).decode()))
        f.write('};\n')
    print(pack, len(items), 'items', tot // 1024, 'KB raw ->', os.path.getsize(path) // 1024, 'KB')

core = {}
for n in ['forrest_ground_01', 'aerial_grass_rock', 'mossy_rock', 'forest_leaves_02']:
    core.update(tex_set(n))
for n in ['asphalt_02', 'concrete', 'old_planks_02', 'pine_bark', 'weathered_brown_planks']:
    core.update(tex_set(n, 1024, 512, 512))
core.update(prop_dir('rock_large', ['r1_lod0', 'r2_lod0', 'r3_lod0', 'r5_lod0']))
core.update(prop_dir('rock_medium', ['r8_lod0', 'r9_lod0', 'r10_lod0', 'r12_lod0']))
core.update(prop_dir('grass', ['tall_a_lod0', 'tall_b_lod0', 'tall_c_lod0', 'small_b_lod0']))
core.update(prop_dir('fern', ['a_lod0', 'b_lod0', 'c_lod0', 'd_lod0']))
core.update(prop_dir('branches', ['a_lod0', 'b_lod0']))
core.update(prop_dir('stump', ['a_lod0']))
for f in ['metal_jerrycan', 'old_tyre', 'propane_tank', 'metal_trash_can', 'trashbag', 'covered_car', 'exterior_aircon_unit', 'wooden_picnic_table']:
    core.update(raw(f'village/{f}.glb', f'glb/{f}', 'model/gltf-binary'))
for f in ['wine_barrel_01', 'treasure_chest']:
    core.update(raw(f'hall/{f}.glb', f'glb/{f}', 'model/gltf-binary'))
for s in ['kloofendal_48d', 'qwantani_sunrise', 'kloppenheim_06', 'kloppenheim_02']:
    core.update(sky(s))
# 旧版本里的几张小照片材质（集装箱钢板、生锈油桶、麻布沙袋、金属、沙地）
if OLD:
    s = open(OLD).read()
    for m in re.finditer(r'"?(\w+)"?\s*:\s*"data:image/(\w+);base64,([A-Za-z0-9+/=]+)"', s):
        k = m.group(1)
        if k.split('_')[0] in ('container', 'barrel', 'burlap', 'metal', 'sand', 'ground', 'wall'):
            core['old/' + k] = ('image/' + m.group(2), base64.b64decode(m.group(3)))
write('core', core)

town = {}
for n in ['white_plaster_rough_01', 'clay_roof_tiles', 'cobblestone_floor_04', 'castle_wall_slates', 'wooden_gate']:
    town.update(tex_set(n, 1024, 512, 512))
write('town', town)

fort = {}
for n in ['medieval_blocks_03', 'large_floor_tiles_02', 'castle_wall_varriation']:
    fort.update(tex_set(n, 1024, 512, 512))
write('fort', fort)
