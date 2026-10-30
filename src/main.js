// Warehouse builder: draw a floor and walls, place racks, doors, loads and data loggers, edit sizes, save layouts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as M from './models.js';
import { buildLogger, makeSim, LOGGER } from './logger.js';

const KEY = 'warehouse-builder-v1';
const $ = s => document.querySelector(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const deg = r => r*180/Math.PI, rad = d => d*Math.PI/180;
const round = (v, n = 3) => +(+v).toFixed(n);

/* ---------- layout state (everything that is saved) ---------- */
const blank = () => ({ v: 1, nextId: 1, seq: { rack: 0, logger: 0 }, ambient: 5, snap: .1, objects: [] });
let S = loadLocal() || blank();
const byId = id => S.objects.find(o => o.id === id);
const ofKind = k => S.objects.filter(o => o.kind === k);
const doorsOf = wallId => S.objects.filter(o => o.kind === 'door' && o.wall === wallId);
const newId = () => S.nextId++;
function loadLocal(){ try { const d = JSON.parse(localStorage.getItem(KEY)); return d && Array.isArray(d.objects) ? d : null; } catch { return null; } }
function saveLocal(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

// undo / redo keep whole-layout snapshots
let undoStack = [], redoStack = [], lastSnap = JSON.stringify(S);
function commit(){
  const now = JSON.stringify(S); if (now === lastSnap) return sync();
  undoStack.push(lastSnap); if (undoStack.length > 120) undoStack.shift(); redoStack = []; lastSnap = now;
  saveLocal(); sync();
}
function undo(){ if (!undoStack.length) return toast('Nothing to undo'); redoStack.push(lastSnap); lastSnap = undoStack.pop(); S = JSON.parse(lastSnap); afterReplace(); }
function redo(){ if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(lastSnap); lastSnap = redoStack.pop(); S = JSON.parse(lastSnap); afterReplace(); }
function afterReplace(){ if (sel && !byId(sel.id)) sel = null; saveLocal(); sync(); renderPanel(); }

/* ---------- renderer, camera, controls ---------- */
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
view.appendChild(renderer.domElement);
const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; view.appendChild(labels.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ece9e2');
const camera = new THREE.PerspectiveCamera(45, 1, .02, 400); camera.position.set(0, 17, 15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = 1.48; controls.minDistance = .12; controls.maxDistance = 150; controls.screenSpacePanning = false;
scene.add(new THREE.HemisphereLight('#ffffff', '#cbc4b4', 1.7));
const sun = new THREE.DirectionalLight('#ffffff', 1.5); sun.position.set(9, 16, 7); scene.add(sun);
const fillL = new THREE.DirectionalLight('#ffffff', .45); fillL.position.set(-10, 6, -8); scene.add(fillL);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#e3dfd6', roughness: 1 }));
ground.rotation.x = -Math.PI/2; ground.position.y = -.16; scene.add(ground);
const grid = new THREE.GridHelper(80, 80, '#b9b2a3', '#d3cdc0'); grid.position.y = .004; scene.add(grid);
const world = new THREE.Group(); scene.add(world);
const overlay = new THREE.Group(); scene.add(overlay);          // ghosts, previews, handles, selection box
function resize(){ const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w/h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view);

/* ---------- building the 3D view from the state ---------- */
const views = new Map();               // id -> { group, sig }
const doorK = new Map();               // id -> how far open (animated)
let wallMode = 'see', showTags = true;
const wallMat = new THREE.MeshStandardMaterial({ color: '#d5d8db', roughness: .9, transparent: true, opacity: .38, depthWrite: false });
function applyWallMode(){ wallMat.opacity = wallMode === 'solid' ? 1 : .38; wallMat.transparent = wallMode !== 'solid'; wallMat.depthWrite = wallMode === 'solid'; wallMat.needsUpdate = true;
  for (const o of ofKind('wall')) { const v = views.get(o.id); if (v) v.group.visible = wallMode !== 'hidden'; }
  for (const o of ofKind('door')) { const v = views.get(o.id); if (v) v.group.visible = wallMode !== 'hidden'; }
  $('#wallmode').textContent = 'Walls: ' + { solid: 'solid', see: 'see-through', hidden: 'hidden' }[wallMode]; }

function signature(o){
  if (o.kind === 'wall') return JSON.stringify([o, doorsOf(o.id)]);
  if (o.kind === 'door') return JSON.stringify([o, byId(o.wall)]);
  if (o.kind === 'logger') return JSON.stringify([o, byId(o.host)]);
  return JSON.stringify(o);
}
function build(o){
  let g;
  if (o.kind === 'floor'){ g = M.buildFloor(o); g.position.set(o.x, 0, o.z); }
  else if (o.kind === 'wall'){ g = M.buildWall(o, doorsOf(o.id), wallMat); g.visible = wallMode !== 'hidden'; }
  else if (o.kind === 'door'){ const w = byId(o.wall); if (!w) return null; g = M.buildDoor(o, w); g.position.set(w.x1, 0, w.z1); g.rotation.y = -M.wallAngle(w);
    if (!doorK.has(o.id)) doorK.set(o.id, o.open ? 1 : 0); g.userData.anim(easeIO(doorK.get(o.id))); g.visible = wallMode !== 'hidden'; }
  else if (o.kind === 'rack'){ g = M.buildRack(o); g.position.set(o.x, 0, o.z); g.rotation.y = rad(o.rot); }
  else if (o.kind === 'item'){ g = M.buildItem(o.item); g.position.set(o.x, 0, o.z); g.rotation.y = rad(o.rot); }
  else if (o.kind === 'logger'){ g = buildLogger(); placeLoggerGroup(g, o);
    const tag = document.createElement('div'); tag.className = 'ltag'; tag.textContent = o.name;
    const lab = new CSS2DObject(tag); lab.position.set(0, .075, 0); lab.center.set(.5, 1); g.add(lab); g.userData.tag = tag; tag.hidden = !showTags;
    tag.addEventListener('pointerdown', e => { e.stopPropagation(); select({ id: o.id }); });
    g.userData.setReading(readings.get(o.id) ?? NaN); }
  if (g){ g.userData.objId = o.id; g.traverse(c => { c.userData.objId = o.id; }); }
  return g;
}
function loggerWorld(o){
  const hv = views.get(o.host); if (!hv) return null;
  hv.group.updateMatrixWorld(true);
  return { p: V3(...o.local).applyMatrix4(hv.group.matrixWorld), n: V3(...o.normal).transformDirection(hv.group.matrixWorld) };
}
function orientLogger(g, p, n){
  const z = n.clone().normalize(), up = Math.abs(z.y) > .9 ? V3(0, 0, -1) : V3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  g.position.copy(p).addScaledVector(z, LOGGER.d/2 + .001);
}
function placeLoggerGroup(g, o){ const w = loggerWorld(o); if (w){ orientLogger(g, w.p, w.n); g.userData.baseY = g.position.y; } }
function sync(){
  const ids = new Set(S.objects.map(o => o.id));
  for (const [id, v] of views) if (!ids.has(id)){ disposeLabels(v.group); world.remove(v.group); views.delete(id); }
  // hosts before the loggers that hang on them
  const order = [...S.objects].sort((a, b) => (a.kind === 'logger') - (b.kind === 'logger'));
  for (const o of order){
    const sig = signature(o), v = views.get(o.id);
    if (v && v.sig === sig) continue;
    if (v){ disposeLabels(v.group); world.remove(v.group); }
    const g = build(o); if (!g){ views.delete(o.id); continue; }
    world.add(g); views.set(o.id, { group: g, sig });
  }
  // a moved rack moves the loggers on it
  for (const o of ofKind('logger')){ const v = views.get(o.id); if (v) placeLoggerGroup(v.group, o); }
  updateSelBox(); updateStats(); $('#empty').hidden = S.objects.length > 0 || mode !== 'select';
}
function disposeLabels(g){ g.traverse(c => { if (c.isCSS2DObject) c.element.remove(); }); }

/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(V3(0, 1, 0), 0);
function setRay(e){ const r = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - r.left)/r.width*2 - 1, -(e.clientY - r.top)/r.height*2 + 1); ray.setFromCamera(ndc, camera); }
function groundAt(e, y = 0){ setRay(e); groundPlane.constant = -y; const p = new THREE.Vector3(); return ray.ray.intersectPlane(groundPlane, p) ? p : null; }
function pick(e, filter = () => true){
  setRay(e);
  const roots = [...views.values()].map(v => v.group).filter(g => g.visible);
  // see-through walls (and their doors) only take the click when nothing else is behind them
  let wallHit = null;
  for (const h of ray.intersectObjects(roots, true)){
    if (!h.object.visible && h.object.userData.part !== 'loggerHit') continue;
    const o = byId(h.object.userData.objId); if (!o || !filter(o, h)) continue;
    if (wallMode !== 'solid' && (o.kind === 'wall' || o.kind === 'door')){ wallHit = wallHit || { o, hit: h }; continue; }
    return { o, hit: h };
  }
  return wallHit;
}
const snapV = v => Math.round(v/S.snap)*S.snap;

/* ---------- modes ---------- */
let mode = 'select', placeKind = null, ghost = null, ghostRot = 0, drag = null, sel = null;
const HINTS = {
  select: 'Click to select · drag to move · R rotate · Delete remove · drag empty space to orbit, right-drag to pan, wheel to zoom',
  floor: 'Drag on the ground to draw a floor · Esc to stop',
  wall: 'Drag to draw a wall · ends snap to the grid and to other walls · Esc to stop',
  place: 'Click to place · R rotate · Esc to stop',
  logger: 'Click a rack (or a wall) to put a logger on that spot · Esc to stop',
};
function setMode(m, kind = null){
  mode = m; placeKind = kind; clearGhost(); drag = null;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m && (m !== 'place' || b.dataset.kind === kind)));
  $('#hint').textContent = HINTS[m];
  view.style.cursor = m === 'select' ? 'default' : 'crosshair';
  $('#empty').hidden = S.objects.length > 0 || m !== 'select';
}
function clearGhost(){ if (ghost){ overlay.remove(ghost); ghost = null; } overlay.children.filter(c => c.userData.preview).forEach(c => overlay.remove(c)); }

/* ---------- selection ---------- */
const selBox = new THREE.Box3Helper(new THREE.Box3(), '#2f7de1'); selBox.visible = false; overlay.add(selBox);
const handles = [];
function select(s){ sel = s; updateSelBox(); renderPanel(); }
function selGroup(){
  if (!sel) return null; const v = views.get(sel.id); if (!v) return null;
  if (sel.load != null){ let found = null; v.group.traverse(c => { if (!found && c.isMesh && c.userData.load === sel.load) found = c.parent; }); return found; }
  return v.group;
}
function updateSelBox(){
  for (const h of handles) overlay.remove(h); handles.length = 0;
  const g = selGroup(); selBox.visible = !!g;
  if (!g) return;
  const o = byId(sel.id);
  if (o.kind === 'logger'){ selBox.visible = false; return; }
  g.updateMatrixWorld(true); selBox.box.setFromObject(g, true);
  if (o.kind === 'wall') for (const end of [1, 2]){
    const hm = new THREE.Mesh(new THREE.SphereGeometry(.14, 16, 12), new THREE.MeshBasicMaterial({ color: '#2f7de1' }));
    hm.position.set(o['x' + end], o.h + .15, o['z' + end]); hm.userData.handle = end; overlay.add(hm); handles.push(hm); }
}

/* ---------- placing and dragging loads (from the palette, off a rack, or off the floor) ---------- */
function rackSlots(itemType, skip){
  const out = [];
  for (const r of ofKind('rack')){ const v = views.get(r.id); if (!v) continue; v.group.updateMatrixWorld(true);
    for (let b = 0; b < r.bays; b++) for (let l = 0; l <= r.levels; l++) for (const p of [0, 1]){
      const idx = r.loads.findIndex(x => x.b === b && x.l === l && x.p === p);
      if (idx >= 0 && !(skip && skip.rack === r.id && skip.index === idx)) continue;
      const ignore = skip && skip.rack === r.id ? skip.index : -1;
      const local = M.slotLocal(r, b, l, p), w = local.clone().applyMatrix4(v.group.matrixWorld);
      out.push({ rack: r, b, l, p, world: w, why: M.rackCheck(r, b, l, itemType, ignore) });
    } }
  return out;
}
// where a load would land for this pointer: the nearest free rack position on screen (within reach), else the floor
function loadTarget(e, itemType, skip){
  const rect = renderer.domElement.getBoundingClientRect(); let best = null, bd = 70*70;
  for (const s of rackSlots(itemType, skip)){
    const q = s.world.clone(); q.y += M.ITEMS[itemType].h/2; q.project(camera);
    const sx = (q.x + 1)/2*rect.width + rect.left, sy = (1 - q.y)/2*rect.height + rect.top, d = (sx - e.clientX)**2 + (sy - e.clientY)**2;
    if (q.z < 1 && d < bd){ bd = d; best = s; } }
  if (best) return { slot: best };
  const p = groundAt(e); return p ? { floor: V3(snapV(p.x), 0, snapV(p.z)) } : null;
}
function showLoadGhost(itemType, tgt){
  if (!ghost || ghost.userData.type !== itemType){ clearGhost(); ghost = M.ghostify(M.buildItem(itemType)); ghost.userData.type = itemType; overlay.add(ghost); }
  overlay.children.filter(c => c.userData.preview).forEach(c => overlay.remove(c));
  if (!tgt){ ghost.visible = false; return; } ghost.visible = true;
  if (tgt.slot){ const s = tgt.slot; ghost.position.copy(s.world); ghost.position.y += .04; ghost.rotation.y = rad(s.rack.rot);
    const b = new THREE.Box3Helper(new THREE.Box3().setFromCenterAndSize(V3(), V3(.82, .02, 1.22)), s.why ? '#e2483d' : '#2fae55');
    const holder = new THREE.Group(); holder.add(b); holder.position.copy(s.world); holder.position.y += .012; holder.rotation.y = rad(s.rack.rot); holder.userData.preview = true; overlay.add(holder); }
  else { ghost.position.copy(tgt.floor); ghost.rotation.y = rad(ghostRot); }
}
function dropLoad(itemType, tgt, from){
  // from: null (palette), { rack, index } or { item: id }
  if (!tgt) return false;
  if (tgt.slot){ const s = tgt.slot;
    if (s.why){ toast(s.why); return false; }
    if (from && from.rack){ const r = byId(from.rack), ld = r.loads[from.index];
      if (from.rack === s.rack.id){ Object.assign(ld, { b: s.b, l: s.l, p: s.p }); }
      else { r.loads.splice(from.index, 1); s.rack.loads.push({ b: s.b, l: s.l, p: s.p, item: itemType }); } }
    else { if (from && from.item) S.objects = S.objects.filter(o => o.id !== from.item); s.rack.loads.push({ b: s.b, l: s.l, p: s.p, item: itemType }); }
    drops.set(`${s.rack.id}:${s.b}-${s.l}-${s.p}`, { y: .18, v: 0, kg: M.ITEMS[itemType].kg });    // it is set down from just above
    return true; }
  const f = tgt.floor;
  if (from && from.rack){ const r = byId(from.rack); r.loads.splice(from.index, 1); S.objects.push({ id: newId(), kind: 'item', item: itemType, x: f.x, z: f.z, rot: ghostRot }); }
  else if (from && from.item){ const it = byId(from.item); it.x = f.x; it.z = f.z; }
  else S.objects.push({ id: newId(), kind: 'item', item: itemType, x: f.x, z: f.z, rot: ghostRot });
  return true;
}

/* ---------- doors: find the wall under the pointer ---------- */
function doorTarget(e, type, ignoreId){
  const p = groundAt(e); if (!p) return null;
  const T = M.DOOR_TYPES[type]; let best = null;
  for (const w of ofKind('wall')){
    const L = M.wallLen(w), ux = (w.x2 - w.x1)/L, uz = (w.z2 - w.z1)/L, dx = p.x - w.x1, dz = p.z - w.z1;
    const t = dx*ux + dz*uz, dist = Math.abs(dx*uz - dz*ux);
    if (t < -.3 || t > L + .3 || dist > 1.5) continue;
    if (!best || dist < best.dist) best = { wall: w, t, dist, L };
  }
  if (!best) return null;
  const w = best.wall, cur = ignoreId ? byId(ignoreId) : null, dw = cur ? cur.w : T.w, dh = cur ? cur.h : T.h;
  const t = Math.max(dw/2 + .05, Math.min(best.L - dw/2 - .05, snapV(best.t)));
  let why = '';
  if (best.L < dw + .1) why = 'This wall is too short for that door';
  else if (dh > w.h - .05) why = `The wall is too low: the door needs ${Math.round((dh + .05)*100)} cm`;
  else if (doorsOf(w.id).some(d => d.id !== ignoreId && Math.abs(d.t - t) < (d.w + dw)/2 + .05)) why = 'That overlaps another door';
  return { wall: w, t, w: dw, h: dh, why };
}

/* ---------- loggers: the surface point under the pointer ---------- */
function loggerTarget(e, ignoreId){
  const h = pick(e, (o, hit) => (o.kind === 'rack' && hit.object.userData.load == null) || o.kind === 'wall');
  if (!h) return null;
  const n = h.hit.face.normal.clone().transformDirection(h.hit.object.matrixWorld);
  if (n.dot(ray.ray.direction) > 0) n.negate();
  const u = h.hit.object.userData;
  return { host: h.o, point: h.hit.point.clone(), normal: n, part: u.part || 'rack', bay: u.bay, level: u.level };
}
function showLoggerGhost(t){
  if (!ghost || ghost.userData.type !== 'logger'){ clearGhost(); ghost = M.ghostify(buildLogger(), '#2f7de1'); ghost.scale.setScalar(1.6); ghost.userData.type = 'logger'; overlay.add(ghost); }
  ghost.visible = !!t; if (t) orientLogger(ghost, t.point, t.normal);
}
// a logger is stored in its host's own frame (rack or wall), so it moves with the host
function hostFields(t){
  const g = views.get(t.host.id).group; g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  return { host: t.host.id, part: t.part, bay: t.bay, level: t.level, local: t.point.clone().applyMatrix4(inv).toArray().map(v => round(v, 4)),
    normal: t.normal.clone().transformDirection(inv).toArray().map(v => round(v, 4)) };
}
function addLogger(t){
  S.seq.logger++;
  const o = { id: newId(), kind: 'logger', name: 'DL-' + String(S.seq.logger).padStart(2, '0'), ...hostFields(t) };
  S.objects.push(o); return o;
}

/* ---------- pointer input (captured before the orbit controls see it) ---------- */
let down = null;
view.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('.ltag')) return;
  down = { x: e.clientX, y: e.clientY, moved: false };
  if (mode === 'select'){
    // wall end handles first
    setRay(e); const hh = ray.intersectObjects(handles)[0];
    if (hh){ drag = { type: 'handle', end: hh.object.userData.handle, wall: sel.id }; controls.enabled = false; return; }
    const h = pick(e);
    if (!h){ drag = { type: 'none' }; return; }
    const o = h.o, loadIdx = h.hit.object.userData.load;
    select(o.kind === 'rack' && loadIdx != null ? { id: o.id, load: loadIdx } : { id: o.id });
    controls.enabled = false;
    const g0 = groundAt(e) || V3();
    if (o.kind === 'rack' && loadIdx != null) drag = { type: 'load', from: { rack: o.id, index: loadIdx }, item: o.loads[loadIdx].item, armed: false };
    else if (o.kind === 'item') drag = { type: 'load', from: { item: o.id }, item: o.item, armed: false };
    else if (o.kind === 'wall') drag = { type: 'wallmove', o, start: g0, orig: { ...o } };
    else if (o.kind === 'door') drag = { type: 'door', o };
    else if (o.kind === 'logger') drag = { type: 'logger', o };
    else drag = { type: 'move', o, off: V3(o.x - g0.x, 0, o.z - g0.z) };
    return;
  }
  controls.enabled = false;
  if (mode === 'floor' || mode === 'wall'){ const p = groundAt(e); if (!p) return; drag = { type: mode, a: snapPoint(p, mode === 'wall'), b: null }; return; }
  if (mode === 'place' || mode === 'logger') drag = { type: 'click' };
}, true);

addEventListener('pointermove', e => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
  if (!e.target.closest || !e.target.closest('#view')){ if (!drag) return; }
  if (mode === 'place' && !drag) return placeHover(e);
  if (mode === 'logger' && !drag) return showLoggerGhost(loggerTarget(e));
  if (mode === 'select' && !drag){ const h = pick(e); view.style.cursor = h ? 'pointer' : 'default'; return; }
  if (!drag) return;
  if (drag.type === 'floor' || drag.type === 'wall'){ const p = groundAt(e); if (!p) return; drag.b = snapPoint(p, drag.type === 'wall', drag.a); drawPreview(); return; }
  if (!down || !down.moved) return;
  if (drag.type === 'move'){ const p = groundAt(e); if (!p) return; drag.o.x = snapV(p.x + drag.off.x); drag.o.z = snapV(p.z + drag.off.z); sync(); }
  else if (drag.type === 'wallmove'){ const p = groundAt(e); if (!p) return; const dx = snapV(p.x - drag.start.x), dz = snapV(p.z - drag.start.z);
    Object.assign(drag.o, { x1: round(drag.orig.x1 + dx), z1: round(drag.orig.z1 + dz), x2: round(drag.orig.x2 + dx), z2: round(drag.orig.z2 + dz) }); sync(); }
  else if (drag.type === 'handle'){ const p = groundAt(e); if (!p) return; const w = byId(drag.wall), q = snapPoint(p, true, drag.end === 1 ? V3(w.x2, 0, w.z2) : V3(w.x1, 0, w.z1), w.id);
    w['x' + drag.end] = round(q.x); w['z' + drag.end] = round(q.z); sync(); }
  else if (drag.type === 'door'){ const t = doorTarget(e, drag.o.type, drag.o.id); if (t && t.wall.id === drag.o.wall && !t.why){ drag.o.t = round(t.t); sync(); } }
  else if (drag.type === 'logger'){ const t = loggerTarget(e); if (t){ Object.assign(drag.o, hostFields(t)); sync(); } }
  else if (drag.type === 'load'){
    if (!drag.armed){ drag.armed = true; hideSource(drag.from, true); }
    drag.tgt = loadTarget(e, drag.item, drag.from.rack ? drag.from : null); showLoadGhost(drag.item, drag.tgt); }
});

addEventListener('pointerup', e => {
  const d = drag; drag = null; controls.enabled = true;
  const wasClick = down && !down.moved; down = null;
  if (!d) return;
  if (d.type === 'none'){ if (wasClick) select(null); return; }
  if (d.type === 'floor'){ clearPreview(); if (!d.b) return; const w = Math.abs(d.b.x - d.a.x), dd = Math.abs(d.b.z - d.a.z);
    if (w < .5 || dd < .5) return toast('Drag a bigger area for the floor');
    const o = { id: newId(), kind: 'floor', x: round((d.a.x + d.b.x)/2), z: round((d.a.z + d.b.z)/2), w: round(w), d: round(dd) };
    S.objects.push(o); commit(); select({ id: o.id }); setMode('select'); frameAll(); return; }
  if (d.type === 'wall'){ clearPreview(); if (!d.b || d.a.distanceTo(d.b) < .3) return;
    const o = { id: newId(), kind: 'wall', x1: round(d.a.x), z1: round(d.a.z), x2: round(d.b.x), z2: round(d.b.z), h: 3, t: .2 };
    S.objects.push(o); commit(); return; }
  if (d.type === 'click'){ if (!wasClick) return;
    if (mode === 'logger'){ const t = loggerTarget(e); if (!t) return toast('Click on a rack or a wall to place a logger'); const o = addLogger(t); commit(); toast(`${o.name} placed`); return; }
    if (mode === 'place') return placeClick(e); return; }
  if (d.type === 'load'){
    if (!d.armed){ return; }
    hideSource(d.from, false); clearGhost();
    if (dropLoad(d.item, d.tgt, d.from)){ select(null); commit(); } else sync();
    return; }
  commit();
});
view.addEventListener('dblclick', e => { if (mode !== 'select') return; const h = pick(e); if (h && h.o.kind === 'door') toggleDoor(h.o); });
function hideSource(from, hide){
  if (from.item){ const v = views.get(from.item); if (v) v.group.visible = !hide; }
  if (from.rack){ const v = views.get(from.rack); if (v) v.group.traverse(c => { if (c.isMesh && c.userData.load === from.index) c.visible = !hide; }); }
}
function snapPoint(p, toWalls, from, skipWall){
  let q = V3(snapV(p.x), 0, snapV(p.z));
  if (toWalls){
    let best = null, bd = .35;
    for (const w of ofKind('wall')) if (w.id !== skipWall) for (const [x, z] of [[w.x1, w.z1], [w.x2, w.z2]]){ const d = Math.hypot(p.x - x, p.z - z); if (d < bd){ bd = d; best = V3(x, 0, z); } }
    if (best) return best;
    if (from){ const a = Math.atan2(q.z - from.z, q.x - from.x), L = Math.hypot(q.x - from.x, q.z - from.z), s = Math.round(a/(Math.PI/2))*(Math.PI/2);
      if (Math.abs(a - s) < rad(6)) q = V3(round(from.x + Math.cos(s)*snapV(L)), 0, round(from.z + Math.sin(s)*snapV(L))); }
  }
  return q;
}
function drawPreview(){
  clearPreview(); const d = drag; if (!d.b) return;
  let m;
  if (d.type === 'floor'){ const w = Math.abs(d.b.x - d.a.x), dd = Math.abs(d.b.z - d.a.z); if (w < .01 || dd < .01) return;
    m = M.ghostify(M.box(w, .15, dd, M.mat('#d8d4cb'), (d.a.x + d.b.x)/2, -.07, (d.a.z + d.b.z)/2));
    sizeTag(`${w.toFixed(2)} × ${dd.toFixed(2)} m`, V3((d.a.x + d.b.x)/2, .2, (d.a.z + d.b.z)/2)); }
  else { const L = d.a.distanceTo(d.b); if (L < .01) return;
    m = M.ghostify(M.buildWall({ x1: d.a.x, z1: d.a.z, x2: d.b.x, z2: d.b.z, h: 3, t: .2 }, [], M.mat('#d5d8db')));
    sizeTag(`${L.toFixed(2)} m`, V3((d.a.x + d.b.x)/2, 3.3, (d.a.z + d.b.z)/2)); }
  m.userData.preview = true; overlay.add(m);
}
function sizeTag(text, p){ const el = document.createElement('div'); el.className = 'sizetag'; el.textContent = text; const o = new CSS2DObject(el); o.position.copy(p); o.userData.preview = true; overlay.add(o); }
function clearPreview(){ overlay.children.filter(c => c.userData.preview).forEach(c => { if (c.isCSS2DObject) c.element.remove(); overlay.remove(c); }); }

/* ---------- palette placement ---------- */
function placeHover(e){
  const k = placeKind;
  if (k.startsWith('item:')){ const it = k.slice(5); showLoadGhost(it, loadTarget(e, it)); return; }
  if (k.startsWith('door:')){ const type = k.slice(5), t = doorTarget(e, type);
    if (!ghost || ghost.userData.type !== k){ clearGhost(); ghost = new THREE.Group(); ghost.userData.type = k; overlay.add(ghost); }
    ghost.clear(); ghost.visible = !!t; if (!t) return;
    const T = M.DOOR_TYPES[type], g = M.ghostify(M.buildDoor({ type, t: t.t, w: T.w, h: T.h, open: false }, t.wall), t.why ? '#e2483d' : '#2fae55');
    g.position.set(t.wall.x1, 0, t.wall.z1); g.rotation.y = -M.wallAngle(t.wall); ghost.add(g); ghost.userData.t = t; return; }
  if (k === 'rack'){ const p = groundAt(e); if (!p) return;
    if (!ghost || ghost.userData.type !== k){ clearGhost(); ghost = M.ghostify(M.buildRack(newRack(0, 0))); ghost.userData.type = k; overlay.add(ghost); }
    ghost.position.set(snapV(p.x), 0, snapV(p.z)); ghost.rotation.y = rad(ghostRot); }
}
const newRack = (x, z) => ({ id: 0, kind: 'rack', name: '', x, z, rot: ghostRot, bays: 1, levels: 2, pitch: 1.4, rating: 1, loads: [] });
function placeClick(e){
  const k = placeKind;
  if (k.startsWith('item:')){ const it = k.slice(5); if (dropLoad(it, loadTarget(e, it), null)) commit(); return; }
  if (k.startsWith('door:')){ const type = k.slice(5), t = doorTarget(e, type); if (!t) return toast('Point at a wall to place a door');
    if (t.why) return toast(t.why);
    const o = { id: newId(), kind: 'door', type, wall: t.wall.id, t: round(t.t), w: t.w, h: t.h, open: false }; S.objects.push(o); commit(); return; }
  if (k === 'rack'){ const p = groundAt(e); if (!p) return; S.seq.rack++;
    const o = { ...newRack(snapV(p.x), snapV(p.z)), id: newId(), name: 'R-' + String(S.seq.rack).padStart(2, '0') };
    S.objects.push(o); commit(); select({ id: o.id }); return; }
}

/* ---------- keyboard ---------- */
addEventListener('keydown', e => {
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y'){ e.preventDefault(); redo(); return; }
  if (mod && k === 'd'){ e.preventDefault(); duplicate(); return; }
  if (k === 'escape'){ if (mode !== 'select') setMode('select'); else select(null); return; }
  if (k === 'delete' || k === 'backspace'){ e.preventDefault(); removeSel(); return; }
  if (k === 'r'){ if (mode === 'place'){ ghostRot = (ghostRot + 90) % 360; if (ghost) ghost.rotation.y = rad(ghostRot); }
    else if (sel){ const o = byId(sel.id); if (o && sel.load == null && 'rot' in o){ o.rot = (o.rot + 90) % 360; commit(); renderPanel(); } } return; }
  if (k === 'v') setMode('select'); if (k === 'f') setMode('floor'); if (k === 'w') setMode('wall'); if (k === 'l') setMode('logger');
});
function removeSel(){
  if (!sel) return; const o = byId(sel.id); if (!o) return;
  if (sel.load != null){ o.loads.splice(sel.load, 1); select(null); commit(); return; }
  const gone = new Set([o.id]);
  for (const x of S.objects) if ((x.kind === 'door' && x.wall === o.id) || (x.kind === 'logger' && x.host === o.id)) gone.add(x.id);
  S.objects = S.objects.filter(x => !gone.has(x.id)); select(null); commit();
}
function duplicate(){
  if (!sel || sel.load != null) return; const o = byId(sel.id); if (!o || !['rack', 'item', 'floor'].includes(o.kind)) return toast('Select a rack, load or floor to duplicate');
  const c = JSON.parse(JSON.stringify(o)); c.id = newId(); c.x = round(c.x + (o.kind === 'rack' ? 0 : 1)); c.z = round(c.z + (o.kind === 'rack' ? 1.6 : 1));
  if (o.kind === 'rack'){ S.seq.rack++; c.name = 'R-' + String(S.seq.rack).padStart(2, '0'); }
  S.objects.push(c); commit(); select({ id: c.id });
}
function toggleDoor(o){ o.open = !o.open; saveLocal(); lastSnap = JSON.stringify(S); renderPanel(); }

/* ---------- properties panel ---------- */
const panel = $('#panel');
function field(label, key, value, attrs = ''){ return `<label class="f"><span>${label}</span><input data-k="${key}" value="${value}" ${attrs}></label>`; }
function num(label, key, value, step = .1, extra = ''){ return field(label, key, round(value, 3), `type="number" step="${step}" ${extra}`); }
function renderPanel(){
  const o = sel && byId(sel.id);
  $('#loggercard').hidden = !(o && o.kind === 'logger');
  if (!o){ panel.innerHTML = scenePanel(); bindPanel(null); return; }
  let h = '';
  if (o.kind === 'floor') h = `<h3>Floor</h3>${num('Width (m)', 'w', o.w)}${num('Depth (m)', 'd', o.d)}${num('Centre X (m)', 'x', o.x)}${num('Centre Z (m)', 'z', o.z)}
    <button data-act="walls">Add walls around this floor</button>`;
  else if (o.kind === 'wall'){ const L = M.wallLen(o), a = deg(M.wallAngle(o));
    h = `<h3>Wall</h3>${num('Length (m)', 'len', L)}${num('Height (m)', 'h', o.h)}${num('Thickness (m)', 't', o.t, .01)}${num('Start X (m)', 'x1', o.x1)}${num('Start Z (m)', 'z1', o.z1)}${num('Angle (°)', 'ang', a, 1)}
    <p class="note">Drag the blue dots to move its ends.</p>`; }
  else if (o.kind === 'rack' && sel.load != null){ const ld = o.loads[sel.load], it = M.ITEMS[ld.item];
    h = `<h3>${it.name}</h3><p class="kv"><b>${it.kg} kg</b> · ${Math.round(it.h*100)} cm tall</p><p class="kv">On ${o.name}, bay ${ld.b + 1}, ${ld.l ? 'level ' + ld.l : 'ground'}, ${ld.p ? 'right' : 'left'} position</p>
    <p class="note">Drag it to another position or onto the floor.</p><button data-act="del">Remove load</button>`; }
  else if (o.kind === 'rack'){ const kg = o.loads.reduce((a, x) => a + M.ITEMS[x.item].kg, 0);
    h = `<h3>Rack ${o.name}</h3>${field('Name', 'name', o.name)}${num('Bays', 'bays', o.bays, 1, 'min="1" max="12"')}${num('Beam levels', 'levels', o.levels, 1, 'min="1" max="8"')}
    ${num('Level pitch (m)', 'pitch', o.pitch, .05, 'min="0.8" max="3"')}
    <label class="f"><span>Beam rating</span><select data-k="rating">${M.RACK.RAT.map((r, i) => `<option value="${i}" ${i === o.rating ? 'selected' : ''}>${r.kg} kg per level</option>`).join('')}</select></label>
    ${num('X (m)', 'x', o.x)}${num('Z (m)', 'z', o.z)}${num('Rotation (°)', 'rot', o.rot, 90)}
    <p class="kv"><b>${o.loads.length}</b> of ${o.bays*(o.levels + 1)*2} positions · <b>${kg.toLocaleString('en')} kg</b></p>
    <p class="kv">Beam sag <b id="sagmm">0.0 mm</b> · limit L/200 = ${M.RACK.SAG_MM.toFixed(1)} mm</p>
    <p class="note">Sag is drawn ${M.RACK.SAG_EXAG}× deeper so you can see it.</p>
    <button data-act="clearloads">Unload all</button>`; }
  else if (o.kind === 'item'){ const it = M.ITEMS[o.item];
    h = `<h3>${it.name}</h3><p class="kv"><b>${it.kg} kg</b> · ${Math.round(it.h*100)} cm tall</p>${num('X (m)', 'x', o.x)}${num('Z (m)', 'z', o.z)}${num('Rotation (°)', 'rot', o.rot, 90)}
    <p class="note">Drag it onto a rack to put it away.</p>`; }
  else if (o.kind === 'door'){ const w = byId(o.wall);
    h = `<h3>${M.DOOR_TYPES[o.type].name}</h3>${num('Width (m)', 'w', o.w)}${num('Height (m)', 'h', o.h)}${num('Position along wall (m)', 't', o.t)}
    <button data-act="door">${o.open ? 'Close' : 'Open'}</button><p class="note">Double-click a door to open or close it.</p>`; }
  else if (o.kind === 'logger') h = `<h3>Data logger</h3><p class="note">Details are on the card by the logger.</p>`;
  h += `<button data-act="del" class="danger">Delete</button>`;
  if (o.kind === 'rack' && sel.load != null) h = h.replace(/<button data-act="del" class="danger">Delete<\/button>$/, '');
  panel.innerHTML = h; bindPanel(o);
}
function scenePanel(){
  return `<h3>Layout</h3>${num('Room temperature (°C)', 'ambient', S.ambient, .5)}
    <label class="f"><span>Grid snap</span><select data-k="snap">${[.05, .1, .25, .5, 1].map(v => `<option value="${v}" ${v === S.snap ? 'selected' : ''}>${v*100} cm</option>`).join('')}</select></label>
    <div id="stats"></div><p class="note">Select anything to edit its size and position.</p>`;
}
function bindPanel(o){
  panel.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => applyField(o, inp.dataset.k, inp.value)));
  panel.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => panelAction(o, b.dataset.act)));
  updateStats();
}
function applyField(o, k, raw){
  const v = parseFloat(raw);
  if (!o){ if (k === 'ambient' && Number.isFinite(v)) S.ambient = v; if (k === 'snap') S.snap = v; commit(); return; }
  if (k === 'name'){ o.name = raw.trim() || o.name; }
  else if (!Number.isFinite(v)) return renderPanel();
  else if (o.kind === 'wall' && (k === 'len' || k === 'ang' || k === 'x1' || k === 'z1')){
    const L = k === 'len' ? Math.max(.3, v) : M.wallLen(o), a = k === 'ang' ? rad(v) : M.wallAngle(o);
    if (k === 'x1') o.x1 = v; if (k === 'z1') o.z1 = v;
    o.x2 = round(o.x1 + Math.cos(a)*L); o.z2 = round(o.z1 + Math.sin(a)*L);
    for (const d of doorsOf(o.id)) d.t = Math.min(d.t, L - d.w/2 - .05); }
  else if (o.kind === 'rack' && (k === 'bays' || k === 'levels')){
    const n = Math.max(1, Math.round(v)), lost = o.loads.filter(x => k === 'bays' ? x.b >= n : x.l > n);
    if (lost.length){ toast(`Unload ${k === 'bays' ? 'bay ' + (Math.max(...lost.map(x => x.b)) + 1) : 'level ' + Math.max(...lost.map(x => x.l))} first`); return renderPanel(); }
    o[k] = Math.min(k === 'bays' ? 12 : 8, n); }
  else if (o.kind === 'rack' && (k === 'pitch' || k === 'rating')){
    const test = { ...o, [k]: k === 'rating' ? Math.round(v) : Math.max(.8, v) }, bad = o.loads.find((x, i) => M.rackCheck(test, x.b, x.l, x.item, i));
    if (bad){ toast(M.rackCheck(test, bad.b, bad.l, bad.item, o.loads.indexOf(bad))); return renderPanel(); }
    o[k] = test[k]; }
  else if (o.kind === 'door' && (k === 'w' || k === 'h' || k === 't')){
    const w = byId(o.wall), L = M.wallLen(w), test = { ...o, [k]: v };
    if (test.h > w.h - .05) { toast('The wall is too low for that door'); return renderPanel(); }
    if (test.w + .1 > L) { toast('The wall is too short for that door'); return renderPanel(); }
    test.t = Math.max(test.w/2 + .05, Math.min(L - test.w/2 - .05, test.t));
    if (doorsOf(w.id).some(d => d.id !== o.id && Math.abs(d.t - test.t) < (d.w + test.w)/2 + .05)){ toast('That overlaps another door'); return renderPanel(); }
    Object.assign(o, { w: test.w, h: test.h, t: round(test.t) }); }
  else if (o.kind === 'wall' && k === 'h'){ const need = Math.max(0, ...doorsOf(o.id).map(d => d.h + .05)); o.h = Math.max(need, v, .3); }
  else if (k === 'rot') o.rot = ((Math.round(v) % 360) + 360) % 360;
  else if (k in o) o[k] = Math.max(['w', 'd', 't'].includes(k) ? .05 : -1e6, v);
  commit(); renderPanel();
}
function panelAction(o, act){
  if (act === 'del') return removeSel();
  if (act === 'clearloads'){ o.loads = []; commit(); renderPanel(); return; }
  if (act === 'door'){ toggleDoor(o); return; }
  if (act === 'walls'){ const t = .2, x0 = o.x - o.w/2 + t/2, x1 = o.x + o.w/2 - t/2, z0 = o.z - o.d/2 + t/2, z1 = o.z + o.d/2 - t/2;
    for (const [a, b, c, d] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]])
      S.objects.push({ id: newId(), kind: 'wall', x1: round(a), z1: round(b), x2: round(c), z2: round(d), h: 3, t });
    commit(); toast('Walls added around the floor'); }
}
function updateStats(){
  const el = $('#stats'); if (!el) return;
  const area = ofKind('floor').reduce((a, f) => a + f.w*f.d, 0), racks = ofKind('rack');
  const pos = racks.reduce((a, r) => a + r.bays*(r.levels + 1)*2, 0), used = racks.reduce((a, r) => a + r.loads.length, 0);
  el.innerHTML = `<p class="kv">Floor <b>${area.toFixed(1)} m²</b></p><p class="kv">Racks <b>${racks.length}</b> · positions <b>${used}/${pos}</b></p>
    <p class="kv">Doors <b>${ofKind('door').length}</b> · loggers <b>${ofKind('logger').length}</b></p>`;
}

/* ---------- logger card: number, live reading, where it is ---------- */
const readings = new Map(), sim = makeSim();
function loggerWhere(o){
  const h = byId(o.host); if (!h) return 'Unattached';
  if (h.kind === 'wall') return `On a wall, ${o.local[1].toFixed(2)} m up`;
  const W = M.rackWidth(h), [lx, ly] = o.local, b = o.bay ?? Math.floor((lx + W/2)/M.RACK.BP), l = o.level ?? Math.floor((ly + .02)/h.pitch);
  const inside = b >= 0 && b < h.bays && ly <= M.rackHeight(h) + .05;
  return `Rack ${h.name}${inside ? `, bay ${b + 1}, ${l > 0 ? 'level ' + Math.min(l, h.levels) : 'ground level'}` : ''}, on the ${o.part || 'rack'}`;
}
function tickReadings(){
  const doors = ofKind('door').map(d => { const w = byId(d.wall); if (!w) return null; const a = M.wallAngle(w);
    return { k: doorK.get(d.id) || 0, p: V3(w.x1 + Math.cos(a)*d.t, d.h/2, w.z1 + Math.sin(a)*d.t) }; }).filter(Boolean);
  for (const o of ofKind('logger')){ const v = views.get(o.id); if (!v) continue;
    const p = v.group.getWorldPosition(V3()), warm = doors.reduce((a, d) => a + 3*d.k*Math.max(0, 1 - p.distanceTo(d.p)/6), 0);
    const t = sim.reading(o.id, S.ambient, p.y, warm); readings.set(o.id, t); v.group.userData.setReading(t); }
  renderCard();
}
setInterval(tickReadings, 2000);
const card = $('#loggercard');
function renderCard(){
  const o = sel && byId(sel.id); if (!o || o.kind !== 'logger'){ card.hidden = true; return; }
  const t = readings.get(o.id);
  if (card.dataset.id !== String(o.id)){ card.dataset.id = o.id;
    card.innerHTML = `<div class="ch"><b class="lname"></b><button class="x" title="Close">×</button></div>
      <div class="temp"><span class="tv"></span><small>°C</small></div><p class="kv where"></p>
      <p class="kv">Elitech RC-5 · recording · battery 100%</p>
      <label class="f"><span>Logger number</span><input class="ren"></label><button class="danger del">Delete logger</button>`;
    card.querySelector('.x').onclick = () => select(null);
    card.querySelector('.del').onclick = () => removeSel();
    const ren = card.querySelector('.ren'); ren.value = o.name;
    ren.onchange = () => { const n = ren.value.trim(); if (!n) return; if (ofKind('logger').some(x => x !== o && x.name === n)){ toast(`${n} is already used`); ren.value = o.name; return; } o.name = n; commit(); renderCard(); };
  }
  card.querySelector('.lname').textContent = o.name;
  card.querySelector('.tv').textContent = Number.isFinite(t) ? t.toFixed(1) : '--.-';
  card.querySelector('.where').textContent = loggerWhere(o);
  card.hidden = false;
}
function positionCard(){
  if (card.hidden) return; const o = sel && byId(sel.id), v = o && views.get(o.id); if (!v) return;
  const p = v.group.getWorldPosition(V3()).project(camera), r = view.getBoundingClientRect();
  let x = (p.x + 1)/2*r.width + 18, y = (1 - p.y)/2*r.height - 40;
  x = Math.min(r.width - card.offsetWidth - 8, Math.max(8, x)); y = Math.min(r.height - card.offsetHeight - 8, Math.max(8, y));
  card.style.transform = `translate(${x}px, ${y}px)`; card.style.opacity = p.z < 1 ? 1 : 0;
}

/* ---------- toolbar, palette, files ---------- */
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  const m = b.dataset.mode, k = b.dataset.kind || null;
  if (mode === m && placeKind === k && m !== 'select') return setMode('select');
  if (m === 'place' && k.startsWith('door:') && !ofKind('wall').length) toast('Draw a wall first: doors go into walls');
  if (m === 'logger' && !ofKind('rack').length && !ofKind('wall').length) toast('Add a rack first: loggers go on racks');
  setMode(m, k);
}));
$('#undo').onclick = undo; $('#redo').onclick = redo;
$('#wallmode').onclick = () => { wallMode = { see: 'solid', solid: 'hidden', hidden: 'see' }[wallMode]; applyWallMode(); };
$('#tags').onclick = () => { showTags = !showTags; $('#tags').classList.toggle('on', showTags); for (const v of views.values()) if (v.group.userData.tag) v.group.userData.tag.hidden = !showTags; };
$('#fit').onclick = () => frameAll();
$('#new').onclick = () => { if (S.objects.length && !confirm('Start a new empty layout? (You can undo this.)')) return; const keep = { ambient: S.ambient, snap: S.snap }; S = { ...blank(), ...keep }; select(null); commit(); };
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'warehouse-layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async () => {
  const f = $('#file').files[0]; $('#file').value = ''; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d || !Array.isArray(d.objects)) throw 0;
    S = { ...blank(), ...d }; select(null); commit(); frameAll(); toast('Layout loaded'); }
  catch { toast('That file is not a warehouse layout'); }
};
$('#start').onclick = () => setMode('floor');
$('#example').onclick = () => { if (S.objects.length && !confirm('Replace this layout with the example? (You can undo this.)')) return; S = exampleLayout(); select(null); commit(); frameAll(); };

// a small cold store: floor, four walls, three kinds of door, two loaded racks, loads by the dock door and five loggers
function exampleLayout(){
  const L = { ...blank(), ambient: S.ambient, snap: S.snap }, id = () => L.nextId++, t = .2;
  const x0 = -7.9, x1 = 7.9, z0 = -5.9, z1 = 5.9;
  L.objects.push({ id: id(), kind: 'floor', x: 0, z: 0, w: 16, d: 12 });
  const [wb, wr, wf, wl] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].map(([a, b, c, d]) => {
    const w = { id: id(), kind: 'wall', x1: a, z1: b, x2: c, z2: d, h: 4, t }; L.objects.push(w); return w; });
  L.objects.push({ id: id(), kind: 'door', type: 'vslide', wall: wf.id, t: 4, w: 3, h: 3.2, open: false });
  L.objects.push({ id: id(), kind: 'door', type: 'swing', wall: wr.id, t: 2, w: 1, h: 2.1, open: false });
  L.objects.push({ id: id(), kind: 'door', type: 'hslide', wall: wl.id, t: 6, w: 3, h: 3, open: false });
  const mk = [['carton', 'tote', 'crate', 'mesh', 'sack', 'drum'], ['drum', 'carton', 'pallet', 'tote', 'crate', 'carton']];
  const racks = [[-2.5, -4.3, 0], [-2.5, .2, 180]].map(([x, z, rot], i) => {
    const r = { id: id(), kind: 'rack', name: 'R-0' + (i + 1), x, z, rot, bays: 3, levels: 3, pitch: 1.4, rating: 1, loads: [] };
    let n = i*2;
    for (let l = 0; l <= 3; l++) for (let b = 0; b < 3; b++) for (const p of [0, 1]){
      if ((b + l + p + i) % 4 === 3) continue;
      const item = mk[i][n++ % 6]; if (!M.rackCheck(r, b, l, item)) r.loads.push({ b, l, p, item }); }
    L.objects.push(r); L.seq.rack++; return r; });
  L.objects.push({ id: id(), kind: 'item', item: 'carton', x: 3.4, z: 3.6, rot: 0 }, { id: id(), kind: 'item', item: 'drum', x: 4.6, z: 3.6, rot: 0 });
  const onBeam = (r, b, l) => { const bh = M.RACK.RAT[r.rating].h, xc = -M.rackWidth(r)/2 + b*M.RACK.BP + M.RACK.UPW + M.RACK.CS/2;
    return { host: r.id, part: 'beam', bay: b, level: l, local: [round(xc + .45), round(l*r.pitch - bh/2), round(M.RACK.D/2 - .005)], normal: [0, 0, 1] }; };
  const logs = [onBeam(racks[0], 1, 1), onBeam(racks[0], 0, 3), onBeam(racks[1], 2, 2), onBeam(racks[1], 0, 1),
    { host: wr.id, part: 'wall', local: [6, 1.5, t/2], normal: [0, 0, 1] }];
  for (const lg of logs){ L.seq.logger++; L.objects.push({ id: id(), kind: 'logger', name: 'DL-' + String(L.seq.logger).padStart(2, '0'), ...lg }); }
  return L;
}
if (new URLSearchParams(location.search).get('example') === '1'){ S = exampleLayout(); lastSnap = JSON.stringify(S); }

let toastT = 0;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

function frameAll(){
  const b = new THREE.Box3(); for (const v of views.values()) b.expandByObject(v.group);
  if (b.isEmpty()){ controls.target.set(0, 0, 0); camera.position.set(0, 17, 15); return; }
  const c = b.getCenter(V3()), s = b.getSize(V3()).length();
  controls.target.copy(c); camera.position.copy(c).add(V3(.35, .62, .7).normalize().multiplyScalar(Math.max(5, s*1.2)));
}

/* ---------- loop: door animation, labels, card ---------- */
const clock = new THREE.Clock();
/* ---------- beam sag: each beam pair is a spring pulled toward the dip its load gives; a load set down bounces it ---------- */
const sag = new Map();         // `${rackId}:${bay}-${level}` -> { s (m, drawn), v }
const drops = new Map();       // `${rackId}:${bay}-${level}-${pos}` -> { y above rest, v, kg } while a load is being set down
const sagOf = (rid, b, l) => (sag.get(`${rid}:${b}-${l}`) || { s: 0 }).s;
function stepSag(dt){
  for (const [k, d] of drops){
    d.v -= 9.81*dt; d.y += d.v*dt;
    if (d.y <= 0){ d.y = 0; d.landed = true;
      const [rid, rest] = k.split(':'), r = byId(+rid), [b, l] = rest.split('-').map(Number);
      if (r && l > 0){ const sp = sag.get(`${rid}:${b}-${l}`); if (sp) sp.v += .08*Math.abs(d.v)*d.kg/M.RACK.RAT[r.rating].kg; }
      if (d.v < -.5) d.v = -d.v*.15; else drops.delete(k); } }
  for (const r of ofKind('rack')){
    const v = views.get(r.id), g = v && v.group; if (!g || !g.userData.beams) continue;
    const cap = M.RACK.RAT[r.rating].kg, lifted = drag && drag.armed && drag.from && drag.from.rack === r.id ? drag.from.index : -1, load = {};
    r.loads.forEach((ld, i) => { if (i === lifted || !ld.l) return; const d = drops.get(`${r.id}:${ld.b}-${ld.l}-${ld.p}`); if (d && !d.landed) return;     // still in the air
      load[ld.b + '-' + ld.l] = (load[ld.b + '-' + ld.l] || 0) + M.ITEMS[ld.item].kg; });
    for (let b = 0; b < r.bays; b++) for (let l = 1; l <= r.levels; l++){
      const key = `${r.id}:${b}-${l}`, tgt = M.RACK.SAGV*(load[b + '-' + l] || 0)/cap, sp = sag.get(key) || { s: tgt, v: 0 };
      sp.v += (260*(tgt - sp.s) - 11*sp.v)*dt; sp.s += sp.v*dt;
      if (Math.abs(tgt - sp.s) < 1e-5 && Math.abs(sp.v) < 1e-4){ sp.s = tgt; sp.v = 0; }
      sag.set(key, sp); }
    for (const bm of g.userData.beams) M.bendBeam(bm, sagOf(r.id, bm.userData.bay, bm.userData.level));
    for (const lg of g.userData.loadGroups){ const s = lg.userData.slot, d = drops.get(`${r.id}:${s.b}-${s.l}-${s.p}`);
      lg.position.y = s.baseY - (s.l ? sagOf(r.id, s.b, s.l)*M.RACK.SAG_POS : 0) + (d ? d.y : 0); }
  }
  // loggers clipped to a beam ride its bend
  for (const o of ofKind('logger')){ if (o.part !== 'beam' || o.level == null) continue;
    const h = byId(o.host), v = views.get(o.id); if (!h || h.kind !== 'rack' || !v || v.group.userData.baseY == null) continue;
    const x0 = -M.rackWidth(h)/2 + o.bay*M.RACK.BP + M.RACK.UPW, u = Math.max(0, Math.min(1, (o.local[0] - x0)/M.RACK.CS));
    v.group.position.y = v.group.userData.baseY - sagOf(h.id, o.bay, o.level)*M.sagShape(u); }
  // live figure in the rack panel
  const el = $('#sagmm'); if (el && sel){ const r = byId(sel.id); if (r && r.kind === 'rack'){ let mx = 0;
    for (let b = 0; b < r.bays; b++) for (let l = 1; l <= r.levels; l++) mx = Math.max(mx, sagOf(r.id, b, l));
    el.textContent = (mx/M.RACK.SAG_EXAG*1000).toFixed(1) + ' mm'; } }
}
function loop(){
  const dt = Math.min(.05, clock.getDelta());
  stepSag(dt);
  for (const o of ofKind('door')){ const k = doorK.get(o.id) ?? 0, tgt = o.open ? 1 : 0;
    if (k !== tgt){ const nk = tgt > k ? Math.min(1, k + dt/1.1) : Math.max(0, k - dt/1.1); doorK.set(o.id, nk); const v = views.get(o.id); if (v) v.group.userData.anim(easeIO(nk)); } }
  if (selBox.visible){ const g = selGroup(); if (g) selBox.box.setFromObject(g, true); }
  controls.update(); renderer.render(scene, camera); labels.render(scene, camera); positionCard();
  requestAnimationFrame(loop);
}
const easeIO = t => t < .5 ? 2*t*t : 1 - (-2*t + 2)**2/2;

/* ---------- start ---------- */
resize(); applyWallMode(); sync(); setMode('select'); renderPanel(); frameAll(); tickReadings(); loop();
// view options in the address bar: ?open=1 opens every door, ?az=deg&el=deg turns the camera, ?logger=DL-03 selects a logger and flies to it, ?walls=solid|see|hidden
{ const q = new URLSearchParams(location.search);
  if (q.get('open') === '1') for (const d of ofKind('door')){ d.open = true; doorK.set(d.id, 1); views.get(d.id)?.group.userData.anim(1); }
  if (q.has('walls')){ wallMode = q.get('walls'); applyWallMode(); }
  if (q.has('az') || q.has('el')){ const off = camera.position.clone().sub(controls.target), r = off.length(), az = rad(+(q.get('az') ?? 30)), el = rad(+(q.get('el') ?? 38));
    camera.position.copy(controls.target).add(V3(Math.sin(az)*Math.cos(el), Math.sin(el), Math.cos(az)*Math.cos(el)).multiplyScalar(r*(+(q.get('zoom') ?? 1)))); }
  const lg = q.get('logger') && ofKind('logger').find(o => o.name === q.get('logger'));
  if (lg){ select({ id: lg.id }); const p = views.get(lg.id).group.getWorldPosition(V3()), n = loggerWorld(lg).n;
    controls.target.copy(p); camera.position.copy(p).add(n.multiplyScalar(1.1)).add(V3(.5, .35, 0)); } }
window.__wb = { get S(){ return S; }, views, select, setMode, commit, frameAll, camera, get sel(){ return sel; }, stepSag };
