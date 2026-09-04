"""
worldsim.py - self-calibrating helper for reconstructing a 1 x 1 x 1 room from two photographs.

Files next to this module: camera_A.jpg and camera_B.jpg, the two unaltered camera images. Nothing else is known
about the cameras: their positions, orientations and focal lengths are recovered from the images themselves, using
only the fact that the room is a unit cube.

What the images show: the cameras are outside the room, so each image shows the room as an open box - the three
far interior faces (floor/walls/ceiling) meet at one interior corner, the near faces are not drawn, and everything
outside the room is black. The outline of the room is a hexagon whose six vertices are six of the cube's corners.

Coordinates: the room is [0,1]^3. Which corner is the origin is not knowable from the images, so any of the room's
symmetric frames is acceptable, as long as BOTH cameras are expressed in the SAME frame (align() does this).

An "objects" list is a list of dicts: {"shape": "sphere"|"cube", "color": "red"|"blue", "size": 0.10|0.15|0.20,
"position": [x, y, z], "rotation": [rx, ry, rz] (Euler XYZ radians, matrix = Rx*Ry*Rz; cubes only, None for spheres)}.
Orientation is part of the answer and is scored modulo the cube's 24 symmetries, to about 10 degrees.

Typical workflow:
    import worldsim as ws
    hexA = ws.room_outline("A"); hexB = ws.room_outline("B")   # 1. hexagon of room corners in each image (check them!)
    pA = ws.solve_camera("A"); pB = ws.solve_camera("B")        # 2. camera pose + focal length from the hexagon
    pB = ws.align(pA, pB)                                         # 3. put B in the same room frame as A
    bA = ws.blobs("A"); bB = ws.blobs("B")                        # 4. red/blue objects in each image
    matches = ws.auto_match(pA, pB, bA, bB)                       # 5. pair blobs across views by triangulation
    guess = ws.initial_hypothesis(pA, pB, matches, shapes)        # 6. one object per pair, shapes from YOUR eyes
    guess.append(ws.object_from_pixels(pA, (u,v), pB, (u,v), "cube", "red"))  # objects merged/hidden in a blob
    ws.compare(guess, pA, pB)                                     # 7. render and compare with the real images
    guess = ws.local_search(guess, pA, pB)                        # 8. refine positions / sizes / cube rotations
    ws.compare(guess, pA, pB)                                     # 9. verify; fix what is unexplained; repeat
    guess = ws.refine_rotation(guess, pA, pB, i)                  # 10. polish each cube's orientation
    print(ws.to_json(guess))
"""
import itertools
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
SIZES = [0.10, 0.15, 0.20]
GRID = 0.05
ROOM = 1.0
CENTRE = np.array([0.5, 0.5, 0.5])


def _find(name):
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


# ----------------------------------------------------------------------------- images
_IMG = {}


def load_image(cam_id):
    """Image as an (H, W, 3) int array."""
    if cam_id not in _IMG:
        _IMG[cam_id] = np.asarray(Image.open(_find(f"camera_{cam_id}.jpg")).convert("RGB")).astype(np.int32)
    return _IMG[cam_id]


def image_size(cam_id):
    h, w = load_image(cam_id).shape[:2]
    return w, h


def color_masks(img):
    """Masks of the pure-red and pure-blue object colours."""
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    red = (r > 90) & (r > 1.7 * g) & (r > 1.7 * b)
    blue = (b > 90) & (b > 1.35 * r) & (b > 1.15 * g)
    return {"red": red, "blue": blue}


def room_mask(cam_id):
    """Pixels belonging to the room (everything that is not the black background)."""
    img = load_image(cam_id)
    return img.max(axis=2) > 28


def _label(mask):
    from scipy import ndimage

    return ndimage.label(mask)


# ----------------------------------------------------------------------------- room outline
def _convex_hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _simplify_polygon(poly, n_target=6):
    """Reduce a polygon to n_target vertices by repeatedly removing the vertex whose removal changes the polygon
    least (smallest triangle with its neighbours). Works for non-convex polygons."""
    poly = [np.array(p, dtype=float) for p in poly]
    while len(poly) > n_target:
        best_i, best_a = None, None
        for i in range(len(poly)):
            a, b, c = poly[i - 1], poly[i], poly[(i + 1) % len(poly)]
            area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
            if best_a is None or area < best_a:
                best_i, best_a = i, area
        poly.pop(best_i)
    return [(float(p[0]), float(p[1])) for p in poly]


def _trace_contour(mask):
    """Ordered boundary of a (single-component) binary mask, by Moore-neighbour tracing. Returns (u, v) points."""
    H, W = mask.shape
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return []
    start = (int(ys.min()), int(xs[ys == ys.min()].min()))  # topmost, then leftmost
    # 8 neighbours in clockwise order starting from the west
    nbrs = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]

    def inside(y, x):
        return 0 <= y < H and 0 <= x < W and mask[y, x]

    contour = [start]
    cur = start
    backtrack = 0  # index of the neighbour direction we came from (west for the start pixel)
    for _ in range(4 * (H + W) * 4):
        found = False
        for k in range(8):
            idx = (backtrack + k) % 8
            dy, dx = nbrs[idx]
            ny, nx = cur[0] + dy, cur[1] + dx
            if inside(ny, nx):
                contour.append((ny, nx))
                # next search starts from the neighbour before the one we came from
                backtrack = (idx + 5) % 8
                cur = (ny, nx)
                found = True
                break
        if not found:
            break
        if cur == start and len(contour) > 2:
            break
    return [(float(x), float(y)) for (y, x) in contour[:-1]]


def _douglas_peucker(points, eps):
    """Simplify an open polyline."""
    if len(points) < 3:
        return list(points)
    a, b = np.array(points[0]), np.array(points[-1])
    ab = b - a
    n = np.linalg.norm(ab)
    if n < 1e-9:
        d = [np.linalg.norm(np.array(p) - a) for p in points]
    else:
        d = [abs((np.array(p) - a)[0] * ab[1] - (np.array(p) - a)[1] * ab[0]) / n for p in points]
    i = int(np.argmax(d))
    if d[i] > eps:
        left = _douglas_peucker(points[: i + 1], eps)
        right = _douglas_peucker(points[i:], eps)
        return left[:-1] + right
    return [points[0], points[-1]]


def _simplify_contour(contour, eps=2.0):
    """Closed-contour simplification: split at the two points farthest apart, simplify both halves."""
    pts = np.array(contour)
    i0 = 0
    d = np.linalg.norm(pts - pts[i0], axis=1)
    i1 = int(np.argmax(d))
    d2 = np.linalg.norm(pts - pts[i1], axis=1)
    i0 = int(np.argmax(d2))
    if i0 > i1:
        i0, i1 = i1, i0
    half1 = [tuple(p) for p in pts[i0 : i1 + 1]]
    half2 = [tuple(p) for p in np.concatenate([pts[i1:], pts[: i0 + 1]])]
    s1 = _douglas_peucker(half1, eps)
    s2 = _douglas_peucker(half2, eps)
    poly = s1[:-1] + s2[:-1]
    return poly


_OUTLINE = {}


def room_outline(cam_id, verbose=True):
    """The outline of the room in the image: the hexagon formed by the outer edges of the three visible faces, as
    6 (u, v) pixel vertices in counter-clockwise order (as seen on screen). These are six of the cube's corners;
    the seventh visible corner (where the three faces meet) lies inside and is predicted by solve_camera. The
    hexagon may be non-convex (one reflex vertex where the missing near corner would have been). If the room is
    only partly inside the frame the outline is unreliable; check the printed vertices against the image and use
    set_room_outline to correct them."""
    if cam_id in _OUTLINE:
        hexagon = _OUTLINE[cam_id]
    else:
        mask = room_mask(cam_id)
        lab, n = _label(mask)
        if n > 1:  # keep the largest component
            sizes = [(lab == i).sum() for i in range(1, n + 1)]
            mask = lab == (1 + int(np.argmax(sizes)))
        contour = _trace_contour(mask)
        poly = _simplify_contour(contour, eps=1.0)
        # reduce to the six most significant corners (jpeg jaggies have tiny triangle areas and go first)
        hexagon = _simplify_polygon(poly, 6) if len(poly) >= 6 else poly
        # a vertex that is nearly collinear with its neighbours is not a real corner: drop it (degenerate view)
        if len(hexagon) == 6:
            areas = []
            for i in range(6):
                a, b, c = np.array(hexagon[i - 1]), np.array(hexagon[i]), np.array(hexagon[(i + 1) % 6])
                areas.append(abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2)
            if min(areas) < 6.0:
                hexagon = [h for i, h in enumerate(hexagon) if i != int(np.argmin(areas))]
        # order counter-clockwise on screen (y down => use signed area)
        n = len(hexagon)
        area = sum(hexagon[i][0] * hexagon[(i + 1) % n][1] - hexagon[(i + 1) % n][0] * hexagon[i][1] for i in range(n))
        if area > 0:
            hexagon = hexagon[::-1]
        _OUTLINE[cam_id] = hexagon
    if verbose:
        print(f"camera {cam_id} room outline ({len(hexagon)} corners, pixel u,v): " + ", ".join(f"({u:.0f},{v:.0f})" for u, v in hexagon))
        if len(hexagon) != 6:
            print("  WARNING: expected 6 corners; the view may be degenerate. Use set_room_outline with corners you read off the image.")
    return hexagon


def set_room_outline(cam_id, hexagon):
    """Override the detected outline with the 6 (u, v) corners you measured yourself, listed in order around the
    outline (either direction)."""
    pts = [tuple(map(float, p)) for p in hexagon]
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    if area > 0:
        pts = pts[::-1]
    _OUTLINE[cam_id] = pts
    _POSE.pop(cam_id, None)
    return pts


# ----------------------------------------------------------------------------- camera model
def _rotvec_to_matrix(rv):
    theta = np.linalg.norm(rv)
    if theta < 1e-12:
        return np.eye(3)
    k = rv / theta
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(theta) * K + (1 - math.cos(theta)) * (K @ K)


def _matrix_to_rotvec(R):
    from scipy.spatial.transform import Rotation

    return Rotation.from_matrix(R).as_rotvec()


class Pose:
    """A pinhole camera: R maps world -> camera axes (x right, y down, z forward), t is the translation,
    f is the focal length in pixels, principal point at the image centre."""

    def __init__(self, cam_id, R, t, f):
        self.cam_id = cam_id
        self.R = np.asarray(R, dtype=float)
        self.t = np.asarray(t, dtype=float)
        self.f = float(f)
        self.W, self.H = image_size(cam_id)
        self.reprojection_error = None

    @property
    def position(self):
        return -self.R.T @ self.t

    @property
    def fov_deg(self):
        return 2 * math.degrees(math.atan(self.H / 2 / self.f))

    def to_cam(self, p):
        return self.R @ np.asarray(p, dtype=float) + self.t

    def project(self, p):
        """World point -> (u, v, depth); None if behind the camera."""
        c = self.to_cam(p)
        if c[2] <= 1e-6:
            return None
        return (float(self.f * c[0] / c[2] + self.W / 2), float(self.f * c[1] / c[2] + self.H / 2), float(c[2]))

    def ray(self, u, v):
        d = np.array([(u - self.W / 2) / self.f, (v - self.H / 2) / self.f, 1.0])
        d = self.R.T @ d
        return self.position, d / np.linalg.norm(d)

    def transformed(self, M):
        """Same camera, expressed in a frame related to the current one by the room symmetry M (about the room centre):
        p_new = CENTRE + M (p_old - CENTRE)  =>  R_new = R M^T, t_new = t + R (I - M^T) CENTRE."""
        M = np.asarray(M, dtype=float)
        R_new = self.R @ M.T
        t_new = self.t + self.R @ (np.eye(3) - M.T) @ CENTRE
        p = Pose(self.cam_id, R_new, t_new, self.f)
        p.reprojection_error = self.reprojection_error
        return p

    def __repr__(self):
        pos = self.position
        return (
            f"Pose(camera {self.cam_id}: position=({pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f}), fov={self.fov_deg:.1f} deg, "
            f"reprojection error={self.reprojection_error if self.reprojection_error is None else round(self.reprojection_error, 2)} px)"
        )


CUBE_CORNERS = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=float)


def _project_all(R, t, f, X, W, H):
    C = X @ R.T + t
    z = C[:, 2]
    return np.stack([f * C[:, 0] / z + W / 2, f * C[:, 1] / z + H / 2], axis=1), z


def _solve_t_linear(R, f, X, uv, W, H):
    """Given R and f, the translation is linear: solve it by least squares."""
    A, b = [], []
    for Xi, (u, v) in zip(X, uv):
        rX = R @ Xi
        du, dv = u - W / 2, v - H / 2
        A.append([-f, 0, du])
        b.append(f * rX[0] - du * rX[2])
        A.append([0, -f, dv])
        b.append(f * rX[1] - dv * rX[2])
    t, *_ = np.linalg.lstsq(np.array(A), np.array(b), rcond=None)
    return t


def _dlt_init(X, uv, W, H):
    """Direct Linear Transform: 6 correspondences -> 3x4 projection matrix -> (R, t, f) with the principal point
    forced to the image centre. Exact for noise-free data; a good starting point otherwise."""
    A = []
    for (x, y, z), (u, v) in zip(X, uv):
        A.append([x, y, z, 1, 0, 0, 0, 0, -u * x, -u * y, -u * z, -u])
        A.append([0, 0, 0, 0, x, y, z, 1, -v * x, -v * y, -v * z, -v])
    _, _, vt = np.linalg.svd(np.array(A, dtype=float))
    P = vt[-1].reshape(3, 4)
    M = P[:, :3]
    if np.linalg.det(M) < 0:
        P = -P
        M = -M
    # RQ decomposition via QR of the flipped matrix
    Mf = np.flipud(M).T
    Q, Rr = np.linalg.qr(Mf)
    K = np.flipud(np.fliplr(Rr.T))
    R = np.flipud(Q.T)
    # make K's diagonal positive
    D = np.diag(np.sign(np.diag(K)))
    K = K @ D
    R = D @ R
    if np.linalg.det(R) < 0:
        R = -R
        K = -K
    K = K / K[2, 2]
    f = float((abs(K[0, 0]) + abs(K[1, 1])) / 2)
    t = np.linalg.solve(K, P[:, 3])
    if np.linalg.det(R) < 0:
        return None
    # The decomposed K may have a principal point away from the centre; re-solve t for our constrained model.
    t = _solve_t_linear(R, f, X, uv, W, H)
    return R, t, f


def _fit_pose(X, uv, W, H, n_starts=None, top_k=6, seed=0):
    """Fit R, t, f to 3D<->2D correspondences. Starts from a DLT initialisation (plus a few random-rotation
    starts as a fallback), each refined by Levenberg-Marquardt. Returns (rms error px, R, t, f) or None."""
    from scipy.optimize import least_squares
    from scipy.spatial.transform import Rotation

    uv = np.asarray(uv, dtype=float)
    if n_starts is None:
        n_starts = 200 if len(uv) >= 6 else 40
    starts = []
    try:
        init = _dlt_init(X, uv, W, H) if len(uv) >= 6 else None
        if init is not None and 10 < init[2] < 20000:
            starts.append((-1.0, *init))
    except Exception:
        pass
    fovs = [35, 45, 55, 65, 75]
    rots = Rotation.random(n_starts, random_state=seed).as_matrix()
    rand = []
    for R in rots:
        for fov in fovs:
            f = H / 2 / math.tan(math.radians(fov) / 2)
            t = _solve_t_linear(R, f, X, uv, W, H)
            C = X @ R.T + t
            if (C[:, 2] <= 0.05).any():
                continue
            p, _ = _project_all(R, t, f, X, W, H)
            err = float(np.sqrt(((p - uv) ** 2).sum(axis=1).mean()))
            rand.append((err, R, t, f))
    rand.sort(key=lambda s: s[0])
    starts += rand[:top_k]
    if not starts:
        return None

    def resid(params):
        R = _rotvec_to_matrix(params[:3])
        t = params[3:6]
        f = params[6]
        C = X @ R.T + t
        z = np.maximum(C[:, 2], 1e-3)
        p = np.stack([f * C[:, 0] / z + W / 2, f * C[:, 1] / z + H / 2], axis=1)
        return (p - uv).ravel()

    best = None
    for _, R0, t0, f0 in starts:
        x0 = np.concatenate([_matrix_to_rotvec(R0), t0, [f0]])
        try:
            sol = least_squares(resid, x0, method="lm", max_nfev=3000)
        except Exception:
            continue
        R = _rotvec_to_matrix(sol.x[:3])
        t = sol.x[3:6]
        f = float(sol.x[6])
        if f <= 0:
            continue
        C = X @ R.T + t
        if (C[:, 2] <= 0.05).any():
            continue
        err = float(np.sqrt((sol.fun.reshape(-1, 2) ** 2).sum(axis=1).mean()))
        if best is None or err < best[0]:
            best = (err, R, t, f)
    return best


def _point_in_polygon(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                inside = not inside
    return inside


_POSE = {}


def _labelings(n):
    """Candidate assignments of the n outline vertices (in order) to cube corners.

    The outline is the convex hull of the room's corners. Two configurations occur:
      family A: the camera is outside all three slabs of the room. The three far faces meet at a corner that lies
                inside the outline; the hexagon alternates between that corner's three neighbours and the three
                corners between them (the near corner also projects inside).
      family B: one of the camera's coordinates lies within the room's extent along that axis, so two opposite
                faces are both visible. The hexagon is the outline of those two faces; the two corners of the far
                edge lie inside.
    Every valid labelling is equivalent up to a room symmetry, so any consistent one gives a usable frame.
    """
    if n == 5:
        # a degenerate view where one hexagon corner is collinear with its neighbours: try every 6-vertex
        # labelling with one vertex dropped
        out = []
        for family, X in _labelings(6):
            for drop in range(6):
                out.append((family, np.array([X[k] for k in range(6) if k != drop])))
        return out
    if n != 6:
        return []
    e = np.eye(3)
    out = []
    for parity in (0, 1):
        for perm in itertools.permutations(range(3)):
            X = [None] * 6
            for i in range(3):
                X[(parity + 2 * i) % 6] = e[perm[i]]
                X[(parity + 2 * i + 1) % 6] = e[perm[i]] + e[perm[(i + 1) % 3]]
            out.append(("A", np.array(X)))
    L = np.array([[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], dtype=float)
    for start in range(6):
        for d in (1, -1):
            out.append(("B", np.array([L[(start + d * k) % 6] for k in range(6)])))
    return out


def solve_camera(cam_id, verbose=True):
    """Recover the camera pose and focal length from the room outline (see _labelings for how the outline's
    vertices are matched to cube corners). All candidate labellings are fitted and the best consistent one is
    kept; the frame is arbitrary but consistent. Returns a Pose (cached)."""
    if cam_id in _POSE:
        pose = _POSE[cam_id]
    else:
        hexagon = room_outline(cam_id, verbose=False)
        W, H = image_size(cam_id)
        best = None
        for family, X in _labelings(len(hexagon)):
            fit = _fit_pose(X, hexagon, W, H)
            if fit is None:
                continue
            err, R, t, f = fit
            if np.linalg.det(R) < 0:
                continue
            pose = Pose(cam_id, R, t, f)
            cam_pos = pose.position
            if all(-0.05 <= v <= 1.05 for v in cam_pos):
                continue  # camera inside the room
            # corners not on the outline must project inside it
            on_outline = {tuple(int(v) for v in row) for row in X}
            ok = True
            for k in CUBE_CORNERS:
                if tuple(int(v) for v in k) in on_outline:
                    continue
                pk = pose.project(k)
                if pk is None or not _point_in_polygon((pk[0], pk[1]), hexagon):
                    ok = False
                    break
            if not ok:
                continue
            if best is None or err < best[0]:
                best = (err, R, t, f, family)
        if best is None:
            raise RuntimeError("could not solve the camera pose from the outline; check room_outline()")
        err, R, t, f, family = best
        pose = Pose(cam_id, R, t, f)
        pose.reprojection_error = err
        pose.family = family
        _POSE[cam_id] = pose
    if verbose:
        print(pose)
        if pose.reprojection_error is not None and pose.reprojection_error > 6:
            print("  WARNING: large reprojection error - check room_outline() against the image (set_room_outline to fix).")
    return pose


# ----------------------------------------------------------------------------- frame alignment
def _symmetries():
    out = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            M = np.zeros((3, 3))
            for i in range(3):
                M[i, perm[i]] = signs[i]
            out.append(M)
    return out


SYMMETRIES = _symmetries()


def face_colours(cam_id, pose, verbose=False):
    """Mean chromaticity (r, g, b normalised to sum 1) of each of the six room faces that is visible in the image,
    keyed by face name ('x=0', 'x=1', 'y=0', 'y=1', 'z=0', 'z=1'); objects and background are excluded.
    Uses the pose to know where each face lies in the image."""
    img = load_image(cam_id)
    W, H = image_size(cam_id)
    masks = color_masks(img)
    exclude = masks["red"] | masks["blue"] | ~room_mask(cam_id)
    out = {}
    cam_pos = pose.position
    for axis in range(3):
        for val in (0, 1):
            # a face is visible from outside if the camera is on the opposite side of that face plane
            normal_outward = 1 if val == 1 else -1
            if (cam_pos[axis] - val) * normal_outward > 0:
                continue  # this is a near face: culled
            corners = []
            for a in (0, 1):
                for b in (0, 1):
                    p = [0, 0, 0]
                    p[axis] = val
                    others = [i for i in range(3) if i != axis]
                    p[others[0]] = a
                    p[others[1]] = b
                    corners.append(p)
            corners = [corners[0], corners[1], corners[3], corners[2]]
            pts = [pose.project(c) for c in corners]
            if any(p is None for p in pts):
                continue
            poly = Image.new("L", (W, H), 0)
            ImageDraw.Draw(poly).polygon([(p[0], p[1]) for p in pts], fill=255)
            m = (np.asarray(poly) > 0) & ~exclude
            # shrink to avoid edges
            if m.sum() < 200:
                continue
            px = img[m].astype(float)
            s = px.sum(axis=1, keepdims=True)
            s[s == 0] = 1
            chroma = (px / s).mean(axis=0)
            out[f"{'xyz'[axis]}={val}"] = tuple(round(float(c), 3) for c in chroma)
    if verbose:
        print(f"camera {cam_id} visible faces: {out}")
    return out


def align(pose_a, pose_b, blobs_a=None, blobs_b=None, verbose=True):
    """Express camera B in the same room frame as camera A. Each solved pose is only defined up to a room
    symmetry, so all 48 candidate symmetries of B's frame are scored by (1) how well the colours of faces visible
    in both images agree and (2) how well same-colour blobs triangulate. Returns the re-expressed Pose for B."""
    if blobs_a is None:
        blobs_a = blobs("A", verbose=False)
    if blobs_b is None:
        blobs_b = blobs("B", verbose=False)
    fa = face_colours("A", pose_a)
    scored = []
    for M in SYMMETRIES:
        pb = pose_b.transformed(M)
        fb = face_colours("B", pb)
        common = [k for k in fa if k in fb]
        if len(common) == 0:
            colour_cost = 1.0
        else:
            colour_cost = float(np.mean([np.abs(np.array(fa[k]) - np.array(fb[k])).sum() for k in common]))
        # geometric: cameras must be outside the room in both frames (they are, by construction), and blobs must triangulate
        tri_cost, _ = _match_cost(pose_a, pb, blobs_a, blobs_b)
        # also require that both cameras see a consistent room: the far corners should differ (cameras on different sides)
        scored.append((colour_cost * 3 + tri_cost, colour_cost, tri_cost, M, pb))
    scored.sort(key=lambda s: s[0])
    total, ccost, tcost, M, pb = scored[0]
    if verbose:
        runner = scored[1]
        print(
            f"align: best frame colour-mismatch={ccost:.3f}, triangulation residual={tcost:.3f} "
            f"(runner-up total {runner[0]:.3f} vs {total:.3f}); "
            f"B now at ({pb.position[0]:.2f}, {pb.position[1]:.2f}, {pb.position[2]:.2f})"
        )
        if runner[0] - total < 0.05:
            print("  WARNING: the frame alignment is ambiguous; check compare() in both cameras carefully.")
    return pb


def triangulate(pose_a, uv_a, pose_b, uv_b):
    """3D point closest to the two viewing rays, plus the distance between the rays at that point (residual)."""
    o1, d1 = pose_a.ray(*uv_a)
    o2, d2 = pose_b.ray(*uv_b)
    w0 = o1 - o2
    a, b, c = d1 @ d1, d1 @ d2, d2 @ d2
    d, e = d1 @ w0, d2 @ w0
    den = a * c - b * b
    if abs(den) < 1e-9:
        s, t = 0.0, 0.0
    else:
        s = (b * e - c * d) / den
        t = (a * e - b * d) / den
    p1 = o1 + s * d1
    p2 = o2 + t * d2
    return (p1 + p2) / 2, float(np.linalg.norm(p1 - p2))


def _match_cost(pose_a, pose_b, blobs_a, blobs_b):
    """Best pairing of same-colour blobs across the views by triangulation residual (unpaired blobs cost 0.3)."""
    best_total, best_pairs = 0.0, []
    for color in ("red", "blue"):
        ia = [i for i, b in enumerate(blobs_a) if b["color"] == color]
        ib = [i for i, b in enumerate(blobs_b) if b["color"] == color]
        if not ia and not ib:
            continue
        best = None
        k = min(len(ia), len(ib))
        for sub_a in itertools.combinations(ia, k):
            for perm_b in itertools.permutations(ib, k):
                cost = 0.3 * (len(ia) + len(ib) - 2 * k)
                pairs = []
                for i, j in zip(sub_a, perm_b):
                    p, r = triangulate(pose_a, blobs_a[i]["centroid"], pose_b, blobs_b[j]["centroid"])
                    inside = all(-0.1 <= v <= 1.1 for v in p)
                    cost += r + (0 if inside else 0.5)
                    pairs.append((i, j, p, r))
                if best is None or cost < best[0]:
                    best = (cost, pairs)
        if best is not None:
            best_total += best[0]
            best_pairs += best[1]
    return best_total, best_pairs


def auto_match(pose_a, pose_b, blobs_a=None, blobs_b=None, verbose=True):
    """Pair blobs in A with blobs in B (same colour) so that the paired rays intersect best. Returns a list of
    dicts {a: index in blobs_a, b: index in blobs_b, point, residual}. Unpaired blobs are reported; they are
    usually an object hidden or merged in one view, or a false detection."""
    if blobs_a is None:
        blobs_a = blobs("A", verbose=False)
    if blobs_b is None:
        blobs_b = blobs("B", verbose=False)
    _, pairs = _match_cost(pose_a, pose_b, blobs_a, blobs_b)
    matches = [{"a": i, "b": j, "point": [round(float(v), 3) for v in p], "residual": round(r, 3)} for i, j, p, r in pairs]
    if verbose:
        for m in matches:
            print(f"  A blob {m['a']} <-> B blob {m['b']}: {blobs_a[m['a']]['color']} at {m['point']} (ray gap {m['residual']})")
        ua = set(range(len(blobs_a))) - {m["a"] for m in matches}
        ub = set(range(len(blobs_b))) - {m["b"] for m in matches}
        for i in ua:
            print(f"  A blob {i} ({blobs_a[i]['color']}, centroid {blobs_a[i]['centroid']}) has no partner in B")
        for j in ub:
            print(f"  B blob {j} ({blobs_b[j]['color']}, centroid {blobs_b[j]['centroid']}) has no partner in A")
    return matches


# ----------------------------------------------------------------------------- blobs
def blobs(cam_id, min_area=40, verbose=True):
    """Connected red/blue regions in a camera image: color, area, bbox (u0, v0, u1, v1), width, height,
    centroid (u, v), circularity (weak shape hint: ~1 sphere, lower cube), touches_edge. Ordered left to right.
    Two touching same-colour objects can merge into one blob; an occluded object may be split or hidden."""
    img = load_image(cam_id)
    W, H = image_size(cam_id)
    masks = color_masks(img)
    out = []
    for color, mask in masks.items():
        lab, n = _label(mask)
        for i in range(1, n + 1):
            region = lab == i
            ys, xs = np.nonzero(region)
            area = int(len(xs))
            if area < min_area:
                continue
            u0, u1, v0, v1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
            padded = np.pad(region, 1)
            edge = region & ~(padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:])
            perim = int(edge.sum())
            circ = float(4 * math.pi * area / (perim * perim)) if perim else 0.0
            out.append(
                {
                    "color": color,
                    "area": area,
                    "bbox": (u0, v0, u1, v1),
                    "width": u1 - u0 + 1,
                    "height": v1 - v0 + 1,
                    "centroid": (round(float(xs.mean()), 1), round(float(ys.mean()), 1)),
                    "circularity": round(min(circ, 1.2), 2),
                    "touches_edge": bool(u0 == 0 or v0 == 0 or u1 == W - 1 or v1 == H - 1),
                }
            )
    out.sort(key=lambda b: b["centroid"][0])
    if verbose:
        print(f"camera {cam_id}: {len(out)} blob(s)")
        for k, b in enumerate(out):
            print(
                f"  [{k}] {b['color']:4s} area={b['area']:5d} bbox={b['bbox']} w={b['width']} h={b['height']} "
                f"centroid={b['centroid']} circ={b['circularity']}" + (" EDGE" if b["touches_edge"] else "")
            )
    return out


# ----------------------------------------------------------------------------- hypotheses
def snap(objects):
    """Snap positions to the 0.05 grid inside the room, sizes to the legal set; keep cube rotations."""
    out = []
    for o in objects:
        size = min(SIZES, key=lambda s: abs(s - float(o["size"])))
        reach = size / 2 * (math.sqrt(3) if o["shape"] == "cube" else 1)
        margin = reach + 0.05
        pos = []
        for v in o["position"]:
            v = round(float(v) / GRID) * GRID
            pos.append(round(min(max(v, margin), ROOM - margin), 3))
        new = {"shape": o["shape"], "color": o["color"], "size": size, "position": pos}
        if o["shape"] == "cube" and o.get("rotation") is not None:
            new["rotation"] = [round(float(r), 3) for r in o["rotation"]]
        out.append(new)
    return out


def apparent_size(pose, blob, point, shape):
    """Physical size implied by a blob's pixel width at the triangulated depth (cube silhouettes are wider than
    the edge length, so cubes are divided by a typical factor 1.3)."""
    depth = pose.to_cam(point)[2]
    s = blob["width"] * depth / pose.f
    if shape == "cube":
        s /= 1.3
    return float(s)


def initial_hypothesis(pose_a, pose_b, matches, shapes, blobs_a=None, blobs_b=None, verbose=True):
    """One object per matched blob pair. `shapes` lists the shape you see for each match (same order as
    `matches`). Position = triangulated point; size = nearest legal size to the apparent size (averaged over the
    two views). Cubes get an initial rotation of zero (local_search fits it)."""
    if blobs_a is None:
        blobs_a = blobs("A", verbose=False)
    if blobs_b is None:
        blobs_b = blobs("B", verbose=False)
    if len(shapes) != len(matches):
        raise ValueError(f"{len(matches)} matches but {len(shapes)} shapes")
    objs = []
    for m, shape in zip(matches, shapes):
        ba, bb = blobs_a[m["a"]], blobs_b[m["b"]]
        p = np.array(m["point"], dtype=float)
        s = 0.5 * (apparent_size(pose_a, ba, p, shape) + apparent_size(pose_b, bb, p, shape))
        o = {"shape": shape, "color": ba["color"], "size": s, "position": p.tolist()}
        if shape == "cube":
            o["rotation"] = [0.0, 0.0, 0.0]
        objs.append(o)
    objs = snap(objs)
    if verbose:
        print("initial hypothesis:")
        for o in objs:
            print("  ", o)
    return objs


def object_from_pixels(pose_a, uv_a, pose_b, uv_b, shape, color, size=None, width_px_a=None, verbose=True):
    """Build one object from the pixel centre you read off each image (use this when an object is merged with
    another blob, partly hidden, or missed by blobs()). Position = triangulation of the two rays; size from
    width_px_a (its apparent width in camera A) if given, else 0.15 to be refined by local_search."""
    p, gap = triangulate(pose_a, uv_a, pose_b, uv_b)
    if size is None and width_px_a is not None:
        size = apparent_size(pose_a, {"width": width_px_a}, p, shape)
    o = {"shape": shape, "color": color, "size": size if size is not None else 0.15, "position": [float(v) for v in p]}
    if shape == "cube":
        o["rotation"] = [0.0, 0.0, 0.0]
    o = snap([o])[0]
    if verbose:
        print(f"object from pixels: {o} (ray gap {gap:.3f}; a gap above ~0.05 means the two pixels are not the same object)")
    return o


def shape_test(objects, pose_a, pose_b, index):
    """IoU with object `index` as a sphere vs as a cube (each briefly refined). Prints and returns both."""
    res = {}
    for shape in ("sphere", "cube"):
        trial = [dict(o) for o in objects]
        trial[index]["shape"] = shape
        if shape == "cube":
            trial[index]["rotation"] = trial[index].get("rotation") or [0.0, 0.0, 0.0]
        trial = _fit_rotation(trial, index, pose_a, pose_b) if shape == "cube" else trial
        res[shape] = compare(trial, pose_a, pose_b, verbose=False)["score"]
    print(f"object #{index}: as sphere -> {res['sphere']}, as cube -> {res['cube']}")
    return res


# ----------------------------------------------------------------------------- rendering
def _euler_matrix(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


def _cube_corners(c, s, rot):
    h = s / 2
    R = _euler_matrix(*rot) if rot is not None else np.eye(3)
    return [np.asarray(c) + R @ np.array([dx * h, dy * h, dz * h]) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]


def render_masks(objects, pose):
    """Silhouette masks {'red': mask, 'blue': mask} the objects would produce in this camera (nearer occludes)."""
    W, H = pose.W, pose.H
    masks = {"red": np.zeros((H, W), dtype=bool), "blue": np.zeros((H, W), dtype=bool)}
    depth_buf = np.full((H, W), np.inf)
    for o in objects:
        c = np.array(o["position"], dtype=float)
        s = float(o["size"])
        pr = pose.project(c)
        if pr is None:
            continue
        depth = pr[2]
        img = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(img)
        if o["shape"] == "sphere":
            r_px = pose.f * (s / 2) / depth
            r_px *= 1.0 / math.sqrt(max(1e-6, 1 - (s / 2 / depth) ** 2))
            d.ellipse([pr[0] - r_px, pr[1] - r_px, pr[0] + r_px, pr[1] + r_px], fill=255)
        else:
            pts = [pose.project(p) for p in _cube_corners(c, s, o.get("rotation"))]
            pts = [(p[0], p[1]) for p in pts if p is not None]
            hull = _convex_hull([(round(p[0], 2), round(p[1], 2)) for p in pts])
            if len(hull) >= 3:
                d.polygon(hull, fill=255)
        m = np.asarray(img) > 0
        nearer = m & (depth < depth_buf)
        depth_buf[nearer] = depth
        for col in masks:
            masks[col][nearer] = False
        masks[o["color"]][nearer] = True
    return masks


def render(objects, pose, path=None):
    """RGB preview of the hypothesis silhouettes (with the room outline) for this camera; optionally saved."""
    masks = render_masks(objects, pose)
    img = np.full((pose.H, pose.W, 3), 40, dtype=np.uint8)
    img[room_mask(pose.cam_id)] = 110
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


_BLOBMASK = {}


def _blob_masks(cam_id):
    if cam_id not in _BLOBMASK:
        img = load_image(cam_id)
        masks = color_masks(img)
        out = []
        for b in blobs(cam_id, verbose=False):
            lab, n = _label(masks[b["color"]])
            u0, v0, u1, v1 = b["bbox"]
            sub = lab[v0 : v1 + 1, u0 : u1 + 1]
            vals, counts = np.unique(sub[sub > 0], return_counts=True)
            lid = int(vals[np.argmax(counts)]) if len(vals) else -1
            out.append(lab == lid)
        _BLOBMASK[cam_id] = out
    return _BLOBMASK[cam_id]


def compare(objects, pose_a, pose_b, verbose=True):
    """Render the hypothesis in both cameras and compare with the real images. Returns {'score': mean IoU over
    cameras and colours (1.0 perfect; a correct answer typically scores 0.8-0.95), 'cameras': {...}}. Per camera and
    object: predicted vs real blob centroid (du, dv in pixels), width ratio, plus phantom objects (no real blob
    nearby) and UNEXPLAINED real blobs (no hypothesised object nearby)."""
    report = {"cameras": {}}
    ious = []
    for pose in (pose_a, pose_b):
        cam_id = pose.cam_id
        real = color_masks(load_image(cam_id))
        pred = render_masks(objects, pose)
        cam_rep = {"iou": {}, "objects": [], "unexplained_real_blobs": []}
        for col in ("red", "blue"):
            if real[col].any() or pred[col].any():
                iou = _iou(real[col], pred[col])
                cam_rep["iou"][col] = round(iou, 3)
                ious.append(iou)
        real_blobs = blobs(cam_id, verbose=False)
        bmasks = _blob_masks(cam_id)
        used = set()
        for i, o in enumerate(objects):
            single = render_masks([o], pose)[o["color"]]
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
            if best is not None and bd < 120:
                used.add(best)
                b = real_blobs[best]
                entry.update(
                    {
                        "real_centroid": b["centroid"],
                        "du": round(b["centroid"][0] - pc[0], 1),
                        "dv": round(b["centroid"][1] - pc[1], 1),
                        "width_ratio": round(b["width"] / max(pw, 1), 2),
                        "overlap_iou": round(_iou(single, bmasks[best]), 3),
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


def _overlaps(objects):
    for i in range(len(objects)):
        for j in range(i + 1, len(objects)):
            a, b = objects[i], objects[j]
            d = float(np.linalg.norm(np.array(a["position"]) - np.array(b["position"])))
            ra = a["size"] / 2 * (math.sqrt(3) if a["shape"] == "cube" else 1)
            rb = b["size"] / 2 * (math.sqrt(3) if b["shape"] == "cube" else 1)
            if d < ra + rb + 0.05:
                return True
    return False


def _fit_rotation(objects, i, pose_a, pose_b, n=40, seed=0):
    """Random search over the rotation of cube i (rotation is a rendering nuisance, not part of the answer)."""
    from scipy.spatial.transform import Rotation

    if objects[i]["shape"] != "cube":
        return objects
    rng = np.random.default_rng(seed)
    best_objs = objects
    best = compare(objects, pose_a, pose_b, verbose=False)["score"]
    cands = [objects[i].get("rotation") or [0.0, 0.0, 0.0]] + [
        list(Rotation.random(random_state=int(rng.integers(1 << 30))).as_euler("xyz")) for _ in range(n)
    ]
    for rot in cands:
        trial = [dict(o) for o in objects]
        trial[i]["rotation"] = [float(r) for r in rot]
        sc = compare(trial, pose_a, pose_b, verbose=False)["score"]
        if sc > best + 1e-4:
            best, best_objs = sc, trial
    return best_objs


def local_search(objects, pose_a, pose_b, passes=6, try_sizes=True, verbose=True):
    """Coordinate descent maximising the mean IoU: each object's position is moved by up to +-0.15 along x, y and z,
    its size is tried at all legal values, and cube rotations are fitted. Shapes, colours and the object count are
    never changed - decide those yourself (see shape_test). Returns the improved (snapped) list."""
    objs = snap(objects)

    def score(os_):
        return compare(os_, pose_a, pose_b, verbose=False)["score"]

    best = score(objs)
    if verbose:
        print(f"local_search start score={best}")
    for p in range(passes):
        improved = False
        for i in range(len(objs)):
            if objs[i]["shape"] == "cube":
                fitted = _fit_rotation(objs, i, pose_a, pose_b, n=25 if p == 0 else 10, seed=p)
                sc = score(fitted)
                if sc > best + 1e-4:
                    best, objs, improved = sc, fitted, True
            steps = (-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15)
            for axis in range(3):
                for d in steps:
                    for s in (SIZES if try_sizes else [objs[i]["size"]]):
                        if d == 0 and s == objs[i]["size"]:
                            continue
                        o = dict(objs[i])
                        o["size"] = s
                        pos = list(objs[i]["position"])
                        pos[axis] += d
                        o["position"] = pos
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


def refine_rotation(objects, pose_a, pose_b, i, verbose=True):
    """Polish cube i's orientation: random search followed by shrinking local perturbations (orientation is scored
    to about 10 degrees, modulo the cube's own symmetries). Returns the updated list."""
    if objects[i]["shape"] != "cube":
        return objects
    objs = _fit_rotation(objects, i, pose_a, pose_b, n=60, seed=7)
    best = compare(objs, pose_a, pose_b, verbose=False)["score"]
    for step in (0.3, 0.15, 0.07, 0.035):
        improved = True
        while improved:
            improved = False
            base = objs[i].get("rotation") or [0.0, 0.0, 0.0]
            for axis in range(3):
                for d in (-step, step):
                    trial = [dict(o) for o in objs]
                    rot = list(base)
                    rot[axis] += d
                    trial[i]["rotation"] = rot
                    sc = compare(trial, pose_a, pose_b, verbose=False)["score"]
                    if sc > best + 1e-4:
                        best, objs, improved = sc, trial, True
                        base = rot
    if verbose:
        print(f"refine_rotation #{i}: rotation={[round(r, 3) for r in objs[i]['rotation']]} score={best}")
    return objs


def to_json(objects):
    """Final answer: positions on the grid, legal sizes, cube rotations (Euler XYZ radians), null for spheres."""
    out = []
    for o in snap(objects):
        rec = {"shape": o["shape"], "color": o["color"], "size": o["size"], "position": o["position"]}
        rec["rotation"] = [round(float(r), 4) for r in (o.get("rotation") or [0.0, 0.0, 0.0])] if o["shape"] == "cube" else None
        out.append(rec)
    return json.dumps({"objects": out}, indent=2)
