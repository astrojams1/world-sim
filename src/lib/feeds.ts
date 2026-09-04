import * as THREE from "three";
import { FEED_HEIGHT, FEED_WIDTH } from "./room";
import { addObjects, buildRoomScene, makeCamera, type SceneObject } from "./scene";
import type { Room } from "./types";

let renderer: THREE.WebGLRenderer | null = null;
function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(FEED_WIDTH, FEED_HEIGHT, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

export interface Feeds {
  A: string;
  B: string;
}

/** Render the two camera feeds for a room, optionally substituting the objects (e.g. a guess). */
export function renderFeeds(room: Room, objects: SceneObject[] = room.objects): Feeds {
  const r = getRenderer();
  const scene = buildRoomScene(room);
  addObjects(scene, objects);
  const out: Partial<Feeds> = {};
  for (const spec of room.cameras) {
    const cam = makeCamera(spec);
    r.render(scene, cam);
    out[spec.id] = r.domElement.toDataURL("image/jpeg", 0.92);
  }
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const m = obj.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
  return out as Feeds;
}
