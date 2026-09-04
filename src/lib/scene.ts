import * as THREE from "three";
import { OBJECT_HEX } from "./room";
import type { CameraSpec, Room, RoomObject, Guess } from "./types";

export type SceneObject = Pick<RoomObject, "shape" | "color" | "size" | "position">;

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

  const key = new THREE.PointLight(room.lighting.keyLight.color, room.lighting.keyLight.intensity, 0, 1.2);
  key.position.set(...room.lighting.keyLight.position);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.002;
  scene.add(key);

  const fill = new THREE.PointLight(room.lighting.fillLight.color, room.lighting.fillLight.intensity, 0, 1.2);
  fill.position.set(...room.lighting.fillLight.position);
  scene.add(fill);

  return scene;
}

export function makeObjectMesh(o: SceneObject, opts: { ghost?: boolean } = {}): THREE.Mesh {
  const geom =
    o.shape === "sphere" ? new THREE.SphereGeometry(o.size / 2, 48, 32) : new THREE.BoxGeometry(o.size, o.size, o.size);
  const material = opts.ghost
    ? new THREE.MeshBasicMaterial({ color: OBJECT_HEX[o.color], wireframe: true, transparent: true, opacity: 0.85 })
    : new THREE.MeshStandardMaterial({ color: OBJECT_HEX[o.color], roughness: 0.45, metalness: 0.05 });
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(...o.position);
  mesh.castShadow = !opts.ghost;
  mesh.receiveShadow = !opts.ghost;
  return mesh;
}

export function addObjects(scene: THREE.Scene, objects: SceneObject[], opts: { ghost?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = opts.ghost ? "guess" : "objects";
  for (const o of objects) group.add(makeObjectMesh(o, opts));
  scene.add(group);
  return group;
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
  return g.objects.map((o) => ({ shape: o.shape, color: o.color, size: o.size, position: o.position }));
}
