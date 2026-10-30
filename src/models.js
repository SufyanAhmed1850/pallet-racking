// 3D models for the warehouse builder. Units are metres, y is up, the floor's top is y = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ---------- materials and canvas textures (shared, built once) ---------- */
const matCache = new Map();
export function mat(color, opts = {}){
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .05, ...opts }));
  return matCache.get(key);
}
function canvasTex(w, h, draw, repeat){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
const texCache = new Map();
const tex = (key, make) => { if (!texCache.has(key)) texCache.set(key, make()); return texCache.get(key); };

const TEX = {
  carton: () => tex('carton', () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c99a62'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a6438'; g.lineWidth = 3;
    for (let i = 1; i < 3; i++){ g.beginPath(); g.moveTo(i*w/3, 0); g.lineTo(i*w/3, h); g.stroke(); g.beginPath(); g.moveTo(0, i*h/3); g.lineTo(w, i*h/3); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, h*.15, w, h*.7);              // stretch wrap sheen
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 4; g.beginPath(); g.moveTo(w*.1, h*.85); g.lineTo(w*.55, h*.2); g.stroke();
  })),
  tote: () => tex('tote', () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3f9f6e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1f5a3c'; g.lineWidth = 4;
    for (let k = 0; k < 3; k++){ const y = (k + 1)*h/3; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.moveTo(0, y - 10); g.lineTo(w, y - 10); g.stroke(); g.lineWidth = 4;
      for (let j = 0; j < 2; j++){ g.fillStyle = '#1f5a3c'; g.fillRect(w*(j + .5)/2 - 18, y - h/3 + 14, 36, 12); } }
    g.beginPath(); g.moveTo(w/2, 0); g.lineTo(w/2, h); g.stroke();
  })),
  crate: () => tex('crate', () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8b276'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a07b45'; g.lineWidth = 22; g.strokeRect(11, 11, w - 22, h - 22);
    g.beginPath(); g.moveTo(16, h - 16); g.lineTo(w - 16, 16); g.stroke();
    g.fillStyle = '#a8322a'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('FRAGILE', w/2, h/2 + 40);
  })),
  sack: () => tex('sack', () => canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#ece6d4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,140,110,.35)'; g.lineWidth = 1;
    for (let i = 0; i < w; i += 4){ g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    g.fillStyle = '#3b6fb6'; g.fillRect(w*.2, h*.38, w*.6, h*.24);
  }, true)),
  mesh: () => tex('mesh', () => { const t = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#7d878c'; g.lineWidth = 3;
    for (let i = 0; i <= w; i += 21){ g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
  }); return t; }),
  slots: () => tex('slots', () => { const t = canvasTex(32, 64, (g, w, h) => {
    g.fillStyle = '#3f6fbf'; g.fillRect(0, 0, w, h); g.fillStyle = '#1e3766';
    g.fillRect(6, 10, 6, 26); g.fillRect(w - 12, 10, 6, 26); }, true); return t; }),
  slats: () => tex('slats', () => canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#c3cacd'; g.fillRect(0, 0, w, h); g.fillStyle = '#9aa3a7'; g.fillRect(0, h - 8, w, 4);
  }, true)),
  ribs: () => tex('ribs', () => canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#d4d9db'; g.fillRect(0, 0, w, h); g.fillStyle = '#b4bcc0'; g.fillRect(w - 10, 0, 5, h);
  }, true)),
};

/* ---------- small geometry helpers ---------- */
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export function box(w, h, d, material, x = 0, y = 0, z = 0){
  const m = new THREE.Mesh(BOX, material); m.scale.set(w, h, d); m.position.set(x, y, z); return m;
}
// box from its min corner (x0, y0, z0) to max corner
export const boxAt = (x0, y0, z0, x1, y1, z1, material) => box(x1 - x0, y1 - y0, z1 - z0, material, (x0 + x1)/2, (y0 + y1)/2, (z0 + z1)/2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 18);
export function rodBetween(a, b, r, material){
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(CYL, material);
  m.scale.set(r, d.length(), r); m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
function cyl(r, h, material, x, y, z){ const m = new THREE.Mesh(CYL, material); m.scale.set(r, h, r); m.position.set(x, y, z); return m; }

/* ---------- loads: every one sits on a 1200 x 800 EUR pallet footprint (0.8 along x, 1.2 along z) ---------- */
export const ITEMS = {
  pallet: { name:'Empty pallet', kg:25,  h:.144 },
  carton: { name:'Cartons',      kg:420, h:1.10 },
  sack:   { name:'Sacks',        kg:1000, h:.85 },
  drum:   { name:'Drums',        kg:440, h:1.03 },
  tote:   { name:'Totes',        kg:240, h:.90 },
  crate:  { name:'Crate',        kg:560, h:.95 },
  mesh:   { name:'Mesh box',     kg:780, h:.97 },
};
const WOOD = () => mat('#c99e62'), WOOD_D = () => mat('#a8814c');
function pallet(){
  const g = new THREE.Group();
  for (const x of [-.35, 0, .35]){
    g.add(box(.1, .022, 1.2, WOOD_D(), x, .011, 0));
    for (const z of [-.525, 0, .525]) g.add(box(.1, .078, .145, WOOD_D(), x, .061, z));
  }
  for (const x of [-.34, -.17, 0, .17, .34]) g.add(box(.12, .022, 1.2, WOOD(), x, .133, 0));
  g.add(box(.8, .022, .1, WOOD(), 0, .111, -.55)); g.add(box(.8, .022, .1, WOOD(), 0, .111, 0)); g.add(box(.8, .022, .1, WOOD(), 0, .111, .55));
  return g;
}
export function buildItem(type){
  const g = new THREE.Group(), H = ITEMS[type].h, P = .144;
  if (type !== 'mesh') g.add(pallet());
  if (type === 'carton') g.add(box(.78, H - P, 1.18, mat('#ffffff', { map: TEX.carton() }), 0, P + (H - P)/2, 0));
  else if (type === 'tote') g.add(box(.8, H - P, 1.2, mat('#ffffff', { map: TEX.tote() }), 0, P + (H - P)/2, 0));
  else if (type === 'crate') g.add(box(.76, H - P, 1.16, mat('#ffffff', { map: TEX.crate() }), 0, P + (H - P)/2, 0));
  else if (type === 'sack'){
    // 20 sacks in 5 interlocked layers of 4: lengthwise pairs, then crosswise pairs
    const sg = new RoundedBoxGeometry(.39, .135, .58, 3, .05), sm = mat('#ffffff', { map: TEX.sack() });
    const lengthwise = [[-.2, -.3], [.2, -.3], [-.2, .3], [.2, .3]], crosswise = [[0, -.45], [0, -.15], [0, .15], [0, .45]];
    for (let k = 0; k < 5; k++) for (const [x, z] of (k % 2 ? crosswise : lengthwise)){
      const s = new THREE.Mesh(sg, sm); s.position.set(x, P + .07 + k*.14, z);
      if (k % 2){ s.rotation.y = Math.PI/2; s.scale.set(.74, 1, 1.36); } g.add(s); }
  } else if (type === 'drum'){
    const dm = mat('#2f5fa8', { metalness: .35, roughness: .5 }), lid = mat('#4c7fcb', { metalness: .35, roughness: .45 }), rib = mat('#22467f', { metalness: .4 });
    for (const z of [-.3, .3]){ g.add(cyl(.29, .86, dm, 0, P + .43, z)); g.add(cyl(.292, .02, lid, 0, P + .87, z));
      for (const y of [.29, .58]) g.add(cyl(.296, .025, rib, 0, P + y, z)); g.add(cyl(.03, .02, mat('#d9dde0'), .15, P + .885, z)); }
  } else if (type === 'mesh'){
    const galv = mat('#aab2b5', { metalness: .5, roughness: .45 }), x0 = -.4175, x1 = .4175, z0 = -.62, z1 = .62, zb = .14, zt = .97;
    for (const [x, z] of [[x0 + .045, z0 + .045], [x1 - .045, z0 + .045], [x0 + .045, z1 - .045], [x1 - .045, z1 - .045]]) g.add(box(.09, .1, .09, galv, x, .05, z));
    g.add(box(.835, .04, 1.24, galv, 0, zb - .02, 0));
    g.add(box(.76, .5, 1.14, mat('#8f9aa1', { metalness: .4, roughness: .5 }), 0, zb + .25, 0));          // contents
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) g.add(box(.03, zt - zb, .03, galv, x, (zb + zt)/2, z));
    const wm = mat('#ffffff', { map: TEX.mesh(), transparent: true, side: THREE.DoubleSide, alphaTest: .3 }), wh = zt - zb;
    const plane = (w, rotY, x, z) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, wh), wm); p.rotation.y = rotY; p.position.set(x, zb + wh/2, z); g.add(p); };
    plane(.835, 0, 0, z1); plane(.835, 0, 0, z0); plane(1.24, Math.PI/2, x1, 0); plane(1.24, Math.PI/2, x0, 0);
    for (const y of [zt, zb]) for (const z of [z0, z1]) g.add(box(.835, .02, .02, galv, 0, y, z));
    for (const y of [zt]) for (const x of [x0, x1]) g.add(box(.02, .02, 1.24, galv, x, y, 0));
  }
  g.userData.h = H;
  return g;
}

/* ---------- selective pallet rack (local: x along the run, z depth with the aisle at +z, y up; origin at the footprint centre) ---------- */
export const RACK = { CS: 1.85, UPW: .09, UPD: .07, D: 1.1, GAP: .075, RAT: [{ kg:1000, h:.10 }, { kg:2000, h:.12 }, { kg:3000, h:.14 }] };
RACK.BP = RACK.CS + RACK.UPW; RACK.CLR = (RACK.CS - 1.6)/3;
// Beam sag: a beam pair bends elastically, up to L/200 at its rated load (1850 mm span -> 9.25 mm). It is drawn
// SAG_EXAG times deeper so it can be seen. A pallet position sits SAG_POS of the way to the mid-span dip.
RACK.SAG_MM = RACK.CS*1000/200; RACK.SAG_EXAG = 4; RACK.SAGV = RACK.SAG_MM/1000*RACK.SAG_EXAG;
export const sagShape = u => 4*u*(1 - u);
RACK.SAG_POS = sagShape((RACK.CLR + .4)/RACK.CS);
// bend a beam made by buildRack (its own segmented geometry) down by s metres at mid-span
export function bendBeam(mesh, s){
  if (mesh.userData.bent === s) return; mesh.userData.bent = s;
  const pos = mesh.geometry.attributes.position, base = mesh.userData.base, CS = RACK.CS;
  for (let i = 0; i < pos.count; i++) pos.array[i*3 + 1] = base[i*3 + 1] - s*sagShape((base[i*3] + CS/2)/CS);
  pos.needsUpdate = true; mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
}
export const rackWidth = r => r.bays*RACK.BP + RACK.UPW;
export const rackHeight = r => r.levels*r.pitch + .25;
export function slotLocal(r, b, l, p){
  const x0 = -rackWidth(r)/2 + b*RACK.BP + RACK.UPW;
  return new THREE.Vector3(x0 + (p ? RACK.CS - RACK.CLR - .4 : RACK.CLR + .4), l*r.pitch, 0);
}
export function rackCheck(r, b, l, type, ignoreIndex = -1){
  const it = ITEMS[type], bh = RACK.RAT[r.rating].h, cap = RACK.RAT[r.rating].kg;
  if (b < 0 || b >= r.bays || l < 0 || l > r.levels) return 'No such position';
  if (l > 0){ const load = r.loads.filter((x, i) => i !== ignoreIndex && x.b === b && x.l === l).reduce((a, x) => a + ITEMS[x.item].kg, 0) + it.kg;
    if (load > cap) return `Over the beam rating: ${load} kg on a ${cap} kg level`; }
  if (l < r.levels && it.h + RACK.GAP > r.pitch - bh) return `Too tall: needs ${Math.round((it.h + RACK.GAP)*100)} cm, the level has ${Math.round((r.pitch - bh)*100)} cm`;
  return '';
}
export function buildRack(r){
  const g = new THREE.Group(), { CS, UPW, UPD, D, BP } = RACK, W = rackWidth(r), H = rackHeight(r), bh = RACK.RAT[r.rating].h;
  const up = mat('#ffffff', { map: TEX.slots() }), blue = mat('#3f6fbf'), orange = mat('#e8642c'), yellow = mat('#f2c230'), galv = mat('#b7bec1', { metalness: .4 });
  const slotTex = TEX.slots().clone(); slotTex.needsUpdate = true; slotTex.repeat.set(1, H/.1);
  const upM = new THREE.MeshStandardMaterial({ map: slotTex, roughness: .7 });
  for (let j = 0; j <= r.bays; j++){
    const x = -W/2 + j*BP + UPW/2;
    for (const z of [D/2 - UPD/2, -D/2 + UPD/2]){
      const u = box(UPW, H - .01, UPD, upM, x, .01 + (H - .01)/2, z); u.userData.part = 'upright'; g.add(u);
      g.add(box(.15, .01, .13, galv, x, .005, z));
      if (z > 0){ const gd = box(.12, .4, .035, yellow, x, .21, D/2 + .03); gd.userData.part = 'guard'; g.add(gd); }
    }
    // frame bracing between the front and back upright
    const za = -D/2 + UPD, zb = D/2 - UPD, n = Math.max(1, Math.round((H - .3)/.95)), dz = (H - .3)/n;
    g.add(rodBetween(new THREE.Vector3(x, .15, za), new THREE.Vector3(x, .15, zb), .016, blue));
    g.add(rodBetween(new THREE.Vector3(x, H - .15, za), new THREE.Vector3(x, H - .15, zb), .016, blue));
    for (let i = 0; i < n; i++) g.add(rodBetween(new THREE.Vector3(x, .15 + i*dz, i % 2 ? zb : za), new THREE.Vector3(x, .15 + (i + 1)*dz, i % 2 ? za : zb), .014, blue));
  }
  g.userData.beams = []; g.userData.loadGroups = [];
  for (let b = 0; b < r.bays; b++){
    const xc = -W/2 + b*BP + UPW + CS/2;
    for (let l = 1; l <= r.levels; l++){
      const y = l*r.pitch - bh/2;
      for (const z of [D/2 - .03, -D/2 + .03]){
        // each beam has its own segmented box so it can bend along its span
        const geo = new THREE.BoxGeometry(CS, bh, .05, 16, 1, 1), bm = new THREE.Mesh(geo, orange);
        bm.position.set(xc, y, z); bm.userData = { part: 'beam', bay: b, level: l, base: geo.attributes.position.array.slice() };
        g.add(bm); g.userData.beams.push(bm);
        for (const ex of [xc - CS/2 + .02, xc + CS/2 - .02]) g.add(box(.04, bh + .08, .06, orange, ex, y - .03, z));
      }
    }
  }
  // load notice across the end frame
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(.9, .3), new THREE.MeshStandardMaterial({ map: signTex(r), roughness: .6 }));
  sign.position.set(-W/2 - .002, Math.min(1.1, H - .4), 0); sign.rotation.y = -Math.PI/2; g.add(sign);
  // loads on their positions
  r.loads.forEach((ld, i) => { const it = buildItem(ld.item), p = slotLocal(r, ld.b, ld.l, ld.p); it.position.copy(p);
    it.userData.slot = { b: ld.b, l: ld.l, p: ld.p, index: i, baseY: p.y };
    it.traverse(o => { if (o.isMesh) o.userData.load = i; }); g.add(it); g.userData.loadGroups.push(it); });
  return g;
}
function signTex(r){
  return canvasTex(512, 170, (g, w, h) => {
    g.fillStyle = '#fbfaf3'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2483d'; g.fillRect(0, 0, w, 42);
    g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('SAFE WORKING LOAD', w/2, 30);
    g.fillStyle = '#231e16'; g.font = 'bold 38px sans-serif'; g.fillText(`${RACK.RAT[r.rating].kg} KG PER LEVEL`, w/2, 92);
    g.font = '24px sans-serif'; g.fillText(`${RACK.RAT[r.rating].kg*r.levels} KG PER BAY  ·  ${r.levels} LEVELS`, w/2, 140);
  });
}

/* ---------- floor and walls ---------- */
export function buildFloor(f){
  const g = new THREE.Group(), s = box(f.w, .15, f.d, mat('#cbc6bb'), 0, -.075, 0); s.userData.part = 'floor'; g.add(s);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(f.w, .15, f.d)), new THREE.LineBasicMaterial({ color: '#9c968a' }));
  edge.position.y = -.075; g.add(edge);
  return g;
}
export const wallLen = w => Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
export const wallAngle = w => Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
// a wall in its own frame: x along it from 0 to L, y up, z across its thickness; door openings are left out
export function buildWall(w, doors, wallMat){
  const g = new THREE.Group(), L = wallLen(w), ops = doors.map(d => [d.t - d.w/2, d.t + d.w/2, d.h]).sort((a, b) => a[0] - b[0]);
  let x = 0;
  const piece = (x0, x1, y0, y1) => { if (x1 - x0 < .001 || y1 - y0 < .001) return; const m = boxAt(x0, y0, -w.t/2, x1, y1, w.t/2, wallMat); m.userData.part = 'wall'; g.add(m); };
  for (const [a, b, h] of ops){ piece(x, Math.max(x, a), 0, w.h); piece(Math.max(a, 0), Math.min(b, L), Math.min(h, w.h), w.h); x = Math.max(x, b); }
  piece(x, L, 0, w.h);
  g.position.set(w.x1, 0, w.z1); g.rotation.y = -wallAngle(w);
  return g;
}

/* ---------- doors (built in the wall's frame; k = how far open, 0..1) ---------- */
export const DOOR_TYPES = {
  swing:  { name:'Door',                    w:1.0, h:2.1 },
  hslide: { name:'Sliding door (horizontal)', w:3.0, h:3.0 },
  vslide: { name:'Roller door (vertical)',    w:3.0, h:3.2 },
};
export function buildDoor(d, wall){
  const g = new THREE.Group(), t = wall.t, frameM = mat('#5b6670'), x0 = d.t - d.w/2, x1 = d.t + d.w/2;
  // frame around the opening
  g.add(boxAt(x0 - .05, 0, -t/2 - .01, x0, d.h + .05, t/2 + .01, frameM));
  g.add(boxAt(x1, 0, -t/2 - .01, x1 + .05, d.h + .05, t/2 + .01, frameM));
  g.add(boxAt(x0 - .05, d.h, -t/2 - .01, x1 + .05, d.h + .05, t/2 + .01, frameM));
  const moving = new THREE.Group(); moving.userData.part = 'leaf'; g.add(moving);
  if (d.type === 'swing'){
    moving.add(box(d.w - .02, d.h - .02, .045, mat('#d9dde0'), (d.w - .02)/2, (d.h - .02)/2, 0));
    for (const z of [.045, -.045]) moving.add(box(.13, .025, .03, mat('#3a3f44'), d.w - .14, 1.05, z));   // lever handles both sides
    moving.position.set(x0 + .01, .01, t/2 - .03);
    g.userData.anim = k => { moving.rotation.y = -k*Math.PI/2; };
  } else if (d.type === 'hslide'){
    const leafM = mat('#ffffff', { map: TEX.ribs() });
    g.add(boxAt(x0 - .1, d.h + .06, t/2 + .02, x1 + d.w + .1, d.h + .14, t/2 + .1, frameM));            // top track
    const leaf = box(d.w + .1, d.h + .04, .06, leafM, 0, (d.h + .04)/2, 0);
    leaf.material = leafM.clone(); leaf.material.map = TEX.ribs().clone(); leaf.material.map.needsUpdate = true; leaf.material.map.repeat.set((d.w + .1)/.3, 1);
    moving.add(leaf); moving.position.set(d.t, 0, t/2 + .06);
    g.userData.anim = k => { moving.position.x = d.t + k*(d.w + .05); };
  } else {
    const slatM = new THREE.MeshStandardMaterial({ map: TEX.slats().clone(), roughness: .6 }); slatM.map.needsUpdate = true; slatM.map.repeat.set(1, d.h/.08);
    g.add(boxAt(x0 - .12, 0, t/2, x0 - .02, d.h + .1, t/2 + .12, frameM)); g.add(boxAt(x1 + .02, 0, t/2, x1 + .12, d.h + .1, t/2 + .12, frameM));   // guides
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, d.w + .3, 20), mat('#8c969c', { metalness: .3 }));
    coil.rotation.z = Math.PI/2; coil.position.set(d.t, d.h + .3, t/2 + .26); g.add(coil);
    const curtain = new THREE.Mesh(BOX, slatM); moving.add(curtain); moving.position.set(d.t, 0, t/2 + .06);
    g.userData.anim = k => { const ch = Math.max(.02, d.h*(1 - k)); curtain.scale.set(d.w + .1, ch, .03); curtain.position.y = d.h + .04 - ch/2;
      slatM.map.repeat.set(1, ch/.08); };
  }
  g.userData.anim(d.open ? 1 : 0);
  return g;
}

/* ---------- ghost copies for placement previews ---------- */
export function ghostify(obj, color = '#2f7de1'){
  obj.traverse(o => { if (o.isMesh || o.isLineSegments){ const m = (o.material.clone ? o.material.clone() : o.material); m.transparent = true; m.opacity = .45; m.depthWrite = false;
    if (m.color && color) m.color.lerp(new THREE.Color(color), .35); o.material = m; o.raycast = () => {}; } });
  return obj;
}
