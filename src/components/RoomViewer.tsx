"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { addObjects, buildRoomScene, makeCamera, type SceneObject } from "@/lib/scene";
import type { Room } from "@/lib/types";

interface Props {
  room: Room;
  guess?: SceneObject[] | null;
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
    if (showTruth) addObjects(scene, room.objects);
    if (guess && guess.length) addObjects(scene, guess, { ghost: true });

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

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      viewCam.aspect = w / h;
      viewCam.updateProjectionMatrix();
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
