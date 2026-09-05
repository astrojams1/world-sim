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

Typical workflow (short form):
    import worldsim as ws
    r = ws.solve_all()                                            # everything below in one call; read its printout
    objs = r["objects"]; pA, pB = r["pose_a"], r["pose_b"]
    # reconcile with what you SEE: add merged/hidden objects with object_from_pixels, drop phantoms, fix colours
    objs = ws.finish(objs, pA, pB)                                # refine, verify, print the answer

Typical workflow (long form):
    hexA = ws.room_outline("A"); hexB = ws.room_outline("B")   # 1. hexagon of room corners in each image (check them!)
    pA = ws.solve_camera("A"); pB = ws.solve_camera("B")        # 2. camera pose + focal length from the hexagon
    pB = ws.align(pA, pB)                                         # 3. put B in the same room frame as A
    bA = ws.blobs("A"); bB = ws.blobs("B")                        # 4. red/blue objects in each image
    matches = ws.auto_match(pA, pB, bA, bB)                       # 5. pair blobs across views by triangulation
    guess = ws.initial_hypothesis(pA, pB, matches, shapes)        # 6. one object per pair, shapes from YOUR eyes
    guess.append(ws.object_from_pixels(pA, (u,v), pB, (u,v), "cube", "red"))  # objects merged/hidden in a blob
    ws.compare(guess, pA, pB)                                     # 7. render and compare with the real images
    guess = ws.apply_shapes(guess, ws.shape_check(guess, pA, pB)) # 7b. let the silhouettes arbitrate sphere vs cube
    guess = ws.local_search(guess, pA, pB)                        # 8. refine positions / sizes / cube rotations
    ws.compare(guess, pA, pB)                                     # 9. verify; fix what is unexplained; repeat
    guess = ws.refine_all_rotations(guess, pA, pB)                # 10. polish every cube's orientation
    print(ws.to_json(guess))
"""
import itertools
import time
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
SIZES = [0.10, 0.15, 0.20]
_LOG_PATH = os.path.join("/mnt/data" if os.path.isdir("/mnt/data") else BASE, "session_log.txt")


def _out(*args, **kwargs):
    """print() that also appends to the session transcript (the kernel's own stdout is never replaced)."""
    print(*args, **kwargs)
    try:
        with open(_LOG_PATH, "a") as f:
            print(*args, **kwargs, file=f)
    except Exception:
        pass
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
    # A pure-red or pure-blue material keeps its other two channels near zero under any lighting, so the
    # dominant channel must also exceed the others by a margin: a bluish-grey wall (say 85,132,158) passes the
    # ratio tests but not the margin, and an object standing in front of such a wall stays a separate blob.
    red = (r > 90) & (r > 1.7 * g) & (r > 1.7 * b) & (r - np.maximum(g, b) > 45)
    blue = (b > 90) & (b > 1.35 * r) & (b > 1.15 * g) & (b - np.maximum(r, g) > 45)
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


def _merge_close_vertices(poly, min_dist):
    """Merge consecutive vertices closer than min_dist pixels (a real corner is never that close to another)."""
    pts = [tuple(map(float, p)) for p in poly]
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            if math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < min_dist:
                merged = ((pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2)
                pts = [merged if k == i else p for k, p in enumerate(pts) if k != j]
                changed = True
                break
    return pts


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
        _out(f"camera {cam_id} room outline ({len(hexagon)} corners, pixel u,v): " + ", ".join(f"({u:.0f},{v:.0f})" for u, v in hexagon))
        if len(hexagon) != 6:
            _out("  WARNING: expected 6 corners; the view may be degenerate. Use set_room_outline with corners you read off the image.")
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
        self.cx, self.cy = self.W / 2, self.H / 2
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
        return (float(self.f * c[0] / c[2] + self.cx), float(self.f * c[1] / c[2] + self.cy), float(c[2]))

    def ray(self, u, v):
        d = np.array([(u - self.cx) / self.f, (v - self.cy) / self.f, 1.0])
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


def _random_starts(X, uv, W, H, n_starts, top_k, seed=0):
    """Evaluate n_starts random rotations x 5 fields of view at once (the translation is linear given R and f,
    so all of them are solved in one batched normal-equation solve) and return the top_k by reprojection error."""
    from scipy.spatial.transform import Rotation

    fovs = np.array([35.0, 45.0, 55.0, 65.0, 75.0])
    fs = H / 2 / np.tan(np.radians(fovs) / 2)  # (F,)
    R = Rotation.random(n_starts, random_state=seed).as_matrix()  # (S,3,3)
    rX = np.einsum("sij,nj->sni", R, X)  # (S,n,3)
    du = uv[:, 0] - W / 2  # (n,)
    dv = uv[:, 1] - H / 2
    S, n = rX.shape[0], rX.shape[1]
    F = len(fs)
    # A rows per point: [-f, 0, du], [0, -f, dv]; b: f*rX_x - du*rX_z, f*rX_y - dv*rX_z
    A = np.zeros((S, F, 2 * n, 3))
    A[:, :, 0::2, 0] = -fs[None, :, None]
    A[:, :, 1::2, 1] = -fs[None, :, None]
    A[:, :, 0::2, 2] = du[None, None, :]
    A[:, :, 1::2, 2] = dv[None, None, :]
    b = np.zeros((S, F, 2 * n))
    b[:, :, 0::2] = fs[None, :, None] * rX[:, None, :, 0] - du[None, None, :] * rX[:, None, :, 2]
    b[:, :, 1::2] = fs[None, :, None] * rX[:, None, :, 1] - dv[None, None, :] * rX[:, None, :, 2]
    AtA = np.einsum("sfki,sfkj->sfij", A, A)
    Atb = np.einsum("sfki,sfk->sfi", A, b)
    try:
        t = np.linalg.solve(AtA + 1e-9 * np.eye(3), Atb[..., None])[..., 0]  # (S,F,3)
    except np.linalg.LinAlgError:
        return []
    C = rX[:, None, :, :] + t[:, :, None, :]  # (S,F,n,3)
    z = C[..., 2]
    ok = (z > 0.05).all(axis=2)  # (S,F)
    zs = np.where(z > 1e-3, z, 1e-3)
    pu = fs[None, :, None] * C[..., 0] / zs + W / 2
    pv = fs[None, :, None] * C[..., 1] / zs + H / 2
    err = np.sqrt(((pu - uv[:, 0]) ** 2 + (pv - uv[:, 1]) ** 2).mean(axis=2))  # (S,F)
    err = np.where(ok, err, np.inf)
    flat = err.ravel()
    order = np.argsort(flat)[:top_k]
    out = []
    for idx in order:
        if not np.isfinite(flat[idx]):
            break
        si, fi = divmod(int(idx), F)
        out.append((float(flat[idx]), R[si], t[si, fi], float(fs[fi])))
    return out


def _fit_pose(X, uv, W, H, n_starts=None, top_k=6, seed=0, good_enough=1.0):
    """Fit R, t, f to 3D<->2D correspondences. Starts from a DLT initialisation (six or more points) refined by
    Levenberg-Marquardt; random-rotation starts (evaluated in one batch) are only used when that is missing or
    poor. Stops as soon as a start refines to under `good_enough` px. Returns (rms error px, R, t, f) or None."""
    from scipy.optimize import least_squares

    uv = np.asarray(uv, dtype=float)
    if n_starts is None:
        # five points have no closed-form start, so they need many more random starts to find the basin
        n_starts = 60 if len(uv) >= 6 else 600

    def resid(params):
        R = _rotvec_to_matrix(params[:3])
        t = params[3:6]
        f = params[6]
        C = X @ R.T + t
        z = np.maximum(C[:, 2], 1e-3)
        p = np.stack([f * C[:, 0] / z + W / 2, f * C[:, 1] / z + H / 2], axis=1)
        return (p - uv).ravel()

    def refine(R0, t0, f0):
        x0 = np.concatenate([_matrix_to_rotvec(R0), t0, [f0]])
        try:
            sol = least_squares(resid, x0, method="lm", max_nfev=400)
        except Exception:
            return None
        R = _rotvec_to_matrix(sol.x[:3])
        t = sol.x[3:6]
        f = float(sol.x[6])
        if f <= 0:
            return None
        C = X @ R.T + t
        if (C[:, 2] <= 0.05).any():
            return None
        err = float(np.sqrt((sol.fun.reshape(-1, 2) ** 2).sum(axis=1).mean()))
        return (err, R, t, f)

    best = None
    try:
        init = _dlt_init(X, uv, W, H) if len(uv) >= 6 else None
    except Exception:
        init = None
    if init is not None and 10 < init[2] < 20000:
        best = refine(*init)
        if best is not None and best[0] < good_enough:
            return best
        if best is not None and best[0] > 3.0:
            return best  # a wrong labelling: random starts never rescue it (checked on 40 cameras)
    for _, R0, t0, f0 in _random_starts(X, uv, W, H, n_starts, top_k, seed):
        fit = refine(R0, t0, f0)
        if fit is None:
            continue
        if best is None or fit[0] < best[0]:
            best = fit
            if best[0] < good_enough:
                break
    return best


def _point_in_polygon(pt, poly, tol=4.0):
    """Inside test with a tolerance: a point within `tol` pixels of an edge counts as inside (a corner that lies
    exactly on the outline, as in a degenerate pentagonal view, must not be rejected)."""
    if tol > 0:
        n = len(poly)
        for i in range(n):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
            dx, dy = x2 - x1, y2 - y1
            L2 = dx * dx + dy * dy
            if L2 < 1e-9:
                continue
            t = max(0.0, min(1.0, ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / L2))
            if math.hypot(pt[0] - (x1 + t * dx), pt[1] - (y1 + t * dy)) <= tol:
                return True
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


def _candidate_outlines(cam_id, primary):
    """Alternative outlines to try when the primary one fits poorly: near-duplicate corners merged, coarser
    simplifications, and the primary with one corner dropped (degenerate views where two corners coincide)."""
    mask = room_mask(cam_id)
    lab, n = _label(mask)
    if n > 1:
        sizes = [(lab == i).sum() for i in range(1, n + 1)]
        mask = lab == (1 + int(np.argmax(sizes)))
    contour = _trace_contour(mask)
    out = []
    for eps in (1.0, 2.0, 3.5):
        poly = _simplify_contour(contour, eps=eps)
        merged = _merge_close_vertices(poly, 8.0)
        for cand in (poly, merged):
            if len(cand) >= 6:
                out.append(_simplify_polygon(cand, 6))
            elif len(cand) == 5:
                out.append(cand)
    for k in range(len(primary)):
        out.append([h for i, h in enumerate(primary) if i != k])
    # orient counter-clockwise and de-duplicate
    seen, uniq = set(), []
    for alt in out:
        n_alt = len(alt)
        area = sum(alt[i][0] * alt[(i + 1) % n_alt][1] - alt[(i + 1) % n_alt][0] * alt[i][1] for i in range(n_alt))
        if area > 0:
            alt = alt[::-1]
        key = tuple((round(u), round(v)) for u, v in alt)
        if key not in seen and key != tuple((round(u), round(v)) for u, v in primary):
            seen.add(key)
            uniq.append(alt)
    return uniq


def _best_fit_for_outline(cam_id, outline, W, H, n_starts=None, top_k=6, good_enough=1.0):
    best = None
    for family, X in _labelings(len(outline)):
        fit = _fit_pose(X, outline, W, H, n_starts=n_starts, top_k=top_k, good_enough=good_enough)
        if fit is None:
            continue
        err, R, t, f = fit
        if np.linalg.det(R) < 0:
            continue
        pose = Pose(cam_id, R, t, f)
        if all(-0.05 <= v <= 1.05 for v in pose.position):
            continue  # camera inside the room
        on_outline = {tuple(int(v) for v in row) for row in X}
        ok = True
        for k in CUBE_CORNERS:
            if tuple(int(v) for v in k) in on_outline:
                continue
            pk = pose.project(k)
            if pk is None or not _point_in_polygon((pk[0], pk[1]), outline):
                ok = False
                break
        if not ok:
            continue
        if best is None or err < best[0]:
            best = (err, R, t, f, family)
            if err < good_enough:
                break  # every valid labelling is equivalent up to a room symmetry; no need to try the rest
    return best


def solve_camera(cam_id, verbose=True):
    """Recover the camera pose and focal length from the room outline (see _labelings for how the outline's
    vertices are matched to cube corners). All candidate labellings are fitted and the best consistent one is
    kept; the frame is arbitrary but consistent. Returns a Pose (cached)."""
    if cam_id in _POSE:
        pose = _POSE[cam_id]
    else:
        hexagon = room_outline(cam_id, verbose=False)
        W, H = image_size(cam_id)
        best = _best_fit_for_outline(cam_id, hexagon, W, H)
        if best is None or best[0] > 3.0:
            # poor or no fit: the outline probably has a spurious, merged or missing corner. Try alternatives
            # (cheaper fits: the DLT start does most of the work, the random starts are only a fallback).
            for alt in _candidate_outlines(cam_id, hexagon)[:8]:
                cand = _best_fit_for_outline(cam_id, alt, W, H, top_k=3)
                if cand is not None and (best is None or cand[0] < best[0]):
                    best = cand
                    _OUTLINE[cam_id] = alt
                    if best[0] < 1.5:
                        break
        if best is None:
            raise RuntimeError("could not solve the camera pose from the outline; check room_outline()")
        err, R, t, f, family = best
        pose = Pose(cam_id, R, t, f)
        pose.reprojection_error = err
        pose.family = family
        _POSE[cam_id] = pose
    if verbose:
        _out(pose)
        if pose.reprojection_error is not None and pose.reprojection_error > 6:
            _out("  WARNING: large reprojection error - check room_outline() against the image (set_room_outline to fix).")
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
        _out(f"camera {cam_id} visible faces: {out}")
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
    if len(scored) > 1 and scored[1][0] - scored[0][0] < 0.08:
        # near tie (several same-colour blobs can triangulate almost as well in a wrong frame): let the images
        # decide. Each close frame gets a quick hypothesis (pairing, initial objects, one local-search pass) and
        # the frame whose rendered objects overlap the real pixels best wins.
        close = [c for c in scored if c[0] - scored[0][0] < 0.08][:3]
        rescored = []
        for c in close:
            try:
                m = auto_match(pose_a, c[4], blobs_a, blobs_b, verbose=False)
                if not m:
                    rescored.append((0.0, c))
                    continue
                shapes = ["sphere" if 0.5 * (blobs_a[x["a"]]["circularity"] + blobs_b[x["b"]]["circularity"]) > 0.95 else "cube" for x in m]
                objs = initial_hypothesis(pose_a, c[4], m, shapes, blobs_a, blobs_b, verbose=False)
                objs = local_search(objs, pose_a, c[4], passes=1, verbose=False)
                rescored.append((compare(objs, pose_a, c[4], verbose=False)["score"], c))
            except Exception:
                rescored.append((0.0, c))
        rescored.sort(key=lambda r: -r[0])
        if verbose:
            _out("align: " + "; ".join(f"frame with B at ({r[1][4].position[0]:.2f}, {r[1][4].position[1]:.2f}, {r[1][4].position[2]:.2f}) fits the images at IoU {r[0]:.3f}" for r in rescored))
        best_c = rescored[0][1]
        scored = [best_c] + [c for c in scored if c is not best_c]
    total, ccost, tcost, M, pb = scored[0]
    if verbose:
        runner = scored[1]
        _out(
            f"align: best frame colour-mismatch={ccost:.3f}, triangulation residual={tcost:.3f} "
            f"(runner-up total {runner[0]:.3f} vs {total:.3f}); "
            f"B now at ({pb.position[0]:.2f}, {pb.position[1]:.2f}, {pb.position[2]:.2f})"
        )
        if runner[0] - total < 0.05:
            _out("  WARNING: the frame alignment is ambiguous; check compare() in both cameras carefully.")
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


def _match_cost(pose_a, pose_b, blobs_a, blobs_b, size_weight=0.0, unpaired=0.15):
    """Best pairing of same-colour blobs across the views by triangulation residual (unpaired blobs cost 0.08).
    The pair costs are computed once and the assignment is solved exactly (Hungarian algorithm with a 0.3 dummy
    per blob), so any number of objects is tractable."""
    from scipy.optimize import linear_sum_assignment

    UNPAIRED = unpaired  # a pair must cost under 2 x unpaired or both blobs stay unpaired
    best_total, best_pairs = 0.0, []
    for color in ("red", "blue"):
        ia = [i for i, b in enumerate(blobs_a) if b["color"] == color]
        ib = [i for i, b in enumerate(blobs_b) if b["color"] == color]
        if not ia and not ib:
            continue
        if not ia or not ib:
            best_total += UNPAIRED * (len(ia) + len(ib))
            continue
        na, nb = len(ia), len(ib)
        cost = np.full((na, nb), 0.0)
        info = {}
        for r_i, i in enumerate(ia):
            for c_j, j in enumerate(ib):
                p, r = triangulate(pose_a, blobs_a[i]["centroid"], pose_b, blobs_b[j]["centroid"])
                # an object's centre is at least 0.1 from every wall (size/2 + 0.05), so a triangulated point
                # outside [0.05, 0.95] is a wrong pairing or a wrong frame
                inside = all(0.05 <= v <= 0.95 for v in p)
                # appearance consistency: the physical size implied by the blob width in each view must agree
                sa = apparent_size(pose_a, blobs_a[i], p, "sphere")
                sb = apparent_size(pose_b, blobs_b[j], p, "sphere")
                size_mismatch = abs(sa - sb) / max(sa + sb, 1e-6)  # 0 = identical, ~0.33 = one is twice the other
                cost[r_i, c_j] = r + (0 if inside else 0.5) + size_weight * size_mismatch
                info[(r_i, c_j)] = (p, r)
        # square matrix with dummies: pairing blob i with a dummy costs UNPAIRED (and likewise for j)
        n = na + nb
        M = np.full((n, n), 0.0)
        M[:na, :nb] = cost
        M[:na, nb:] = UNPAIRED
        M[na:, :nb] = UNPAIRED
        rows, cols = linear_sum_assignment(M)
        total = 0.0
        pairs = []
        for r_i, c_j in zip(rows, cols):
            if r_i < na and c_j < nb:
                # a real pair is only kept when it beats leaving both unpaired (the solver already ensures this)
                total += cost[r_i, c_j]
                p, r = info[(r_i, c_j)]
                pairs.append((ia[r_i], ib[c_j], p, r))
            elif r_i < na or c_j < nb:
                total += UNPAIRED
        best_total += total
        best_pairs += pairs
    return best_total, best_pairs


def auto_match(pose_a, pose_b, blobs_a=None, blobs_b=None, verbose=True):
    """Pair blobs in A with blobs in B (same colour) so that the paired rays intersect best. Returns a list of
    dicts {a: index in blobs_a, b: index in blobs_b, point, residual}. Unpaired blobs are reported; they are
    usually an object hidden or merged in one view, or a false detection."""
    if blobs_a is None:
        blobs_a = blobs("A", verbose=False)
    if blobs_b is None:
        blobs_b = blobs("B", verbose=False)
    # final pairing: a pair must cost under 0.16 (correct pairs have ray gaps up to 0.075, 99th percentile 0.058,
    # plus a small size term; wrong pairs are often above). The frame scoring in align() keeps the 0.15 penalty:
    # a cheap "unpaired" there would favour frames that pair fewer blobs.
    _, pairs = _match_cost(pose_a, pose_b, blobs_a, blobs_b, size_weight=0.15, unpaired=0.08)
    matches = [{"a": i, "b": j, "point": [round(float(v), 3) for v in p], "residual": round(r, 3)} for i, j, p, r in pairs]
    if verbose:
        for m in matches:
            _out(f"  A blob {m['a']} <-> B blob {m['b']}: {blobs_a[m['a']]['color']} at {m['point']} (ray gap {m['residual']})")
        ua = set(range(len(blobs_a))) - {m["a"] for m in matches}
        ub = set(range(len(blobs_b))) - {m["b"] for m in matches}
        for i in ua:
            _out(f"  A blob {i} ({blobs_a[i]['color']}, centroid {blobs_a[i]['centroid']}) has no partner in B")
        for j in ub:
            _out(f"  B blob {j} ({blobs_b[j]['color']}, centroid {blobs_b[j]['centroid']}) has no partner in A")
    return matches


# ----------------------------------------------------------------------------- blobs
def blobs(cam_id, min_area=150, verbose=True):
    """Connected red/blue regions in a camera image: color, area, bbox (u0, v0, u1, v1), width, height,
    centroid (u, v), circularity (weak shape hint: ~1 sphere, lower cube), touches_edge. Ordered left to right.
    Regions under min_area pixels are ignored (the smallest possible object covers about 250 px). Two touching
    same-colour objects can merge into one blob; an occluded object may be split or hidden."""
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
        _out(f"camera {cam_id}: {len(out)} blob(s)")
        for k, b in enumerate(out):
            _out(
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
        lo = math.ceil(margin / GRID - 1e-9) * GRID
        hi = math.floor((ROOM - margin) / GRID + 1e-9) * GRID
        pos = []
        for v in o["position"]:
            v = round(float(v) / GRID) * GRID
            pos.append(round(min(max(v, lo), hi), 3))
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
        _out("initial hypothesis:")
        for o in objs:
            _out("  ", o)
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
        _out(f"object from pixels: {o} (ray gap {gap:.3f}; a gap above ~0.05 means the two pixels are not the same object)")
    return o


def _hidden_fraction(o, others, pose):
    """Fraction of object o's silhouette in this camera that lies behind nearer objects in `others`."""
    if not others:
        return 0.0
    own = render_masks([o], pose)[o["color"]]
    n = own.sum()
    if n == 0:
        return 0.0
    pr = pose.project(np.array(o["position"], dtype=float))
    if pr is None:
        return 0.0
    hidden = own & (_depth_buffer(others, pose) < pr[2])
    return float(hidden.sum() / n)


def _matched_blob_mask(o, pose, others=None):
    """Mask of the real blob (same colour) nearest to where object o projects in this camera, and its width.
    A view in which the object is mostly hidden behind other objects (`others`) has no usable blob."""
    pr = pose.project(o["position"])
    if pr is None:
        return None, None
    if others is not None and _hidden_fraction(o, others, pose) > 0.5:
        return None, None
    real = blobs(pose.cam_id, verbose=False)
    masks = _blob_masks(pose.cam_id)
    best, bd = None, 1e9
    for j, b in enumerate(real):
        if b["color"] != o["color"]:
            continue
        d = math.hypot(b["centroid"][0] - pr[0], b["centroid"][1] - pr[1])
        if d < bd:
            best, bd = j, d
    if best is None or bd > 120:
        return None, None
    return masks[best], real[best]


def _object_fit(o, pose_a, pose_b, shape, n_rot=40, seed=3, others=None, skip=()):
    """Best per-object silhouette IoU (mean over the two cameras) for `shape`, over legal sizes and, for cubes,
    random rotations. Returns (score, size, rotation)."""
    from scipy.spatial.transform import Rotation

    targets = []
    for pose in (pose_a, pose_b):
        m, b = (None, None) if pose.cam_id in skip else _matched_blob_mask(o, pose, others)
        targets.append((pose, m))
    if all(m is None for _, m in targets):
        return None
    rng = np.random.default_rng(seed)
    rots = [[0.0, 0.0, 0.0]] + ([list(Rotation.random(random_state=int(rng.integers(1 << 30))).as_euler("xyz")) for _ in range(n_rot)] if shape == "cube" else [])
    best = None
    for size in SIZES:
        for rot in rots:
            cand = {"shape": shape, "color": o["color"], "size": size, "position": o["position"]}
            if shape == "cube":
                cand["rotation"] = rot
            ious = []
            for pose, m in targets:
                if m is None:
                    continue
                cov, win = render_soft(cand, pose)
                ious.append(_soft_iou(cov, m, win))
            sc = float(np.mean(ious))
            if best is None or sc > best[0]:
                best = (sc, size, rot if shape == "cube" else None)
    return best


def shading_flatness(cam_id, blob_index):
    """Fraction of a blob's interior pixels with (nearly) zero luminance gradient. A cube's faces are flat plateaus
    separated by sharp edges (high fraction); a sphere is one smooth gradient (low fraction). Measured from the
    image alone. Returns None for blobs too small to erode."""
    from scipy import ndimage

    img = load_image(cam_id).astype(float)
    mask = _blob_masks(cam_id)[blob_index]
    lum = img.mean(axis=2)
    er = ndimage.binary_erosion(mask, iterations=2)
    if er.sum() < 30:
        return None
    gy, gx = np.gradient(lum)
    g = np.hypot(gx, gy)[er]
    v = lum[er]
    rng = max(float(v.max() - v.min()), 1e-6)
    return float((g < 0.02 * rng).mean())


# Size-aware thresholds on shading flatness (midpoints between sphere and cube medians measured on 130 blobs).
_FLAT_THRESHOLD = {0.10: 0.20, 0.15: 0.32, 0.20: 0.48}


def _shading_vote(o, pose_a, pose_b, size, others=None, skip=()):
    """Mean flatness over the blobs the object matches, minus the size-aware threshold: > 0 says cube, < 0 sphere."""
    vals = []
    for pose in (pose_a, pose_b):
        if pose.cam_id in skip:
            continue
        pr = pose.project(o["position"])
        if pr is None:
            continue
        if others is not None and _hidden_fraction(o, others, pose) > 0.5:
            continue
        real = blobs(pose.cam_id, verbose=False)
        best, bd = None, 1e9
        for j, b in enumerate(real):
            if b["color"] != o["color"]:
                continue
            d = math.hypot(b["centroid"][0] - pr[0], b["centroid"][1] - pr[1])
            if d < bd:
                best, bd = j, d
        if best is None or bd > 120:
            continue
        f = shading_flatness(pose.cam_id, best)
        if f is not None:
            vals.append(f)
    if not vals:
        return None
    return float(np.mean(vals)) - _FLAT_THRESHOLD[min(SIZES, key=lambda x: abs(x - size))]


def shape_check(objects, pose_a, pose_b, margin=0.03, cube_margin=0.06, verbose=True):
    """Decide sphere vs cube for EVERY object from its own silhouette: each object is fitted as a sphere and as a
    cube (size and rotation re-fitted for each shape) against the real blob it matches in each camera, and the
    shape with the clearly higher per-object overlap wins. Returns the recommended shapes (and prints the sizes
    that go with them). Small cubes look round and small spheres look angular to the eye, but two silhouettes do
    not lie; adopt the recommendation unless the object shares its blob with another object (flagged) or you can
    clearly see the contrary in BOTH images."""
    recommended = []
    for i, o in enumerate(objects):
        others = [x for k, x in enumerate(objects) if k != i]
        fits = {shape: _object_fit(o, pose_a, pose_b, shape, others=others) for shape in ("sphere", "cube")}
        if fits["sphere"] is None or fits["cube"] is None:
            recommended.append(o["shape"])
            if verbose:
                _out(f"object #{i} ({o['color']} {o['shape']}): no matching blob, keeping shape")
            continue
        # a blob much wider than the object's own render means two objects share it: unreliable
        shared_in = set()
        for pose in (pose_a, pose_b):
            m, b = _matched_blob_mask(o, pose, others)
            if b is not None:
                r = render_masks([o], pose)[o["color"]]
                xs = np.nonzero(r.any(axis=0))[0]
                if len(xs) and b["width"] > 1.6 * (xs.max() - xs.min() + 1):
                    shared_in.add(pose.cam_id)
        shared = len(shared_in) >= 2
        one_view = ""
        if len(shared_in) == 1:
            # the other view alone decides (its silhouette is the object's own)
            alt = {shape: _object_fit(o, pose_a, pose_b, shape, others=others, skip=shared_in) for shape in ("sphere", "cube")}
            if alt["sphere"] is not None and alt["cube"] is not None:
                fits = alt
                one_view = f" (blob shared in camera {next(iter(shared_in))}: judged from the other view)"
            else:
                shared = True
        s_sc, s_size, _ = fits["sphere"]
        c_sc, c_size, c_rot = fits["cube"]
        current = o["shape"]
        other = "cube" if current == "sphere" else "sphere"
        cur_sc = s_sc if current == "sphere" else c_sc
        oth_sc = c_sc if current == "sphere" else s_sc
        # a cube has free size AND rotation, so it can mimic a disc; it must win by a wider margin - but a small
        # object's silhouette is only ~25 px across, where IoU differences are compressed, so scale the margin
        scale = min(1.0, max(0.5, (fits["cube"][1] if other == "cube" else fits["sphere"][1]) / 0.15))
        need = (cube_margin if other == "cube" else margin) * scale
        # shading (flat faces vs smooth gradient) arbitrates when the silhouettes are inconclusive
        vote = None if shared else _shading_vote(o, pose_a, pose_b, c_size if other == "cube" else s_size, others, skip=shared_in)
        if not shared and oth_sc - cur_sc > need:
            rec = other
        elif not shared and vote is not None and abs(oth_sc - cur_sc) <= need and abs(vote) > 0.05:
            rec = "cube" if vote > 0 else "sphere"
        else:
            rec = current
        recommended.append(rec)
        if verbose:
            flag = " (blob shared with another object: unreliable)" if shared else ("" if rec == current else f"  <-- CHANGE to {rec} (size {c_size if rec == 'cube' else s_size})")
            shade = "" if vote is None else f", shading {'flat faces (cube-like)' if vote > 0 else 'smooth (sphere-like)'} {vote:+.2f}"
            _out(f"object #{i} ({o['color']}, currently {current}): as sphere IoU {s_sc:.3f} (size {s_size}), as cube IoU {c_sc:.3f} (size {c_size}){shade}{one_view}{flag}")
    return recommended


def apply_shapes(objects, shapes):
    """Return a copy of objects with the given shapes (cubes get a zero rotation to be fitted by local_search)."""
    out = []
    for o, shape in zip(objects, shapes):
        n = dict(o)
        n["shape"] = shape
        if shape == "cube":
            n["rotation"] = n.get("rotation") or [0.0, 0.0, 0.0]
        else:
            n.pop("rotation", None)
        out.append(n)
    return out


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
    _out(f"object #{index}: as sphere -> {res['sphere']}, as cube -> {res['cube']}")
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


def _depth_buffer(objects, pose):
    """Per-pixel depth of the nearest object silhouette in this camera (inf where no object is drawn)."""
    W, H = pose.W, pose.H
    depth_buf = np.full((H, W), np.inf)
    for o in objects:
        m = render_masks([o], pose)[o["color"]]
        pr = pose.project(np.array(o["position"], dtype=float))
        if pr is None:
            continue
        depth_buf[m & (pr[2] < depth_buf)] = pr[2]
    return depth_buf


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


def _crop_window(o, pose, pad=1.35):
    """Pixel window (x0, y0, x1, y1) that contains object o's silhouette in this camera, or None."""
    pr = pose.project(o["position"])
    if pr is None:
        return None
    reach = o["size"] / 2 * (math.sqrt(3) if o["shape"] == "cube" else 1.0)
    r_px = pose.f * reach / pr[2] * pad + 2
    x0, x1 = int(max(0, pr[0] - r_px)), int(min(pose.W, pr[0] + r_px + 1))
    y0, y1 = int(max(0, pr[1] - r_px)), int(min(pose.H, pr[1] + r_px + 1))
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def render_soft(o, pose, scale=3, window=None):
    """Sub-pixel silhouette coverage (0..1 per pixel) of a single object, rendered at `scale` x resolution inside a
    crop window around the object and box-filtered down. Returns (coverage, window)."""
    if window is None:
        window = _crop_window(o, pose)
    if window is None:
        return None, None
    x0, y0, x1, y1 = window
    w, h = x1 - x0, y1 - y0
    f = pose.f * scale
    cx, cy = (pose.cx - x0) * scale, (pose.cy - y0) * scale
    c = pose.R @ np.asarray(o["position"], dtype=float) + pose.t
    img = Image.new("L", (w * scale, h * scale), 0)
    if c[2] > 1e-6:
        d = ImageDraw.Draw(img)
        s = float(o["size"])
        if o["shape"] == "sphere":
            depth = c[2]
            u, v = f * c[0] / depth + cx, f * c[1] / depth + cy
            r_px = f * (s / 2) / depth
            r_px *= 1.0 / math.sqrt(max(1e-6, 1 - (s / 2 / depth) ** 2))
            d.ellipse([u - r_px, v - r_px, u + r_px, v + r_px], fill=255)
        else:
            hh = s / 2
            rot = o.get("rotation")
            Rc = pose.R @ (_euler_matrix(*rot) if rot is not None else np.eye(3))
            pts = []
            for dx in (-1, 1):
                for dy in (-1, 1):
                    for dz in (-1, 1):
                        p = c + Rc @ np.array([dx * hh, dy * hh, dz * hh])
                        if p[2] > 1e-6:
                            pts.append((round(f * p[0] / p[2] + cx, 2), round(f * p[1] / p[2] + cy, 2)))
            hull = _convex_hull(pts)
            if len(hull) >= 3:
                d.polygon(hull, fill=255)
    m = np.asarray(img, dtype=np.float32) * (1.0 / 255.0)
    return m.reshape(h, scale, w, scale).mean(axis=(1, 3)), window


def _soft_iou(cov, mask, window):
    """Soft IoU between a cropped coverage map and a full-size binary mask."""
    if cov is None:
        return 0.0
    x0, y0, x1, y1 = window
    m = mask[y0:y1, x0:x1].astype(np.float32)
    inter = np.minimum(cov, m).sum()
    union = np.maximum(cov, m).sum() + (mask.sum() - m.sum())  # blob pixels outside the window count against
    return float(inter / union) if union else 1.0


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
_LAST_ISSUES = None  # open issues reported by the previous finish() call
_REFINED = set()  # JSON of object lists that have already been through local_search + refine_all_rotations


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
            # fraction of the object's visible footprint that lands on real pixels of its colour: an object whose
            # footprint is covered is explained even when it shares its blob with another object (two touching
            # objects of one colour form a single blob)
            foot = vis if vis.any() else single
            coverage = float((foot & real[o["color"]]).sum() / max(foot.sum(), 1))
            entry["coverage"] = round(coverage, 2)
            if best is None or bd >= 120:
                # no unused blob: fall back to the nearest blob of the colour, shared with another object
                for j, b in enumerate(real_blobs):
                    if b["color"] != o["color"]:
                        continue
                    dd = math.hypot(b["centroid"][0] - pc[0], b["centroid"][1] - pc[1])
                    if dd < bd:
                        best, bd = j, dd
                shared = True
            else:
                shared = False
            if best is not None and ((not shared and bd < 120) or coverage >= 0.5):
                if not shared:
                    used.add(best)
                b = real_blobs[best]
                entry.update(
                    {
                        "real_centroid": b["centroid"],
                        "shared_blob": shared,
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
        _out(f"score (mean IoU) = {report['score']}")
        for cam_id, cr in report["cameras"].items():
            _out(f"camera {cam_id}: IoU {cr['iou']}")
            fine = [e["index"] for e in cr["objects"] if e["visible"] and e.get("real_centroid") is not None and not e.get("shared_blob")
                    and abs(e["du"]) <= 3 and abs(e["dv"]) <= 3 and e["overlap_iou"] >= 0.8]
            if fine:
                _out(f"  objects {fine} match their blobs (offset within 3 px, overlap IoU >= 0.8)")
            for e in cr["objects"]:
                if e["index"] in fine:
                    continue
                o = objects[e["index"]]
                tag = f"  #{e['index']} {o['color']} {o['shape']} {o['size']} @ {o['position']}"
                if not e["visible"]:
                    _out(tag + " -> not visible in this camera")
                elif e["real_centroid"] is None:
                    _out(tag + f" -> predicted at {e['pred_centroid']} but NO real blob of that colour nearby (phantom? only {e['coverage']:.0%} of its footprint is on real pixels of its colour)")
                else:
                    _out(
                        tag
                        + f" -> predicted {e['pred_centroid']}, real {e['real_centroid']}, offset du={e['du']} dv={e['dv']}, "
                        f"width ratio real/pred={e['width_ratio']}, overlap IoU={e['overlap_iou']}"
                        + (" (shares this blob with another object: offsets not meaningful)" if e.get("shared_blob") else "")
                    )
            for b in cr["unexplained_real_blobs"]:
                _out(f"  UNEXPLAINED real {b['color']} blob at {b['centroid']} (width {b['width']}) - missing object?")
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


def _rotation_targets(o, pose_a, pose_b, others=None):
    targets = [(pose, _matched_blob_mask(o, pose, others)[0]) for pose in (pose_a, pose_b)]
    return [(p, m) for p, m in targets if m is not None]


def _rotation_score(o, rot, targets):
    cand = dict(o)
    cand["rotation"] = list(rot)
    vals = []
    for p, m in targets:
        cov, win = render_soft(cand, p)
        vals.append(_soft_iou(cov, m, win))
    return float(np.mean(vals)) if vals else 0.0


def _fit_rotation(objects, i, pose_a, pose_b, n=40, seed=0):
    """Random search over the rotation of cube i against its own silhouette in both cameras (fast, sub-pixel)."""
    from scipy.spatial.transform import Rotation

    if objects[i]["shape"] != "cube":
        return objects
    o = objects[i]
    targets = _rotation_targets(o, pose_a, pose_b, [x for k, x in enumerate(objects) if k != i])
    if not targets:
        return objects
    rng = np.random.default_rng(seed)
    cands = [o.get("rotation") or [0.0, 0.0, 0.0]] + [
        list(Rotation.random(random_state=int(rng.integers(1 << 30))).as_euler("xyz")) for _ in range(n)
    ]
    best_rot = max(cands, key=lambda r: _rotation_score(o, r, targets))
    out = [dict(x) for x in objects]
    out[i]["rotation"] = [float(r) for r in best_rot]
    return out


def _object_targets(objects, i, pose):
    """Pixels of object i's colour not explained by the OTHER objects (so objects sharing a blob split it)."""
    others = [o for k, o in enumerate(objects) if k != i]
    real = color_masks(load_image(pose.cam_id))[objects[i]["color"]]
    if others:
        real = real & ~render_masks(others, pose)[objects[i]["color"]]
    return real


def _object_score(o, targets):
    """Mean soft IoU over the views; a view in which the candidate is more than half hidden behind the other
    objects is skipped (targets may carry a depth buffer of the other objects as a third element)."""
    vals = []
    for target in targets:
        pose, tmask = target[0], target[1]
        depth_buf = target[2] if len(target) > 2 else None
        cov, win = render_soft(o, pose)
        if cov is None:
            continue
        if depth_buf is not None:
            pr = pose.project(np.array(o["position"], dtype=float))
            if pr is not None:
                x0, y0, x1, y1 = win
                hidden = (cov * (depth_buf[y0:y1, x0:x1] < pr[2])).sum()
                if hidden > 0.5 * max(cov.sum(), 1e-6):
                    continue
        vals.append(_soft_iou(cov, tmask, win))
    return float(np.mean(vals)) if vals else 0.0


def local_search(objects, pose_a, pose_b, passes=6, try_sizes=True, verbose=True):
    """Coordinate descent, one object at a time: its position is moved by up to +-0.15 along x, y and z, its size
    is tried at all legal values, and cube rotations are fitted, each candidate scored by the object's own
    sub-pixel silhouette overlap with the pixels of its colour that the other objects do not explain (in both
    cameras). Shapes, colours and the object count are never changed - decide those yourself (see shape_check).
    Returns the improved (snapped) list."""
    objs = snap(objects)
    if verbose:
        _out(f"local_search start score={compare(objs, pose_a, pose_b, verbose=False)['score']}")
    for p in range(passes):
        improved = False
        for i in range(len(objs)):
            targets = [(pose, _object_targets(objs, i, pose)) for pose in (pose_a, pose_b)]
            if objs[i]["shape"] == "cube":
                fitted = _fit_rotation(objs, i, pose_a, pose_b, n=25 if p == 0 else 10, seed=p)
                if fitted[i]["rotation"] != objs[i].get("rotation"):
                    objs = fitted
            best = _object_score(objs[i], targets)
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
                        o = snap([o])[0]
                        trial = list(objs)
                        trial[i] = o
                        if _overlaps(trial):
                            continue
                        sc = _object_score(o, targets)
                        if sc > best + 1e-4:
                            best, objs, improved = sc, trial, True
        if verbose:
            _out(f"pass {p + 1}: score={compare(objs, pose_a, pose_b, verbose=False)['score']}")
        if not improved:
            break
    return objs


def refine_rotation(objects, pose_a, pose_b, i, n=150, try_sizes=True, verbose=True):
    """Polish cube i's orientation against its own silhouette in both cameras (sub-pixel coverage): random search
    over `n` orientations, shrinking coordinate steps, then a Powell polish. With `try_sizes` every legal size is
    searched the same way and the (size, rotation) pair with the best overlap wins: a cube seen at the wrong
    size settles into a wrong orientation (the silhouette of a bigger cube can mimic a rotated smaller one), so
    the two must be decided together. Orientation is scored to about 10 degrees modulo the cube's own
    symmetries. Returns the updated list."""
    from scipy.optimize import minimize
    from scipy.spatial.transform import Rotation

    if objects[i]["shape"] != "cube":
        return objects
    o = dict(objects[i])
    targets = _rotation_targets(o, pose_a, pose_b, [x for k, x in enumerate(objects) if k != i])
    if not targets:
        if verbose:
            _out(f"refine_rotation #{i}: no matching blob, rotation and size unchanged")
        return objects
    rng = np.random.default_rng(7)
    rand = [list(Rotation.random(random_state=int(rng.integers(1 << 30))).as_euler("xyz")) for _ in range(n)]
    sizes = list(SIZES) if try_sizes else [o["size"]]
    # the current size is searched last so that ties keep it
    sizes.sort(key=lambda s: s == o["size"])
    # random search at every size first; the coordinate descent only for sizes that are within 0.1 of the best
    coarse = []
    for size in sizes:
        cand = dict(o)
        cand["size"] = size
        score = lambda rot, cand=cand: _rotation_score(cand, rot, targets)  # noqa: E731
        cands = [o.get("rotation") or [0.0, 0.0, 0.0]] + (rand if len(sizes) == 1 else rand[: max(1, n // 3)])
        rot = max(cands, key=score)
        coarse.append((score(rot), size, rot, score))
    top = max(c[0] for c in coarse)
    if len(sizes) > 1:
        # the competitive sizes get the rest of the random starts before the descent
        full = []
        for sc, size, rot, score in coarse:
            if sc >= top - 0.1:
                for r in rand[max(1, n // 3):]:
                    s2 = score(r)
                    if s2 > sc:
                        sc, rot = s2, r
            full.append((sc, size, rot, score))
        coarse = full
        top = max(c[0] for c in coarse)
    best, best_rot, best_size = -1.0, None, o["size"]
    for sc, size, rot, score in coarse:
        if sc < top - 0.1:
            continue
        for step in (0.3, 0.15, 0.07, 0.035, 0.017):
            improved = True
            while improved:
                improved = False
                for axis in range(3):
                    for d in (-step, step):
                        r2 = list(rot)
                        r2[axis] += d
                        s2 = score(r2)
                        if s2 > sc + 1e-5:
                            sc, rot, improved = s2, r2, True
        if sc >= best:
            best, best_rot, best_size = sc, rot, size
    o["size"] = best_size
    score = lambda rot: _rotation_score(o, rot, targets)  # noqa: E731
    out = [dict(x) for x in objects]
    out[i]["rotation"] = [float(r) for r in best_rot]
    out[i]["size"] = float(best_size)
    if verbose:
        changed = "" if best_size == objects[i]["size"] else f" size {objects[i]['size']} -> {best_size}"
        _out(f"refine_rotation #{i}: rotation={[round(r, 3) for r in best_rot]}{changed} silhouette IoU={best:.3f}")
    return out


def refine_all_rotations(objects, pose_a, pose_b, verbose=True):
    """refine_rotation (orientation and size together) for every cube."""
    for i, o in enumerate(objects):
        if o["shape"] == "cube":
            objects = refine_rotation(objects, pose_a, pose_b, i, verbose=verbose)
    return objects


def _ray_room_span(origin, direction):
    """Parameter interval [t0, t1] where origin + t*direction lies inside the room (with a small margin)."""
    t0, t1 = -np.inf, np.inf
    for k in range(3):
        if abs(direction[k]) < 1e-9:
            if not (0.05 <= origin[k] <= 0.95):
                return None
            continue
        a = (0.05 - origin[k]) / direction[k]
        b = (0.95 - origin[k]) / direction[k]
        lo, hi = min(a, b), max(a, b)
        t0, t1 = max(t0, lo), min(t1, hi)
    if t1 <= t0:
        return None
    return max(t0, 0.0), t1


def _residual_mask(objects, pose, color):
    """Real pixels of `color` not explained by the current objects."""
    real = color_masks(load_image(pose.cam_id))[color]
    pred = render_masks(objects, pose)[color]
    return real & ~pred


def explain_unpaired(objects, pose_a, pose_b, matches, blobs_a, blobs_b, min_score=0.35, verbose=True):
    """For every blob that auto_match left without a partner (usually an object that shares a blob with another
    object in the other view, or is hidden there), search along its viewing ray for the object that best explains
    it: every depth inside the room x legal sizes x sphere/cube (rotation fitted). The candidate is scored by its
    silhouette overlap with the unpaired blob and with the still-unexplained pixels of that colour in the other
    view. Accepted candidates are appended (printed as AUTO-ADDED) so you can veto them. Returns the new list."""
    from scipy.spatial.transform import Rotation

    objs = [dict(o) for o in objects]
    used_a = {m["a"] for m in matches}
    used_b = {m["b"] for m in matches}
    todo = [("A", j) for j in range(len(blobs_a)) if j not in used_a] + [("B", j) for j in range(len(blobs_b)) if j not in used_b]
    poses = {"A": pose_a, "B": pose_b}
    masks = {"A": _blob_masks("A"), "B": _blob_masks("B")}
    rng = np.random.default_rng(5)
    rots = [[0.0, 0.0, 0.0]] + [list(Rotation.random(random_state=int(rng.integers(1 << 30))).as_euler("xyz")) for _ in range(10)]
    for cam, j in todo:
        blob = (blobs_a if cam == "A" else blobs_b)[j]
        pose = poses[cam]
        other = "B" if cam == "A" else "A"
        opose = poses[other]
        own_mask = masks[cam][j]
        # is this blob already explained by an existing object (e.g. a second blob of an occluded object)?
        if (own_mask & render_masks(objs, pose)[blob["color"]]).sum() > 0.5 * own_mask.sum():
            continue
        resid_other = _residual_mask(objs, opose, blob["color"])
        depth_other = _depth_buffer(objs, opose)
        o, d = pose.ray(*blob["centroid"])
        span = _ray_room_span(o, d)
        if span is None:
            continue
        best = None
        ranked = []  # every candidate scored, so that the best NON-overlapping one can be chosen
        step = (span[1] - span[0]) / 14
        depths = list(np.linspace(span[0], span[1], 15))
        for t in depths:
            p = o + t * d
            for size in SIZES:
                for shape in ("sphere", "cube"):
                    for rot in (rots if shape == "cube" else [None]):
                        cand = {"shape": shape, "color": blob["color"], "size": size, "position": [float(v) for v in p]}
                        if rot is not None:
                            cand["rotation"] = rot
                        cov, win = render_soft(cand, pose)
                        s_own = _soft_iou(cov, own_mask, win)
                        cov2, win2 = render_soft(cand, opose)
                        if cov2 is not None and cov2.sum() > 1e-6:
                            # consistency with the other view: the part of the footprint hidden behind a nearer
                            # object is consistent whatever the image shows there; the visible part must land on
                            # unexplained pixels of the colour (a visible footprint on nothing is a contradiction)
                            x0, y0, x1, y1 = win2
                            pr2 = opose.project(p)
                            hidden = (depth_other[y0:y1, x0:x1] < pr2[2]) if pr2 is not None else np.zeros_like(cov2, dtype=bool)
                            visible = cov2 * ~hidden
                            vis_area = visible.sum()
                            if vis_area < 0.2 * cov2.sum():
                                s_other = 0.5  # (almost) entirely hidden: the other view neither confirms nor denies
                            else:
                                inter = np.minimum(visible, resid_other[y0:y1, x0:x1]).sum()
                                s_other = float(inter / vis_area)
                            score = 0.6 * s_own + 0.4 * s_other
                        else:
                            score = s_own
                        ranked.append((score, cand, s_own, s_other if cov2 is not None else None))
                        if best is None or score > best[0]:
                            best = ranked[-1]
        if best is not None:
            # fine pass: neighbouring depths around the best, same shape and size, a few rotations
            base = dict(best[1])
            t_best = float(np.dot(np.array(base["position"]) - o, d))
            for t in np.linspace(t_best - step, t_best + step, 7):
                if abs(t - t_best) < 1e-9:
                    continue
                p = o + t * d
                for rot in (rots[:6] if base["shape"] == "cube" else [None]):
                    cand = dict(base)
                    cand["position"] = [float(v) for v in p]
                    if rot is not None:
                        cand["rotation"] = rot
                    cov, win = render_soft(cand, pose)
                    s_own = _soft_iou(cov, own_mask, win)
                    cov2, win2 = render_soft(cand, opose)
                    if cov2 is not None and cov2.sum() > 1e-6:
                        x0, y0, x1, y1 = win2
                        pr2 = opose.project(p)
                        hidden = (depth_other[y0:y1, x0:x1] < pr2[2]) if pr2 is not None else np.zeros_like(cov2, dtype=bool)
                        visible = cov2 * ~hidden
                        vis_area = visible.sum()
                        s_other = 0.5 if vis_area < 0.2 * cov2.sum() else float(np.minimum(visible, resid_other[y0:y1, x0:x1]).sum() / vis_area)
                        sc = 0.6 * s_own + 0.4 * s_other
                    else:
                        s_other, sc = None, s_own
                    ranked.append((sc, cand, s_own, s_other))
                    if sc > best[0]:
                        best = ranked[-1]
        if best is None or best[0] < min_score:
            if verbose:
                _out(f"unpaired {blob['color']} blob {j} in {cam} at {blob['centroid']}: no consistent object found (best {0 if best is None else round(best[0], 2)}); it may be a reflection of an object you already have, or you may need object_from_pixels")
            continue
        # the best candidate that does not overlap an existing object (only the new object is tested: existing
        # objects may already sit closer together than the rule allows)
        ranked.sort(key=lambda c: -c[0])
        chosen, cand = None, None
        for c in ranked:
            if c[0] < min_score:
                break
            trial = snap([c[1]])[0]
            if not any(_overlaps([trial, o]) for o in objs):
                chosen, cand = c, trial
                break
        if chosen is None:
            if verbose:
                _out(f"unpaired {blob['color']} blob {j} in {cam}: every consistent explanation overlaps an existing object; skipped")
            continue
        best = chosen
        objs.append(cand)
        if verbose:
            _out(f"AUTO-ADDED from unpaired {blob['color']} blob {j} in {cam} at {blob['centroid']}: {cand} (own IoU {best[2]:.2f}, other-view support {best[3] if best[3] is None else round(best[3], 2)}). Veto it if you do not see this object.")
    return objs


def solve_all(shapes=None, verbose=True):
    """One-shot pipeline: outline -> cameras -> align -> blobs -> match -> hypothesis -> shape check -> refine.
    `shapes` (optional) is your visual inventory for the matched pairs, in the order auto_match prints them; if
    omitted, shapes start from blob circularity and the silhouette shape check decides. Unpaired blobs are
    explained automatically (explain_unpaired) and printed as AUTO-ADDED. Prints everything you need to review
    (cameras, blobs, matches, auto-added objects, shape verdicts, compare report) and returns a dict with
    pose_a, pose_b, blobs_a, blobs_b, matches, objects, report."""
    t_start = time.time()
    room_outline("A", verbose=verbose)
    room_outline("B", verbose=verbose)
    pa = solve_camera("A", verbose=verbose)
    pb = solve_camera("B", verbose=verbose)
    ba = blobs("A", verbose=verbose)
    bb = blobs("B", verbose=verbose)
    pb = align(pa, pb, ba, bb, verbose=verbose)
    if verbose:
        _out("matches (A blob <-> B blob):")
    matches = auto_match(pa, pb, ba, bb, verbose=verbose)
    if not matches:
        raise RuntimeError("no blob pairs matched across the two views; check the outlines and blobs")
    if shapes is None:
        shapes = []
        for m in matches:
            circ = 0.5 * (ba[m["a"]]["circularity"] + bb[m["b"]]["circularity"])
            shapes.append("sphere" if circ > 0.95 else "cube")
    objs = initial_hypothesis(pa, pb, matches, shapes, ba, bb, verbose=verbose)
    objs = local_search(objs, pa, pb, passes=3, verbose=False)
    if verbose:
        _out("unpaired blobs:")
    objs = explain_unpaired(objs, pa, pb, matches, ba, bb, verbose=verbose)
    if verbose:
        _out("shape check:")
    rec = shape_check(objs, pa, pb, verbose=verbose)
    objs = apply_shapes(objs, rec)
    objs = local_search(objs, pa, pb, verbose=False)
    before = objs
    objs = refine_all_rotations(objs, pa, pb, verbose=False)
    if any(a["size"] != b["size"] for a, b in zip(objs, before)):
        # a size changed: let the positions settle again (sizes now fixed)
        objs = local_search(objs, pa, pb, passes=2, try_sizes=False, verbose=False)
    _REFINED.add(to_json(objs))
    if verbose:
        _out("compare:")
    report = compare(objs, pa, pb, verbose=verbose)
    if verbose:
        _print_answer(objs, report, first=True)
        _out(f"(solve_all took {time.time() - t_start:.1f} s)")
    return {"pose_a": pa, "pose_b": pb, "blobs_a": ba, "blobs_b": bb, "matches": matches, "objects": objs, "report": report}


def finish(objects, pose_a, pose_b, verbose=True):
    """After you have corrected the inventory: refine positions/sizes/rotations, verify, and print the answer.
    Objects that are exactly the list solve_all() (or a previous finish()) returned are already refined and are
    only verified again."""
    global _REFINED
    key = to_json(objects)
    if key in _REFINED:
        objs = [dict(o) for o in objects]
    else:
        objs = local_search(objects, pose_a, pose_b, verbose=False)
        objs = refine_all_rotations(objs, pose_a, pose_b, verbose=False)
        _REFINED.add(to_json(objs))
    report = compare(objs, pose_a, pose_b, verbose=verbose)
    if verbose:
        _print_answer(objs, report, first=False)
    return objs


def _open_issues(objs, report):
    issues = []
    for cam_id, c in report["cameras"].items():
        issues += [("unexplained", cam_id, b["color"], b["centroid"]) for b in c["unexplained_real_blobs"]]
        issues += [("phantom", cam_id, objs[e["index"]]["color"], e["pred_centroid"]) for e in c["objects"] if e.get("visible") and e.get("real_centroid") is None]
    return issues


def _print_answer(objs, report, first):
    """Print the answer JSON under a banner: FINAL when the compare report has no open issue (or the same open
    issue as the previous answer, which two views cannot resolve), otherwise a request to fix that one thing."""
    global _LAST_ISSUES
    issues = _open_issues(objs, report)
    if not issues:
        _out("=== FINAL ANSWER (copy verbatim; do not run any further cell) ===")
    elif _LAST_ISSUES is not None and issues == _LAST_ISSUES:
        _out("(the same open issue as after the previous answer: it cannot be resolved from these two views, so it is accepted)")
        _out("=== FINAL ANSWER (copy verbatim; do not run any further cell) ===")
    elif first:
        _out("=== ANSWER (one open issue remains: if you can see what is wrong, fix exactly that in ONE cell and call ws.finish; otherwise call ws.finish as is) ===")
    else:
        _out("=== ANSWER (one open issue remains: fix it in ONE cell, call finish once more, then stop) ===")
    _LAST_ISSUES = issues
    _out(to_json(objs, compact=True))


def to_json(objects, compact=False):
    """Final answer: positions on the grid, legal sizes, cube rotations (Euler XYZ radians), null for spheres.
    `compact` prints one object per line (shorter to read and to copy)."""
    out = []
    for o in snap(objects):
        rec = {"shape": o["shape"], "color": o["color"], "size": o["size"], "position": o["position"]}
        rec["rotation"] = [round(float(r), 4) for r in (o.get("rotation") or [0.0, 0.0, 0.0])] if o["shape"] == "cube" else None
        out.append(rec)
    if compact:
        return '{"objects": [\n' + ",\n".join("  " + json.dumps(r) for r in out) + "\n]}"
    return json.dumps({"objects": out}, indent=2)
