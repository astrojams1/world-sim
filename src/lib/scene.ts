import * as THREE from "three";
import { OBJECT_HEX, PLATFORM_HEX, platformFrame, ROOM_BOUNDS } from "./room";
import type { CameraSpec, Platform, Room, RoomObject, Guess, Vec3 } from "./types";

export type SceneObject = Pick<RoomObject, "shape" | "color" | "size" | "position" | "rotation">;

/** What is drawn inside the room: the objects and, in platform mode, the platform. Either may be a guess. */
export interface SceneContent {
  objects: SceneObject[];
  platform?: Platform;
}

/** Build the room geometry + lighting. Objects are added separately so we can render guesses. */
export function buildRoomScene(room: Room): THREE.Scene {
  const scene = new THREE.Scene();
  const s = room.size;
  const mat = (hex: string) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0 });

  const plane = (w: number, h: number, hex: string) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(hex));

  const floor = plane(s, s, room.colors.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(s / 2, 0, s / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = plane(s, s, room.colors.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(s / 2, s, s / 2);
  scene.add(ceiling);

  const north = plane(s, s, room.colors.wallNorth); // z = 0, faces +z
  north.position.set(s / 2, s / 2, 0);
  north.receiveShadow = true;
  scene.add(north);

  const south = plane(s, s, room.colors.wallSouth); // z = 1, faces -z
  south.rotation.y = Math.PI;
  south.position.set(s / 2, s / 2, s);
  south.receiveShadow = true;
  scene.add(south);

  const west = plane(s, s, room.colors.wallWest); // x = 0, faces +x
  west.rotation.y = Math.PI / 2;
  west.position.set(0, s / 2, s / 2);
  west.receiveShadow = true;
  scene.add(west);

  const east = plane(s, s, room.colors.wallEast); // x = 1, faces -x
  east.rotation.y = -Math.PI / 2;
  east.position.set(s, s / 2, s / 2);
  east.receiveShadow = true;
  scene.add(east);

  scene.add(new THREE.AmbientLight(0xffffff, room.lighting.ambientIntensity));

  // Distant light: parallel rays, one consistent shadow direction for every object.
  const sun = new THREE.DirectionalLight(room.lighting.sun.color, room.lighting.sun.intensity);
  const d = room.lighting.sun.direction;
  sun.position.set(0.5 + d[0] * 3, 0.5 + d[1] * 3, 0.5 + d[2] * 3);
  sun.target.position.set(0.5, 0.5, 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1;
  sun.shadow.camera.right = 1;
  sun.shadow.camera.top = 1;
  sun.shadow.camera.bottom = -1;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 6;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.01;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(room.lighting.fillLight.color, room.lighting.fillLight.intensity);
  fill.position.set(...room.lighting.fillLight.position);
  fill.target.position.set(0.5, 0.5, 0.5);
  scene.add(fill);
  scene.add(fill.target);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));

  return scene;
}

export interface DrawOptions {
  ghost?: boolean;
  /** Time after the first snapshot: everything on the platform is displaced by velocity * t. */
  t?: number;
  platform?: Platform;
}

function displacement(opts: DrawOptions): Vec3 {
  const t = opts.t ?? 0;
  const v = opts.platform?.velocity;
  return v && t ? [v[0] * t, v[1] * t, v[2] * t] : [0, 0, 0];
}

export function makeObjectMesh(o: SceneObject, opts: DrawOptions = {}): THREE.Mesh {
  const geom =
    o.shape === "sphere" ? new THREE.SphereGeometry(o.size / 2, 48, 32) : new THREE.BoxGeometry(o.size, o.size, o.size);
  const material = opts.ghost
    ? new THREE.MeshBasicMaterial({ color: OBJECT_HEX[o.color], wireframe: true, transparent: true, opacity: 0.85 })
    : new THREE.MeshStandardMaterial({ color: OBJECT_HEX[o.color], roughness: 0.45, metalness: 0.05 });
  const mesh = new THREE.Mesh(geom, material);
  const dp = displacement(opts);
  mesh.position.set(o.position[0] + dp[0], o.position[1] + dp[1], o.position[2] + dp[2]);
  if (o.rotation) mesh.rotation.set(...o.rotation);
  mesh.castShadow = !opts.ghost;
  mesh.receiveShadow = !opts.ghost;
  return mesh;
}

export function addObjects(scene: THREE.Scene, objects: SceneObject[], opts: DrawOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = opts.ghost ? "guess" : "objects";
  for (const o of objects) group.add(makeObjectMesh(o, opts));
  scene.add(group);
  return group;
}

/**
 * The platform: an infinite plane drawn as a large double-sided sheet clipped to the room (renderers must enable
 * localClippingEnabled). Local x = across, y = direction of motion, z = normal. It never moves visibly.
 */
export function makePlatformMesh(platform: Platform, opts: DrawOptions = {}): THREE.Mesh {
  const material = opts.ghost
    ? new THREE.MeshBasicMaterial({ color: PLATFORM_HEX, wireframe: true, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: PLATFORM_HEX, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  material.clippingPlanes = ROOM_BOUNDS.map((b) => new THREE.Plane(new THREE.Vector3(...b.normal), b.constant));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, opts.ghost ? 24 : 1, opts.ghost ? 24 : 1), material);
  const { d, n, e } = platformFrame(platform);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...e), new THREE.Vector3(...d), new THREE.Vector3(...n));
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.position.set(...platform.position);
  mesh.castShadow = !opts.ghost;
  mesh.receiveShadow = !opts.ghost;
  mesh.name = opts.ghost ? "guess-platform" : "platform";
  return mesh;
}

/** Add the objects and (if any) the platform, at time t after the first snapshot. */
export function addContent(scene: THREE.Scene, content: SceneContent, opts: Omit<DrawOptions, "platform"> = {}) {
  const o: DrawOptions = { ...opts, platform: content.platform };
  if (content.platform) scene.add(makePlatformMesh(content.platform, o));
  addObjects(scene, content.objects, o);
}

export function makeCamera(spec: CameraSpec): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(spec.fov, spec.aspect, 0.01, 10);
  cam.position.set(...spec.position);
  cam.up.set(0, 1, 0);
  cam.lookAt(new THREE.Vector3(...spec.lookAt));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

export function guessToSceneObjects(g: Guess): SceneObject[] {
  return g.objects.map((o) => ({ shape: o.shape, color: o.color, size: o.size, position: o.position, ...(o.rotation ? { rotation: o.rotation } : {}) }));
}

export function guessToContent(g: Guess): SceneContent {
  return { objects: guessToSceneObjects(g), ...(g.platform ? { platform: g.platform } : {}) };
}

export function roomContent(room: Room): SceneContent {
  return { objects: room.objects, ...(room.platform ? { platform: room.platform } : {}) };
}
