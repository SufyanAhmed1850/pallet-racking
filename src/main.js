// Warehouse builder: draw a floor and walls, place racks, doors, loads and data loggers, edit sizes, save layouts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as M from './models.js';
import * as R from './rules.js';
import { buildLogger, makeSim, LOGGER } from './logger.js';
import { ICON, LIBRARY, renderThumbs } from './library.js';

const KEY = 'warehouse-builder-v1', CLIP_KEY = 'warehouse-builder-clipboard';
const $ = s => document.querySelector(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const deg = r => r*180/Math.PI, rad = d => d*Math.PI/180;
const round = (v, n = 3) => +(+v).toFixed(n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND_NAME = { floor: 'Floor', wall: 'Wall', door: 'Door', rack: 'Pallet rack', item: 'Load', logger: 'Data logger' };
const SHORT_DOOR = { swing: 'Door', hslide: 'Sliding door', vslide: 'Roller door' };
const baseName = o => o.kind === 'item' ? M.ITEMS[o.item].name : o.kind === 'door' ? SHORT_DOOR[o.type] : KIND_NAME[o.kind];
const typeName = o => o.kind === 'door' ? M.DOOR_TYPES[o.type].name : o.kind === 'item' ? M.ITEMS[o.item].name : KIND_NAME[o.kind];

/* ---------- layout state (everything that is saved) ---------- */
const blank = () => ({ v: 1, nextId: 1, seq: { rack: 0, logger: 0 }, ambient: 5, snap: .1, rotSnap: 15, gridSize: 1, objects: [] });
let S = migrate(loadLocal() || blank());
const byId = id => S.objects.find(o => o.id === id);
const ofKind = k => S.objects.filter(o => o.kind === k);
const doorsOf = wallId => S.objects.filter(o => o.kind === 'door' && o.wall === wallId);
const newId = () => S.nextId++;
function loadLocal(){ try { const d = JSON.parse(localStorage.getItem(KEY)); return d && Array.isArray(d.objects) ? d : null; } catch { return null; } }
function saveLocal(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }
// older layouts (and imports) get the fields added since: names for every object, rotation/grid settings
function migrate(d){
  d = { ...blank(), ...d }; d.seq = { rack: 0, logger: 0, ...(d.seq || {}) };
  const n = {};
  for (const o of d.objects){ if (o.name) continue;
    const base = baseName(o);
    n[base] = (n[base] || 0) + 1; o.name = `${base} ${n[base]}`; }
  return d;
}
function nextName(o){
  if (o.kind === 'rack'){ S.seq.rack++; return 'R-' + String(S.seq.rack).padStart(2, '0'); }
  if (o.kind === 'logger'){ S.seq.logger++; return 'DL-' + String(S.seq.logger).padStart(2, '0'); }
  const base = baseName(o);
  let k = 1; while (S.objects.some(x => x.name === `${base} ${k}`)) k++; return `${base} ${k}`;
}

// undo / redo keep whole-layout snapshots
let undoStack = [], redoStack = [], lastSnap = JSON.stringify(S);
function commit(){
  const now = JSON.stringify(S); if (now === lastSnap){ sync(); return; }
  undoStack.push(lastSnap); if (undoStack.length > 150) undoStack.shift(); redoStack = []; lastSnap = now;
  saveLocal(); sync(); refreshUndo();
}
function undo(){ if (!undoStack.length) return toast('Nothing to undo'); redoStack.push(lastSnap); lastSnap = undoStack.pop(); S = JSON.parse(lastSnap); afterReplace(); }
function redo(){ if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(lastSnap); lastSnap = redoStack.pop(); S = JSON.parse(lastSnap); afterReplace(); }
function afterReplace(){ selection = selection.filter(s => byId(s.id) && (s.load == null || byId(s.id).loads[s.load])); saveLocal(); sync(); renderPanel(); refreshUndo(); }
function refreshUndo(){ $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }

/* ---------- renderer, camera, controls ---------- */
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
view.appendChild(renderer.domElement);
const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; view.appendChild(labels.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ece9e2');
const camera = new THREE.PerspectiveCamera(45, 1, .02, 400); camera.position.set(0, 17, 15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .12; controls.maxPolarAngle = 1.48; controls.minDistance = .12; controls.maxDistance = 150;
controls.screenSpacePanning = false; controls.zoomToCursor = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
scene.add(new THREE.HemisphereLight('#ffffff', '#cbc4b4', 1.7));
const sun = new THREE.DirectionalLight('#ffffff', 1.5); sun.position.set(9, 16, 7); scene.add(sun);
const fillL = new THREE.DirectionalLight('#ffffff', .45); fillL.position.set(-10, 6, -8); scene.add(fillL);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#e3dfd6', roughness: 1 }));
ground.rotation.x = -Math.PI/2; ground.position.y = -.16; scene.add(ground);
let grid = null;
function makeGrid(){ if (grid) scene.remove(grid); const n = Math.round(80/S.gridSize); grid = new THREE.GridHelper(n*S.gridSize, n, '#b9b2a3', '#d3cdc0'); grid.position.y = .004; scene.add(grid); }
makeGrid();
const world = new THREE.Group(); scene.add(world);
const overlay = new THREE.Group(); scene.add(overlay);          // ghosts, previews, handles, selection boxes
const guides = new THREE.Group(); scene.add(guides);            // snap guides and distance labels while dragging
function resize(){ const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w/h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view);

// gizmo: move / rotate / scale handles on a pivot at the centre of the selection
const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(.85); tc.setSpace('world');
const pivot = new THREE.Object3D(); scene.add(pivot);
scene.add(tc.getHelper());
tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });

/* ---------- building the 3D view from the state ---------- */
const views = new Map();               // id -> { group, sig }
const doorK = new Map();               // id -> how far open (animated)
let wallMode = 'see', showTags = true;
const wallMat = new THREE.MeshStandardMaterial({ color: '#d5d8db', roughness: .9, transparent: true, opacity: .38, depthWrite: false });
const isShown = o => !o.hidden && (o.kind !== 'wall' && o.kind !== 'door' || wallMode !== 'hidden');
function applyWallMode(){ wallMat.opacity = wallMode === 'solid' ? 1 : .38; wallMat.transparent = wallMode !== 'solid'; wallMat.depthWrite = wallMode === 'solid'; wallMat.needsUpdate = true;
  for (const o of S.objects){ const v = views.get(o.id); if (v) v.group.visible = isShown(o); }
  $('#wallmode').title = 'Walls: ' + { solid: 'solid', see: 'see-through', hidden: 'hidden' }[wallMode] + ' (click to change)';
  $('#wallmode .t').textContent = { solid: 'Solid walls', see: 'See-through walls', hidden: 'Walls hidden' }[wallMode]; }

function signature(o){
  if (o.kind === 'wall') return JSON.stringify([o, doorsOf(o.id)]);
  if (o.kind === 'door') return JSON.stringify([o, byId(o.wall)]);
  if (o.kind === 'logger') return JSON.stringify([o, byId(o.host)]);
  return JSON.stringify(o);
}
function build(o){
  let g;
  if (o.kind === 'floor'){ g = M.buildFloor(o); g.position.set(o.x, 0, o.z); }
  else if (o.kind === 'wall'){ g = M.buildWall(o, doorsOf(o.id), wallMat); }
  else if (o.kind === 'door'){ const w = byId(o.wall); if (!w) return null; g = M.buildDoor(o, w); g.position.set(w.x1, 0, w.z1); g.rotation.y = -M.wallAngle(w);
    if (!doorK.has(o.id)) doorK.set(o.id, o.open ? 1 : 0); g.userData.anim(easeIO(doorK.get(o.id))); }
  else if (o.kind === 'rack'){ g = M.buildRack(o); g.position.set(o.x, 0, o.z); g.rotation.y = rad(o.rot); }
  else if (o.kind === 'item'){ g = M.buildItem(o.item); g.position.set(o.x, 0, o.z); g.rotation.y = rad(o.rot); }
  else if (o.kind === 'logger'){ g = buildLogger(); placeLoggerGroup(g, o);
    const tag = document.createElement('div'); tag.className = 'ltag'; tag.textContent = o.name;
    const lab = new CSS2DObject(tag); lab.position.set(0, .075, 0); lab.center.set(.5, 1); g.add(lab); g.userData.tag = tag; tag.hidden = !showTags;
    tag.addEventListener('pointerdown', e => { e.stopPropagation(); select({ id: o.id }); });
    g.userData.setReading(readings.get(o.id) ?? NaN); }
  if (!g) return null;
  g.userData.objId = o.id; g.traverse(c => { c.userData.objId = o.id; });
  g.visible = isShown(o);
  if (o.locked && o.kind !== 'logger'){       // a small lock badge on top of locked objects
    const b = new THREE.Box3().setFromObject(g), el = document.createElement('div'); el.className = 'lockbadge'; el.innerHTML = ICON.lock; el.title = `${o.name} is locked`;
    const lab = new CSS2DObject(el);
    lab.position.copy(g.worldToLocal(V3((b.min.x + b.max.x)/2, b.max.y + .12, (b.min.z + b.max.z)/2))); g.add(lab); }
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
    const sig = signature(o) + (o.kind === 'logger' && byId(o.host)?.hidden ? 'h' : ''), v = views.get(o.id);
    if (v && v.sig === sig){ v.group.visible = isShown(o) && !(o.kind === 'logger' && byId(o.host)?.hidden); continue; }
    if (v){ disposeLabels(v.group); world.remove(v.group); }
    const g = build(o); if (!g){ views.delete(o.id); continue; }
    if (o.kind === 'logger' && byId(o.host)?.hidden) g.visible = false;
    world.add(g); views.set(o.id, { group: g, sig });
  }
  // a moved rack moves the loggers on it
  for (const o of ofKind('logger')){ const v = views.get(o.id); if (v) placeLoggerGroup(v.group, o); }
  updateSelBoxes(); updateGizmo(); updateStats(); $('#empty').hidden = S.objects.length > 0 || !['select', 'move', 'rotate', 'scale'].includes(mode);
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
    if (h.object.isCSS2DObject || !h.face) continue;
    const o = byId(h.object.userData.objId); if (!o || o.hidden || !filter(o, h)) continue;
    if (wallMode !== 'solid' && (o.kind === 'wall' || o.kind === 'door')){ wallHit = wallHit || { o, hit: h }; continue; }
    return { o, hit: h };
  }
  return wallHit;
}
const snapV = v => round(Math.round(v/S.snap)*S.snap, 4);

/* ---------- tools ---------- */
let mode = 'select', placeKind = null, ghost = null, ghostRot = 0, drag = null;
const TOOL_HINTS = {
  select: 'Select: click to select · Shift/Ctrl+click to add · Shift+drag empty space to box-select · drag an object to move it (guides snap it to neighbours) · right-click for actions',
  move: 'Move: drag the arrows to move along one axis, the square to move freely · snaps to the grid',
  rotate: 'Rotate: drag the ring · snaps every ' + '15°' + ' · R turns 90°',
  scale: 'Scale: drag the handles to resize a floor',
  hand: 'Hand: drag to pan the view · objects cannot move with this tool',
  orbit: 'Orbit: drag to turn the view around the warehouse · objects cannot move with this tool',
  floor: 'Floor: drag on the ground to draw a floor · Esc to stop',
  wall: 'Wall: drag to draw a wall on the floor · ends snap to the grid and to other walls · Esc to stop',
  place: 'Place: green means it fits, red means it cannot go there · click to place · R rotate · Esc to stop',
  logger: 'Logger: click a rack (or a wall) to put a logger on that spot · Esc to stop',
};
const EDIT_TOOLS = ['select', 'move', 'rotate', 'scale'];
function setMode(m, kind = null){
  if (m === 'place' && kind === 'tool:floor'){ m = 'floor'; kind = null; }
  if (m === 'place' && kind === 'tool:wall'){ m = 'wall'; kind = null; }
  if (m === 'place' && kind === 'tool:logger'){ m = 'logger'; kind = null; }
  mode = m; placeKind = kind; clearGhost(); clearGuides(); drag = null; hideTip();
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === m));
  document.querySelectorAll('[data-lib]').forEach(b => b.classList.toggle('on', (m === 'place' && b.dataset.lib === kind) || b.dataset.lib === 'tool:' + m));
  $('#hint').textContent = TOOL_HINTS[m].replace('15°', S.rotSnap + '°');
  view.style.cursor = m === 'hand' ? 'grab' : m === 'orbit' ? 'move' : EDIT_TOOLS.includes(m) ? 'default' : 'crosshair';
  controls.mouseButtons.LEFT = m === 'hand' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  $('#empty').hidden = S.objects.length > 0 || !EDIT_TOOLS.includes(m);
  updateGizmo();
}
function clearGhost(){ if (ghost){ overlay.remove(ghost); ghost = null; } overlay.children.filter(c => c.userData.preview).forEach(c => { if (c.isCSS2DObject) c.element.remove(); overlay.remove(c); }); }

/* ---------- selection ---------- */
let selection = [];                    // [{ id, load? }]; the last one is the primary
const primary = () => selection[selection.length - 1] || null;
const selObjects = () => selection.filter(s => s.load == null).map(s => byId(s.id)).filter(Boolean);
// selecting one member of a group selects the whole group
function expandGroups(list){ const out = [...list];
  for (const s of list){ const o = byId(s.id); if (o && o.group && s.load == null) for (const x of S.objects) if (x.group === o.group && !out.some(t => t.id === x.id && t.load == null)) out.unshift({ id: x.id }); }
  return out; }
function select(s){ selection = s ? expandGroups([s]) : []; afterSelect(); }
function setSelection(list){ selection = expandGroups(list); afterSelect(); }
function toggleSel(s){
  const i = selection.findIndex(t => t.id === s.id && t.load == s.load);
  if (i >= 0){ const o = byId(s.id); selection = selection.filter(t => !(t.id === s.id && t.load == s.load) && !(o.group && s.load == null && byId(t.id)?.group === o.group)); }
  else selection = expandGroups([...selection.filter(t => t.load == null && s.load == null), s]);
  afterSelect(); }
function afterSelect(){ updateSelBoxes(); updateGizmo(); renderPanel(); }
const isSelected = id => selection.some(s => s.id === id && s.load == null);

const selPool = [];
let hoverId = null, invalidIds = new Set();
const hoverBox = new THREE.Box3Helper(new THREE.Box3(), '#7fb2f0'); hoverBox.visible = false; overlay.add(hoverBox);
function selGroupOf(s){
  const v = views.get(s.id); if (!v) return null;
  if (s.load != null){ let found = null; v.group.traverse(c => { if (!found && c.isMesh && c.userData.load === s.load) found = c.parent; }); return found; }
  return v.group;
}
const handles = [];
function updateSelBoxes(){
  for (const h of handles) overlay.remove(h); handles.length = 0;
  let n = 0;
  for (const s of selection){ const o = byId(s.id), g = selGroupOf(s); if (!o || !g || o.kind === 'logger' || !g.visible) continue;
    let hb = selPool[n]; if (!hb){ hb = new THREE.Box3Helper(new THREE.Box3(), '#2f7de1'); overlay.add(hb); selPool.push(hb); }
    hb.userData.sel = s; hb.visible = true; n++;
    hb.material.color.set(invalidIds.has(o.id) ? '#e2483d' : o.locked ? '#8d939b' : '#2f7de1'); hb.material.linewidth = 2;
    g.updateMatrixWorld(true); hb.box.setFromObject(g, true); }
  for (let i = n; i < selPool.length; i++){ selPool[i].visible = false; selPool[i].userData.sel = null; }
  const o = primary() && byId(primary().id);
  if (o && o.kind === 'wall' && selection.length === 1 && !o.locked && EDIT_TOOLS.includes(mode)) for (const end of [1, 2]){
    const hm = new THREE.Mesh(new THREE.SphereGeometry(.14, 16, 12), new THREE.MeshBasicMaterial({ color: '#2f7de1' }));
    hm.position.set(o['x' + end], o.h + .15, o['z' + end]); hm.userData.handle = end; overlay.add(hm); handles.push(hm); }
}
function setHover(id){
  if (id === hoverId) return; hoverId = id;
  const v = id != null && !isSelected(id) && views.get(id);
  hoverBox.visible = !!v; if (v){ v.group.updateMatrixWorld(true); hoverBox.box.setFromObject(v.group, true); }
}

/* ---------- moving, rotating and checking a set of objects ---------- */
const MOVABLE = ['rack', 'item', 'floor', 'wall'];
const onFloor = f => S.objects.filter(o => o.id !== f.id && !o.locked && (
  (o.kind === 'rack' || o.kind === 'item') && Math.abs(o.x - f.x) <= f.w/2 + .01 && Math.abs(o.z - f.z) <= f.d/2 + .01 ||
  o.kind === 'wall' && [[o.x1, o.z1], [o.x2, o.z2]].every(([x, z]) => Math.abs(x - f.x) <= f.w/2 + .05 && Math.abs(z - f.z) <= f.d/2 + .05)));
const withContents = list => { const out = [...list]; for (const f of list) if (f.kind === 'floor') for (const o of onFloor(f)) if (!out.includes(o)) out.push(o); return out; };
const movableSel = () => withContents(selObjects().filter(o => MOVABLE.includes(o.kind) && !o.locked));
const snapshot = list => list.map(o => JSON.parse(JSON.stringify(o)));
function restore(list, snap){ list.forEach((o, i) => { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, snap[i]); }); }
function translate(list, dx, dz){
  for (const o of list){
    if (o.kind === 'wall'){ o.x1 = round(o.x1 + dx); o.x2 = round(o.x2 + dx); o.z1 = round(o.z1 + dz); o.z2 = round(o.z2 + dz); }
    else { o.x = round(o.x + dx); o.z = round(o.z + dz); } }
}
function rotateAbout(list, cx, cz, dDeg){
  const t = rad(dDeg), c = Math.cos(t), s = Math.sin(t);
  const rot = (x, z) => [cx + (x - cx)*c + (z - cz)*s, cz - (x - cx)*s + (z - cz)*c];
  for (const o of list){
    if (o.kind === 'wall'){ [o.x1, o.z1] = rot(o.x1, o.z1).map(v => round(v)); [o.x2, o.z2] = rot(o.x2, o.z2).map(v => round(v)); }
    else { [o.x, o.z] = rot(o.x, o.z).map(v => round(v));
      if (o.kind === 'floor'){ if (Math.round(dDeg/90) % 2){ [o.w, o.d] = [o.d, o.w]; } }
      else o.rot = normRot((o.rot || 0) + dDeg); } }
}
// within 3° of a quarter turn counts as a quarter turn (fixes small slips)
const normRot = r => { r = ((r % 360) + 360) % 360; const q = Math.round(r/90)*90; return round(Math.abs(r - q) < 3 ? q % 360 : r, 2); };
// everything that could be affected when these objects change: themselves, their doors, and every door clear zone
function affected(list){ const ids = new Set(list.map(o => o.id));
  if (list.some(o => o.kind === 'floor')) return [...list, ...S.objects.filter(o => !ids.has(o.id))];      // a floor carries everything: check it all
  return [...list, ...S.objects.filter(o => o.kind === 'door' && !ids.has(o.id))]; }
// problems an edit creates; anything that was already wrong (e.g. in an imported layout) does not block unrelated edits
const badIds = () => new Set(S.objects.filter(o => R.problem(o, S)).map(o => o.id));
function check(list, base = null){ const all = affected(list); return R.firstProblem(base ? all.filter(o => !base.has(o.id)) : all, S); }
const selCentre = list => { const b = list.reduce((a, o) => { const f = R.footprint(o, S); if (!f) return a; const q = R.aabb(f); return { x0: Math.min(a.x0, q.x0), x1: Math.max(a.x1, q.x1), z0: Math.min(a.z0, q.z0), z1: Math.max(a.z1, q.z1) }; }, { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  return { x: (b.x0 + b.x1)/2, z: (b.z0 + b.z1)/2, box: b }; };
// run an edit on a set of objects: if it leaves anything invalid, try nudging out of shallow overlaps, else undo it and say why
function edit(list, fn, okMsg){
  const base = badIds(), snap = snapshot(list); fn();
  let bad = check(list, base);
  if (bad && list.length === 1 && 'x' in list[0] && list[0].kind !== 'floor' && R.settle(list[0], S)){ bad = check(list, base); if (!bad) toast('Nudged into the nearest free spot'); }
  if (bad){ restore(list, snap); toast(`${bad.o.name || typeName(bad.o)}: ${bad.why}`); sync(); renderPanel(); return false; }
  commit(); renderPanel(); if (okMsg) toast(okMsg); return true;
}

/* ---------- guides: snap lines and distance labels while something moves ---------- */
const guideMat = new THREE.LineDashedMaterial({ color: '#e2483d', dashSize: .15, gapSize: .1, depthTest: false, transparent: true });
const measMat = new THREE.LineBasicMaterial({ color: '#2f7de1', depthTest: false, transparent: true });
function clearGuides(){ for (const c of [...guides.children]){ if (c.isCSS2DObject) c.element.remove(); c.traverse?.(k => { if (k.isCSS2DObject) k.element.remove(); }); guides.remove(c); } }
function guideLine(a, b, mat){ const g = new THREE.BufferGeometry().setFromPoints([a, b]), l = new THREE.Line(g, mat); l.computeLineDistances(); l.renderOrder = 999; guides.add(l); }
function measLabel(text, p){ const el = document.createElement('div'); el.className = 'meas'; el.textContent = text; const o = new CSS2DObject(el); o.position.copy(p); guides.add(o); }
function drawGuides(gs, box, ids){
  clearGuides();
  const y = .03;
  if (gs.x){ const a = gs.x.src, z0 = Math.min(a.z0, box.z0) - .3, z1 = Math.max(a.z1, box.z1) + .3; guideLine(V3(gs.x.at, y, z0), V3(gs.x.at, y, z1), guideMat); }
  if (gs.z){ const a = gs.z.src, x0 = Math.min(a.x0, box.x0) - .3, x1 = Math.max(a.x1, box.x1) + .3; guideLine(V3(x0, y, gs.z.at), V3(x1, y, gs.z.at), guideMat); }
  const c = R.clearances(box, S, ids), mx = (box.x0 + box.x1)/2, mz = (box.z0 + box.z1)/2, y2 = .05;
  const show = (d, a, b, mid) => { if (d == null || d < .01) return; guideLine(a, b, measMat); measLabel(d.toFixed(2) + ' m', mid); };
  show(c['-x'], V3(box.x0 - c['-x'], y2, mz), V3(box.x0, y2, mz), V3(box.x0 - c['-x']/2, y2, mz));
  show(c['+x'], V3(box.x1, y2, mz), V3(box.x1 + c['+x'], y2, mz), V3(box.x1 + c['+x']/2, y2, mz));
  show(c['-z'], V3(mx, y2, box.z0 - c['-z']), V3(mx, y2, box.z0), V3(mx, y2, box.z0 - c['-z']/2));
  show(c['+z'], V3(mx, y2, box.z1), V3(mx, y2, box.z1 + c['+z']), V3(mx, y2, box.z1 + c['+z']/2));
}
// move a set by (dx, dz) from their start state, snapping to the grid and then to neighbouring edges; returns the problem if any
function dragMove(d, dx, dz){
  restore(d.list, d.snap);
  if (d.axis === 'x') dz = 0; if (d.axis === 'z') dx = 0;
  // grid: keep the lead object on the grid
  const lead = d.snap[d.leadIndex], lx = lead.kind === 'wall' ? lead.x1 : lead.x, lz = lead.kind === 'wall' ? lead.z1 : lead.z;
  dx = snapV(lx + dx) - lx; dz = snapV(lz + dz) - lz;
  translate(d.list, dx, dz);
  const ids = new Set(d.list.map(o => o.id)), fps = d.list.map(o => R.footprint(o, S)).filter(Boolean);
  const gs = R.guideSnap(fps, S, ids, Math.max(.12, S.snap*.9));
  let gx = d.axis === 'z' ? null : gs.x, gz = d.axis === 'x' ? null : gs.z;
  if (gx || gz){ translate(d.list, gx ? gx.d : 0, gz ? gz.d : 0); }
  const box = selCentre(d.list).box;
  drawGuides({ x: gx, z: gz }, box, ids);
  const bad = check(d.list, d.base); invalidIds = bad ? new Set(d.list.map(o => o.id)) : new Set();
  sync(); showTip(bad ? `<b class="bad">Cannot go here</b><br>${esc(bad.o.name || typeName(bad.o))}: ${esc(bad.why)}` : null, d.lastEvent);
  return bad;
}

/* ---------- gizmo (move / rotate / scale handles) ---------- */
function updateGizmo(){
  const list = movableSel();
  const want = ['move', 'rotate', 'scale'].includes(mode) && list.length && !drag;
  if (!want || (mode === 'scale' && !(list.length === 1 && list[0].kind === 'floor'))){ tc.detach(); return; }
  if (mode === 'rotate' && list.every(o => o.kind === 'floor')){ tc.detach(); return; }
  if (tc.dragging) return;
  const c = selCentre(list); pivot.position.set(c.x, .02, c.z); pivot.rotation.set(0, 0, 0); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld();
  tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[mode]);
  tc.showY = mode === 'rotate'; tc.showX = mode !== 'rotate'; tc.showZ = mode !== 'rotate';
  tc.setTranslationSnap(S.snap); tc.setRotationSnap(rad(S.rotSnap)); tc.setScaleSnap(null);
  tc.attach(pivot);
}
let gz = null;
tc.addEventListener('mouseDown', () => { const list = movableSel(); gz = { list, snap: snapshot(list), p0: pivot.position.clone(), base: badIds() }; hideCtx(); });
tc.addEventListener('objectChange', () => {
  if (!gz) return; restore(gz.list, gz.snap);
  const dx = pivot.position.x - gz.p0.x, dz = pivot.position.z - gz.p0.z;
  if (tc.mode === 'translate') translate(gz.list, round(dx), round(dz));
  else if (tc.mode === 'rotate') rotateAbout(gz.list, gz.p0.x, gz.p0.z, round(deg(pivot.rotation.y), 2));
  else if (tc.mode === 'scale'){ const f = gz.list[0], s0 = gz.snap[0]; f.w = Math.max(.5, snapV(s0.w*pivot.scale.x)); f.d = Math.max(.5, snapV(s0.d*pivot.scale.z)); }
  const ids = new Set(gz.list.map(o => o.id)), box = selCentre(gz.list).box;
  drawGuides({}, box, ids);
  const bad = check(gz.list, gz.base); invalidIds = bad ? new Set(gz.list.map(o => o.id)) : new Set();
  gz.bad = bad; sync();
});
tc.addEventListener('mouseUp', () => {
  if (!gz) return; const g = gz; gz = null; clearGuides(); invalidIds = new Set();
  if (tc.mode === 'scale' && g.list[0].kind === 'floor'){ const f = g.list[0], s0 = g.snap[0], nw = f.w, nd = f.d; restore(g.list, g.snap); resizeFloor(f, { w: nw, d: nd, x: s0.x, z: s0.z }); updateGizmo(); return; }
  if (g.bad){ restore(g.list, g.snap); toast(`${g.bad.o.name || typeName(g.bad.o)}: ${g.bad.why}`); sync(); }
  else commit();
  renderPanel(); updateGizmo();
});

/* ---------- placing and dragging loads (from the library, off a rack, or off the floor) ---------- */
function rackSlots(itemType, skip){
  const out = [];
  for (const r of ofKind('rack')){ const v = views.get(r.id); if (!v || r.hidden) continue; v.group.updateMatrixWorld(true);
    for (let b = 0; b < r.bays; b++) for (let l = 0; l <= r.levels; l++) for (const p of [0, 1]){
      const idx = r.loads.findIndex(x => x.b === b && x.l === l && x.p === p);
      if (idx >= 0 && !(skip && skip.rack === r.id && skip.index === idx)) continue;
      const ignore = skip && skip.rack === r.id ? skip.index : -1;
      const local = M.slotLocal(r, b, l, p), w = local.clone().applyMatrix4(v.group.matrixWorld);
      out.push({ rack: r, b, l, p, world: w, why: r.locked ? `${r.name} is locked` : M.rackCheck(r, b, l, itemType, ignore) });
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
  const p = groundAt(e); if (!p) return null;
  const f = V3(snapV(p.x), 0, snapV(p.z)), test = { id: -1, kind: 'item', item: itemType, x: f.x, z: f.z, rot: ghostRot };
  const ignore = skip && skip.item ? new Set([skip.item]) : new Set();
  return { floor: f, why: R.problem(test, S, ignore) || (R.firstProblem(S.objects.filter(o => o.kind === 'door'), { ...S, objects: [...S.objects.filter(o => !ignore.has(o.id)), test] })?.why ?? '') };
}
function showLoadGhost(itemType, tgt){
  if (!ghost || ghost.userData.type !== itemType){ clearGhost(); ghost = M.ghostify(M.buildItem(itemType)); ghost.userData.type = itemType; overlay.add(ghost); }
  overlay.children.filter(c => c.userData.preview).forEach(c => { if (c.isCSS2DObject) c.element.remove(); overlay.remove(c); });
  if (!tgt){ ghost.visible = false; return; } ghost.visible = true;
  const bad = tgt.slot ? tgt.slot.why : tgt.why;
  tintGhost(ghost, !bad);
  if (tgt.slot){ const s = tgt.slot; ghost.position.copy(s.world); ghost.position.y += .04; ghost.rotation.y = rad(s.rack.rot);
    const b = new THREE.Box3Helper(new THREE.Box3().setFromCenterAndSize(V3(), V3(.82, .02, 1.22)), s.why ? '#e2483d' : '#2fae55');
    const holder = new THREE.Group(); holder.add(b); holder.position.copy(s.world); holder.position.y += .012; holder.rotation.y = rad(s.rack.rot); holder.userData.preview = true; overlay.add(holder); }
  else { ghost.position.copy(tgt.floor); ghost.rotation.y = rad(ghostRot); footMark({ cx: tgt.floor.x, cz: tgt.floor.z, hw: .4, hd: .6, ang: rad(ghostRot) }, !bad); }
}
// a ground outline under a ghost: green where it fits, red where it does not
function footMark(f, ok){
  const pts = R.corners(f).map(([x, z]) => V3(x, .02, z)); pts.push(pts[0].clone());
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ok ? '#2fae55' : '#e2483d', depthTest: false }));
  l.renderOrder = 998; l.userData.preview = true; overlay.add(l);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(f.hw*2, f.hd*2), new THREE.MeshBasicMaterial({ color: ok ? '#2fae55' : '#e2483d', transparent: true, opacity: .16, depthWrite: false }));
  fill.rotation.set(-Math.PI/2, 0, 0); fill.rotateOnWorldAxis(V3(0, 1, 0), f.ang); fill.position.set(f.cx, .015, f.cz); fill.userData.preview = true; overlay.add(fill);
}
function tintGhost(g, ok){ const c = new THREE.Color(ok ? '#2fae55' : '#e2483d'); g.traverse(o => { if (o.isMesh && o.material){ if (!o.userData.c0) o.userData.c0 = o.material.color.clone(); o.material.color.copy(o.userData.c0).lerp(c, .45); } }); }
function dropLoad(itemType, tgt, from){
  // from: null (library), { rack, index } or { item: id }
  if (!tgt) return false;
  if (from && from.rack && byId(from.rack).locked){ toast(`${byId(from.rack).name} is locked`); return false; }
  if (from && from.item && byId(from.item).locked){ toast(`${byId(from.item).name} is locked`); return false; }
  if (tgt.slot){ const s = tgt.slot;
    if (s.why){ toast(s.why); return false; }
    if (from && from.rack){ const r = byId(from.rack), ld = r.loads[from.index];
      if (from.rack === s.rack.id){ Object.assign(ld, { b: s.b, l: s.l, p: s.p }); }
      else { r.loads.splice(from.index, 1); s.rack.loads.push({ b: s.b, l: s.l, p: s.p, item: itemType }); } }
    else { if (from && from.item) S.objects = S.objects.filter(o => o.id !== from.item); s.rack.loads.push({ b: s.b, l: s.l, p: s.p, item: itemType }); }
    drops.set(`${s.rack.id}:${s.b}-${s.l}-${s.p}`, { y: .18, v: 0, kg: M.ITEMS[itemType].kg });    // it is set down from just above
    return true; }
  if (tgt.why){ toast(tgt.why); return false; }
  const f = tgt.floor;
  if (from && from.rack){ const r = byId(from.rack); r.loads.splice(from.index, 1); const o = { id: newId(), kind: 'item', item: itemType, x: f.x, z: f.z, rot: ghostRot }; o.name = nextName(o); S.objects.push(o); }
  else if (from && from.item){ const it = byId(from.item); it.x = f.x; it.z = f.z; }
  else { const o = { id: newId(), kind: 'item', item: itemType, x: f.x, z: f.z, rot: ghostRot }; o.name = nextName(o); S.objects.push(o); }
  return true;
}

/* ---------- doors: find the wall under the pointer ---------- */
function doorTarget(e, type, ignoreId){
  const p = groundAt(e); if (!p) return null;
  const T = M.DOOR_TYPES[type]; let best = null;
  for (const w of ofKind('wall')){ if (w.hidden) continue;
    const L = M.wallLen(w), ux = (w.x2 - w.x1)/L, uz = (w.z2 - w.z1)/L, dx = p.x - w.x1, dz = p.z - w.z1;
    const t = dx*ux + dz*uz, dist = Math.abs(dx*uz - dz*ux);
    if (t < -.3 || t > L + .3 || dist > 1.5) continue;
    if (!best || dist < best.dist) best = { wall: w, t, dist, L };
  }
  if (!best) return null;
  const w = best.wall, cur = ignoreId ? byId(ignoreId) : null, dw = cur ? cur.w : T.w, dh = cur ? cur.h : T.h;
  const t = Math.max(dw/2 + .05, Math.min(best.L - dw/2 - .05, snapV(best.t)));
  const test = { id: ignoreId ?? -1, kind: 'door', type, wall: w.id, t, w: dw, h: dh, name: cur ? cur.name : 'This door' };
  const why = w.locked ? `${w.name} is locked` : R.problem(test, { ...S, objects: [...S.objects.filter(o => o.id !== ignoreId), test] });
  return { wall: w, t, w: dw, h: dh, why };
}

/* ---------- loggers: the surface point under the pointer ---------- */
function loggerTarget(e){
  const h = pick(e, (o, hit) => (o.kind === 'rack' && hit.object.userData.load == null) || o.kind === 'wall');
  if (!h) return null;
  const n = h.hit.face.normal.clone().transformDirection(h.hit.object.matrixWorld);
  if (n.dot(ray.ray.direction) > 0) n.negate();
  const u = h.hit.object.userData;
  return { host: h.o, point: h.hit.point.clone(), normal: n, part: u.part || 'rack', bay: u.bay, level: u.level };
}
function showLoggerGhost(t){
  if (!ghost || ghost.userData.type !== 'logger'){ clearGhost(); ghost = M.ghostify(buildLogger(), '#2f7de1'); ghost.scale.setScalar(1.6); ghost.userData.type = 'logger'; overlay.add(ghost); }
  ghost.visible = !!t; if (t){ orientLogger(ghost, t.point, t.normal); tintGhost(ghost, !t.host.locked); }
}
// a logger is stored in its host's own frame (rack or wall), so it moves with the host
function hostFields(t){
  const g = views.get(t.host.id).group; g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  return { host: t.host.id, part: t.part, bay: t.bay, level: t.level, local: t.point.clone().applyMatrix4(inv).toArray().map(v => round(v, 4)),
    normal: t.normal.clone().transformDirection(inv).toArray().map(v => round(v, 4)) };
}
function addLogger(t){
  const o = { id: newId(), kind: 'logger', ...hostFields(t) }; o.name = nextName(o);
  S.objects.push(o); return o;
}

/* ---------- pointer input (captured before the orbit controls and the gizmo see it) ---------- */
let down = null, marquee = null;
view.addEventListener('pointerdown', e => {
  hideCtx();
  if (e.button !== 0 || e.target.closest('.ltag, #loggercard, #ctx')) return;
  if (tc.dragging || (tc.object && tc.axis)) return;              // the gizmo has it
  down = { x: e.clientX, y: e.clientY, moved: false };
  if (mode === 'hand' || mode === 'orbit'){ drag = null; return; }       // camera only
  if (EDIT_TOOLS.includes(mode)){
    setRay(e); const hh = ray.intersectObjects(handles)[0];
    if (hh){ drag = { type: 'handle', end: hh.object.userData.handle, wall: primary().id, snap: snapshot([byId(primary().id)]), base: badIds() }; controls.enabled = false; return; }
    const h = pick(e);
    if (!h){ if (e.shiftKey){ marquee = { x: e.clientX, y: e.clientY, add: e.ctrlKey || e.metaKey }; controls.enabled = false; drawMarquee(e); } drag = { type: 'none' }; return; }
    const o = h.o, loadIdx = h.hit.object.userData.load, s = o.kind === 'rack' && loadIdx != null ? { id: o.id, load: loadIdx } : { id: o.id };
    // Shift+drag over the floor box-selects (Ctrl+click still adds the floor itself)
    if (o.kind === 'floor' && e.shiftKey){ marquee = { x: e.clientX, y: e.clientY, add: e.ctrlKey || e.metaKey }; controls.enabled = false; drawMarquee(e); drag = { type: 'none' }; return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey){ toggleSel(s); drag = null; controls.enabled = false; return; }
    // the floor is underfoot everywhere: clicking it selects it, dragging on it turns the camera (use Move or the panel to move it)
    if (o.kind === 'floor'){ drag = { type: 'floorclick', s }; return; }
    if (!selection.some(t => t.id === s.id && t.load == s.load)) select(s);
    controls.enabled = false;
    const g0 = groundAt(e) || V3();
    if (o.locked){ drag = { type: 'locked', o }; return; }
    if (o.kind === 'rack' && loadIdx != null) drag = { type: 'load', from: { rack: o.id, index: loadIdx }, item: o.loads[loadIdx].item, armed: false };
    else if (o.kind === 'item' && selection.length === 1) drag = { type: 'load', from: { item: o.id }, item: o.item, armed: false };
    else if (o.kind === 'door') drag = { type: 'door', o, snap: snapshot([o]) };
    else if (o.kind === 'logger') drag = { type: 'logger', o, snap: snapshot([o]) };
    else { const list = movableSel(); if (!list.length){ drag = null; return; }
      drag = { type: 'group', list, snap: snapshot(list), start: g0, leadIndex: Math.max(0, list.findIndex(x => x.id === o.id)), axis: null, base: badIds(), clicked: s }; }
    return;
  }
  controls.enabled = false;
  if (mode === 'floor' || mode === 'wall'){ const p = groundAt(e); if (!p) return; drag = { type: mode, a: snapPoint(p, mode === 'wall'), b: null }; return; }
  if (mode === 'place' || mode === 'logger') drag = { type: 'click' };
}, true);

addEventListener('pointermove', e => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
  if (libDrag) return libDragMove(e);
  if (marquee){ drawMarquee(e); return; }
  const inView = e.target.closest && e.target.closest('#view');
  if (!inView && !drag){ setHover(null); hideTip(); return; }
  if (mode === 'place' && !drag) return placeHover(e);
  if (mode === 'logger' && !drag) return showLoggerGhost(loggerTarget(e));
  if (EDIT_TOOLS.includes(mode) && !drag){
    if (tc.dragging || (tc.object && tc.axis)){ setHover(null); hideTip(); return; }
    const h = pick(e); view.style.cursor = h ? (h.o.locked ? 'not-allowed' : 'pointer') : 'default'; setHover(h ? h.o.id : null);
    scheduleTip(h, e); return; }
  if (!drag) return;
  if (drag.type === 'floor' || drag.type === 'wall'){ const p = groundAt(e); if (!p) return; drag.b = snapPoint(p, drag.type === 'wall', drag.a); drawPreview(); return; }
  if (!down || !down.moved) return;
  hideTip(true);
  if (drag.type === 'floorclick') return;
  if (drag.type === 'locked'){ showTip(`<b>${esc(drag.o.name)}</b> is locked<br>Unlock it in the panel to move it`, e); return; }
  if (drag.type === 'group'){ const p = groundAt(e); if (!p) return; drag.lastEvent = e; drag.bad = dragMove(drag, p.x - drag.start.x, p.z - drag.start.z); }
  else if (drag.type === 'handle'){ const p = groundAt(e); if (!p) return; const w = byId(drag.wall), q = snapPoint(p, true, drag.end === 1 ? V3(w.x2, 0, w.z2) : V3(w.x1, 0, w.z1), w.id);
    w['x' + drag.end] = round(q.x); w['z' + drag.end] = round(q.z); const bad = check([w], drag.base); invalidIds = bad ? new Set([w.id]) : new Set(); drag.bad = bad; sync(); showTip(bad ? `<b class="bad">Cannot go here</b><br>${esc(bad.why)}` : `${M.wallLen(w).toFixed(2)} m`, e); }
  else if (drag.type === 'door'){ const t = doorTarget(e, drag.o.type, drag.o.id); if (t && t.wall.id === drag.o.wall && !t.why){ drag.o.t = round(t.t); sync(); } }
  else if (drag.type === 'logger'){ const t = loggerTarget(e); if (t && !t.host.locked){ Object.assign(drag.o, hostFields(t)); sync(); } }
  else if (drag.type === 'load'){
    if (!drag.armed){ drag.armed = true; hideSource(drag.from, true); }
    drag.tgt = loadTarget(e, drag.item, drag.from.rack ? drag.from : drag.from); showLoadGhost(drag.item, drag.tgt); }
});

addEventListener('pointerup', e => {
  if (libDrag) return libDragEnd(e);
  if (marquee){ finishMarquee(e); marquee = null; controls.enabled = true; down = null; drag = null; return; }
  const d = drag; drag = null; controls.enabled = !tc.dragging;
  const wasClick = down && !down.moved; down = null;
  if (!d){ updateGizmo(); return; }
  hideTip();
  if (d.type === 'none'){ if (wasClick && e.target.closest && e.target.closest('#view')) select(null); return; }
  if (d.type === 'floorclick'){ if (wasClick) select(d.s); return; }
  if (d.type === 'locked'){ if (!wasClick) toast(`${d.o.name} is locked`); return; }
  if (d.type === 'floor'){ clearPreview(); if (!d.b) return; const w = Math.abs(d.b.x - d.a.x), dd = Math.abs(d.b.z - d.a.z);
    if (w < .5 || dd < .5) return toast('Drag a bigger area for the floor');
    const o = { id: newId(), kind: 'floor', x: round((d.a.x + d.b.x)/2), z: round((d.a.z + d.b.z)/2), w: round(w), d: round(dd) };
    const why = R.problem(o, S); if (why) return toast(`Floor: ${why}`);
    o.name = nextName(o); S.objects.push(o); commit(); select({ id: o.id }); setMode('select'); frameAll(); return; }
  if (d.type === 'wall'){ clearPreview(); if (!d.b || d.a.distanceTo(d.b) < .3) return;
    const o = { id: newId(), kind: 'wall', x1: round(d.a.x), z1: round(d.a.z), x2: round(d.b.x), z2: round(d.b.z), h: 3, t: .2 };
    const why = R.problem(o, S); if (why) return toast(`Wall: ${why}`);
    o.name = nextName(o); S.objects.push(o); commit(); return; }
  if (d.type === 'click'){ if (!wasClick) return;
    if (mode === 'logger'){ const t = loggerTarget(e); if (!t) return toast('Click on a rack or a wall to place a logger'); if (t.host.locked) return toast(`${t.host.name} is locked`);
      const o = addLogger(t); commit(); toast(`${o.name} placed`); return; }
    if (mode === 'place') return placeClick(e); return; }
  if (d.type === 'load'){
    if (!d.armed){ return; }
    hideSource(d.from, false); clearGhost();
    if (dropLoad(d.item, d.tgt, d.from)){ select(null); commit(); } else sync();
    return; }
  if (d.type === 'group'){ clearGuides(); invalidIds = new Set();
    if (wasClick){ if (selection.length > 1 && !byId(d.clicked.id).group) select(d.clicked); else sync(); return; }
    if (d.bad){ // a shallow overlap with one object is nudged clear; anything else goes back where it was
      if (d.list.length === 1 && d.list[0].kind !== 'floor' && R.settle(d.list[0], S) && !check(d.list, d.base)){ toast('Nudged into the nearest free spot'); commit(); renderPanel(); return; }
      restore(d.list, d.snap); toast(`${d.bad.o.name || typeName(d.bad.o)}: ${d.bad.why}`); sync(); return; }
    commit(); renderPanel(); return; }
  if (d.type === 'handle'){ invalidIds = new Set(); if (d.bad){ restore([byId(d.wall)], d.snap); toast(d.bad.why); sync(); return; } commit(); renderPanel(); return; }
  commit(); renderPanel();
});
view.addEventListener('dblclick', e => { if (!EDIT_TOOLS.includes(mode)) return; const h = pick(e); if (h && h.o.kind === 'door') toggleDoor(h.o); });
// X or Z while dragging locks the move to that axis; again frees it
addEventListener('keydown', e => { if (!drag || drag.type !== 'group' || /input|select|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(); if (k === 'x' || k === 'z'){ drag.axis = drag.axis === k ? null : k; toast(drag.axis ? `Moving along ${k.toUpperCase()} only` : 'Moving freely'); e.stopImmediatePropagation(); } }, true);
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
  let m, ok;
  if (d.type === 'floor'){ const w = Math.abs(d.b.x - d.a.x), dd = Math.abs(d.b.z - d.a.z); if (w < .01 || dd < .01) return;
    ok = !R.problem({ id: -1, kind: 'floor', x: (d.a.x + d.b.x)/2, z: (d.a.z + d.b.z)/2, w: Math.max(w, .5), d: Math.max(dd, .5) }, S);
    m = M.ghostify(M.box(w, .15, dd, M.mat('#d8d4cb'), (d.a.x + d.b.x)/2, -.07, (d.a.z + d.b.z)/2), ok ? '#2f7de1' : '#e2483d');
    sizeTag(`${w.toFixed(2)} × ${dd.toFixed(2)} m`, V3((d.a.x + d.b.x)/2, .2, (d.a.z + d.b.z)/2), ok); }
  else { const L = d.a.distanceTo(d.b); if (L < .01) return;
    const w = { id: -1, kind: 'wall', x1: d.a.x, z1: d.a.z, x2: d.b.x, z2: d.b.z, h: 3, t: .2 }; ok = !R.problem(w, S);
    m = M.ghostify(M.buildWall(w, [], M.mat('#d5d8db')), ok ? '#2f7de1' : '#e2483d');
    sizeTag(`${L.toFixed(2)} m${ok ? '' : ' · ' + R.problem(w, S)}`, V3((d.a.x + d.b.x)/2, 3.3, (d.a.z + d.b.z)/2), ok); }
  m.userData.preview = true; overlay.add(m);
}
function sizeTag(text, p, ok = true){ const el = document.createElement('div'); el.className = 'sizetag' + (ok ? '' : ' bad'); el.textContent = text; const o = new CSS2DObject(el); o.position.copy(p); o.userData.preview = true; overlay.add(o); }
function clearPreview(){ overlay.children.filter(c => c.userData.preview).forEach(c => { if (c.isCSS2DObject) c.element.remove(); overlay.remove(c); }); }

/* ---------- marquee (Shift+drag on empty space) ---------- */
const mq = $('#marquee');
function drawMarquee(e){ const r = view.getBoundingClientRect(), x0 = Math.min(marquee.x, e.clientX) - r.left, y0 = Math.min(marquee.y, e.clientY) - r.top;
  Object.assign(mq.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - marquee.x) + 'px', height: Math.abs(e.clientY - marquee.y) + 'px' }); }
function finishMarquee(e){
  mq.style.display = 'none'; const r = renderer.domElement.getBoundingClientRect();
  const x0 = Math.min(marquee.x, e.clientX), x1 = Math.max(marquee.x, e.clientX), y0 = Math.min(marquee.y, e.clientY), y1 = Math.max(marquee.y, e.clientY);
  if (x1 - x0 < 4 && y1 - y0 < 4) return;
  const hits = [];
  for (const o of S.objects){ if (o.hidden || o.kind === 'logger') continue; const v = views.get(o.id); if (!v || !v.group.visible) continue;
    const c = new THREE.Box3().setFromObject(v.group).getCenter(V3()).project(camera), sx = (c.x + 1)/2*r.width + r.left, sy = (1 - c.y)/2*r.height + r.top;
    if (c.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hits.push({ id: o.id }); }
  setSelection(marquee.add ? [...selection.filter(s => s.load == null), ...hits.filter(h => !isSelected(h.id))] : hits);
  if (hits.length) toast(`${selection.length} selected`);
}

/* ---------- library placement (click to pick, or drag straight into the view) ---------- */
function placeHover(e){
  const k = placeKind;
  if (k.startsWith('item:')){ const it = k.slice(5); showLoadGhost(it, loadTarget(e, it)); return; }
  if (k.startsWith('door:')){ const type = k.slice(5), t = doorTarget(e, type);
    if (!ghost || ghost.userData.type !== k){ clearGhost(); ghost = new THREE.Group(); ghost.userData.type = k; overlay.add(ghost); }
    ghost.clear(); ghost.visible = !!t; if (!t){ showTip('Point at a wall to place a door', e); return; }
    const T = M.DOOR_TYPES[type], g = M.ghostify(M.buildDoor({ type, t: t.t, w: T.w, h: T.h, open: false }, t.wall), t.why ? '#e2483d' : '#2fae55');
    g.position.set(t.wall.x1, 0, t.wall.z1); g.rotation.y = -M.wallAngle(t.wall); ghost.add(g); ghost.userData.t = t;
    clearPreview(); footMark(R.doorZone({ type, t: t.t, w: T.w }, t.wall), !t.why); showTip(t.why ? `<b class="bad">Cannot go here</b><br>${esc(t.why)}` : null, e); return; }
  if (k === 'rack'){ const p = groundAt(e); if (!p) return;
    if (!ghost || ghost.userData.type !== k){ clearGhost(); ghost = M.ghostify(M.buildRack(newRack(0, 0))); ghost.userData.type = k; overlay.add(ghost); }
    const test = { ...newRack(snapV(p.x), snapV(p.z)), id: -1 };
    // snap the new rack to neighbours like a moved one
    const gs = R.guideSnap([R.footprint(test, S)], S, new Set(), Math.max(.12, S.snap*.9)); if (gs.x) test.x = round(test.x + gs.x.d); if (gs.z) test.z = round(test.z + gs.z.d);
    const why = R.problem(test, S) || R.firstProblem(S.objects.filter(o => o.kind === 'door'), { ...S, objects: [...S.objects, test] })?.why || '';
    ghost.position.set(test.x, 0, test.z); ghost.rotation.y = rad(ghostRot); tintGhost(ghost, !why); ghost.userData.test = test; ghost.userData.why = why;
    clearPreview(); footMark(R.footprint(test, S), !why); drawGuides({ x: gs.x, z: gs.z }, R.aabb(R.footprint(test, S)), new Set());
    showTip(why ? `<b class="bad">Cannot go here</b><br>${esc(why)}` : null, e); }
}
const newRack = (x, z) => ({ id: 0, kind: 'rack', name: '', x, z, rot: ghostRot, bays: 1, levels: 2, pitch: 1.4, rating: 1, loads: [] });
function placeClick(e){
  const k = placeKind;
  if (k.startsWith('item:')){ const it = k.slice(5); if (dropLoad(it, loadTarget(e, it), null)) commit(); return true; }
  if (k.startsWith('door:')){ const type = k.slice(5), t = doorTarget(e, type); if (!t){ toast('Point at a wall to place a door'); return false; }
    if (t.why){ toast(t.why); return false; }
    const o = { id: newId(), kind: 'door', type, wall: t.wall.id, t: round(t.t), w: t.w, h: t.h, open: false }; o.name = nextName(o); S.objects.push(o); commit(); return true; }
  if (k === 'rack'){ placeHover(e); const test = ghost && ghost.userData.test; if (!test) return false;
    if (ghost.userData.why){ toast(ghost.userData.why); return false; }
    const o = { ...test, id: newId() }; o.name = nextName(o); S.objects.push(o); clearGuides(); commit(); select({ id: o.id }); return true; }
  return false;
}
let libDrag = null;
function libDragStart(e, key){ libDrag = { key, x: e.clientX, y: e.clientY, live: false }; }
function libDragMove(e){
  if (!libDrag.live){ if (Math.hypot(e.clientX - libDrag.x, e.clientY - libDrag.y) < 6) return; libDrag.live = true; setMode('place', libDrag.key); document.body.classList.add('dragging-lib'); }
  if (!['floor', 'wall', 'logger'].includes(mode)){ if (e.target.closest && e.target.closest('#view')) placeHover(e); else { clearGhost(); hideTip(); } }
}
function libDragEnd(e){
  const d = libDrag; libDrag = null; document.body.classList.remove('dragging-lib');
  if (!d.live || /^tool:(floor|wall)$/.test(d.key)){ setMode('place', d.key); return; }   // a click (or a drawing tool) just picks the tool
  const over = e.target.closest && e.target.closest('#view');
  if (over && mode === 'place'){ placeClick(e); }
  else if (over && mode === 'logger'){ const t = loggerTarget(e); if (t && !t.host.locked){ const o = addLogger(t); commit(); toast(`${o.name} placed`); } }
  setMode('select');
}

/* ---------- clipboard, duplicate, delete, lock, hide, group ---------- */
function gatherForCopy(){
  const ids = new Set(selObjects().map(o => o.id));
  // doors travel with their wall, loggers with their rack or wall
  for (const o of S.objects) if ((o.kind === 'door' && ids.has(o.wall)) || (o.kind === 'logger' && ids.has(o.host))) ids.add(o.id);
  return S.objects.filter(o => ids.has(o.id));
}
let clip = null;
function copySel(){ const list = gatherForCopy(); if (!list.length) return toast('Select something to copy');
  clip = JSON.parse(JSON.stringify(list)); try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch {}
  toast(`Copied ${list.length} object${list.length > 1 ? 's' : ''}`); }
function pasteClip(at){
  if (!clip){ try { clip = JSON.parse(localStorage.getItem(CLIP_KEY)); } catch {} }
  if (!clip || !clip.length) return toast('Nothing to paste');
  const items = JSON.parse(JSON.stringify(clip)), map = new Map();
  for (const o of items){ const n = newId(); map.set(o.id, n); o.id = n; delete o.group; delete o.locked; }
  for (const o of items){ if (o.wall != null && map.has(o.wall)) o.wall = map.get(o.wall); if (o.host != null && map.has(o.host)) o.host = map.get(o.host); }
  const placed = items.filter(o => o.kind !== 'door' && o.kind !== 'logger' || (o.kind === 'door' && items.some(w => w.id === o.wall)) || (o.kind === 'logger' && items.some(h => h.id === o.host)));
  const movers = placed.filter(o => MOVABLE.includes(o.kind));
  for (const o of placed){ o.name = nextName(o); }
  S.objects.push(...placed);
  // find a free spot: the pointer if given, else stepping out from the original until everything fits
  const c = selCentre(movers), tries = [];
  if (at) tries.push([snapV(at.x - c.x), snapV(at.z - c.z)]);
  for (let r = 1; r <= 12; r++) for (const [a, b] of [[1, 1], [1, 0], [0, 1], [-1, 0], [0, -1], [1, -1], [-1, 1], [-1, -1]]) tries.push([a*r*.5*Math.max(1, S.snap*10), b*r*.5*Math.max(1, S.snap*10)]);
  let ok = false;
  for (const [dx, dz] of tries){ translate(movers, dx, dz); if (!check(movers)){ ok = true; break; } translate(movers, -dx, -dz); }
  if (!ok){ S.objects = S.objects.filter(o => !placed.includes(o)); return toast('No free space to paste into here'); }
  commit(); setSelection(placed.filter(o => o.kind !== 'logger' && o.kind !== 'door').map(o => ({ id: o.id }))); toast(`Pasted ${placed.length} object${placed.length > 1 ? 's' : ''}`);
}
function duplicate(){ if (!selObjects().length) return toast('Select something to duplicate'); const keep = clip; copySel(); pasteClip(); clip = keep; }
function removeSel(){
  if (!selection.length) return;
  const p = primary();
  if (selection.length === 1 && p.load != null){ const o = byId(p.id); if (o.locked) return toast(`${o.name} is locked`); o.loads.splice(p.load, 1); select(null); commit(); return; }
  const objs = selObjects(), locked = objs.filter(o => o.locked), gone = new Set(objs.filter(o => !o.locked).map(o => o.id));
  if (!gone.size) return toast(locked.length === 1 ? `${locked[0].name} is locked` : 'Those objects are locked');
  for (const x of S.objects) if ((x.kind === 'door' && gone.has(x.wall)) || (x.kind === 'logger' && gone.has(x.host))) gone.add(x.id);
  S.objects = S.objects.filter(x => !gone.has(x.id)); select(null); commit();
  toast(`Deleted ${gone.size} object${gone.size > 1 ? 's' : ''}` + (locked.length ? ` · ${locked.length} locked kept` : ''));
}
function setLock(list, on){ for (const o of list) o.locked = on || undefined; commit(); renderPanel(); toast(on ? `Locked ${list.length}` : `Unlocked ${list.length}`); }
function setHidden(list, on){ for (const o of list) o.hidden = on || undefined; if (on) selection = selection.filter(s => !list.some(o => o.id === s.id)); commit(); renderPanel(); }
function groupSel(){ const list = selObjects().filter(o => o.kind !== 'logger'); if (list.length < 2) return toast('Select two or more objects to group');
  const g = 'g' + newId(); for (const o of list) o.group = g; commit(); renderPanel(); toast(`Grouped ${list.length} objects`); }
function ungroupSel(){ const list = selObjects().filter(o => o.group); if (!list.length) return toast('Nothing grouped in the selection'); for (const o of list) delete o.group; commit(); renderPanel(); toast('Ungrouped'); }
function rotateSel(dDeg){
  const list = movableSel().filter(o => o.kind !== 'floor' || dDeg % 90 === 0); if (!list.length) return toast(selObjects().some(o => o.locked) ? 'Locked objects cannot rotate' : 'Select a rack, load or wall to rotate');
  const c = selCentre(list); edit(list, () => rotateAbout(list, c.x, c.z, dDeg));
}
function nudge(dx, dz){ const list = movableSel(); if (!list.length) return false; edit(list, () => translate(list, dx, dz)); return true; }
function toggleDoor(o){ o.open = !o.open; saveLocal(); lastSnap = JSON.stringify(S); renderPanel(); }

/* ---------- align and distribute (in plan: X runs left-right, Z runs top-bottom as seen from above) ---------- */
function align(how){
  const list = movableSel(); if (list.length < 2) return toast('Select two or more objects to align');
  const boxes = list.map(o => R.aabb(R.footprint(o, S))), all = selCentre(list).box;
  edit(list, () => list.forEach((o, i) => { const b = boxes[i], w = b.x1 - b.x0, d = b.z1 - b.z0;
    let dx = 0, dz = 0;
    if (how === 'left') dx = all.x0 - b.x0; if (how === 'right') dx = all.x1 - b.x1;
    if (how === 'top') dz = all.z0 - b.z0; if (how === 'bottom') dz = all.z1 - b.z1;
    if (how === 'hcenter' || how === 'center') dx = (all.x0 + all.x1)/2 - (b.x0 + w/2);
    if (how === 'vcenter' || how === 'center') dz = (all.z0 + all.z1)/2 - (b.z0 + d/2);
    translate([o], dx, dz); }), 'Aligned');
}
function distribute(axis){
  const list = movableSel(); if (list.length < 3) return toast('Select three or more objects to distribute');
  const items = list.map(o => ({ o, b: R.aabb(R.footprint(o, S)) })), lo = axis === 'x' ? 'x0' : 'z0', hi = axis === 'x' ? 'x1' : 'z1';
  items.sort((a, b) => a.b[lo] - b.b[lo]);
  const span = items[items.length - 1].b[hi] - items[0].b[lo], used = items.reduce((a, it) => a + it.b[hi] - it.b[lo], 0), gap = (span - used)/(items.length - 1);
  edit(list, () => { let at = items[0].b[lo]; for (const it of items){ const d = at - it.b[lo]; translate([it.o], axis === 'x' ? d : 0, axis === 'z' ? d : 0); at += it.b[hi] - it.b[lo] + gap; } }, `Spaced evenly, ${gap.toFixed(2)} m apart`);
}

/* ---------- warehouse size changes keep everything valid ---------- */
// the walls standing on the floor's edges move with them; objects left outside are pulled back in; anything that still
// does not fit cancels the change
function resizeFloor(f, nv){
  const base = badIds(), old = { ...f }, snap = snapshot(S.objects), t = .2;
  Object.assign(f, nv);
  const ox0 = old.x - old.w/2, ox1 = old.x + old.w/2, oz0 = old.z - old.d/2, oz1 = old.z + old.d/2, nx0 = f.x - f.w/2, nx1 = f.x + f.w/2, nz0 = f.z - f.d/2, nz1 = f.z + f.d/2;
  const mapX = x => Math.abs(x - (ox0 + t/2)) < .02 ? nx0 + t/2 : Math.abs(x - (ox1 - t/2)) < .02 ? nx1 - t/2 : Math.abs(x - ox0) < .02 ? nx0 : Math.abs(x - ox1) < .02 ? nx1 : x;
  const mapZ = z => Math.abs(z - (oz0 + t/2)) < .02 ? nz0 + t/2 : Math.abs(z - (oz1 - t/2)) < .02 ? nz1 - t/2 : Math.abs(z - oz0) < .02 ? nz0 : Math.abs(z - oz1) < .02 ? nz1 : z;
  const inOld = (x, z) => x >= ox0 - .05 && x <= ox1 + .05 && z >= oz0 - .05 && z <= oz1 + .05;
  for (const w of ofKind('wall')) if (inOld(w.x1, w.z1) && inOld(w.x2, w.z2)){ const L0 = M.wallLen(w);
    [w.x1, w.z1, w.x2, w.z2] = [mapX(w.x1), mapZ(w.z1), mapX(w.x2), mapZ(w.z2)].map(v => round(v));
    const L = M.wallLen(w); if (L !== L0) for (const d of doorsOf(w.id)) d.t = round(Math.max(d.w/2 + .05, Math.min(L - d.w/2 - (d.type === 'hslide' ? d.w + .05 : .05), d.t))); }
  // pull objects that were on this floor back inside it, clear of any wall standing on an edge
  const edgeWall = side => ofKind('wall').some(w => side === 'x0' ? Math.abs(w.x1 - (nx0 + t/2)) < .02 && Math.abs(w.x2 - (nx0 + t/2)) < .02
    : side === 'x1' ? Math.abs(w.x1 - (nx1 - t/2)) < .02 && Math.abs(w.x2 - (nx1 - t/2)) < .02
    : side === 'z0' ? Math.abs(w.z1 - (nz0 + t/2)) < .02 && Math.abs(w.z2 - (nz0 + t/2)) < .02 : Math.abs(w.z1 - (nz1 - t/2)) < .02 && Math.abs(w.z2 - (nz1 - t/2)) < .02);
  const ix0 = nx0 + (edgeWall('x0') ? t : 0), ix1 = nx1 - (edgeWall('x1') ? t : 0), iz0 = nz0 + (edgeWall('z0') ? t : 0), iz1 = nz1 - (edgeWall('z1') ? t : 0);
  const moved = [];
  for (const o of S.objects) if ((o.kind === 'rack' || o.kind === 'item') && inOld(o.x, o.z) && !o.locked){
    const b = R.aabb(R.footprint(o, S)); let dx = 0, dz = 0;
    if (b.x0 < ix0) dx = ix0 - b.x0; if (b.x1 > ix1) dx = ix1 - b.x1; if (b.z0 < iz0) dz = iz0 - b.z0; if (b.z1 > iz1) dz = iz1 - b.z1;
    if (dx || dz){ o.x = round(o.x + dx); o.z = round(o.z + dz); moved.push(o); } }
  // anything pushed into a neighbour gets nudged clear if the overlap is shallow
  for (const o of moved) R.settle(o, S, .6);
  const bad = R.firstProblem(S.objects.filter(o => !base.has(o.id)), S);
  if (bad){ S.objects.splice(0, S.objects.length, ...snap); toast(`Cannot resize: ${bad.o.name || typeName(bad.o)} — ${bad.why}`); sync(); renderPanel(); return false; }
  commit(); renderPanel(); toast(moved.length ? `Resized · ${moved.length} object${moved.length > 1 ? 's' : ''} moved in from the edge` : 'Resized'); return true;
}

/* ---------- context menu ---------- */
const ctx = $('#ctx');
let ctxDown = null;
view.addEventListener('pointerdown', e => { if (e.button === 2) ctxDown = { x: e.clientX, y: e.clientY }; }, true);
view.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (ctxDown && Math.hypot(e.clientX - ctxDown.x, e.clientY - ctxDown.y) > 5) return;     // that was a pan
  const h = EDIT_TOOLS.includes(mode) ? pick(e) : null, at = groundAt(e);
  if (h){ const s = h.o.kind === 'rack' && h.hit.object.userData.load != null ? { id: h.o.id, load: h.hit.object.userData.load } : { id: h.o.id };
    if (!selection.some(t => t.id === s.id && t.load == s.load)) select(s); }
  const objs = selObjects(), o = h && h.o, many = objs.length > 1, anyLocked = objs.some(x => x.locked), anyUnlocked = objs.some(x => !x.locked);
  const items = [];
  if (primary() && primary().load != null){ items.push(['Remove load', 'Del', () => removeSel()]); }
  else if (o){
    items.push([`<b>${esc(many ? objs.length + ' objects' : o.name)}</b>`, '', null]);
    if (o.kind === 'door') items.push([o.open ? 'Close door' : 'Open door', 'dbl-click', () => toggleDoor(o)]);
    if (o.kind === 'rack' && !o.locked) items.push(['Place a logger here', 'L', () => { setMode('logger'); toast('Click the spot on the rack'); }]);
    if (movableSel().some(x => x.kind !== 'floor')) items.push(['Rotate 90°', 'R', () => rotateSel(90)]);
    items.push(['Duplicate', 'Ctrl+D', duplicate], ['Copy', 'Ctrl+C', copySel], ['Paste', 'Ctrl+V', () => pasteClip(at)]);
    if (anyUnlocked) items.push(['Lock', 'Ctrl+L', () => setLock(objs, true)]); if (anyLocked) items.push(['Unlock', 'Ctrl+L', () => setLock(objs, false)]);
    items.push(['Hide', 'Ctrl+H', () => setHidden(objs, true)]);
    if (many) items.push(['Group', 'Ctrl+G', groupSel]); if (objs.some(x => x.group)) items.push(['Ungroup', 'Ctrl+Shift+G', ungroupSel]);
    if (many) items.push(['-'], ['Align left', '', () => align('left')], ['Align right', '', () => align('right')], ['Align top', '', () => align('top')], ['Align bottom', '', () => align('bottom')], ['Align centres', '', () => align('center')]);
    items.push(['-'], ['Zoom to selection', '.', () => frameSel()], ['Delete', 'Del', removeSel, 'danger']);
  } else {
    items.push(['Paste here', 'Ctrl+V', () => pasteClip(at)], ['Select all', 'Ctrl+A', selectAll], ['-'], ['Fit view', '.', frameAll], ['Reset camera', 'Home', resetCam]);
    if (S.objects.some(x => x.hidden)) items.push(['Show hidden objects', 'Alt+H', () => setHidden(S.objects.filter(x => x.hidden), false)]);
  }
  ctx.innerHTML = items.map((it, i) => it[0] === '-' ? '<hr>' : it[2] ? `<button data-i="${i}" class="${it[3] || ''}"><span>${it[0]}</span><kbd>${it[1]}</kbd></button>` : `<div class="ctxh">${it[0]}</div>`).join('');
  ctx.querySelectorAll('button').forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.i][2](); });
  const r = view.getBoundingClientRect(); ctx.hidden = false;
  ctx.style.left = Math.min(e.clientX - r.left, r.width - ctx.offsetWidth - 6) + 'px'; ctx.style.top = Math.min(e.clientY - r.top, r.height - ctx.offsetHeight - 6) + 'px';
});
function hideCtx(){ ctx.hidden = true; }
addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) hideCtx(); });

/* ---------- hover tooltip ---------- */
const tip = $('#hovertip'); let tipT = 0, tipFor = null;
function describe(o, load){
  if (load != null){ const ld = o.loads[load], it = M.ITEMS[ld.item]; return `<b>${esc(it.name)}</b> on ${esc(o.name)}<br>Bay ${ld.b + 1}, ${ld.l ? 'level ' + ld.l : 'ground'} · ${it.kg} kg`; }
  const lock = o.locked ? ' <span class="lk">locked</span>' : '';
  if (o.kind === 'rack') return `<b>${esc(o.name)}</b> · Pallet rack${lock}<br>${o.bays} bay${o.bays > 1 ? 's' : ''} × ${o.levels} levels · ${M.rackWidth(o).toFixed(2)} × 1.10 × ${M.rackHeight(o).toFixed(2)} m<br>${o.loads.length} loads · ${o.loads.reduce((a, x) => a + M.ITEMS[x.item].kg, 0).toLocaleString('en')} kg`;
  if (o.kind === 'item'){ const it = M.ITEMS[o.item]; return `<b>${esc(o.name)}</b> · ${esc(it.name)}${lock}<br>0.80 × 1.20 × ${it.h.toFixed(2)} m · ${it.kg} kg`; }
  if (o.kind === 'floor') return `<b>${esc(o.name)}</b> · Floor${lock}<br>${o.w.toFixed(2)} × ${o.d.toFixed(2)} m · ${(o.w*o.d).toFixed(1)} m²`;
  if (o.kind === 'wall') return `<b>${esc(o.name)}</b> · Wall${lock}<br>${M.wallLen(o).toFixed(2)} m long · ${o.h.toFixed(2)} m high · ${(o.t*100).toFixed(0)} cm thick`;
  if (o.kind === 'door') return `<b>${esc(o.name)}</b> · ${esc(M.DOOR_TYPES[o.type].name)}${lock}<br>${o.w.toFixed(2)} × ${o.h.toFixed(2)} m · ${o.open ? 'open' : 'closed'} · double-click to ${o.open ? 'close' : 'open'}`;
  if (o.kind === 'logger'){ const t = readings.get(o.id); return `<b>${esc(o.name)}</b> · Elitech RC-5<br>${Number.isFinite(t) ? t.toFixed(1) + ' °C · ' : ''}${esc(loggerWhere(o))}`; }
  return esc(o.name);
}
function scheduleTip(h, e){
  const key = h ? h.o.id + ':' + (h.hit.object.userData.load ?? '') : null;
  if (key !== tipFor){ tipFor = key; hideTip(); clearTimeout(tipT); if (h) tipT = setTimeout(() => showTip(describe(h.o, h.o.kind === 'rack' ? h.hit.object.userData.load : null), e), 350); }
  else if (!tip.hidden) placeTip(e);
}
function showTip(html, e){ if (!html){ tip.hidden = true; return; } tip.innerHTML = html; tip.hidden = false; if (e) placeTip(e); }
function placeTip(e){ const r = view.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - r.left + 16, r.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(e.clientY - r.top + 18, r.height - tip.offsetHeight - 6) + 'px'; }
function hideTip(keepKey){ tip.hidden = true; clearTimeout(tipT); if (!keepKey) tipFor = null; }

/* ---------- camera: smooth moves, preset views, fit, reset ---------- */
let camTween = null;
function flyTo(pos, target, ms = 650){ camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, t: 0, ms }; }
function sceneBox(onlySel){
  const b = new THREE.Box3();
  if (onlySel) for (const s of selection){ const g = selGroupOf(s); if (g) b.expandByObject(g); }
  else for (const [id, v] of views){ const o = byId(id); if (o && isShown(o)) b.expandByObject(v.group); }
  return b;
}
const VIEWS = { front: [0, .32, 1], back: [0, .32, -1], left: [-1, .32, 0], right: [1, .32, 0], top: [0, 1, .0001], bottom: [0, -1, .0001], iso: [.62, .58, .72] };
function viewFrom(name, box = sceneBox()){
  if (box.isEmpty()) box = new THREE.Box3(V3(-8, 0, -6), V3(8, 3, 6));
  const c = box.getCenter(V3()), s = box.getSize(V3()), dir = V3(...VIEWS[name]).normalize();
  const fov = rad(camera.fov), need = Math.max(s.x, s.z, s.y*1.2)*.62/Math.tan(fov/2)/Math.min(1, camera.aspect*.95);
  controls.maxPolarAngle = name === 'bottom' ? Math.PI - .02 : 1.48;
  flyTo(c.clone().addScaledVector(dir, Math.max(3, need)), c);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
function frameAll(){ viewFrom('iso'); }
function frameSel(){ const b = sceneBox(true); if (b.isEmpty()) return frameAll(); const dir = camera.position.clone().sub(controls.target).normalize(), c = b.getCenter(V3()), s = b.getSize(V3()).length();
  flyTo(c.clone().addScaledVector(dir, Math.max(1.2, s*1.4)), c); }
function resetCam(){ controls.maxPolarAngle = 1.48; flyTo(V3(0, 17, 15).add(sceneBox().isEmpty() ? V3() : sceneBox().getCenter(V3()).setY(0)), sceneBox().isEmpty() ? V3() : sceneBox().getCenter(V3()).setY(0)); }
function zoomBy(k){ const off = camera.position.clone().sub(controls.target).multiplyScalar(k); flyTo(controls.target.clone().add(off), controls.target.clone(), 250); }
function orbitBy(az, el){ const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off);
  sph.theta += az; sph.phi = Math.max(.05, Math.min(controls.maxPolarAngle, sph.phi - el)); off.setFromSpherical(sph); flyTo(controls.target.clone().add(off), controls.target.clone(), 220); }

/* ---------- keyboard ---------- */
const selectAll = () => { setSelection(S.objects.filter(o => !o.hidden && o.kind !== 'logger').map(o => ({ id: o.id }))); toast(`${selection.length} selected`); };
addEventListener('keydown', e => {
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y'){ e.preventDefault(); redo(); return; }
  if (mod && k === 'd'){ e.preventDefault(); duplicate(); return; }
  if (mod && k === 'c'){ e.preventDefault(); copySel(); return; }
  if (mod && k === 'x'){ e.preventDefault(); copySel(); removeSel(); return; }
  if (mod && k === 'v'){ e.preventDefault(); pasteClip(); return; }
  if (mod && k === 'a'){ e.preventDefault(); selectAll(); return; }
  if (mod && k === 'g'){ e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (mod && k === 'l'){ e.preventDefault(); const l = selObjects(); if (l.length) setLock(l, !l.every(o => o.locked)); return; }
  if (mod && k === 'h'){ e.preventDefault(); const l = selObjects(); if (l.length) setHidden(l, true); return; }
  if (e.altKey && k === 'h'){ e.preventDefault(); setHidden(S.objects.filter(o => o.hidden), false); return; }
  if (k === 'escape'){ hideCtx(); if (mode !== 'select') setMode('select'); else select(null); return; }
  if (k === 'delete' || k === 'backspace'){ e.preventDefault(); removeSel(); return; }
  if (k === 'r' && !mod){ if (mode === 'place'){ ghostRot = (ghostRot + 90) % 360; if (ghost && placeKind === 'rack') ghost.rotation.y = rad(ghostRot); } else rotateSel(e.shiftKey ? -90 : 90); return; }
  if (k.startsWith('arrow')){ e.preventDefault(); const st = e.shiftKey ? S.snap*10 : S.snap;
    const d = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] }[k];
    if (EDIT_TOOLS.includes(mode) && movableSel().length) nudge(round(d[0]), round(d[1]));
    else orbitBy(k === 'arrowleft' ? .2 : k === 'arrowright' ? -.2 : 0, k === 'arrowup' ? .12 : k === 'arrowdown' ? -.12 : 0);
    return; }
  if (k === '+' || k === '='){ zoomBy(.8); return; } if (k === '-' || k === '_'){ zoomBy(1.25); return; }
  if (k === '.'){ selection.length ? frameSel() : frameAll(); return; }
  if (k === 'home'){ resetCam(); return; }
  const views_ = { 1: 'front', 2: 'back', 3: 'left', 4: 'right', 5: 'top', 6: 'bottom', 0: 'iso' };
  if (!mod && views_[e.key] && /^Digit|^Numpad/.test(e.code)){ viewFrom(views_[e.key]); return; }
  const tools = { v: 'select', g: 'move', e: 'rotate', t: 'scale', h: 'hand', o: 'orbit', f: 'floor', w: 'wall', l: 'logger' };
  if (!mod && !e.altKey && tools[k]) setMode(tools[k]);
  if (k === '?' || (e.shiftKey && k === '/')) $('#keys').hidden = !$('#keys').hidden;
});

/* ---------- properties panel ---------- */
const panel = $('#panel');
function field(label, key, value, attrs = '', unit = ''){ return `<label class="f"><span>${label}${unit ? ` <i>${unit}</i>` : ''}</span><input data-k="${key}" value="${esc(value)}" ${attrs}></label>`; }
function num(label, key, value, step = .1, extra = '', unit = 'm'){ return field(label, key, round(value, 3), `type="number" step="${step}" ${extra}`, unit); }
const row = (...cells) => `<div class="row">${cells.join('')}</div>`;
const sect = (title, body, open = true) => `<details class="sec" ${open ? 'open' : ''}><summary>${title}</summary><div class="secb">${body}</div></details>`;
const ro = (label, value) => `<label class="f ro"><span>${label}</span><output>${value}</output></label>`;
function headerBar(o){
  return `<div class="ph"><div class="pt"><input class="nm" data-k="name" value="${esc(o.name || '')}" ${o.locked ? 'disabled' : ''} aria-label="Name"><small>${esc(typeName(o))}${o.group ? ' · grouped' : ''}</small></div>
    <div class="pa"><button class="ib ${o.locked ? 'on' : ''}" data-act="lock" title="${o.locked ? 'Unlock (Ctrl+L)' : 'Lock against changes (Ctrl+L)'}">${o.locked ? ICON.lock : ICON.unlock}</button>
    <button class="ib" data-act="hide" title="Hide (Ctrl+H)">${ICON.eye}</button></div></div>
    ${o.locked ? '<p class="lockednote">Locked: it cannot be moved, rotated, edited or deleted. Unlock to change it.</p>' : ''}`;
}
function renderPanel(){
  const sels = selection, p = primary(), o = p && byId(p.id);
  $('#loggercard').hidden = !(o && o.kind === 'logger' && sels.length === 1);
  if (!o){ panel.innerHTML = scenePanel(); bindPanel(null); return; }
  if (selObjects().length > 1){ panel.innerHTML = multiPanel(); bindPanel('multi'); return; }
  let h = '';
  const dis = o.locked ? 'disabled' : '';
  if (o.kind === 'rack' && p.load != null){ const ld = o.loads[p.load]; if (!ld){ select(null); return; } const it = M.ITEMS[ld.item];
    h = `<div class="ph"><div class="pt"><b class="nm2">${esc(it.name)}</b><small>Load on ${esc(o.name)}</small></div></div>
      ${sect('Details', ro('Weight', it.kg + ' kg') + ro('Size', `0.80 × 1.20 × ${it.h.toFixed(2)} m`) + ro('Position', `Bay ${ld.b + 1}, ${ld.l ? 'level ' + ld.l : 'ground'}, ${ld.p ? 'right' : 'left'}`))}
      <p class="note">Drag it to another position or onto the floor.</p><button data-act="del" ${dis}>Remove load</button>`;
    panel.innerHTML = h; bindPanel(o); return; }
  h = headerBar(o);
  if (o.kind === 'floor')
    h += sect('Size', row(num('Width', 'w', o.w, S.snap, dis), num('Depth', 'd', o.d, S.snap, dis)) + ro('Area', (o.w*o.d).toFixed(1) + ' m²'))
       + sect('Position', row(num('X', 'x', o.x, S.snap, dis), num('Y', 'y', 0, .1, 'disabled'), num('Z', 'z', o.z, S.snap, dis)) + '<p class="note">Walls on its edges and objects on it follow a resize.</p>')
       + `<button data-act="walls" ${dis}>Add walls around this floor</button>`;
  else if (o.kind === 'wall'){ const L = M.wallLen(o), a = deg(M.wallAngle(o));
    h += sect('Size', row(num('Length', 'len', L, S.snap, dis), num('Height', 'h', o.h, .1, dis)) + num('Thickness', 't', o.t, .01, dis))
       + sect('Position', row(num('Start X', 'x1', o.x1, S.snap, dis), num('Start Z', 'z1', o.z1, S.snap, dis)) + row(ro('End X', o.x2.toFixed(2) + ' m'), ro('End Z', o.z2.toFixed(2) + ' m')) + num('Angle', 'ang', a, 1, dis, '°'))
       + '<p class="note">Drag the blue dots to move its ends.</p>'; }
  else if (o.kind === 'rack'){ const kg = o.loads.reduce((a, x) => a + M.ITEMS[x.item].kg, 0);
    h += sect('Size', ro('Footprint', `${M.rackWidth(o).toFixed(2)} × 1.10 m`) + ro('Height', M.rackHeight(o).toFixed(2) + ' m')
         + row(num('Bays', 'bays', o.bays, 1, `min="1" max="12" ${dis}`, ''), num('Beam levels', 'levels', o.levels, 1, `min="1" max="8" ${dis}`, ''))
         + num('Level pitch', 'pitch', o.pitch, .05, `min="0.8" max="3" ${dis}`)
         + `<label class="f"><span>Beam rating</span><select data-k="rating" ${dis}>${M.RACK.RAT.map((r, i) => `<option value="${i}" ${i === o.rating ? 'selected' : ''}>${r.kg} kg per level</option>`).join('')}</select></label>`)
       + sect('Position', row(num('X', 'x', o.x, S.snap, dis), num('Y', 'y', 0, .1, 'disabled'), num('Z', 'z', o.z, S.snap, dis)) + num('Rotation', 'rot', o.rot, 1, dis, '°'))
       + sect('Loads', `<p class="kv"><b>${o.loads.length}</b> of ${o.bays*(o.levels + 1)*2} positions · <b>${kg.toLocaleString('en')} kg</b></p>
         <p class="kv">Beam sag <b id="sagmm">0.0 mm</b> · limit L/200 = ${M.RACK.SAG_MM.toFixed(1)} mm</p><p class="note">Sag is drawn ${M.RACK.SAG_EXAG}× deeper so you can see it.</p>
         <button data-act="clearloads" ${dis}>Unload all</button>`); }
  else if (o.kind === 'item'){ const it = M.ITEMS[o.item];
    h += sect('Size', ro('Footprint', '0.80 × 1.20 m') + ro('Height', it.h.toFixed(2) + ' m') + ro('Weight', it.kg + ' kg'))
       + sect('Position', row(num('X', 'x', o.x, S.snap, dis), num('Y', 'y', 0, .1, 'disabled'), num('Z', 'z', o.z, S.snap, dis)) + num('Rotation', 'rot', o.rot, 1, dis, '°'))
       + '<p class="note">Drag it onto a rack to put it away.</p>'; }
  else if (o.kind === 'door'){
    h += sect('Size', row(num('Width', 'w', o.w, .05, dis), num('Height', 'h', o.h, .05, dis)))
       + sect('Position', num('Along the wall', 't', o.t, S.snap, dis) + ro('On', esc(byId(o.wall)?.name || 'wall')))
       + `<button data-act="door">${o.open ? 'Close' : 'Open'} the door</button><p class="note">Double-click a door to open or close it.</p>`; }
  else if (o.kind === 'logger'){ const v = views.get(o.id), wp = v ? v.group.getWorldPosition(V3()) : V3();
    h += sect('Position', row(ro('X', wp.x.toFixed(2) + ' m'), ro('Y', wp.y.toFixed(2) + ' m'), ro('Z', wp.z.toFixed(2) + ' m')) + ro('On', esc(loggerWhere(o))))
       + '<p class="note">Drag the logger to move it along its rack or wall. Its reading is on the card beside it.</p>'; }
  h += `<button data-act="del" class="danger" ${dis}>Delete</button>`;
  panel.innerHTML = h; bindPanel(o);
}
function multiPanel(){
  const objs = selObjects(), mv = movableSel(), locked = objs.filter(o => o.locked).length, c = selCentre(mv.length ? mv : objs);
  const ab = (how, icon, tip) => `<button class="ib" data-act="align:${how}" title="${tip}" ${mv.length < 2 ? 'disabled' : ''}>${ICON[icon]}</button>`;
  return `<div class="ph"><div class="pt"><b class="nm2">${objs.length} objects</b><small>${[...new Set(objs.map(typeName))].join(', ')}${locked ? ` · ${locked} locked` : ''}</small></div>
    <div class="pa"><button class="ib ${locked === objs.length ? 'on' : ''}" data-act="lock" title="Lock / unlock all (Ctrl+L)">${locked === objs.length ? ICON.lock : ICON.unlock}</button><button class="ib" data-act="hide" title="Hide all (Ctrl+H)">${ICON.eye}</button></div></div>
    ${sect('Align', `<div class="tools">${ab('left', 'alignL', 'Align left edges')}${ab('hcenter', 'alignHC', 'Align centres on a vertical line (same X)')}${ab('right', 'alignR', 'Align right edges')}${ab('top', 'alignT', 'Align top edges (as seen from above)')}${ab('vcenter', 'alignVC', 'Align centres on a horizontal line (same Z)')}${ab('bottom', 'alignB', 'Align bottom edges (as seen from above)')}${ab('center', 'alignC', 'Centre on each other')}</div>
      <div class="tools"><button class="ib wide" data-act="dist:x" title="Equal gaps left to right" ${mv.length < 3 ? 'disabled' : ''}>${ICON.distH}<span>Space along X</span></button><button class="ib wide" data-act="dist:z" title="Equal gaps top to bottom" ${mv.length < 3 ? 'disabled' : ''}>${ICON.distV}<span>Space along Z</span></button></div>`)}
    ${sect('Move together', row(num('Move X by', 'dx', 0, S.snap, mv.length ? '' : 'disabled'), num('Move Z by', 'dz', 0, S.snap, mv.length ? '' : 'disabled')) + row(ro('Centre X', c.x.toFixed(2) + ' m'), ro('Centre Z', c.z.toFixed(2) + ' m')))}
    ${sect('Rotate', row(num('Turn by', 'drot', 0, S.rotSnap, mv.length ? '' : 'disabled', '°'), field('Set each to', 'setrot', '', `type="number" step="1" placeholder="—" ${mv.some(o => 'rot' in o) ? '' : 'disabled'}`, '°')))}
    <div class="row"><button data-act="group">Group</button><button data-act="ungroup">Ungroup</button></div>
    <div class="row"><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>`;
}
function scenePanel(){
  return sect('Layout', `${num('Room temperature', 'ambient', S.ambient, .5, '', '°C')}
      ${row(`<label class="f"><span>Snap step</span><select data-k="snap">${[.01, .05, .1, .25, .5, 1].map(v => `<option value="${v}" ${v === S.snap ? 'selected' : ''}>${v < .1 ? v*100 + ' cm' : v*100 + ' cm'}</option>`).join('')}</select></label>`,
        `<label class="f"><span>Grid size</span><select data-k="gridSize">${[.5, 1, 2, 5].map(v => `<option value="${v}" ${v === S.gridSize ? 'selected' : ''}>${v} m</option>`).join('')}</select></label>`)}
      <label class="f"><span>Rotation snap</span><select data-k="rotSnap">${[1, 5, 15, 45, 90].map(v => `<option value="${v}" ${v === S.rotSnap ? 'selected' : ''}>${v}°</option>`).join('')}</select></label>
      <div id="stats"></div>`)
    + sect('Objects', outliner(), true);
}
function outliner(){
  if (!S.objects.length) return '<p class="note">Nothing yet. Draw a floor to start.</p>';
  const order = ['floor', 'wall', 'door', 'rack', 'item', 'logger'];
  const list = [...S.objects].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || String(a.name).localeCompare(String(b.name), 'en', { numeric: true }));
  return `<div class="outl">${list.map(o => { const bad = R.problem(o, S);
    return `<div class="oi ${o.hidden ? 'off' : ''} ${isSelected(o.id) ? 'sel' : ''}" data-id="${o.id}" title="${esc(bad || typeName(o))}">
      <span class="on2">${bad ? '<i class="warn">!</i>' : ''}${esc(o.name)}</span><small>${esc(typeName(o))}</small>
      <button class="ib sm" data-oact="vis" title="${o.hidden ? 'Show' : 'Hide'}">${o.hidden ? ICON.eyeOff : ICON.eye}</button>
      <button class="ib sm ${o.locked ? 'on' : ''}" data-oact="lock" title="${o.locked ? 'Unlock' : 'Lock'}">${o.locked ? ICON.lock : ICON.unlock}</button></div>`; }).join('')}</div>`;
}
function bindPanel(o){
  panel.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => applyField(o, inp.dataset.k, inp.value)));
  panel.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => panelAction(o, b.dataset.act)));
  panel.querySelectorAll('.oi').forEach(row_ => {
    row_.addEventListener('click', e => { if (e.target.closest('button')) return; const id = +row_.dataset.id; const ob = byId(id); if (ob.hidden) return toast('Show it first');
      if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSel({ id }); else select({ id }); });
    row_.querySelectorAll('[data-oact]').forEach(b => b.addEventListener('click', () => { const ob = byId(+row_.dataset.id);
      if (b.dataset.oact === 'vis') setHidden([ob], !ob.hidden); else setLock([ob], !ob.locked); })); });
  updateStats();
}
function applyField(o, k, raw){
  const v = parseFloat(raw);
  if (!o){ if (k === 'ambient' && Number.isFinite(v)) S.ambient = v; if (k === 'snap') S.snap = v; if (k === 'rotSnap') S.rotSnap = v; if (k === 'gridSize'){ S.gridSize = v; makeGrid(); }
    commit(); renderPanel(); updateGizmo(); return; }
  if (o === 'multi'){ const list = movableSel(); if (!Number.isFinite(v)) return renderPanel();
    if (k === 'dx' || k === 'dz') edit(list, () => translate(list, k === 'dx' ? v : 0, k === 'dz' ? v : 0));
    if (k === 'drot') rotateSel(v);
    if (k === 'setrot') edit(list, () => list.forEach(x => { if ('rot' in x) x.rot = normRot(v); }));
    return; }
  if (o.locked){ toast(`${o.name} is locked`); return renderPanel(); }
  if (k === 'name'){ const n = raw.trim(); if (n) o.name = n; commit(); renderPanel(); return; }
  if (!Number.isFinite(v)) return renderPanel();
  if (o.kind === 'floor' && (k === 'x' || k === 'z')){ const list = withContents([o]), d = round(v - o[k]); edit(list, () => translate(list, k === 'x' ? d : 0, k === 'z' ? d : 0)); return; }
  if (o.kind === 'floor' && (k === 'w' || k === 'd')){ resizeFloor(o, { [k]: Math.max(.5, v) }); return; }
  if (o.kind === 'wall' && (k === 'len' || k === 'ang' || k === 'x1' || k === 'z1')){
    edit([o], () => { const L = k === 'len' ? Math.max(.3, v) : M.wallLen(o), a = k === 'ang' ? rad(v) : M.wallAngle(o);
      if (k === 'x1') o.x1 = v; if (k === 'z1') o.z1 = v;
      o.x2 = round(o.x1 + Math.cos(a)*L); o.z2 = round(o.z1 + Math.sin(a)*L);
      for (const d of doorsOf(o.id)) d.t = Math.min(d.t, L - d.w/2 - .05); }); return; }
  if (o.kind === 'rack' && (k === 'bays' || k === 'levels')){
    const n = Math.max(1, Math.round(v)), lost = o.loads.filter(x => k === 'bays' ? x.b >= n : x.l > n);
    if (lost.length){ toast(`Unload ${k === 'bays' ? 'bay ' + (Math.max(...lost.map(x => x.b)) + 1) : 'level ' + Math.max(...lost.map(x => x.l))} first`); return renderPanel(); }
    edit([o], () => { o[k] = Math.min(k === 'bays' ? 12 : 8, n); }); return; }
  if (o.kind === 'rack' && (k === 'pitch' || k === 'rating')){
    const test = { ...o, [k]: k === 'rating' ? Math.round(v) : Math.max(.8, v) }, bad = o.loads.find((x, i) => M.rackCheck(test, x.b, x.l, x.item, i));
    if (bad){ toast(M.rackCheck(test, bad.b, bad.l, bad.item, o.loads.indexOf(bad))); return renderPanel(); }
    o[k] = test[k]; commit(); renderPanel(); return; }
  if (o.kind === 'door' && (k === 'w' || k === 'h' || k === 't')){
    edit([o], () => { o[k] = k === 't' ? v : Math.max(.5, v); }); return; }
  if (o.kind === 'wall' && k === 'h'){ const need = Math.max(0, ...doorsOf(o.id).map(d => d.h + .05)); if (v < need) toast(`A door needs the wall at least ${need.toFixed(2)} m high`); o.h = Math.max(need, v, .3); commit(); renderPanel(); return; }
  if (o.kind === 'wall' && k === 't'){ edit([o], () => { o.t = Math.max(.05, Math.min(1, v)); }); return; }
  if (k === 'rot'){ edit([o], () => { o.rot = normRot(v); }); return; }
  if (k === 'x' || k === 'z'){ edit([o], () => { o[k] = round(v); }); return; }
}
function panelAction(o, act){
  if (o === 'multi'){ const objs = selObjects();
    if (act.startsWith('align:')) return align(act.slice(6));
    if (act === 'dist:x' || act === 'dist:z') return distribute(act.slice(5));
    if (act === 'lock') return setLock(objs, !objs.every(x => x.locked)); if (act === 'hide') return setHidden(objs, true);
    if (act === 'group') return groupSel(); if (act === 'ungroup') return ungroupSel(); if (act === 'dup') return duplicate(); if (act === 'del') return removeSel(); return; }
  if (act === 'lock') return setLock([o], !o.locked);
  if (act === 'hide') return setHidden([o], true);
  if (act === 'door') return toggleDoor(o);
  if (o.locked) return toast(`${o.name} is locked`);
  if (act === 'del') return removeSel();
  if (act === 'clearloads'){ o.loads = []; commit(); renderPanel(); return; }
  if (act === 'walls'){ const t = .2, x0 = o.x - o.w/2 + t/2, x1 = o.x + o.w/2 - t/2, z0 = o.z - o.d/2 + t/2, z1 = o.z + o.d/2 - t/2;
    const added = [];
    for (const [a, b, c, d] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]){
      const w = { id: newId(), kind: 'wall', x1: round(a), z1: round(b), x2: round(c), z2: round(d), h: 3, t }; w.name = nextName(w); S.objects.push(w); added.push(w); }
    const bad = R.firstProblem(added, S);
    if (bad){ S.objects = S.objects.filter(x => !added.includes(x)); toast(`Cannot add the walls: ${bad.why}`); return; }
    commit(); toast('Walls added around the floor'); }
}
function updateStats(){
  const el = $('#stats'); if (!el) return;
  const area = ofKind('floor').reduce((a, f) => a + f.w*f.d, 0), racks = ofKind('rack');
  const pos = racks.reduce((a, r) => a + r.bays*(r.levels + 1)*2, 0), used = racks.reduce((a, r) => a + r.loads.length, 0);
  const bad = S.objects.filter(o => R.problem(o, S)).length;
  el.innerHTML = `<p class="kv">Floor <b>${area.toFixed(1)} m²</b> · racks <b>${racks.length}</b> · positions <b>${used}/${pos}</b></p>
    <p class="kv">Doors <b>${ofKind('door').length}</b> · loggers <b>${ofKind('logger').length}</b>${bad ? ` · <b class="bad">${bad} need attention</b>` : ''}</p>`;
}

/* ---------- logger card: number, live reading, where it is ---------- */
const readings = new Map(), sim = makeSim();
function loggerWhere(o){
  const h = byId(o.host); if (!h) return 'Unattached';
  if (h.kind === 'wall') return `${h.name}, ${o.local[1].toFixed(2)} m up`;
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
  const p = primary(), o = p && byId(p.id); if (!o || o.kind !== 'logger' || selection.length !== 1){ card.hidden = true; return; }
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
  card.querySelector('.del').disabled = !!o.locked;
  card.hidden = false;
}
function positionCard(){
  if (card.hidden) return; const p = primary(), o = p && byId(p.id), v = o && views.get(o.id); if (!v) return;
  const q = v.group.getWorldPosition(V3()).project(camera), r = view.getBoundingClientRect();
  let x = (q.x + 1)/2*r.width + 18, y = (1 - q.y)/2*r.height - 40;
  x = Math.min(r.width - card.offsetWidth - 8, Math.max(8, x)); y = Math.min(r.height - card.offsetHeight - 8, Math.max(8, y));
  card.style.transform = `translate(${x}px, ${y}px)`; card.style.opacity = q.z < 1 ? 1 : 0;
}

/* ---------- toolbar, library, files ---------- */
function buildToolbar(){
  const tools = [['select', 'Select', 'V', 'Select objects; drag to move them'], ['move', 'Move', 'G', 'Move with axis handles'], ['rotate', 'Rotate', 'E', 'Rotate with a ring handle'],
    ['scale', 'Scale', 'T', 'Resize a floor with handles'], ['hand', 'Pan', 'H', 'Pan the view (middle mouse also pans)'], ['orbit', 'Orbit', 'O', 'Orbit the view (dragging empty space also orbits)']];
  $('#tools').innerHTML = tools.map(([k, n, key, tipT]) => `<button data-tool="${k}" title="${tipT} (${key})">${ICON[k === 'move' ? 'move' : k]}<span>${n}</span><kbd>${key}</kbd></button>`).join('');
  $('#tools').querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.tool)));
}
function buildLibrary(thumbs = {}){
  const q = ($('#libsearch').value || '').trim().toLowerCase(), open = JSON.parse(localStorage.getItem('wb-libopen') || '{}');
  $('#lib').innerHTML = LIBRARY.map(c => { const items = c.items.filter(it => !q || (it.name + ' ' + it.tip + ' ' + c.cat).toLowerCase().includes(q)); if (!items.length) return '';
    const isOpen = q || open[c.cat] !== false;
    return `<details class="cat" data-cat="${c.cat}" ${isOpen ? 'open' : ''}><summary>${ICON.chevron}<span>${c.cat}</span><small>${items.length}</small></summary><div class="cards">${items.map(it => {
      const th = it.thumb && thumbs[it.thumb] ? `<img src="${thumbs[it.thumb]}" alt="" draggable="false">` : `<span class="gi">${ICON[it.icon || 'rack']}</span>`;
      return `<button class="card" data-lib="${it.key}" title="${esc(it.tip)}">${th}<span>${esc(it.name)}</span></button>`; }).join('')}</div></details>`; }).join('') || '<p class="note">No match.</p>';
  $('#lib').querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => { if (q) return; const o = JSON.parse(localStorage.getItem('wb-libopen') || '{}'); o[d.dataset.cat] = d.open; localStorage.setItem('wb-libopen', JSON.stringify(o)); }));
  $('#lib').querySelectorAll('[data-lib]').forEach(b => {
    b.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); libDragStart(e, b.dataset.lib); });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setMode('place', b.dataset.lib); } }); });
  setMode(mode, placeKind);
}
let THUMBS = {};
$('#libsearch').addEventListener('input', () => buildLibrary(THUMBS));
$('#undo').onclick = undo; $('#redo').onclick = redo;
$('#wallmode').onclick = () => { wallMode = { see: 'solid', solid: 'hidden', hidden: 'see' }[wallMode]; applyWallMode(); };
$('#tags').onclick = () => { showTags = !showTags; $('#tags').classList.toggle('on', showTags); for (const v of views.values()) if (v.group.userData.tag) v.group.userData.tag.hidden = !showTags; };
$('#fit').onclick = () => frameAll(); $('#reset').onclick = () => resetCam();
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => viewFrom(b.dataset.view)));
$('#helpbtn').onclick = () => { $('#keys').hidden = !$('#keys').hidden; };
$('#keys').addEventListener('click', e => { if (e.target.closest('.x') || e.target === $('#keys')) $('#keys').hidden = true; });
$('#new').onclick = () => { if (S.objects.length && !confirm('Start a new empty layout? (You can undo this.)')) return; const keep = { ambient: S.ambient, snap: S.snap, rotSnap: S.rotSnap, gridSize: S.gridSize }; S = { ...blank(), ...keep }; select(null); commit(); };
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'warehouse-layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async () => {
  const f = $('#file').files[0]; $('#file').value = ''; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d || !Array.isArray(d.objects)) throw 0;
    S = migrate(d); makeGrid(); select(null); commit(); frameAll(); const bad = S.objects.filter(o => R.problem(o, S)).length;
    toast(bad ? `Layout loaded · ${bad} object${bad > 1 ? 's' : ''} marked ! in the Objects list need attention` : 'Layout loaded'); }
  catch { toast('That file is not a warehouse layout'); }
};
$('#start').onclick = () => setMode('floor');
$('#example').onclick = () => { if (S.objects.length && !confirm('Replace this layout with the example? (You can undo this.)')) return; S = exampleLayout(); select(null); commit(); frameAll(); };

// a small cold store: floor, four walls, three kinds of door, two loaded racks, loads by the dock door and five loggers
function exampleLayout(){
  const L = { ...blank(), ambient: S.ambient, snap: S.snap, rotSnap: S.rotSnap, gridSize: S.gridSize }, id = () => L.nextId++, t = .2;
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
  L.objects.push({ id: id(), kind: 'item', item: 'carton', x: 3.4, z: 3.4, rot: 0 }, { id: id(), kind: 'item', item: 'drum', x: 4.6, z: 3.4, rot: 0 });
  const onBeam = (r, b, l) => { const bh = M.RACK.RAT[r.rating].h, xc = -M.rackWidth(r)/2 + b*M.RACK.BP + M.RACK.UPW + M.RACK.CS/2;
    return { host: r.id, part: 'beam', bay: b, level: l, local: [round(xc + .45), round(l*r.pitch - bh/2), round(M.RACK.D/2 - .005)], normal: [0, 0, 1] }; };
  const logs = [onBeam(racks[0], 1, 1), onBeam(racks[0], 0, 3), onBeam(racks[1], 2, 2), onBeam(racks[1], 0, 1),
    { host: wr.id, part: 'wall', local: [6, 1.5, t/2], normal: [0, 0, 1] }];
  for (const lg of logs){ L.seq.logger++; L.objects.push({ id: id(), kind: 'logger', name: 'DL-' + String(L.seq.logger).padStart(2, '0'), ...lg }); }
  return migrate(L);
}
if (new URLSearchParams(location.search).get('example') === '1'){ S = exampleLayout(); lastSnap = JSON.stringify(S); }

let toastT = 0;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

/* ---------- loop: camera moves, door animation, sag, labels, card ---------- */
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
  const el = $('#sagmm'), p = primary(); if (el && p){ const r = byId(p.id); if (r && r.kind === 'rack'){ let mx = 0;
    for (let b = 0; b < r.bays; b++) for (let l = 1; l <= r.levels; l++) mx = Math.max(mx, sagOf(r.id, b, l));
    el.textContent = (mx/M.RACK.SAG_EXAG*1000).toFixed(1) + ' mm'; } }
}
function stepCam(dt){
  if (!camTween) return; const c = camTween; c.t = Math.min(1, c.t + dt*1000/c.ms); const k = easeIO(c.t);
  camera.position.lerpVectors(c.p0, c.p1, k); controls.target.lerpVectors(c.t0, c.t1, k); if (c.t >= 1) camTween = null;
}
function loop(){
  const dt = Math.min(.05, clock.getDelta());
  stepCam(dt); stepSag(dt);
  for (const o of ofKind('door')){ const k = doorK.get(o.id) ?? 0, tgt = o.open ? 1 : 0;
    if (k !== tgt){ const nk = tgt > k ? Math.min(1, k + dt/1.1) : Math.max(0, k - dt/1.1); doorK.set(o.id, nk); const v = views.get(o.id); if (v) v.group.userData.anim(easeIO(nk)); } }
  for (const hb of selPool) if (hb.visible && hb.userData.sel){ const g = selGroupOf(hb.userData.sel); if (g) hb.box.setFromObject(g, true); }
  ground.visible = camera.position.y > -.1;
  controls.update(); renderer.render(scene, camera); labels.render(scene, camera); positionCard();
  requestAnimationFrame(loop);
}
const easeIO = t => t < .5 ? 2*t*t : 1 - (-2*t + 2)**2/2;

/* ---------- start ---------- */
buildToolbar(); buildLibrary();
resize(); applyWallMode(); sync(); setMode('select'); renderPanel(); refreshUndo(); tickReadings(); loop();
{ const b = sceneBox(); if (b.isEmpty()){ controls.target.set(0, 0, 0); camera.position.set(0, 17, 15); } else { viewFrom('iso'); camTween.t = 1; stepCam(0); } }
setTimeout(() => { THUMBS = renderThumbs(); buildLibrary(THUMBS); }, 30);
// view options in the address bar: ?open=1 opens every door, ?az=deg&el=deg turns the camera, ?logger=DL-03 selects a logger and flies to it, ?walls=solid|see|hidden, ?view=top|front|…
{ const q = new URLSearchParams(location.search);
  if (q.get('open') === '1') for (const d of ofKind('door')){ d.open = true; doorK.set(d.id, 1); views.get(d.id)?.group.userData.anim(1); }
  if (q.has('walls')){ wallMode = q.get('walls'); applyWallMode(); }
  if (q.has('view')){ viewFrom(q.get('view')); camTween.t = 1; stepCam(0); }
  if (q.has('az') || q.has('el')){ const off = camera.position.clone().sub(controls.target), r = off.length(), az = rad(+(q.get('az') ?? 30)), el = rad(+(q.get('el') ?? 38));
    camera.position.copy(controls.target).add(V3(Math.sin(az)*Math.cos(el), Math.sin(el), Math.cos(az)*Math.cos(el)).multiplyScalar(r*(+(q.get('zoom') ?? 1)))); }
  const lg = q.get('logger') && ofKind('logger').find(o => o.name === q.get('logger'));
  if (lg){ select({ id: lg.id }); const p = views.get(lg.id).group.getWorldPosition(V3()), n = loggerWorld(lg).n;
    controls.target.copy(p); camera.position.copy(p).add(n.multiplyScalar(1.1)).add(V3(.5, .35, 0)); }
  if (q.has('sel')){ const names = q.get('sel').split(','); setSelection(S.objects.filter(o => names.includes(o.name)).map(o => ({ id: o.id }))); }
  if (q.has('tool')) setMode(q.get('tool')); }
window.__wb = { get S(){ return S; }, views, select, setSelection, get selection(){ return selection; }, setMode, commit, frameAll, camera, controls, stepSag, stepCam, viewFrom,
  align, distribute, copySel, pasteClip, duplicate, removeSel, setLock, setHidden, groupSel, rotateSel, nudge, resizeFloor, undo, redo, R, tc, pivot,
  get sel(){ return primary(); } };
