// Placement rules: every object that stands on the floor has a footprint (an oriented rectangle in plan). Footprints
// must lie on a floor, must not overlap walls, racks, loads or the clear zone in front of a door, and floors must not
// overlap each other. All the checks are plain functions of the layout, so the UI can ask "is this valid?" at any time.
import * as M from './models.js';

const rad = d => d*Math.PI/180;
export const EPS = .004;          // touching is fine; overlapping by more than 4 mm is not

// plan rectangle: centre (cx, cz), half-sizes along its own axes (hw, hd), angle (radians, same sense as Object3D.rotation.y)
export function footprint(o, S){
  if (o.kind === 'rack') return { cx: o.x, cz: o.z, hw: M.rackWidth(o)/2, hd: .6, ang: rad(o.rot || 0) };
  if (o.kind === 'item'){ const mesh = o.item === 'mesh'; return { cx: o.x, cz: o.z, hw: mesh ? .4175 : .4, hd: mesh ? .62 : .6, ang: rad(o.rot || 0) }; }
  if (o.kind === 'floor') return { cx: o.x, cz: o.z, hw: o.w/2, hd: o.d/2, ang: 0 };
  if (o.kind === 'wall'){ const L = M.wallLen(o); return { cx: (o.x1 + o.x2)/2, cz: (o.z1 + o.z2)/2, hw: L/2 + o.t/2, hd: o.t/2, ang: -M.wallAngle(o) }; }
  if (o.kind === 'door'){ const w = S.objects.find(x => x.id === o.wall); if (!w) return null; return doorZone(o, w); }
  return null;
}
// the floor in front of and behind a door that must stay clear: the swing of a hinged leaf, the run of a sliding leaf,
// and a 1 m approach for the big doors
export function doorZone(d, w){
  const a = M.wallAngle(w), ux = Math.cos(a), uz = Math.sin(a);
  let t = d.t, hw = d.w/2, depth = d.type === 'swing' ? d.w + .05 : 1.0;
  if (d.type === 'hslide'){ t = d.t + d.w/2; hw = d.w + .05; }
  return { cx: w.x1 + ux*t, cz: w.z1 + uz*t, hw, hd: depth + w.t/2, ang: -a, door: true };
}
export function corners(f){
  const c = Math.cos(f.ang), s = Math.sin(f.ang), ax = [c, -s], az = [s, c];   // local x and local z in world (x, z)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [f.cx + ax[0]*f.hw*i + az[0]*f.hd*j, f.cz + ax[1]*f.hw*i + az[1]*f.hd*j]);
}
export function aabb(f){ const cs = corners(f), xs = cs.map(p => p[0]), zs = cs.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; }
// separating-axis test; returns the smallest push (dx, dz) that separates a from b, or null when they do not overlap
export function overlap(a, b){
  const A = corners(a), B = corners(b), axes = [];
  for (const P of [A, B]) for (let i = 0; i < 2; i++){ const e = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]], L = Math.hypot(...e); axes.push([-e[1]/L, e[0]/L]); }
  let best = null;
  for (const n of axes){
    const pa = A.map(p => p[0]*n[0] + p[1]*n[1]), pb = B.map(p => p[0]*n[0] + p[1]*n[1]);
    const d1 = Math.max(...pa) - Math.min(...pb), d2 = Math.max(...pb) - Math.min(...pa);
    if (d1 <= EPS || d2 <= EPS) return null;
    const d = Math.min(d1, d2);
    if (!best || d < best.d) best = { d, n: d1 < d2 ? [-n[0], -n[1]] : n };
  }
  return { depth: best.d, dx: best.n[0]*best.d, dz: best.n[1]*best.d };
}
export function onFloors(f, floors, tol = .005){
  if (!floors.length) return false;
  const pts = [...corners(f), [f.cx, f.cz]];
  return pts.every(([x, z]) => floors.some(fl => Math.abs(x - fl.x) <= fl.w/2 + tol && Math.abs(z - fl.z) <= fl.d/2 + tol));
}
export const label = o => o.name || ({ floor: 'Floor', wall: 'Wall', door: 'Door', rack: 'Rack', item: 'Load', logger: 'Logger' })[o.kind];

// why this object cannot stand where it is ('' = fine). skip: ids to ignore (e.g. the rest of a group being moved together
// is still checked, so it is normally empty)
export function problem(o, S, skip = new Set()){
  const f = footprint(o, S); if (!f) return '';
  const floors = S.objects.filter(x => x.kind === 'floor' && x.id !== o.id);
  if (o.kind === 'floor'){
    if (o.w < .5 || o.d < .5) return 'A floor must be at least 0.5 m each way';
    for (const fl of floors) if (!skip.has(fl.id) && overlap(f, footprint(fl, S))) return `Overlaps ${label(fl)}`;
    return '';
  }
  if (o.kind === 'door') return doorProblem(o, S, skip);
  if (!onFloors(o.kind === 'wall' ? { ...f, hw: f.hw - o.t/2, hd: .001 } : f, floors))
    return floors.length ? 'Outside the warehouse floor' : 'Draw a floor first';
  for (const x of S.objects){
    if (x.id === o.id || skip.has(x.id) || !['rack', 'item', 'wall', 'door'].includes(x.kind)) continue;
    if (o.kind === 'wall' && (x.kind === 'wall' || x.kind === 'door')) continue;     // walls meet at corners; doors live in walls
    const g = footprint(x, S); if (!g) continue;
    if (overlap(f, g)) return x.kind === 'door' ? `Blocks the clear space at ${label(x)}` : x.kind === 'wall' ? `Runs into ${label(x)}` : `Overlaps ${label(x)}`;
  }
  return '';
}
function doorProblem(d, S, skip){
  const w = S.objects.find(x => x.id === d.wall); if (!w) return 'Its wall is gone';
  const L = M.wallLen(w);
  if (L < d.w + .1) return 'The wall is too short for this door';
  if (d.h > w.h - .05) return `The wall is too low: the door needs ${Math.round((d.h + .05)*100)} cm`;
  if (d.t - d.w/2 < .05 - 1e-6 || d.t + d.w/2 > L - .05 + 1e-6) return 'The door runs past the end of the wall';
  if (d.type === 'hslide' && d.t + d.w/2 + d.w > L + 1e-6) return 'No room on the wall for the sliding leaf to open';
  for (const o of S.objects) if (o.kind === 'door' && o.wall === d.wall && o.id !== d.id && Math.abs(o.t - d.t) < (o.w + d.w)/2 + .05) return `Overlaps ${label(o)}`;
  const z = doorZone(d, w);
  for (const o of S.objects) if ((o.kind === 'rack' || o.kind === 'item') && !skip.has(o.id) && overlap(z, footprint(o, S))) return `${label(o)} is in the way of this door`;
  return '';
}
// first problem among several objects (for group moves); returns { o, why } or null
export function firstProblem(list, S){ for (const o of list){ const why = problem(o, S); if (why) return { o, why }; } return null; }

// nudge an object out of a shallow overlap (up to `limit` metres); returns true when it ends up valid
export function settle(o, S, limit = .12){
  for (let k = 0; k < 4; k++){
    const why = problem(o, S); if (!why) return true;
    const f = footprint(o, S); let push = null;
    for (const x of S.objects){ if (x.id === o.id || !['rack', 'item', 'wall'].includes(x.kind)) continue; if (o.kind === 'wall' && x.kind === 'wall') continue;
      const ov = overlap(f, footprint(x, S)); if (ov && ov.depth <= limit && (!push || ov.depth > push.depth)) push = ov; }
    if (!push || !('x' in o)) return false;
    o.x = +(o.x + push.dx*1.02).toFixed(4); o.z = +(o.z + push.dz*1.02).toFixed(4);
  }
  return !problem(o, S);
}

// smart guides: snap the moving footprints' edges/centres to nearby edges/centres of other objects, walls and floors
export function guideSnap(moving, S, ids, thr){
  const box = moving.reduce((b, f) => { const a = aabb(f); return { x0: Math.min(b.x0, a.x0), x1: Math.max(b.x1, a.x1), z0: Math.min(b.z0, a.z0), z1: Math.max(b.z1, a.z1) }; },
    { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  const mine = { x: [box.x0, (box.x0 + box.x1)/2, box.x1], z: [box.z0, (box.z0 + box.z1)/2, box.z1] };
  const lines = { x: [], z: [] };
  for (const o of S.objects){
    if (ids.has(o.id) || o.hidden) continue;
    if (o.kind === 'wall'){ const f = footprint(o, S), a = aabb(f), vertical = Math.abs(Math.sin(f.ang)) > .99, horizontal = Math.abs(Math.cos(f.ang)) > .99;
      if (vertical){ lines.x.push({ v: a.x0, src: a }, { v: a.x1, src: a }); } if (horizontal){ lines.z.push({ v: a.z0, src: a }, { v: a.z1, src: a }); } continue; }
    if (!['rack', 'item', 'floor'].includes(o.kind)) continue;
    const a = aabb(footprint(o, S));
    lines.x.push({ v: a.x0, src: a }, { v: (a.x0 + a.x1)/2, src: a }, { v: a.x1, src: a });
    lines.z.push({ v: a.z0, src: a }, { v: (a.z0 + a.z1)/2, src: a }, { v: a.z1, src: a });
  }
  const pick = axis => { let best = null; for (const m of mine[axis]) for (const l of lines[axis]){ const d = l.v - m; if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l.v, src: l.src }; } return best; };
  return { x: pick('x'), z: pick('z'), box };
}
// free distance from a box to the nearest obstacle in each direction along x and z (for measurement labels)
export function clearances(box, S, ids, reach = 8){
  const out = { '-x': null, '+x': null, '-z': null, '+z': null };
  const obst = S.objects.filter(o => !ids.has(o.id) && !o.hidden && ['rack', 'item', 'wall'].includes(o.kind)).map(o => aabb(footprint(o, S)));
  for (const fl of S.objects.filter(o => o.kind === 'floor')){ const a = aabb(footprint(fl, S));
    if (box.x0 >= a.x0 - .01 && box.x1 <= a.x1 + .01 && box.z0 >= a.z0 - .01 && box.z1 <= a.z1 + .01)
      obst.push({ x0: a.x0 - 1, x1: a.x0, z0: a.z0, z1: a.z1 }, { x0: a.x1, x1: a.x1 + 1, z0: a.z0, z1: a.z1 }, { x0: a.x0, x1: a.x1, z0: a.z0 - 1, z1: a.z0 }, { x0: a.x0, x1: a.x1, z0: a.z1, z1: a.z1 + 1 }); }
  const ovZ = a => a.z0 < box.z1 - .01 && a.z1 > box.z0 + .01, ovX = a => a.x0 < box.x1 - .01 && a.x1 > box.x0 + .01;
  for (const a of obst){
    if (ovZ(a)){ if (a.x1 <= box.x0 + .001){ const d = box.x0 - a.x1; if (d < reach && (!out['-x'] || d < out['-x'])) out['-x'] = d; }
      if (a.x0 >= box.x1 - .001){ const d = a.x0 - box.x1; if (d < reach && (!out['+x'] || d < out['+x'])) out['+x'] = d; } }
    if (ovX(a)){ if (a.z1 <= box.z0 + .001){ const d = box.z0 - a.z1; if (d < reach && (!out['-z'] || d < out['-z'])) out['-z'] = d; }
      if (a.z0 >= box.z1 - .001){ const d = a.z0 - box.z1; if (d < reach && (!out['+z'] || d < out['+z'])) out['+z'] = d; } }
  }
  return out;
}
