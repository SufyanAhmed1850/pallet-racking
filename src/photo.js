// Image export: frame a shot in the view (a crop frame shows exactly what will be saved), pick a lens, shape, size and
// look, and save a PNG. The scene is rendered off screen in tiles, so 8K works on any GPU, and supersampled for clean
// edges. The cinematic look adds soft shadows, filmic tone mapping, warmer light, depth haze and a vignette.
import * as THREE from 'three';

const ASPECTS = [['16:9', 16/9], ['2.39:1 cinema', 2.39], ['4:3', 4/3], ['1:1', 1], ['4:5', .8], ['9:16', 9/16]];
const SIZES = [['HD', 1920], ['QHD', 2560], ['4K', 3840], ['8K', 7680]];
const LENSES = [18, 24, 35, 50, 85];                     // full-frame focal lengths (mm)
const fovOf = mm => 2*Math.atan(12/mm)*180/Math.PI;      // vertical field of view of a 24 mm tall frame
const TILE = 2048;

export function setupPhoto(ctx){
  const { scene, camera, controls, view, world, hide, wallMat, lights, ground, getGrid, settleCamera, views, sceneBox, viewFrom, toast, summary, defaultTitle } = ctx;
  const opts = { aspect: 0, size: 2, lens: 0, look: 'cinematic', shadows: true, vignette: true, tags: true, grid: false, transparent: false, caption: false, title: '', thirds: true };
  let r = null, open = false, baseFov = camera.fov, refreshT = 0;

  /* ---------- the crop frame over the view ---------- */
  const frameEl = document.createElement('div'); frameEl.id = 'shotframe'; frameEl.hidden = true; view.appendChild(frameEl);
  const aspect = () => ASPECTS[opts.aspect][1];
  function frameRect(){
    const vw = view.clientWidth, vh = view.clientHeight, a = aspect(), m = 14;       // a small margin so the frame edge shows
    let fw = vw - 2*m, fh = fw/a; if (fh > vh - 2*m){ fh = vh - 2*m; fw = fh*a; }
    return { x: (vw - fw)/2, y: (vh - fh)/2, w: fw, h: fh, vw, vh };
  }
  function placeFrame(){
    const f = frameRect(); Object.assign(frameEl.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
    frameEl.classList.toggle('thirds', opts.thirds);
  }
  // the export camera sees exactly what is inside the frame
  function shotCamera(){
    const f = frameRect(), cam = camera.clone();
    cam.aspect = f.w/f.h; cam.fov = 2*Math.atan(Math.tan(camera.fov*Math.PI/360)*f.h/f.vh)*180/Math.PI;
    cam.updateProjectionMatrix(); return { cam, f };
  }

  /* ---------- lens: change the focal length and dolly so the subject keeps its size ---------- */
  function setFov(fov){
    const off = camera.position.clone().sub(controls.target), k = Math.tan(camera.fov*Math.PI/360)/Math.tan(fov*Math.PI/360);
    camera.position.copy(controls.target).addScaledVector(off, k); camera.fov = fov; camera.updateProjectionMatrix();
  }

  /* ---------- rendering ---------- */
  function renderer(){
    if (!r){ r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); r.outputColorSpace = THREE.SRGBColorSpace; r.setPixelRatio(1); }
    return r;
  }
  // change the scene for the shot, return a function that puts everything back
  function stage(o, cam, shadowSize){
    const undo = [], set = (obj, k, v) => { undo.push([obj, k, obj[k]]); obj[k] = v; };
    for (const h of hide()) set(h, 'visible', false);
    const grid = getGrid(); if (grid) set(grid, 'visible', o.grid);
    set(ground, 'visible', !o.transparent && cam.position.y > -.1);
    const cine = o.look === 'cinematic';
    set(scene, 'background', o.transparent || cine ? null : scene.background);
    const R = renderer();
    R.toneMapping = cine ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; R.toneMappingExposure = cine ? 1.02 : 1;
    if (cine){
      set(lights.hemi, 'intensity', .62); set(lights.hemi, 'color', new THREE.Color('#eef2ff')); set(lights.hemi, 'groundColor', new THREE.Color('#b3a78f'));
      set(lights.sun, 'intensity', 3.4); set(lights.sun, 'color', new THREE.Color('#ffe8cf'));
      set(lights.fill, 'intensity', .5); set(lights.fill, 'color', new THREE.Color('#d6e2ff'));
      if (!o.transparent){ const d = cam.position.distanceTo(controls.target); set(scene, 'fog', new THREE.Fog('#e4ddd0', d*1.5, d*5)); }
    }
    R.shadowMap.enabled = o.shadows; R.shadowMap.type = THREE.PCFSoftShadowMap;
    // a lower, late-afternoon sun in the cinematic look gives longer shadows
    const sunDir = cine ? new THREE.Vector3(.7, .5, .5).normalize() : lights.sun.position.clone().sub(lights.sun.target.position).normalize();
    if (cine && !o.shadows){ const s = lights.sun, p = s.position.clone(); undo.push([s.position, 'x', p.x], [s.position, 'y', p.y], [s.position, 'z', p.z]); s.position.copy(s.target.position).addScaledVector(sunDir, 20); }
    if (o.shadows){
      const box = sceneBox(), c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()), rad = Math.max(4, box.isEmpty() ? 8 : box.getSize(new THREE.Vector3()).length()/2);
      const sun = lights.sun, dir = sunDir;
      set(sun, 'castShadow', true); undo.push([sun.position, 'x', sun.position.x], [sun.position, 'y', sun.position.y], [sun.position, 'z', sun.position.z]);
      const t0 = sun.target.position.clone(); undo.push([sun.target.position, 'x', t0.x], [sun.target.position, 'y', t0.y], [sun.target.position, 'z', t0.z]);
      sun.target.position.copy(c); sun.position.copy(c).addScaledVector(dir, rad*2); sun.target.updateMatrixWorld();
      const sc = sun.shadow.camera; Object.assign(sc, { left: -rad, right: rad, top: rad, bottom: -rad, near: .1, far: rad*4 }); sc.updateProjectionMatrix();
      sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02; sun.shadow.radius = 3;
      // see-through glass and walls let light through; everything else casts and receives
      world.traverse(m => { if (!m.isMesh) return; const mt = m.material, clear = mt.transparent && mt.opacity < .6 && !mt.alphaTest;
        set(m, 'castShadow', !clear && mt !== wallMat || (mt === wallMat && !wallMat.transparent)); set(m, 'receiveShadow', true); });
      set(ground, 'receiveShadow', true);
    }
    return () => { for (let i = undo.length - 1; i >= 0; i--){ const [obj, k, v] = undo[i]; obj[k] = v; }
      if (lights.sun.shadow.map){ lights.sun.shadow.map.dispose(); lights.sun.shadow.map = null; }
      lights.sun.target.updateMatrixWorld(); };
  }
  // render W x H (times ss for supersampling) in tiles into a 2D canvas
  function renderScene(W, H, o, ss, shadowSize){
    const { cam, f } = shotCamera(), R = renderer(), restore = stage(o, cam, shadowSize);
    const BW = W*ss, BH = H*ss, big = document.createElement('canvas'); big.width = BW; big.height = BH;
    const g = big.getContext('2d'), tw = Math.min(TILE, BW), th = Math.min(TILE, BH);
    try {
      R.setSize(tw, th, false);
      for (let y = 0; y < BH; y += th) for (let x = 0; x < BW; x += tw){
        cam.setViewOffset(BW, BH, x, y, tw, th); cam.updateProjectionMatrix();
        R.render(scene, cam);
        g.drawImage(R.domElement, 0, 0, Math.min(tw, BW - x), Math.min(th, BH - y), x, y, Math.min(tw, BW - x), Math.min(th, BH - y));
      }
    } finally { restore(); }
    cam.clearViewOffset();
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const c = out.getContext('2d');
    if (!o.transparent && o.look === 'cinematic'){ const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#f7f4ee'); gr.addColorStop(.62, '#ebe5da'); gr.addColorStop(1, '#ddd5c6'); c.fillStyle = gr; c.fillRect(0, 0, W, H); }
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(big, 0, 0, W, H);
    big.width = big.height = 0;
    return { canvas: out, c, cam, k: H/f.h };
  }
  // logger tags as on screen, scaled with the image
  function drawTags(c, cam, W, H, k){
    const list = [];
    for (const v of views.values()){ const tag = v.group.userData.tag; if (!tag || !v.group.visible) continue;
      const lab = v.group.children.find(ch => ch.isCSS2DObject); if (!lab) continue;
      const p = lab.getWorldPosition(new THREE.Vector3()).project(cam); if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue;
      list.push({ x: (p.x + 1)/2*W, y: (1 - p.y)/2*H, z: p.z, text: tag.textContent }); }
    list.sort((a, b) => b.z - a.z);
    const fs = 10.5*k, px = 5*k, py = 3*k, bw = 1.5*k, rr = 6*k;
    c.font = `700 ${fs}px ui-monospace, Menlo, Consolas, monospace`; c.textBaseline = 'middle'; c.textAlign = 'center';
    for (const t of list){
      const w = c.measureText(t.text).width + 2*px + 2*bw, h = fs + 2*py + 2*bw, x0 = t.x - w/2, y0 = t.y - h;
      c.save(); c.shadowColor = 'rgba(0,0,0,.18)'; c.shadowBlur = 3*k; c.shadowOffsetY = k;
      c.beginPath(); c.roundRect(x0, y0, w, h, rr); c.fillStyle = '#fff'; c.fill(); c.restore();
      c.beginPath(); c.roundRect(x0 + bw/2, y0 + bw/2, w - bw, h - bw, rr); c.lineWidth = bw; c.strokeStyle = '#3f5fc9'; c.stroke();
      c.fillStyle = '#2b4fb8'; c.fillText(t.text, t.x, y0 + h/2 + .5*k);
    }
  }
  function finish(c, W, H, o){
    if (o.vignette && !o.transparent){
      const gr = c.createRadialGradient(W/2, H/2, Math.min(W, H)*.35, W/2, H/2, Math.hypot(W, H)/2);
      gr.addColorStop(0, 'rgba(35,26,16,0)'); gr.addColorStop(1, 'rgba(35,26,16,.32)'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    }
    if (o.caption){
      const u = Math.min(W, H), m = u*.045, t = (o.title || defaultTitle()).trim(), sub = summary();
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = o.transparent ? '#231e16' : 'rgba(35,30,22,.92)';
      c.font = `650 ${u*.042}px system-ui, -apple-system, "Segoe UI", sans-serif`; c.fillText(t, m, H - m - u*.032);
      c.fillStyle = 'rgba(35,30,22,.62)'; c.font = `500 ${u*.022}px system-ui, -apple-system, "Segoe UI", sans-serif`; c.fillText(sub, m, H - m);
    }
  }
  function dims(){ const a = aspect(), L = SIZES[opts.size][1]; return a >= 1 ? [L, Math.round(L/a)] : [Math.round(L*a), L]; }
  function shoot(W, H, o, preview){
    if (!preview) settleCamera();          // a camera move still running would otherwise be caught half way
    const ss = preview ? 1 : (Math.max(W, H) <= 3840 ? 2 : 1);
    const { canvas, c, cam, k } = renderScene(W, H, o, ss, preview ? 2048 : 4096);
    if (o.tags) drawTags(c, cam, W, H, k);
    finish(c, W, H, o);
    return canvas;
  }

  /* ---------- panel ---------- */
  const aside = document.querySelector('aside.right'), panel = document.createElement('div'); panel.id = 'shotpanel'; panel.hidden = true; aside.appendChild(panel);
  const seg = (name, items, cur) => `<div class="seg" data-k="${name}">${items.map(([lab, v], i) => `<button data-v="${v ?? i}" class="${String(v ?? i) === String(cur) ? 'on' : ''}">${lab}</button>`).join('')}</div>`;
  const chk = (k, lab) => `<label class="chk"><input type="checkbox" data-c="${k}" ${opts[k] ? 'checked' : ''}><span>${lab}</span></label>`;
  function renderPanel(){
    const [W, H] = dims();
    panel.innerHTML = `<div class="ph"><b>Save image</b><button class="x ib" title="Close (Esc)">✕</button></div>
      <p class="note">Frame the shot in the view: drag to orbit, right-drag to pan, wheel to zoom. Only what is inside the frame is saved.</p>
      <p class="lbl">Shot</p><div class="seg" data-k="view">${[['Iso', 'iso'], ['Hero', 'hero'], ['Top', 'top'], ['Front', 'front']].map(([l, v]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
      <p class="lbl">Lens</p>${seg('lens', [['View', 0], ...LENSES.map(mm => [mm + ' mm', mm])], opts.lens)}
      <p class="lbl">Shape</p>${seg('aspect', ASPECTS.map(([l], i) => [l, i]), opts.aspect)}
      <p class="lbl">Size</p>${seg('size', SIZES.map(([l], i) => [l, i]), opts.size)}<p class="dim">${W} × ${H} px</p>
      <p class="lbl">Look</p>${seg('look', [['Cinematic', 'cinematic'], ['Clean', 'clean']], opts.look)}
      <div class="chks">${chk('shadows', 'Soft shadows')}${chk('vignette', 'Vignette')}${chk('tags', 'Logger tags')}${chk('grid', 'Floor grid')}${chk('transparent', 'Transparent background')}${chk('thirds', 'Thirds guide')}${chk('caption', 'Caption')}</div>
      <input class="cap" placeholder="${defaultTitle().replace(/"/g, '&quot;')}" value="${opts.title.replace(/"/g, '&quot;')}" ${opts.caption ? '' : 'hidden'} aria-label="Caption title">
      <p class="lbl">Preview</p><div class="pv"><canvas></canvas></div>
      <button class="save on">Save PNG · ${W} × ${H}</button>`;
    panel.querySelector('.x').onclick = close;
    panel.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
      const k = b.parentElement.dataset.k, v = b.dataset.v;
      if (k === 'view'){ viewFrom(v); setTimeout(refresh, 700); return; }
      opts[k] = k === 'look' ? v : +v;
      if (k === 'lens') setFov(opts.lens ? fovOf(opts.lens) : baseFov);
      if (k === 'look'){ opts.shadows = v === 'cinematic'; opts.vignette = v === 'cinematic'; }
      placeFrame(); renderPanel(); refresh(); });
    panel.querySelectorAll('[data-c]').forEach(i => i.onchange = () => { opts[i.dataset.c] = i.checked; placeFrame(); if (i.dataset.c === 'caption') renderPanel(); refresh(); });
    const cap = panel.querySelector('.cap'); cap.oninput = () => { opts.title = cap.value; refresh(); };
    panel.querySelector('.save').onclick = save;
    refresh(true);
  }
  function refresh(now){
    if (!open) return; clearTimeout(refreshT);
    refreshT = setTimeout(() => {
      const pv = panel.querySelector('.pv canvas'); if (!pv) return;
      const a = aspect(), bw = 250, bh = 190, dw = Math.min(bw, bh*a), dh = dw/a, W = Math.round(dw*2), H = Math.round(dh*2);
      const img = shoot(W, H, opts, true); pv.width = W; pv.height = H; pv.style.width = dw + 'px'; pv.style.height = dh + 'px';
      const g = pv.getContext('2d'); g.clearRect(0, 0, W, H); g.drawImage(img, 0, 0);
    }, now === true ? 0 : 220);
  }
  function save(){
    const [W, H] = dims(), btn = panel.querySelector('.save'); btn.disabled = true; btn.textContent = `Rendering ${W} × ${H}…`;
    setTimeout(() => {
      let canvas;
      try { canvas = shoot(W, H, opts, false); }
      catch (e){ btn.disabled = false; btn.textContent = `Save PNG · ${W} × ${H}`; toast('Could not render the image at this size: try a smaller one'); return; }
      canvas.toBlob(b => {
        btn.disabled = false; btn.textContent = `Save PNG · ${W} × ${H}`;
        if (!b) return toast('Could not encode the image: try a smaller size');
        const name = ((opts.caption && opts.title) || defaultTitle()).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'warehouse';
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${name}-${W}x${H}.png`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(`Saved ${a.download} (${(b.size/1048576).toFixed(1)} MB)`);
      }, 'image/png');
    }, 40);
  }

  function openPanel(){
    if (open) return; open = true; baseFov = camera.fov;
    document.querySelector('#panel').hidden = true; panel.hidden = false; frameEl.hidden = false;
    document.querySelector('#shotbtn')?.classList.add('on');
    if (opts.lens) setFov(fovOf(opts.lens));
    placeFrame(); renderPanel();
  }
  function close(){
    if (!open) return; open = false;
    if (camera.fov !== baseFov) setFov(baseFov);
    document.querySelector('#panel').hidden = false; panel.hidden = true; frameEl.hidden = true;
    document.querySelector('#shotbtn')?.classList.remove('on');
  }
  controls.addEventListener('change', () => refresh());
  new ResizeObserver(() => { if (open){ placeFrame(); refresh(); } }).observe(view);
  return { open: openPanel, close, toggle: () => open ? close() : openPanel(), get isOpen(){ return open; }, refresh, shoot: (W, H, o) => shoot(W, H, { ...opts, ...o }, false), opts };
}
