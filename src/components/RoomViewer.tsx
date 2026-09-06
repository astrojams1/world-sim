"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { addObjects, buildRoomScene, makeCamera, makePlatformMesh, roomContent, type SceneContent } from "@/lib/scene";
import { SNAPSHOT_INTERVAL } from "@/lib/room";
import type { Platform, Room } from "@/lib/types";

interface Props {
  room: Room;
  /** The model's answer, already re-expressed in the truth's room frame (alignGuessToTruth). When given, the
   * canvas is split by a movable divider: the truth is drawn left of it and the guess right of it, through the
   * same camera, so anything that jumps at the divider is an error. */
  guess?: SceneContent | null;
}

/** In platform mode the objects glide from the first snapshot to the second (SNAPSHOT_INTERVAL later), hold
 * there, and start again: the motion the four images encode, as a loop. Wall-clock milliseconds per cycle. */
const LOOP_MOVE_MS = 2000;
const LOOP_HOLD_MS = 800;
function loopTime(nowMs: number): number {
  const phase = nowMs % (LOOP_MOVE_MS + LOOP_HOLD_MS);
  return phase < LOOP_MOVE_MS ? (phase / LOOP_MOVE_MS) * SNAPSHOT_INTERVAL : SNAPSHOT_INTERVAL;
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, 128, 64);
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(0.12, 0.06, 1);
  return sprite;
}

/** An arrow on the platform showing how far everything on it moves by the second snapshot. */
function velocityArrow(platform: Platform, color: number): THREE.ArrowHelper {
  const v = new THREE.Vector3(...platform.velocity);
  const len = v.length() * SNAPSHOT_INTERVAL;
  const origin = new THREE.Vector3(...platform.position).addScaledVector(new THREE.Vector3(...platform.normal), 0.01);
  return new THREE.ArrowHelper(v.normalize(), origin, Math.max(len, 0.02), color, 0.03, 0.02);
}

export default function RoomViewer({ room, guess }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // where the truth|guess divider sits, as a fraction of the canvas width (0 = all guess, 1 = all truth)
  const [split, setSplit] = useState(0.5);
  const splitRef = useRef(split);
  useEffect(() => {
    splitRef.current = split;
  }, [split]);
  const hasGuess = Boolean(guess && (guess.objects.length || guess.platform));
  // the two cameras' frusta and labels are optional and off by default
  const [showCameras, setShowCameras] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true; // the platform plane is clipped to the room
    mount.appendChild(renderer.domElement);

    // Two scenes with the same room: the truth's content and the guess's content, drawn solid in both, rendered
    // side by side through one camera with a scissor split. Objects riding a platform are animated along its
    // velocity (truth and guess each with their own).
    const moving: Array<{ mesh: THREE.Object3D; base: THREE.Vector3; velocity: THREE.Vector3 }> = [];
    const build = (content: SceneContent, arrowColor: number) => {
      const scene = buildRoomScene(room);
      if (content.platform) scene.add(makePlatformMesh(content.platform));
      const group = addObjects(scene, content.objects);
      if (content.platform) {
        const velocity = new THREE.Vector3(...content.platform.velocity);
        for (const mesh of group.children) moving.push({ mesh, base: mesh.position.clone(), velocity });
        scene.add(velocityArrow(content.platform, arrowColor));
      }
      return scene;
    };
    const scene = build(roomContent(room), 0xffffff);
    const guessScene = hasGuess && guess ? build(guess, 0xffd166) : null;
    const scenes = guessScene ? [scene, guessScene] : [scene];

    // Camera frusta + labels (optional)
    if (showCameras) for (const s of scenes) for (const spec of room.cameras) {
      const cam = makeCamera(spec);
      cam.far = 0.35;
      cam.updateProjectionMatrix();
      const helper = new THREE.CameraHelper(cam);
      s.add(helper);
      const label = makeLabel(spec.id, spec.id === "A" ? "#ffd166" : "#8ecae6");
      label.position.set(...spec.position);
      label.position.y += 0.06;
      s.add(label);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 16, 12),
        new THREE.MeshBasicMaterial({ color: spec.id === "A" ? 0xffd166 : 0x8ecae6 }),
      );
      marker.position.set(...spec.position);
      s.add(marker);
    }

    for (const s of scenes) {
      const axes = new THREE.AxesHelper(0.25);
      axes.position.set(0, 0.002, 0);
      s.add(axes);
    }

    const viewCam = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
    viewCam.position.set(-1.2, 1.6, 2.3);
    const controls = new OrbitControls(viewCam, renderer.domElement);
    controls.target.set(0.5, 0.3, 0.5);
    controls.enableDamping = true;
    controls.minDistance = 0.3;
    controls.maxDistance = 6;
    // On touch screens a one-finger vertical swipe scrolls the page; horizontal drags orbit and two fingers zoom.
    renderer.domElement.style.touchAction = "pan-y";
    let interacted = false;
    controls.addEventListener("start", () => {
      interacted = true;
    });

    /** Move the view camera back (along its current direction) until the whole room fits the canvas. */
    const fit = () => {
      const vfov = (viewCam.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * viewCam.aspect);
      const radius = 1.0; // the room plus a little margin, around the orbit target
      const distance = radius / Math.sin(Math.min(vfov, hfov) / 2);
      const dir = viewCam.position.clone().sub(controls.target).normalize();
      viewCam.position.copy(controls.target).addScaledVector(dir, distance);
    };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      // updateStyle stays on: on a 2x/3x phone screen the drawing buffer is larger than the CSS box, and the
      // canvas must still be laid out at the box's size or it overflows and looks zoomed in
      renderer.setSize(w, h);
      viewCam.aspect = w / h;
      viewCam.updateProjectionMatrix();
      if (!interacted) fit();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const tick = () => {
      if (moving.length) {
        const t = loopTime(performance.now());
        for (const m of moving) m.mesh.position.copy(m.base).addScaledVector(m.velocity, t);
      }
      controls.update();
      if (guessScene) {
        // same camera and viewport for both; only the scissor differs, so the two halves line up exactly
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        const x = Math.round(w * splitRef.current);
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, w, h);
        renderer.setScissor(0, 0, x, h);
        renderer.render(scene, viewCam);
        renderer.setScissor(x, 0, w - x, h);
        renderer.render(guessScene, viewCam);
        renderer.setScissorTest(false);
      } else {
        renderer.render(scene, viewCam);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const s of scenes)
        s.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const m = o.material as THREE.Material | THREE.Material[];
            if (Array.isArray(m)) m.forEach((x) => x.dispose());
            else m.dispose();
          }
        });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [room, guess, hasGuess, showCameras]);

  // Dragging the divider (mouse or touch) moves the split; the range input below does the same and is the
  // keyboard-accessible control.
  const dragging = useRef(false);
  const setFromClientX = (clientX: number) => {
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      <label className="absolute bottom-2 right-2 z-10 flex min-h-6 items-center gap-1 text-xs text-white/70">
        <input type="checkbox" className="h-4 w-4" checked={showCameras} onChange={(e) => setShowCameras(e.target.checked)} />
        cameras
      </label>
      {hasGuess && (
        // the divider: a hairline with a wide invisible grip; drag it, or focus it and use the arrow keys
        <div
          role="slider"
          aria-label="Truth versus guess divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-col-resize touch-none outline-none focus-visible:bg-white/10"
          style={{ left: `${split * 100}%` }}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromClientX(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 0.02));
            if (e.key === "ArrowRight") setSplit((s) => Math.min(1, s + 0.02));
          }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/80" />
          <div className="absolute right-full top-2 mr-2 text-xs text-white/80">truth</div>
          <div className="absolute left-full top-2 ml-2 text-xs text-amber-200">guess</div>
        </div>
      )}
    </div>
  );
}
