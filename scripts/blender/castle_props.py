"""Authored castle furniture kit, built in local XY ground / Z-up coordinates.

The caller owns placement transforms, shared materials, collision proxies and
export batching. Detail is concentrated on visible tops, carved profiles and
functional metalwork; no new collider or gameplay footprint is introduced.
"""

from math import cos, sin, pi
import random


FOOTPRINTS = {
    'shelf_B_large_decorated': (1.82, .42),
    'table_medium': (1.72, 1.72),
    'table_low': (2.1, 1.22),
    'table_medium_long': (2.68, 1.68),
    'table_small': (.82, .82),
    'chair_A_wood': (.62, .7),
    'cabinet_medium_decorated': (1.8, .82),
}


def build_furniture(api, placement):
    """Build one named, material-batched-ready piece at the local origin."""
    name = placement['id']
    room = placement['roomId']
    asset = placement['asset']
    w, d = FOOTPRINTS[asset]
    rng = random.Random(sum((i + 1) * ord(c) for i, c in enumerate(name)))
    serial = 0

    def key(label):
        nonlocal serial
        serial += 1
        return f'{name}-{label}-{serial}'

    def box(label, pos, size, mat='wood', bevel=.02):
        return api['cube'](key(label), pos, size, mat, 'furniture', bevel)

    def cyl(label, pos, radius, depth, mat='gold', vertices=12):
        return api['cylinder'](key(label), pos, radius, depth, mat, 'furniture', vertices)

    def ball(label, pos, scale, mat='wood'):
        return api['sphere'](key(label), pos, scale, mat, 'furniture')

    def rod(label, a, b, radius=.018, mat='wood-light'):
        return api['beam'](key(label), a, b, radius, mat, 'furniture')

    def curve(label, points, radius=.012, mat='gold', sides=6):
        return api['tube'](key(label), points, radius, mat, 'furniture', sides)

    def lathe(label, profile, pos, mat='wood', segments=12):
        return api['lathe'](key(label), profile, pos, mat, 'furniture', segments)

    def mesh(label, verts, faces, mat='pewter'):
        return api['mesh'](key(label), verts, faces, mat, 'furniture')

    def panel(label, points, y, thickness=.035, mat='wood', tilt=0, pivot_z=0):
        """Extruded authored profile in the XZ plane."""
        n = len(points)
        verts = [(x, y - thickness / 2, z) for x, z in points]
        verts += [(x, y + thickness / 2, z) for x, z in points]
        if tilt:
            verts = [(x, y + (yy - y) * cos(tilt) - (z - pivot_z) * sin(tilt),
                      pivot_z + (yy - y) * sin(tilt) + (z - pivot_z) * cos(tilt))
                     for x, yy, z in verts]
        faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        return api['mesh'](key(label), verts, faces, mat, 'furniture')

    def ring(label, x, y, z, radius, mat='gold', vertical=False, wire=.009):
        points = [(x + cos(a) * radius,
                   y if vertical else y + sin(a) * radius,
                   z + sin(a) * radius if vertical else z)
                  for a in [i * 2 * pi / 16 for i in range(17)]]
        curve(label, points, wire, mat)

    def pointed(label, x, y, z, width, height, mat='wood-light', radius=.018):
        points = [(x - width / 2, y, z), (x - width / 2, y, z + height * .56),
                  (x - width * .40, y, z + height * .76),
                  (x - width * .23, y, z + height * .9), (x, y, z + height),
                  (x + width * .23, y, z + height * .9),
                  (x + width * .40, y, z + height * .76),
                  (x + width / 2, y, z + height * .56), (x + width / 2, y, z)]
        curve(label, points, radius, mat)

    def rosette(label, x, y, z, size, mat='gold'):
        # A stylized four-petal relief with a dark center and raised brass boss.
        points = []
        for i in range(25):
            a = i * 2 * pi / 24
            r = size * (.72 + .28 * cos(a * 4))
            points.append((x + r * cos(a), y, z + r * sin(a)))
        curve(label, points, .008, mat)
        ball(label + '-boss', (x, y - .005, z), (.025, .012, .025), mat)

    def turned_leg(x, y, h, thick=.065):
        profile = [(0, 0), (thick * 1.2, 0), (thick * 1.2, .055),
                   (thick * .70, .09), (thick * .65, h * .25),
                   (thick * 1.18, h * .32), (thick * 1.28, h * .39),
                   (thick * .72, h * .46), (thick * .58, h * .72),
                   (thick * 1.08, h * .79), (thick * 1.08, h * .85),
                   (thick * .80, h), (0, h)]
        lathe('turned-column', profile, (x, y, .025), 'wood-dark')
        for z in [h * .34, h * .8]:
            cyl('leg-brass-collar', (x, y, z + .025), thick * 1.12, .022)

    def candle(x, y, z, height=.24):
        lathe('candlestick', [(0, 0), (.075, 0), (.09, .015), (.06, .035),
                             (.023, .075), (.022, .17), (.065, .19),
                             (.055, .21), (0, .21)], (x, y, z), 'gold')
        cyl('ivory-candle', (x, y, z + .21 + height / 2), .027, height, 'bone')
        ball('warm-flame', (x, y, z + .21 + height + .025), (.013, .013, .035), 'flame')

    def goblet(x, y, z, tipped=False):
        obj = lathe('pewter-goblet', [(0, 0), (.066, 0), (.067, .014), (.02, .03),
                              (.016, .12), (.053, .15), (.075, .2),
                              (.075, .265), (.063, .265), (.06, .215),
                              (.04, .19), (0, .18)], (x, y, z), 'pewter')
        if tipped:
            obj.rotation_euler.x = pi / 2
            ring('fallen-goblet-lip', x, y - .267, z, .070, 'gold', True, .005)
        else:
            ring('goblet-lip', x, y, z + .267, .070, 'gold', wire=.005)

    def plate(x, y, z, radius=.17):
        lathe('plate', [(0, 0), (radius * .7, 0), (radius, .025),
                        (radius, .04), (radius * .80, .03),
                        (radius * .68, .01), (0, .01)], (x, y, z), 'pewter')
        ring('plate-rim', x, y, z + .034, radius * .89, 'gold', wire=.006)

    def pottery(x, y, z, r=.10, h=.30, mat='ceramic'):
        lathe('stoneware', [(0, 0), (r * .65, 0), (r, h * .15),
                            (r, h * .52), (r * .55, h * .80),
                            (r * .48, h), (r * .36, h),
                            (r * .36, h * .78), (0, h * .73)], (x, y, z), mat)
        ring('pot-rim', x, y, z + h, r * .45, 'bone', wire=.009)

    def book(x, y, z, width=.085, h=.28, color='wine'):
        box('leather-book', (x, y, z + h / 2), (width, .19, h), color, .006)
        box('book-pages', (x, y + .008, z + h / 2), (width * .77, .18, h - .022), 'paper', .001)
        box('bound-spine', (x, y - .098, z + h / 2), (width, .014, h), color, .006)
        for dz in [.055, h - .055]:
            box('gilded-binding', (x, y - .106, z + dz), (width * .94, .005, .011), 'gold', .001)

    def stacked_volume(x, y, z, width=.29, color='wine'):
        # Five small source meshes became three broader authored forms here;
        # horizontal stacks break the shelf grid and spend fewer triangles.
        box('stacked-book-cover', (x, y, z + .026), (width, .19, .052), color, .005)
        box('stacked-book-pages', (x, y - .012, z + .026), (width - .018, .178, .032), 'paper', .002)
        box('stacked-gold-spine', (x, y + .085, z + .026), (width * .84, .008, .012), 'gold', .001)

    def open_book(x, y, z, width=.42, color='wine'):
        box('open-book-leather', (x, y, z), (width + .028, .27, .025), color, .006)
        for side in [-1, 1]:
            page = box('open-devotional-page', (x + side * width / 4, y, z + .028),
                       (width / 2 - .012, .25, .025), 'paper', .003)
            page.rotation_euler.y = side * .07
            for i in range(3):
                box('devotional-script', (x + side * width / 4, y - .08 + .06 * i, z + .043),
                    (width / 2 - .05, .006, .002), 'ink', .001)

    def wilted_vase(x, y, z):
        pottery(x, y, z, .068, .19, 'ceramic')
        for side in [-1, 1]:
            pts = [(x, y, z + .17), (x + side * .02, y, z + .33),
                   (x + side * .08, y + .01, z + .39), (x + side * .105, y + .01, z + .34)]
            curve('wilted-flower-stem', pts, .005, 'sage', sides=4)
            for j in range(3):
                a = j * 2 * pi / 3
                petal = box('dry-flower-petal', (pts[-1][0] + cos(a) * .022,
                     pts[-1][1] + sin(a) * .022, pts[-1][2]), (.036, .022, .01), 'bone', .003)
                petal.rotation_euler.z = a

    def copper_pan(x, y, z, radius=.095):
        # Wall-hung skillet inside the cabinet/shelf footprint, facing forward.
        obj = lathe('hanging-copper-skillet', [(0, 0), (radius, 0),
                   (radius, .030), (radius * .90, .038),
                   (radius * .85, .012), (0, .012)], (x, y, z), 'copper', 10)
        obj.rotation_euler.x = pi / 2
        rod('skillet-long-handle', (x, y - .017, z + radius * .72),
            (x, y - .017, z + radius * 1.65), .011, 'iron')
        ring('skillet-hanging-eye', x, y - .017, z + radius * 1.82, .018, 'iron', True, .005)

    def armor(x, y, z):
        lathe('armor-plinth', [(0, 0), (.26, 0), (.26, .05), (.22, .08),
                              (.22, .12), (0, .12)], (x, y, z), 'wood-dark')
        rod('armor-stand', (x, y, z + .12), (x, y, z + .98), .045, 'wood-dark')
        # Tapered breastplate faces read as metal plates rather than a sphere torso.
        panel('cuirass', [(x - .19, z + .30), (x - .24, z + .68),
                         (x - .15, z + .8), (x + .15, z + .8),
                         (x + .24, z + .68), (x + .19, z + .30)], y, .21, 'pewter')
        rod('breastplate-ridge', (x, y - .118, z + .34), (x, y - .118, z + .76), .017, 'gold')
        for side in [-1, 1]:
            ball('curved-pauldron', (x + side * .235, y, z + .72), (.14, .13, .09), 'pewter')
            curve('shoulder-gold-trim', [(x + side * .14, y - .1, z + .73),
                                       (x + side * .25, y - .13, z + .70),
                                       (x + side * .34, y - .085, z + .68)], .009)
            for i in range(3):
                ball('armor-rivet', (x + side * (.12 + .034 * i), y - .115, z + .68), (.012, .009, .012), 'gold')
        lathe('helmet', [(0, 0), (.14, 0), (.16, .05), (.16, .18),
                         (.12, .26), (.04, .30), (0, .31)], (x, y, z + .85), 'pewter', 16)
        panel('closed-visor', [(x - .12, z + .92), (x - .14, z + 1.05),
                              (x, z + 1.11), (x + .14, z + 1.05),
                              (x + .12, z + .92)], y - .15, .025, 'iron')
        for i in [-1, 0, 1]:
            box('visor-breath-slot', (x + i * .052, y - .169, z + .985), (.014, .009, .044), 'pewter', .002)
        rod('helmet-crest', (x, y + .09, z + 1.1), (x, y - .06, z + 1.19), .014, 'gold')
        for side in [-1, 1]:
            ball('visor-hinge', (x + side * .145, y - .13, z + 1.035), (.02, .015, .02), 'gold')

    def tabletop(h):
        # Actual separate planks with slight steps catch light along the grain.
        planks = 5
        box('table-edge-apron', (0, 0, h - .10), (w - .12, d - .12, .14), 'wood-dark', .035)
        for i in range(planks):
            y = -d / 2 + (i + .5) * d / planks
            box('polished-oak-plank', (0, y, h), (w - .035, d / planks - .013, .10),
                'wood-light' if i % 3 == 1 else 'wood', .022)
        for x in [-w / 2 + .1, w / 2 - .1]:
            box('breadboard-end', (x, 0, h + .005), (.1, d - .012, .12), 'wood-dark', .022)
            for y in [-d / 2 + .09, d / 2 - .09]:
                cyl('brass-top-pin', (x, y, h + .069), .018, .007)

    def table():
        h = .93
        tabletop(h)
        if asset == 'table_medium_long':
            # Swept trestle feet, keyed mortise and a deep carved horizontal beam.
            for x in [-w * .30, w * .30]:
                panel('swept-trestle-foot', [(x - .21, .07), (x - .15, .18),
                      (x - .08, .24), (x + .08, .24), (x + .15, .18),
                      (x + .21, .07)], 0, d * .75, 'wood-dark')
                turned_leg(x, 0, h - .1, .105)
                box('trestle-head', (x, 0, h - .14), (.30, d * .82, .12), 'wood-dark', .025)
            rod('cross-stretcher', (-w * .35, 0, .34), (w * .35, 0, .34), .065, 'wood-dark')
            for x in [-w * .29, w * .29]:
                box('mortise-key', (x, -.105, .34), (.065, .055, .16), 'wood-light', .012)
        else:
            for x in [-w * .37, w * .37]:
                for y in [-d * .35, d * .35]:
                    turned_leg(x, y, h - .09)
            rod('desk-stretcher', (-w * .36, d * .35, .24), (w * .36, d * .35, .24), .04, 'wood-dark')
        top = h + .07
        if room == 'banquet':
            abandoned = name.endswith('--3.5')
            box('woven-wine-runner', (0, 0, top), (w * .82, .31, .014), 'wine', .006)
            for y in [-d * .29, d * .29]:
                for x in [-w * .29, w * .29]:
                    plate(x, y, top + .005)
                    if abandoned and x < 0 and y < 0:
                        goblet(x + .17, y * .79, top + .08, True)
                        for j in range(3):
                            box('forgotten-bread-crumb', (x + .035 * j, y + .018 * j, top + .05),
                                (.018, .012, .009), 'bone', .002)
                    elif not (abandoned and x > 0 and y > 0):
                        goblet(x + .20, y * .79, top + .01)
            candle(-.35, 0, top + .01, .26)
            candle(.35, 0, top + .01, .18)
            plate(0, 0, top + .015, .19)
            for x in [-.10, .06]:
                ball('baked-loaf', (x, .015, top + .08), (.12, .085, .062), 'bone')
                for dx in [-.04, .02, .07]:
                    curve('scored-bread', [(x + dx, -.04, top + .11),
                                           (x + dx + .018, .055, top + .11)], .006, 'wood-light')
            if abandoned:
                wilted_vase(.68, .045, top)
                for x, y in [(.31, .06), (.27, -.04), (.38, -.02)]:
                    ball('forgotten-plum', (x, y, top + .055), (.055, .045, .045), 'wine')
            else:
                lathe('fruit-bowl', [(0, 0), (.10, 0), (.17, .025),
                                     (.19, .075), (.17, .09), (.13, .035), (0, .025)],
                      (.75, 0, top), 'pewter', 10)
                for x, y in [(.69, -.03), (.78, -.04), (.75, .04)]:
                    ball('pear-and-apple', (x, y, top + .080), (.049, .047, .050), 'sage' if x < .75 else 'wine')
        elif room == 'library':
            box('writing-blotter', (-.13, .02, top), (.78, .58, .02), 'wine', .008)
            for side in [-1, 1]:
                obj = box('open-manuscript', (side * .19 - .1, -.08, top + .028), (.36, .34, .036), 'paper', .01)
                obj.rotation_euler.y = side * .09
                for i in range(4):
                    box('ink-script-line', (side * .19 - .1, -.19 + i * .057, top + .053), (.22, .006, .003), 'ink', .001)
            cyl('ink-well', (.43, -.27, top + .035), .052, .07, 'ink')
            rod('quill-shaft', (.43, -.27, top + .075), (.54, -.28, top + .42), .007, 'bone')
            panel('quill-feather', [(.49, top + .24), (.49, top + .41),
                                   (.54, top + .48), (.585, top + .36)], -.28, .008, 'paper')
            candle(-.57, .36, top)
            book(.52, .34, top, .13, .15, 'sage')
            ring('atlas-compass-rose', -.29, -.08, top + .056, .075, 'ink', False, .003)
            for a in [0, pi / 2]:
                curve('atlas-navigation-line', [(-.29 - cos(a) * .095, -.08 - sin(a) * .095, top + .058),
                    (-.29 + cos(a) * .095, -.08 + sin(a) * .095, top + .058)], .002, 'ink', sides=4)
            cyl('broken-wax-seal', (.23, .28, top + .006), .035, .011, 'wine', 8)
            box('sealed-letter', (.20, .28, top + .003), (.23, .13, .008), 'paper', .002)
            curve('spilled-ink', [(.43, -.27, top + .005), (.47, -.28, top + .005),
                  (.50, -.31, top + .005), (.51, -.35, top + .005)], .016, 'ink', sides=4)
        elif room == 'armory':
            box('display-velvet', (0, 0, top), (w * .84, d * .80, .016), 'wine', .01)
            armor(0, 0, top)
            # A laid-down ceremonial sword and small shield tell a different
            # story from the upright full suit on the cabinet.
            panel('ceremonial-shield', [(-.63, top + .03), (-.60, top + .34),
                  (-.42, top + .42), (-.24, top + .34), (-.21, top + .03)], .40, .028, 'pewter')
            rosette('shield-lily-crest', -.42, .375, top + .25, .052)
            mesh('ceremonial-sword-blade', [(.24, -.57, top + .032), (.35, -.53, top + .032),
                  (.56, .26, top + .032), (.49, .40, top + .032), (.43, .30, top + .032)],
                 [(0, 1, 2, 3, 4)], 'pewter')
            rod('sword-crossguard', (.24, -.30, top + .04), (.47, -.37, top + .04), .018, 'gold')
            rod('sword-leather-hilt', (.28, -.40, top + .04), (.24, -.57, top + .04), .022, 'wood-dark')
        else:
            box('butcher-board', (-.22, -.08, top), (.70, .49, .045), 'wood-light', .035)
            ball('bread-loaf', (-.26, -.10, top + .08), (.22, .12, .07), 'bone')
            pottery(.60, .35, top, .12, .31)
            pottery(.28, .44, top, .095, .23, 'copper')
            for i in range(3):
                rod('herb-stem', (.22 + i * .08, -.38, top + .026),
                    (.26 + i * .08, -.18, top + .026), .009, 'sage')
                for j in range(2):
                    ball('herb-leaf', (.25 + i * .08, -.28 + j * .055, top + .03), (.028, .048, .009), 'sage')

    def bench():
        seat_z = .49
        broken = name == 'chapel-pew--3-1'
        for x in [-w * .36, w * .36]:
            panel('carved-bench-end', [(x - .105, .02), (x - .10, .45),
                  (x - .15, .52), (x - .12, 1.03), (x, 1.13),
                  (x + .12, 1.03), (x + .15, .52),
                  (x + .10, .45), (x + .105, .02)], d * .27, .12, 'wood-dark')
            turned_leg(x, -d * .26, seat_z - .04, .055)
        box('seat-oak', (0, 0, seat_z), (w * .94, d * .68, .09), 'wood', .025)
        if broken:
            panel('fractured-tipped-pew-back', [(-w * .44, .57), (-w * .44, .94),
                 (-.18, .92), (-.11, .82), (-.04, .93), (.02, .79), (.13, .94),
                 (w * .44, .96), (w * .44, .57)], .29, .07, 'wood-dark', tilt=.44, pivot_z=.72)
            box('split-pew-crown-left', (-.55, .20, .92), (.75, .09, .075), 'wood-light', .012)
            box('split-pew-crown-right', (.58, .20, .94), (.70, .09, .075), 'wood-light', .012)
        else:
            box('rear-back-panel', (0, d * .32, .86), (w * .91, .07, .55), 'wood-dark', .025)
            box('back-crown', (0, d * .32, 1.14), (w * .98, .12, .085), 'wood-light', .025)
        box('bench-stretcher', (0, 0, .18), (w * .76, .055, .065), 'wood-dark', .008)
        for x in ([-w * .29, w * .29] if broken else [-w * .29, 0, w * .29]):
            if broken:
                continue
            pointed('gothic-blind-arch', x, d * .275, .64, w * .23, .42, 'wood-light')
            rosette('carved-trefoil', x, d * .265, .88, .065, 'wood-light')
        if room == 'entrance':
            box('wine-seat-pad', (0, -.045, .552), (w * .84, d * .51, .07), 'wine', .04)

    def chair():
        for x in [-.23, .23]:
            for y in [-.25, .25]:
                turned_leg(x, y, .46, .033)
        box('chair-seat-rim', (0, 0, .47), (.60, .64, .10), 'wood-dark', .028)
        box('velvet-chair-cushion', (0, -.03, .54), (.53, .53, .065), 'wine', .04)
        for x in [-.215, .215]:
            for y in [-.22, .19]:
                ball('seat-button', (x, y, .575), (.010, .010, .004), 'gold')
        profile = [(-.255, .52), (-.27, 1.16), (-.22, 1.30),
                   (-.11, 1.35), (0, 1.48), (.11, 1.35),
                   (.22, 1.30), (.27, 1.16), (.255, .52)]
        panel('gothic-chair-back', profile, .30, .07, 'wood-dark')
        pointed('chair-back-inlay', 0, .255, .70, .35, .64, 'wood-light', .016)
        rosette('chair-back-rosette', 0, .25, 1.12, .069)
        for x in [-.235, .235]:
            curve('swept-chair-post', [(x, .285, .55), (x * 1.04, .29, .88),
                                      (x, .30, 1.15), (x * .6, .3, 1.34)], .020, 'wood-light')
        rod('front-chair-stretcher', (-.23, -.25, .19), (.23, -.25, .19), .021, 'wood-dark')

    def shelf():
        height = 1.78
        box('bookcase-back', (0, .18, .87), (w - .12, .045, height - .08), 'wood-dark', .008)
        for x in [-w / 2 + .055, w / 2 - .055]:
            box('bookcase-pilaster', (x, 0, .91), (.10, d, 1.68), 'wood-dark', .018)
            for z in [.13, 1.61]:
                box('column-capital', (x, 0, z), (.11, d, .075), 'wood-light', .018)
            rod('pilaster-fluting', (x, -.215 + .025, .25), (x, -.215 + .025, 1.50), .013, 'wood-light')
        for z in [.09, .48, .91, 1.34, 1.72]:
            box('bookcase-shelf', (0, 0, z), (w - .035, d, .065), 'wood', .012)
            box('shelf-gilt-edge', (0, -d / 2 + .005, z + .005), (w - .08, .016, .021), 'gold', .005)
        for z, ww in [(1.76, w), (1.82, w - .035)]:
            box('stepped-cornice', (0, 0, z), (ww, d, .065), 'wood-dark', .02)
        for row, z in enumerate([.125, .515, .945, 1.375]):
            if room == 'kitchen':
                for i in range(5):
                    pottery(-.61 + i * .30, -.005, z, .075 + rng.random() * .012,
                            .20 + rng.random() * .08, 'ceramic' if i % 2 else 'copper')
                if row == 2:
                    for xx in [-.52, .12]:
                        copper_pan(xx, -.125, z + .12, .08)
                continue
            x = -.73
            while x < .71:
                bw = rng.uniform(.074, .125)
                bh = min(.33, rng.uniform(.23, .34))
                # Leave breathing space: abandoned collections have gaps,
                # horizontal stacks and faded single volumes, not a perfect grid.
                if (row == 1 and -.23 < x < .22) or (row == 3 and x > .35):
                    x += bw + .022
                    continue
                if row == 2 and x < -.31:
                    x += bw + .022
                    continue
                book(x + bw / 2, -.065, z, bw, bh, ['wine', 'sage', 'ink', 'wood-light'][rng.randrange(4)])
                x += bw + .022
            if row == 2:
                for i in range(3):
                    stacked_volume(-.53, -.035, z + i * .054, .31 - i * .015, ['ink', 'wood-light', 'wine'][i])
            elif row == 1:
                pottery(0, .02, z, .055, .22, 'ceramic')

    def cabinet():
        height = 1.34 if room != 'chapel' else .99
        for x in [-.68, .68]:
            for y in [-.25, .25]:
                turned_leg(x, y, .16, .045)
        box('cabinet-carcass', (0, .02, height / 2 + .12), (w - .08, d - .07, height), 'wood-dark', .025)
        for z in [.21, height + .14]:
            box('moulded-cabinet-ledge', (0, 0, z), (w, d, .11), 'wood', .026)
        front = -d / 2 + .112
        for x in [-w * .23, w * .23]:
            box('raised-panel-door', (x, front - .009, height / 2 + .17), (w * .42, .07, height * .76), 'wood', .018)
            pointed('door-lancet-relief', x, front - .052, .30, w * .31, height * .64, 'wood-light', .017)
            rosette('door-carving', x, front - .059, height * .68, .069, 'wood-light')
            for z in [.36, height * .85]:
                box('forged-hinge', (x + .24, front - .065, z), (.16, .025, .052), 'iron', .009)
                for dx in [-.047, .047]:
                    ball('hinge-rivet', (x + .24 + dx, front - .08, z), (.011, .006, .011), 'gold')
            handle_x = x + (.17 if x < 0 else -.17)
            ball('ring-handle-mount', (handle_x, front - .072, .74), (.027, .018, .027), 'gold')
            ring('drop-ring-handle', handle_x, front - .098, .705, .042, 'gold', True, .008)
        top = height + .205
        if room == 'chapel':
            box('altar-embroidered-cloth', (0, -.04, top), (w * .86, d * .82, .014), 'wine', .01)
            box('altar-cloth-front-fall', (0, front - .085, top - .15), (w * .8, .013, .30), 'wine', .004)
            for x in [-w * .36, w * .36]:
                candle(x, 0, top + .02, .26)
            rod('altar-cross-stem', (0, .12, top + .04), (0, .12, top + .62), .031, 'gold')
            rod('altar-cross-arm', (-.16, .12, top + .42), (.16, .12, top + .42), .027, 'gold')
            rosette('cloth-emblem', 0, front - .1, top - .13, .068)
            candle(-.43, -.13, top + .025, .14)
            open_book(.05, -.15, top + .026, .44, 'wood-dark')
            box('reliquary-body', (.38, .17, top + .11), (.20, .16, .15), 'gold', .012)
            panel('reliquary-pitched-lid', [(.26, top + .19), (.38, top + .28),
                  (.50, top + .19)], .17, .18, 'gold')
            pointed('reliquary-arched-inset', .38, .075, top + .055, .11, .12, 'iron', .005)
        elif room == 'armory':
            armor(0, 0, top)
        elif room == 'kitchen':
            pottery(-.52, 0, top, .115, .29)
            pottery(-.19, 0, top, .095, .21, 'copper')
            candle(.61, 0, top, .14)
            for xx in [-.55, -.24, .10]:
                copper_pan(xx, -.32, .64, .10)

    def crate():
        h = .65
        opened = name == 'storage-crate--1-2.8'
        box('crate-shadow-core', (0, 0, h / 2), (w - .09, d - .09, h - .03), 'wood-dark', .008)
        for i in range(4):
            z = (i + .5) * h / 4
            for y in [-d / 2 + .022, d / 2 - .022]:
                box('crate-front-slat', (0, y, z), (w - .015, .04, h / 4 - .012), 'wood', .006)
            for x in [-w / 2 + .022, w / 2 - .022]:
                box('crate-side-slat', (x, 0, z), (.04, d - .018, h / 4 - .012), 'wood-light', .006)
        if opened:
            # Open lid stands at the rear, entirely within the original proxy.
            box('open-crate-dark-interior', (0, 0, h + .001), (w - .12, d - .12, .012), 'ink', .002)
            box('open-crate-upright-lid', (0, d / 2 - .045, h + .31), (w - .04, .045, .60), 'wood', .008)
            for i in range(2):
                obj = lathe('rolled-linen', [(0, 0), (.085, 0), (.085, .33), (0, .33)],
                            (-.26 + i * .18, -.12, h + .07), 'bone' if i == 0 else 'sage', 8)
                obj.rotation_euler.y = pi / 2
            stacked_volume(.20, .04, h + .03, .26, 'wine')
            stacked_volume(.18, .04, h + .09, .25, 'ink')
        else:
            for i in range(4):
                box('crate-lid-board', (-w / 2 + (i + .5) * w / 4, 0, h), (w / 4 - .012, d - .015, .045), 'wood', .008)
        for x in [-w * .37, w * .37]:
            if not opened:
                box('lid-iron-strap', (x, 0, h + .028), (.065, d - .008, .016), 'iron', .005)
            for y in [-d / 2 + .018, d / 2 - .018]:
                box('crate-iron-binding', (x, y, h / 2), (.064, .025, h), 'iron', .006)
                for z in [.075, h - .07]:
                    ball('iron-nail', (x, y - .015 if y < 0 else y + .015, z), (.016, .009, .016), 'pewter')
        # Painted inventory mark offers a small lived-in story without clutter.
        for x in [-.06, .02, .10]:
            box('crate-tally', (x, -d / 2 + .012, .38), (.015, .006, .11), 'bone', .001)

    if asset == 'chair_A_wood':
        chair()
    elif asset == 'shelf_B_large_decorated':
        shelf()
    elif asset == 'cabinet_medium_decorated':
        cabinet()
    elif asset == 'table_low':
        bench()
    elif room == 'storage':
        crate()
    else:
        table()
