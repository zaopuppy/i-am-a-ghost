"""Sculpted architectural dressing for the midnight-contract castle cutaway.

World space uses Blender Z-up and Y=-game Z. All standing decoration remains
in existing wall footprints; floor ornament is embedded and non-colliding.
"""

from math import cos, sin, pi
import random


def build_decor(api, scene):
    serial = 0
    rng = random.Random(1701)

    def key(label):
        nonlocal serial
        serial += 1
        return f'castle-{label}-{serial}'

    def box(label, pos, size, mat='stone-light', category='dressing', bevel=.02):
        return api['cube'](key(label), pos, size, mat, category, bevel)

    def cyl(label, pos, radius, depth, mat='gold', category='dressing', vertices=12):
        return api['cylinder'](key(label), pos, radius, depth, mat, category, vertices)

    def ball(label, pos, scale, mat='stone-light'):
        return api['sphere'](key(label), pos, scale, mat, 'dressing')

    def mesh(label, verts, faces, mat, category='dressing'):
        return api['mesh'](key(label), verts, faces, mat, category)

    def curve(label, points, radius=.018, mat='stone-light', category='dressing', sides=6):
        return api['tube'](key(label), points, radius, mat, category, sides)

    def rod(label, a, b, radius=.016, mat='gold'):
        return api['beam'](key(label), a, b, radius, mat, 'dressing')

    def ring(label, center, radius, mat='gold', vertical=True, wire=.013, category='dressing'):
        x, y, z = center
        points = [(x + cos(a) * radius, y if vertical else y + sin(a) * radius,
                   z + sin(a) * radius if vertical else z)
                  for a in [i * 2 * pi / 24 for i in range(25)]]
        curve(label, points, wire, mat, category)

    def flower(label, center, radius, petals=4, mat='gold', category='dressing'):
        x, y, z = center
        pts = []
        for i in range(33):
            a = i * 2 * pi / 32
            r = radius * (.73 + .27 * cos(a * petals))
            pts.append((x + cos(a) * r, y, z + sin(a) * r))
        curve(label, pts, .012, mat, category)

    def leaf(label, x, y, z, width=.08, height=.17, mat='sage', category='dressing'):
        mesh(label, [(x, y, z), (x - width / 2, y - .008, z + height * .42),
                     (x - width * .25, y - .018, z + height * .73),
                     (x, y, z + height), (x + width * .25, y - .018, z + height * .73),
                     (x + width / 2, y - .008, z + height * .42),
                     (x, y - .024, z + height * .53)],
             [(0, 6, 1), (1, 6, 2), (2, 6, 3), (3, 6, 4), (4, 6, 5), (5, 6, 0)], mat, category)

    def lancet_path(width, spring, apex, x=0, y=0):
        # Cubic-like side profile: upright spring, gently swept pointed crown.
        pts = [(x - width / 2, y, 0), (x - width / 2, y, spring)]
        for i in range(1, 13):
            t = i / 12
            pts.append((x - width / 2 * (1 - t ** 1.2), y,
                        spring + (apex - spring) * (1.3 * t - .3 * t * t)))
        for i in range(11, -1, -1):
            t = i / 12
            pts.append((x + width / 2 * (1 - t ** 1.2), y,
                        spring + (apex - spring) * (1.3 * t - .3 * t * t)))
        pts.append((x + width / 2, y, 0))
        return pts

    def window(x, width, height, base=.70):
        y = 11.68
        spring = height * .59
        crown = lancet_path(width, spring, height, x, y)
        crown = [(u, v, z + base) for u, v, z in crown]
        # Single planar texture surface: uncluttered illustration beneath fine
        # stone tracery. UVs deliberately map the full source portrait once.
        obj = mesh('moon-stag-stained-glass', crown, [tuple(reversed(range(len(crown))))], 'moon-glass')
        uv = obj.data.uv_layers.active
        for polygon in obj.data.polygons:
            for loop_index in polygon.loop_indices:
                vertex_index = obj.data.loops[loop_index].vertex_index
                u, _, z = crown[vertex_index]
                uv.data[loop_index].uv = ((u - x + width / 2) / width, (z - base) / height)
        # Recessed dark edging and polished stone ropes make the surround read
        # as a deep, hand-cut opening rather than a rectangular picture frame.
        for extra, wire, yy, mat in [(0, .055, y - .018, 'stone-dark'),
                                      (.13, .060, y - .06, 'stone-light'),
                                      (.27, .045, y - .02, 'stone')]:
            path = lancet_path(width + extra, spring, height + extra * .38, x, yy)
            curve('window-carved-archivolt', [(u, v, z + base) for u, v, z in path], wire, mat, sides=8)
        for side in [-1, 1]:
            xx = x + side * (width / 2 + .12)
            api['lathe'](key('window-fluted-shaft'),
                         [(0, 0), (.105, 0), (.105, .07), (.065, .11),
                          (.055, spring - .12), (.10, spring - .08),
                          (.10, spring), (0, spring)], (xx, y - .03, base), 'stone-light', 'dressing', 12)
            for dx in [-.023, .023]:
                rod('window-shaft-flute', (xx + dx, y - .09, base + .14),
                    (xx + dx, y - .09, base + spring - .15), .009, 'stone-dark')
            leaf('window-capital-acanthus', xx, y - .14, base + spring - .04, .12, .18, 'stone-light')
        box('window-projected-sill', (x, y + .02, base - .04), (width + .35, .32, .12), 'stone-light', bevel=.045)
        # The central portrait stays legible: two narrow side lights and a
        # crown quatrefoil provide rhythm without covering the stag/moon.
        for side in [-1, 1]:
            xx = x + side * width * .31
            path = lancet_path(width * .30, spring * .77, spring * .96, xx, y - .085)
            curve('stained-glass-side-lancet', [(u, v, z + base) for u, v, z in path], .019, 'stone-light')
        flower('window-quatrefoil', (x, y - .095, base + height * .79), width * .155, 4, 'stone-light')
        for side in [-1, 1]:
            curve('window-ogee-tracery', [(x + side * width * .46, y - .085, base + spring),
                                         (x + side * width * .28, y - .085, base + height * .75),
                                         (x + side * width * .13, y - .085, base + height * .77)], .017, 'stone-light')

    def door(x, game_z, axis):
        def world(u, v, h):
            return (x + u, -game_z + v, h) if axis == 'h' else (x + v, -game_z - u, h)
        # Round clustered columns remain outside the 2.2 m opening.
        for side in [-1, 1]:
            for u, v, r in [(side * 1.22, -.12, .063), (side * 1.27, .02, .047)]:
                pos = world(u, v, .12)
                api['lathe'](key('door-bundled-column'),
                             [(0, 0), (r * 1.38, 0), (r * 1.38, .07),
                              (r, .13), (r, 1.39), (r * 1.35, 1.43),
                              (r * 1.35, 1.48), (0, 1.48)], pos, 'stone-light', 'dressing', 12)
            cap = world(side * 1.245, -.05, 1.65)
            cyl('door-carved-capital', cap, .13, .13, 'stone-light')
            for delta in [-.06, .06]:
                p = world(side * 1.245 + delta, -.165, 1.64)
                ball('capital-leaf-tip', p, (.035, .018, .055), 'gold')
        # Two continuous rope mouldings over actual wedge-shaped voussoirs.
        path = lancet_path(2.36, 1.65, 2.63)
        for offset, radius, mat in [(-.16, .044, 'stone-light'), (.13, .032, 'stone-dark')]:
            curve('door-arch-rope', [world(u, offset, h) for u, _, h in path], radius, mat, sides=8)
        arch_pts = path[1:-1]
        for index in range(len(arch_pts) - 1):
            a, b = arch_pts[index], arch_pts[index + 1]
            verts = [world(u, v, h) for v in [-.08, .12]
                     for u, h in [(a[0], a[2]), (b[0], b[2]),
                                   (b[0] * 1.045, b[2] + .13), (a[0] * 1.045, a[2] + .13)]]
            mesh('door-cut-voussoir', verts, [(0, 3, 2, 1), (4, 5, 6, 7),
                 (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
                 'stone' if index % 3 else 'stone-light')
        p = world(0, -.17, 2.68)
        ball('arch-keystone-boss', p, (.075, .045, .10), 'stone-light')
        ball('arch-brass-boss', (p[0], p[1] - .025, p[2]), (.026, .026, .026), 'gold')

    def floor_diamond(x, y, size, mat='gold'):
        mesh('embedded-inlay-diamond', [(x - size, y, .052), (x, y - size, .052),
             (x + size, y, .052), (x, y + size, .052)], [(0, 1, 2, 3)], mat, 'floor')

    def woven_rug(label, x, game_z, w, d, mat):
        y = -game_z
        api['rug'](key(label), x, game_z, w, d, mat)
        # Ribbon-wave perimeter gives a handmade woven look, never a raised rail.
        for side in [-1, 1]:
            points = [(x - w / 2 + .16 + (w - .32) * i / 40,
                       y + side * (d / 2 - .14) + .033 * sin(i * pi / 2), .065)
                      for i in range(41)]
            curve('rug-gold-scroll', points, .008, 'gold', 'floor', 4)
        count = max(3, int(w / .9))
        for i in range(count):
            xx = x - w / 2 + .40 + (w - .80) * i / (count - 1)
            for side in [-1, 1]:
                floor_diamond(xx, y + side * (d / 2 - .30), .050)
        for xx in [x - w / 2 + .05, x + w / 2 - .05]:
            for j in range(8):
                rod('rug-fringe', (xx, y - d * .4 + j * d * .11, .052),
                    (xx + (-.07 if xx < x else .07), y - d * .4 + j * d * .11, .052), .008, 'bone')

    def compass(x, game_z, radius=1.0):
        y = -game_z
        ring('floor-moon-medallion-border', (x, y, .054), radius, 'gold', False, .012, 'floor')
        ring('floor-inner-border', (x, y, .054), radius * .83, 'wood-dark', False, .012, 'floor')
        for i in range(8):
            a = i * pi / 4
            tip = (x + cos(a) * radius * .76, y + sin(a) * radius * .76, .055)
            left = (x + cos(a - .21) * radius * .23, y + sin(a - .21) * radius * .23, .055)
            right = (x + cos(a + .21) * radius * .23, y + sin(a + .21) * radius * .23, .055)
            mesh('compass-lily-point', [(x, y, .055), left, tip, right], [(0, 1, 2, 3)],
                 'gold' if i % 2 == 0 else 'bone', 'floor')
        ring('moon-contract-seal', (x, y, .056), radius * .20, 'gold', False, .011, 'floor')

    def banner(x, game_z, base=1.06, height=1.55, width=.73):
        y = -game_z
        # A restrained billow and a split fishtail create an actual cloth edge.
        cols, rows = 6, 8
        verts = []
        for j in range(rows + 1):
            for i in range(cols + 1):
                u, v = i / cols, j / rows
                z = base + height * v
                if j == 0:
                    z += .13 * (1 - abs(u - .5) * 2)
                verts.append((x + (u - .5) * width,
                              y + sin(u * pi * 2 + v * 2) * .025, z))
        faces = [(j * (cols + 1) + i, j * (cols + 1) + i + 1,
                  (j + 1) * (cols + 1) + i + 1, (j + 1) * (cols + 1) + i)
                 for j in range(rows) for i in range(cols)]
        mesh('billowing-wine-heraldry', verts, faces, 'wine')
        rod('banner-forged-crossbar', (x - width * .65, y, base + height + .035),
            (x + width * .65, y, base + height + .035), .024, 'iron')
        for side in [-1, 1]:
            ball('banner-crossbar-finial', (x + side * width * .65, y, base + height + .035), (.035, .035, .035), 'gold')
            curve('embroidered-banner-edge', [(x + side * width * .43, y - .036, base + .07),
                                              (x + side * width * .43, y - .036, base + height - .06)], .012, 'gold')
        ring('heraldic-moon', (x, y - .045, base + height * .59), width * .20, 'gold', True, .014)
        flower('heraldic-lily', (x, y - .046, base + height * .27), width * .10, 3, 'gold')

    def lantern(x, y, h):
        # North-facing wall lantern: the hanger sits inside the existing wall.
        box('lantern-wall-mount', (x, y + .05, h + .12), (.10, .06, .28), 'iron', bevel=.018)
        curve('lantern-scroll-bracket', [(x, y + .03, h + .23), (x, y - .04, h + .32),
                                         (x, y - .13, h + .31), (x, y - .17, h + .22)], .018, 'iron')
        ring('lantern-hanging-ring', (x, y - .14, h + .19), .048, 'iron', wire=.012)
        for z, r in [(h - .25, .125), (h + .09, .125)]:
            cyl('lantern-metal-ledge', (x, y - .14, z), r, .035, 'iron', vertices=8)
        for i in range(4):
            a = pi / 4 + i * pi / 2
            xx, yy = x + cos(a) * .102, y - .14 + sin(a) * .102
            rod('lantern-forged-upright', (xx, yy, h - .24), (xx, yy, h + .09), .012, 'iron')
        api['lathe'](key('lantern-pointed-cap'), [(0, 0), (.13, 0), (.14, .025),
                     (.06, .11), (.025, .14), (0, .15)], (x, y - .14, h + .10), 'copper', 'dressing', 8)
        cyl('lantern-candle', (x, y - .14, h - .14), .027, .16, 'bone')
        ball('lantern-small-flame', (x, y - .14, h - .03), (.017, .017, .038), 'flame')

    def ivy(x, y, base=.25, height=2.5):
        points = [(x + .13 * sin(i * .8), y, base + height * i / 14) for i in range(15)]
        curve('ivy-aged-stem', points, .011, 'wood-dark')
        for i in range(13):
            p = points[i + 1]
            side = -1 if i % 2 else 1
            xx = p[0] + side * (.12 + .035 * sin(i))
            rod('ivy-petiole', p, (xx, y - .018, p[2] + .07), .006, 'wood-dark')
            leaf('ivy-heart-leaf', xx, y - .018, p[2], .14, .19, 'sage')
        for side in [-1, 1]:
            pts = [(x, y, base + height * .60),
                   (x + side * .27, y, base + height * .66),
                   (x + side * .48, y, base + height * .73)]
            curve('ivy-lateral', pts, .007, 'wood-dark')
            leaf('ivy-lateral-leaf', pts[-1][0], y - .01, pts[-1][2], .11, .15, 'sage')

    # Three portraits are the primary environment anchor; the chapel version
    # extends beyond the cutaway wall to retain a cathedral-like silhouette.
    window(-12, 2.0, 3.0)
    window(0, 2.6, 3.5)
    window(12, 2.0, 3.0)
    for x in [-3.65, 3.65]:
        banner(x, -11.70)
    for x in [-14.3, -9.7, 9.7, 14.3]:
        banner(x, -11.72, 1.03, 1.28, .56)
    for x in [-15.15, -7.6, 7.6, 15.15]:
        ivy(x, 11.74, .21, 2.6 if abs(x) > 14 else 1.8)
    for x in [-13.8, -10.2, -2.0, 2.0, 10.2, 13.8]:
        lantern(x, 11.82, 1.65)

    # Four deliberately spaced piers add masonry rhythm, instead of repeating
    # micro-trim on every wall. Fluting and leaf capitals catch grazing light.
    for x in [-15.3, -8.65, 8.65, 15.3]:
        api['lathe'](key('north-carved-pilaster'), [(0, 0), (.145, 0), (.145, .14),
                     (.095, .22), (.095, 2.67), (.14, 2.72),
                     (.14, 2.84), (.17, 2.88), (0, 2.88)],
                     (x, 11.76, .13), 'stone-light', 'dressing', 12)
        for dx in [-.045, .045]:
            rod('pilaster-recessed-flute', (x + dx, 11.665, .42),
                (x + dx, 11.665, 2.67), .010, 'stone-dark')
        leaf('pilaster-leaf-capital', x, 11.60, 2.79, .17, .20, 'stone-light')

    # Local carved insignia make the rooms readable and tell their former use.
    # A scholarly book seal and crossed armory blades are reliefs on the wall.
    for x in [-8.15, 8.15]:
        box('carved-room-frieze', (x, 11.76, 1.10), (.88, .09, .62), 'stone-dark', bevel=.025)
        flower('frieze-quatrefoil', (x, 11.695, 1.10), .26, 4, 'stone-light')
    for side in [-1, 1]:
        book = box('scholar-book-relief', (-8.15 + side * .10, 11.63, 1.10), (.19, .035, .23), 'bone', bevel=.006)
        book.rotation_euler.y = side * .10
        rod('armory-blade-insignia', (8.15 + side * .16, 11.64, .91),
            (8.15 - side * .16, 11.64, 1.29), .018, 'pewter')
        rod('armory-hilt-insignia', (8.15 + side * .22, 11.62, .99),
            (8.15 + side * .05, 11.62, .88), .014, 'gold')

    # A soft, colored stained-window reflection lies under the chapel window.
    # The root supplies a translucent texture material; this card is flat,
    # upward-facing and intentionally independent of gameplay collision.
    projection = mesh('chapel-stained-glass-floor-pool',
                      [(-.9, 8.7, .030), (.9, 8.7, .030),
                       (.9, 11.3, .030), (-.9, 11.3, .030)],
                      [(0, 1, 2, 3)], 'stained-pool', 'floor')
    for polygon in projection.data.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = projection.data.loops[loop_index].vertex_index
            projection.data.uv_layers.active.data[loop_index].uv = [(0, 0), (1, 0), (1, 1), (0, 1)][vertex_index]

    # Small mortar staining remains on wall faces: aged corners, not random
    # darkening across walking routes or another geometry obstacle.
    for x, width in [(-15.1, .72), (-7.1, .44), (7.1, .40), (15.0, .68)]:
        mesh('wall-base-quiet-damp', [(x - width / 2, 11.805, .12),
             (x + width / 2, 11.805, .12), (x + width * .41, 11.805, .35),
             (x + width * .13, 11.805, .30), (x - width * .16, 11.805, .48),
             (x - width * .45, 11.805, .36)],
             [(0, 1, 2, 3, 4, 5)], 'wear')

    for x, z, axis in ([(x, z, 'h') for z in [-4, 6] for x in [-12, 0, 12]]
                       + [(x, -8, 'v') for x in [-6, 6]]
                       + [(x, 1, 'v') for x in [-8, 8]]):
        door(x, z, axis)

    woven_rug('entry-processional-runner', 0, 9, 28.5, 1.66, 'wine')
    woven_rug('banquet-contract-runner', 0, 1, 1.50, 8.0, 'wine')
    woven_rug('chapel-aisle', 0, -7.1, 1.40, 4.4, 'ink')
    woven_rug('library-reading-rug', -11, -8, 4.1, 3.5, 'sage')
    compass(0, 9, .59)
    # Kitchen and armory differ through embedded tiles rather than new obstacles.
    for i in range(5):
        for j in range(4):
            floor_diamond(-14.5 + i * 1.25, 2.7 - j * 1.45, .17,
                          'bone' if (i + j) % 2 else 'wood-dark')
    for x in [9.3, 12.7]:
        for game_z in [-10.3, -5.7]:
            compass(x, game_z, .35)

    # Quiet narrative scraps stay lower than the floor bevel and against walls.
    for i in range(5):
        obj = box('fallen-library-page', (-14.9 + rng.random() * .45,
                  9.5 + rng.random() * .5, .022), (.15, .21, .003), 'paper', 'floor', .002)
        obj.rotation_euler.z = rng.uniform(-.6, .6)
    for i in range(6):
        floor_diamond(-15.3 + rng.random() * .7, -2.5 + rng.random() * .25, .012, 'wood-dark')

    # Exterior footings and buttresses mark the cutaway as architecture. They
    # remain outside gameplay bounds, below window tops, with moss at the base.
    for x in [-16.30, 16.30]:
        for game_z in [-12.25, 12.25]:
            y = -game_z
            box('buttress-stepped-foundation', (x, y, .16), (.82, .82, .32), 'stone-dark', bevel=.045)
            box('buttress-low-plinth', (x, y, .39), (.67, .67, .16), 'stone-light', bevel=.03)
            box('buttress-pier', (x, y, .99), (.47, .47, 1.14), 'stone', bevel=.035)
            api['lathe'](key('buttress-cap'), [(0, 0), (.39, 0), (.39, .075),
                         (.33, .10), (.30, .25), (.13, .30), (0, .30)],
                         (x, y, 1.59), 'stone-light', 'dressing', 4)
            for i in range(3):
                ball('buttress-low-moss', (x - .20 + i * .19, y - .35, .10), (.13, .07, .045), 'sage')
