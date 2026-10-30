// Tool icons, the object library (categories, search, thumbnails rendered from the real 3D models).
import * as THREE from 'three';
import * as M from './models.js';
import { buildLogger } from './logger.js';

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICON = {
  select: svg('<path d="M5 3l13 8-6 1.5L9 19z"/>'),
  move: svg('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  scale: svg('<rect x="3" y="11" width="10" height="10" rx="1"/><path d="M13 11l8-8M15 3h6v6"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 12v-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L8 14"/>'),
  orbit: svg('<ellipse cx="12" cy="12" rx="9" ry="4"/><circle cx="12" cy="12" r="2.2"/><path d="M19 8.5l2-.5-.5 2"/>'),
  floor: svg('<path d="M3 15l9-5 9 5-9 5z"/><path d="M7.5 12.5l9 5M12 10l-4.5 7.5" opacity=".6"/>'),
  wall: svg('<path d="M3 20V8l9-4 9 4v12"/><path d="M3 12h18M3 16h18M8 8v4M16 8v4M12 12v4M8 16v4M16 16v4"/>'),
  logger: svg('<rect x="8" y="2.5" width="8" height="19" rx="3"/><rect x="9.8" y="6.5" width="4.4" height="3.4" rx=".5"/><circle cx="10.4" cy="13.5" r="1"/><circle cx="13.6" cy="13.5" r="1"/>'),
  rack: svg('<path d="M4 21V3M20 21V3M4 8h16M4 14h16"/><rect x="6" y="9.5" width="5" height="4.5"/><rect x="13" y="15.5" width="5" height="5.5"/>'),
  door: svg('<path d="M5 21V3h11v18M5 21h14"/><circle cx="13" cy="12" r=".8" fill="currentColor"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  alignL: svg('<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>'),
  alignR: svg('<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>'),
  alignT: svg('<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>'),
  alignB: svg('<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>'),
  alignHC: svg('<path d="M12 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="8.5" y="14" width="7" height="4" rx="1"/>'),
  alignVC: svg('<path d="M3 12h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="8.5" width="4" height="7" rx="1"/>'),
  alignC: svg('<path d="M12 3v18M3 12h18" opacity=".55"/><rect x="7" y="7" width="10" height="10" rx="1"/>'),
  distH: svg('<path d="M3 4v16M21 4v16"/><rect x="9" y="8" width="6" height="8" rx="1"/>'),
  distV: svg('<path d="M4 3h16M4 21h16"/><rect x="8" y="9" width="8" height="6" rx="1"/>'),
};

// the library: what can be placed, grouped by category
export const LIBRARY = [
  { cat: 'Structure', items: [
    { key: 'tool:floor', name: 'Floor', tip: 'Drag on the ground to draw a floor slab (F)', icon: 'floor' },
    { key: 'tool:wall', name: 'Wall', tip: 'Drag to draw a wall; ends snap to the grid and to other walls (W)', icon: 'wall' } ] },
  { cat: 'Storage', items: [
    { key: 'rack', name: 'Pallet rack', tip: 'Selective pallet rack: set bays, levels, level height and beam rating', thumb: 'rack' } ] },
  { cat: 'Doors', items: [
    { key: 'door:swing', name: 'Door', tip: 'Hinged personnel door, 1.0 × 2.1 m; place it on a wall', thumb: 'door:swing' },
    { key: 'door:hslide', name: 'Sliding door', tip: 'Horizontal sliding door, 3.0 × 3.0 m; the leaf slides along the wall', thumb: 'door:hslide' },
    { key: 'door:vslide', name: 'Roller door', tip: 'Vertical roller door, 3.0 × 3.2 m; the curtain rolls up into the drum', thumb: 'door:vslide' } ] },
  { cat: 'Loads', items: Object.entries(M.ITEMS).map(([k, it]) => ({ key: 'item:' + k, name: it.name, tip: `${it.name} on a EUR pallet · ${it.kg} kg · ${Math.round(it.h*100)} cm tall`, thumb: 'item:' + k })) },
  { cat: 'Monitoring', items: [
    { key: 'tool:logger', name: 'Data logger', tip: 'Elitech RC-5 temperature logger: click a rack or a wall to place one (L)', thumb: 'logger' } ] },
];

// thumbnails: render each model once into a small image with its own short-lived renderer
export function renderThumbs(size = 72){
  const out = {};
  let r;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return out; }
  r.setPixelRatio(2); r.setSize(size, size); r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9c2b2', 2)); const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(4, 6, 5); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, .01, 100);
  const shot = obj => {
    scene.add(obj); const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
    cam.position.copy(c).add(new THREE.Vector3(.75, .55, 1).normalize().multiplyScalar(s*1.85)); cam.lookAt(c); cam.updateProjectionMatrix();
    r.render(scene, cam); const url = r.domElement.toDataURL('image/png'); scene.remove(obj); return url; };
  out.rack = shot(M.buildRack({ x: 0, z: 0, rot: 0, bays: 1, levels: 2, pitch: 1.4, rating: 1, loads: [{ b: 0, l: 1, p: 0, item: 'carton' }, { b: 0, l: 0, p: 1, item: 'tote' }] }));
  for (const k of Object.keys(M.ITEMS)) out['item:' + k] = shot(M.buildItem(k));
  for (const t of Object.keys(M.DOOR_TYPES)){
    const T = M.DOOR_TYPES[t], w = { x1: 0, z1: 0, x2: T.w*2.6, z2: 0, h: T.h + .6, t: .2 }, g = new THREE.Group();
    const d = { type: t, t: T.w*.85, w: T.w, h: T.h, open: false }; g.add(M.buildWall(w, [d], M.mat('#d5d8db'))); const dg = M.buildDoor(d, w); dg.position.set(0, 0, 0); g.add(dg);
    out['door:' + t] = shot(g); }
  const lg = buildLogger(); lg.userData.setReading(4.6); lg.rotation.y = -.5; out.logger = shot(lg);
  r.dispose(); r.forceContextLoss?.();
  return out;
}
