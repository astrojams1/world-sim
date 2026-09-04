"""
worldsim.py - helper module for reconstructing the room from the two camera feeds.

Files in this directory:
  camera_A.jpg, camera_B.jpg   the unaltered camera feeds
  scene.json                   camera calibration + surface colours
  worldsim.py                  this module

Coordinate system: x 0 (west) -> 1 (east), y 0 (floor) -> 1 (ceiling), z 0 (north) -> 1 (south).
An "objects" list is a list of dicts: {"shape": "sphere"|"cube", "color": "red"|"blue",
"size": 0.10|0.15|0.20, "position": [x, y, z]} with y = size/2 (objects rest on the floor).

Typical workflow:
    import worldsim as ws
    ws.blobs("A"); ws.blobs("B")                   # 1. what is visible in each image (pixel measurements)
    guess = ws.initial_hypothesis("A", shapes)    # 2. one object per blob, using the shapes you saw (left to right)
    ws.compare(guess)                              # 3. render the hypothesis and compare with BOTH real images
    ws.shape_test(guess, i)                        #    (check a doubtful shape)
    guess = ws.local_search(guess)                 # 4. refine positions/sizes to maximise agreement
    ws.compare(guess)                              # 5. verify; fix anything unexplained, repeat 3-5
    print(ws.to_json(guess))                       # 6. final answer
Other primitives: plane_point(cam, u, v, y) back-projects a pixel to height y; project(cam, xyz) does the reverse;
size_candidates(cam, blob, shape) lists the size/position implied by a blob; render(objects, cam, path) saves a preview.
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))


def _find(name):
    """Locate a data file: uploaded files may be mounted as '<file_id>-<name>'."""
    for base in (BASE, "/mnt/data", "."):
        if not os.path.isdir(base):
            continue
        direct = os.path.join(base, name)
        if os.path.exists(direct):
            return direct
        for f in sorted(os.listdir(base)):
            if f.endswith(name):
                return os.path.join(base, f)
    raise FileNotFoundError(name)


SCENE = json.load(open(_find("scene.json")))
W = SCENE["image"]["width"]
H = SCENE["image"]["height"]
SIZES = [0.10, 0.15, 0.20]
GRID = 0.05
ROOM = 1.0


# ----------------------------------------------------------------------------- cameras
class Camera:
    def __init__(self, spec):
        self.id = spec["id"]
        self.pos = np.array(spec["position"], dtype=float)
        look = np.array(spec["lookAt"], dtype=float)
        self.fov = float(spec["fov"])
        self.aspect = W / H
        fwd = look - self.pos
        fwd /= np.linalg.norm(fwd)
        right = np.cross(fwd, np.array([0.0, 1.0, 0.0]))
        right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        self.fwd, self.right, self.up = fwd, right, up
        self.f = 1.0 / math.tan(math.radians(self.fov) / 2)  # focal length for vertical fov (NDC units)
        self.f_px = self.f * H / 2  # focal length in pixels

    def to_cam(self, p):
        d = np.asarray(p, dtype=float) - self.pos
        return np.array([d @ self.right, d @ self.up, d @ self.fwd])  # (x right, y up, depth forward)

    def project(self, p):
        """World point -> (u, v, depth) in pixels; None if behind the camera."""
        cx, cy, depth = self.to_cam(p)
        if depth <= 1e-6:
            return None
        u = (self.f / self.aspect * cx / depth + 1) / 2 * W
        v = (1 - self.f * cy / depth) / 2 * H
        return (float(u), float(v), float(depth))

    def ray(self, u, v):
        """Pixel -> (origin, direction) of the viewing ray in world space."""
        ndc_x = u / W * 2 - 1
        ndc_y = 1 - v / H * 2
        d = self.fwd + (ndc_x * self.aspect / self.f) * self.right + (ndc_y / self.f) * self.up
        d /= np.linalg.norm(d)
        return self.pos.copy(), d

    def plane_point(self, u, v, y=0.0):
        """Intersect the viewing ray through pixel (u, v) with the horizontal plane at height y -> (x, z)."""
        o, d = self.ray(u, v)
        if abs(d[1]) < 1e-9:
            return None
        t = (y - o[1]) / d[1]
        if t <= 0:
            return None
        p = o + t * d
        return (float(p[0]), float(p[2]))

    def sphere_radius_px(self, centre, r):
        depth = self.to_cam(centre)[2]
        return self.f_px * r / max(depth, 1e-6)


CAMS = {c["id"]: Camera(c) for c in SCENE["cameras"]}


def project(cam_id, p):
    return CAMS[cam_id].project(p)


def plane_point(cam_id, u, v, y=0.0):
    return CAMS[cam_id].plane_point(u, v, y)


# ----------------------------------------------------------------------------- images
_IMG = {}


def load_image(cam_id):
    if cam_id not in _IMG:
        _IMG[cam_id] = np.asarray(Image.open(_find(f"camera_{cam_id}.jpg")).convert("RGB")).astype(np.int32)
    return _IMG[cam_id]


def color_masks(img):
    """Pixel masks of the pure-red and pure-blue object colours (walls are muted, so ratios separate them)."""
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    red = (r > 90) & (r > 1.7 * g) & (r > 1.7 * b)
    blue = (b > 90) & (b > 1.35 * r) & (b > 1.15 * g)
    return {"red": red, "blue": blue}


def _label(mask):
    try:
        from scipy import ndimage

        lab, n = ndimage.label(mask)
        return lab, n
    except Exception:  # simple fallback
        lab = np.zeros(mask.shape, dtype=np.int32)
        n = 0
        for y0 in range(mask.shape[0]):
            for x0 in range(mask.shape[1]):
                if mask[y0, x0] and lab[y0, x0] == 0:
                    n += 1
                    stack = [(y0, x0)]
                    lab[y0, x0] = n
                    while stack:
                        y, x = stack.pop()
                        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            yy, xx = y + dy, x + dx
                            if 0 <= yy < mask.shape[0] and 0 <= xx < mask.shape[1] and mask[yy, xx] and lab[yy, xx] == 0:
                                lab[yy, xx] = n
                                stack.append((yy, xx))
        return lab, n


def blobs(cam_id, min_area=40, verbose=True):
    """Connected red/blue regions in a camera image with pixel measurements.

    Returns a list of dicts: color, area, bbox (u0, v0, u1, v1), width, height, centroid (u, v),
    bottom (u, v) = lowest point of the region, circularity (1.0 = perfect disc; spheres ~0.85-1.0,
    cubes noticeably lower, ~0.6-0.8), touches_edge (region is cut off by the image border).
    Two touching objects of the same colour can merge into one blob; an occluded object may be split or hidden.
    """
    img = load_image(cam_id)
    masks = color_masks(img)
    out = []
    for color, mask in masks.items():
        lab, n = _label(mask)
        for i in range(1, n + 1):
            ys, xs = np.nonzero(lab == i)
            area = int(len(xs))
            if area < min_area:
                continue
            u0, u1, v0, v1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
            width, height = u1 - u0 + 1, v1 - v0 + 1
            # perimeter estimate: pixels with a non-member 4-neighbour
            region = lab == i
            padded = np.pad(region, 1)
            edge = region & ~(padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:])
            perim = int(edge.sum())
            circ = float(4 * math.pi * area / (perim * perim)) if perim else 0.0
            bottom_idx = int(np.argmax(ys))
            out.append(
                {
                    "color": color,
                    "area": area,
                    "bbox": (u0, v0, u1, v1),
                    "width": width,
                    "height": height,
                    "centroid": (round(float(xs.mean()), 1), round(float(ys.mean()), 1)),
                    "bottom": (round(float(xs[ys == ys.max()].mean()), 1), int(ys.max())),
                    "circularity": round(min(circ, 1.2), 2),
                    "touches_edge": bool(u0 == 0 or v0 == 0 or u1 == W - 1 or v1 == H - 1),
                }
            )
    out.sort(key=lambda b: b["centroid"][0])
    if verbose:
        print(f"camera {cam_id}: {len(out)} blob(s)")
        for b in out:
            print(
                f"  {b['color']:4s} area={b['area']:5d} bbox={b['bbox']} w={b['width']} h={b['height']} "
                f"centroid={b['centroid']} bottom={b['bottom']} circ={b['circularity']}"
                + (" EDGE" if b["touches_edge"] else "")
            )
    return out


# ----------------------------------------------------------------------------- hypotheses
def snap(objects):
    """Snap x, z to the 0.05 grid, set y = size/2, pick the nearest legal size, keep inside the walls."""
    out = []
    for o in objects:
        size = min(SIZES, key=lambda s: abs(s - float(o["size"])))
        margin = size / 2 + 0.05
        x, _, z = o["position"]
        x = min(max(round(float(x) / GRID) * GRID, margin), ROOM - margin)
        z = min(max(round(float(z) / GRID) * GRID, margin), ROOM - margin)
        out.append(
            {
                "shape": o["shape"],
                "color": o["color"],
                "size": size,
                "position": [round(x, 3), round(size / 2, 3), round(z, 3)],
            }
        )
    return out


def estimate_from_blob(cam_id, blob, size, shape="sphere"):
    """Floor position implied by a blob if the object has the given size: back-project the blob centroid to the
    plane at the object's centre height. Returns snapped (x, z)."""
    u, v = blob["centroid"]
    p = plane_point(cam_id, u, v, y=size / 2)
    if p is None:
        return None
    return (round(round(p[0] / GRID) * GRID, 3), round(round(p[1] / GRID) * GRID, 3))


def size_candidates(cam_id, blob, shape="sphere"):
    """For each legal size: the implied (x, z) and how well the rendered width matches the observed blob width.
    Pass the shape you see (cube silhouettes are wider than spheres of the same size).
    Returns list of (size, (x, z), predicted_width_px, observed_width_px) sorted by width mismatch."""
    res = []
    for s in SIZES:
        xz = estimate_from_blob(cam_id, blob, s, shape)
        if xz is None:
            continue
        obj = {"shape": shape, "color": blob["color"], "size": s, "position": [xz[0], s / 2, xz[1]]}
        m = render_masks([obj], cam_id)[blob["color"]]
        xs = np.nonzero(m.any(axis=0))[0]
        pw = int(xs.max() - xs.min() + 1) if len(xs) else 0
        res.append((s, xz, pw, blob["width"]))
    res.sort(key=lambda t: abs(t[2] - t[3]))
    return res


def initial_hypothesis(cam_id, shapes, verbose=True):
    """Build a first hypothesis from one camera: one object per blob (blobs are ordered left to right, as printed by
    blobs()). `shapes` is the list of shapes you identified for those blobs, e.g. ["sphere", "cube", "sphere"].
    For each blob the size whose rendered width best matches the observed width is chosen and the position is
    back-projected from the blob centroid. Merged/occluded/edge blobs will be wrong - inspect and fix them."""
    bl = blobs(cam_id, verbose=False)
    if len(shapes) != len(bl):
        raise ValueError(f"camera {cam_id} has {len(bl)} blobs but {len(shapes)} shapes were given")
    objs = []
    for b, shape in zip(bl, shapes):
        cands = size_candidates(cam_id, b, shape)
        if not cands:
            continue
        s, (x, z), _, _ = cands[0]
        objs.append({"shape": shape, "color": b["color"], "size": s, "position": [x, s / 2, z]})
    objs = snap(objs)
    if verbose:
        print(f"initial hypothesis from camera {cam_id}:")
        for o in objs:
            print("  ", o)
    return objs


def shape_test(objects, index, cam_ids=("A", "B")):
    """Score the hypothesis with object `index` as a sphere and as a cube (mean IoU each). Prints and returns both."""
    res = {}
    for shape in ("sphere", "cube"):
        trial = [dict(o) for o in objects]
        trial[index]["shape"] = shape
        res[shape] = compare(trial, cam_ids, verbose=False)["score"]
    print(f"object #{index}: as sphere -> {res['sphere']}, as cube -> {res['cube']}")
    return res


# ----------------------------------------------------------------------------- rendering
def _cube_corners(c, s):
    h = s / 2
    return [np.array([c[0] + dx * h, c[1] + dy * h, c[2] + dz * h]) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]


def _hull(points):
    pts = sorted(set((round(p[0], 2), round(p[1], 2)) for p in points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def render_masks(objects, cam_id):
    """Silhouette masks {'red': mask, 'blue': mask} that the objects would produce in the camera image.
    Nearer objects occlude farther ones."""
    cam = CAMS[cam_id]
    masks = {"red": np.zeros((H, W), dtype=bool), "blue": np.zeros((H, W), dtype=bool)}
    depth_buf = np.full((H, W), np.inf)
    for o in objects:
        c = np.array(o["position"], dtype=float)
        s = float(o["size"])
        img = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(img)
        pr = cam.project(c)
        if pr is None:
            continue
        depth = pr[2]
        if o["shape"] == "sphere":
            r_px = cam.sphere_radius_px(c, s / 2)
            # perspective makes the projected sphere slightly larger than f*r/depth
            r_px *= 1.0 / math.sqrt(max(1e-6, 1 - (s / 2 / depth) ** 2))
            d.ellipse([pr[0] - r_px, pr[1] - r_px, pr[0] + r_px, pr[1] + r_px], fill=255)
        else:
            pts = [cam.project(p) for p in _cube_corners(c, s)]
            pts = [(p[0], p[1]) for p in pts if p is not None]
            hull = _hull(pts)
            if len(hull) >= 3:
                d.polygon(hull, fill=255)
        m = np.asarray(img) > 0
        nearer = m & (depth < depth_buf)
        depth_buf[nearer] = depth
        for col in masks:
            masks[col][nearer] = False
        masks[o["color"]][nearer] = True
    return masks


def render(objects, cam_id, path=None):
    """RGB preview (PIL image) of the hypothesis silhouettes over a grey background; optionally saved to path."""
    masks = render_masks(objects, cam_id)
    img = np.full((H, W, 3), 128, dtype=np.uint8)
    img[masks["red"]] = (214, 40, 40)
    img[masks["blue"]] = (31, 95, 214)
    im = Image.fromarray(img)
    if path:
        im.save(path)
    return im


# ----------------------------------------------------------------------------- comparison
def _iou(a, b):
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 1.0


def compare(objects, cam_ids=("A", "B"), verbose=True):
    """Render the hypothesis and compare it with the real images.

    Returns {'score': mean IoU over cameras and colours (1.0 = perfect), 'cameras': {...per-camera detail...}}.
    Per camera it lists, for every hypothesised object, where its centroid lands versus the nearest real blob of the
    same colour (pixel offset du, dv and the width ratio), plus unexplained real blobs and phantom objects.
    """
    report = {"cameras": {}}
    ious = []
    for cam_id in cam_ids:
        real = color_masks(load_image(cam_id))
        pred = render_masks(objects, cam_id)
        cam_rep = {"iou": {}, "objects": [], "unexplained_real_blobs": []}
        for col in ("red", "blue"):
            if real[col].any() or pred[col].any():
                iou = _iou(real[col], pred[col])
                cam_rep["iou"][col] = round(iou, 3)
                ious.append(iou)
        real_blobs = blobs(cam_id, verbose=False)
        used = set()
        for i, o in enumerate(objects):
            single = render_masks([o], cam_id)[o["color"]]
            # visible part after occlusion by the other objects
            vis = single & pred[o["color"]]
            if not single.any():
                cam_rep["objects"].append({"index": i, "visible": False})
                continue
            ys, xs = np.nonzero(vis if vis.any() else single)
            pc = (float(xs.mean()), float(ys.mean()))
            pw = int(xs.max() - xs.min() + 1)
            best, bd = None, 1e9
            for j, b in enumerate(real_blobs):
                if b["color"] != o["color"] or j in used:
                    continue
                dd = math.hypot(b["centroid"][0] - pc[0], b["centroid"][1] - pc[1])
                if dd < bd:
                    best, bd = j, dd
            entry = {"index": i, "visible": True, "pred_centroid": (round(pc[0], 1), round(pc[1], 1)), "pred_width": pw}
            if best is not None and bd < 160:
                used.add(best)
                b = real_blobs[best]
                entry.update(
                    {
                        "real_centroid": b["centroid"],
                        "du": round(b["centroid"][0] - pc[0], 1),
                        "dv": round(b["centroid"][1] - pc[1], 1),
                        "width_ratio": round(b["width"] / max(pw, 1), 2),
                        "overlap_iou": round(_iou(single, _blob_mask(cam_id, real_blobs, best)), 3),
                    }
                )
            else:
                entry["real_centroid"] = None
            cam_rep["objects"].append(entry)
        for j, b in enumerate(real_blobs):
            if j not in used:
                cam_rep["unexplained_real_blobs"].append({"color": b["color"], "centroid": b["centroid"], "width": b["width"]})
        report["cameras"][cam_id] = cam_rep
    report["score"] = round(float(np.mean(ious)) if ious else 0.0, 3)
    if verbose:
        print(f"score (mean IoU) = {report['score']}")
        for cam_id, cr in report["cameras"].items():
            print(f"camera {cam_id}: IoU {cr['iou']}")
            for e in cr["objects"]:
                o = objects[e["index"]]
                tag = f"  #{e['index']} {o['color']} {o['shape']} {o['size']} @ {o['position']}"
                if not e["visible"]:
                    print(tag + " -> not visible in this camera")
                elif e["real_centroid"] is None:
                    print(tag + f" -> predicted at {e['pred_centroid']} but NO real blob of that colour nearby (phantom?)")
                else:
                    print(
                        tag
                        + f" -> predicted {e['pred_centroid']}, real {e['real_centroid']}, offset du={e['du']} dv={e['dv']}, "
                        f"width ratio real/pred={e['width_ratio']}, overlap IoU={e['overlap_iou']}"
                    )
            for b in cr["unexplained_real_blobs"]:
                print(f"  UNEXPLAINED real {b['color']} blob at {b['centroid']} (width {b['width']}) - missing object?")
    return report


_BLOB_CACHE = {}


def _blob_mask(cam_id, real_blobs, j):
    key = (cam_id, j)
    if key not in _BLOB_CACHE:
        img = load_image(cam_id)
        masks = color_masks(img)
        b = real_blobs[j]
        lab, n = _label(masks[b["color"]])
        u, v = b["centroid"]
        # find the label at the blob's bbox region
        u0, v0, u1, v1 = b["bbox"]
        sub = lab[v0 : v1 + 1, u0 : u1 + 1]
        vals, counts = np.unique(sub[sub > 0], return_counts=True)
        lid = int(vals[np.argmax(counts)]) if len(vals) else -1
        _BLOB_CACHE[key] = lab == lid
    return _BLOB_CACHE[key]


def local_search(objects, cam_ids=("A", "B"), passes=8, try_sizes=True, verbose=True):
    """Coordinate descent: move each object by up to +-0.15 in x and z (and optionally change its size) whenever that
    increases the mean IoU against the real images. Shapes, colours and object count are never changed - decide
    those yourself (see shape_test). Returns the improved (snapped) list. Run compare() afterwards and inspect
    any object whose offsets are still large or any UNEXPLAINED blob: that usually means a wrong shape, a missing
    object, or a merged blob."""
    objs = snap(objects)

    def score(os_):
        return compare(os_, cam_ids, verbose=False)["score"]

    best = score(objs)
    if verbose:
        print(f"local_search start score={best}")
    for p in range(passes):
        improved = False
        for i in range(len(objs)):
            cands = []
            for dx in (-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15):
                for dz in (-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15):
                    for s in (SIZES if try_sizes else [objs[i]["size"]]):
                        o = dict(objs[i])
                        o["size"] = s
                        o["position"] = [objs[i]["position"][0] + dx, s / 2, objs[i]["position"][2] + dz]
                        cands.append(o)
            for o in cands:
                trial = list(objs)
                trial[i] = o
                trial = snap(trial)
                if _overlaps(trial):
                    continue
                sc = score(trial)
                if sc > best + 1e-4:
                    best, objs, improved = sc, trial, True
        if verbose:
            print(f"pass {p + 1}: score={best}")
        if not improved:
            break
    return objs


def _overlaps(objects):
    for i in range(len(objects)):
        for j in range(i + 1, len(objects)):
            a, b = objects[i], objects[j]
            d = math.hypot(a["position"][0] - b["position"][0], a["position"][2] - b["position"][2])
            if d < a["size"] / 2 + b["size"] / 2 + 0.05:
                return True
    return False


def to_json(objects):
    return json.dumps({"objects": snap(objects)}, indent=2)
