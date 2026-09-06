"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { addContent, buildRoomScene, makeCamera, roomContent, type SceneContent } from "@/lib/scene";
import { PLATFORM_SIZE, SNAPSHOT_INTERVAL } from "@/lib/room";
import type { Platform, Room } from "@/lib/types";

interface Props {
  room: Room;
  guess?: SceneContent | null;
  showTruth?: boolean;
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

/** An arrow from the platform's centre showing where it will be at the second snapshot. */
function velocityArrow(platform: Platform, color: number): THREE.ArrowHelper {
  const v = new THREE.Vector3(...platform.velocity);
  const len = v.length() * SNAPSHOT_INTERVAL;
  const origin = new THREE.Vector3(...platform.position).addScaledVector(new THREE.Vector3(...platform.normal), PLATFORM_SIZE[1]);
  return new THREE.ArrowHelper(v.normalize(), origin, Math.max(len, 0.02), color, 0.03, 0.02);
}

export default function RoomViewer({ room, guess, showTruth = true }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = buildRoomScene(room);
    // Walls face inward, so the near walls are culled while orbiting and you can see inside.
    if (showTruth) {
      addContent(scene, roomContent(room));
      if (room.platform) scene.add(velocityArrow(room.platform, 0xffffff));
    }
    if (guess && (guess.objects.length || guess.platform)) {
      addContent(scene, guess, { ghost: true });
      if (guess.platform) scene.add(velocityArrow(guess.platform, 0xffd166));
    }

    // Camera frusta + labels
    for (const spec of room.cameras) {
      const cam = makeCamera(spec);
      cam.far = 0.35;
      cam.updateProjectionMatrix();
      const helper = new THREE.CameraHelper(cam);
      scene.add(helper);
      const label = makeLabel(spec.id, spec.id === "A" ? "#ffd166" : "#8ecae6");
      label.position.set(...spec.position);
      label.position.y += 0.06;
      scene.add(label);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 16, 12),
        new THREE.MeshBasicMaterial({ color: spec.id === "A" ? 0xffd166 : 0x8ecae6 }),
      );
      marker.position.set(...spec.position);
      scene.add(marker);
    }

    const axes = new THREE.AxesHelper(0.25);
    axes.position.set(0, 0.002, 0);
    scene.add(axes);

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
      controls.update();
      renderer.render(scene, viewCam);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
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
  }, [room, guess, showTruth]);

  return <div ref={mountRef} className="h-full w-full" />;
}
