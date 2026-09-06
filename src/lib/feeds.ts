import * as THREE from "three";
import { FEED_HEIGHT, FEED_WIDTH, SNAPSHOT_INTERVAL } from "./room";
import { addContent, buildRoomScene, makeCamera, roomContent, type SceneContent } from "./scene";
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
    renderer.localClippingEnabled = true; // the platform plane is clipped to the room
  }
  return renderer;
}

/**
 * Camera feeds: A and B are the two cameras' first snapshots; in platform mode A2 and B2 are the same cameras'
 * second snapshots, SNAPSHOT_INTERVAL later (the cameras do not move; the platform and its objects do).
 */
export type FeedId = "A" | "B" | "A2" | "B2";
export interface Feeds {
  A: string;
  B: string;
  A2?: string;
  B2?: string;
}

export function feedIds(room: Pick<Room, "mode">): FeedId[] {
  return room.mode === "platform" ? ["A", "B", "A2", "B2"] : ["A", "B"];
}

/** The camera and the snapshot time of a feed. */
export function feedInfo(id: FeedId): { camera: "A" | "B"; t: number } {
  return { camera: id[0] as "A" | "B", t: id.endsWith("2") ? SNAPSHOT_INTERVAL : 0 };
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const m = obj.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}

/** Render the camera feeds for a room, optionally substituting the content (e.g. a guess) for the room's own. */
export function renderFeeds(room: Room, content: SceneContent = roomContent(room)): Feeds {
  const r = getRenderer();
  const out: Partial<Feeds> = {};
  const times = room.mode === "platform" ? [0, SNAPSHOT_INTERVAL] : [0];
  for (const t of times) {
    const scene = buildRoomScene(room);
    addContent(scene, content, { t });
    for (const spec of room.cameras) {
      const cam = makeCamera(spec);
      r.render(scene, cam);
      out[t ? (`${spec.id}2` as FeedId) : spec.id] = r.domElement.toDataURL("image/jpeg", 0.92);
    }
    disposeScene(scene);
  }
  return out as Feeds;
}
