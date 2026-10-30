// Elitech RC-5 USB temperature data logger: 80 x 33.5 x 14 mm, white case, blue face with an LCD and two buttons.
// The model is real size; its face is a canvas texture so the LCD can show the live (simulated) reading.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const LOGGER = { w: .0335, h: .08, d: .014 };
const bodyGeo = new RoundedBoxGeometry(LOGGER.w, LOGGER.h, LOGGER.d, 4, .0055);
const bodyMat = new THREE.MeshStandardMaterial({ color: '#f3f4f5', roughness: .45 });
const faceGeo = new THREE.PlaneGeometry(LOGGER.w - .0012, LOGGER.h - .0012);

function rr(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// draw the logger's face with a temperature on its LCD
function drawFace(g, W, H, temp, recording){
  g.clearRect(0, 0, W, H);
  rr(g, 0, 0, W, H, 26); g.fillStyle = '#f4f5f6'; g.fill();
  g.fillStyle = '#3f5fc9'; g.font = 'italic bold 25px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('Data Logger', W/2, 82);
  g.strokeStyle = '#c9ccd0'; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 132); g.quadraticCurveTo(W/2, 112, W - 8, 132); g.stroke();
  // blue face panel
  const grad = g.createLinearGradient(0, 140, 0, 440); grad.addColorStop(0, '#5a7fe0'); grad.addColorStop(1, '#4569d2');
  rr(g, 12, 140, W - 24, 305, 30); g.fillStyle = grad; g.fill();
  g.save(); rr(g, 12, 140, W - 24, 305, 30); g.clip();
  g.fillStyle = '#3c55a8'; g.beginPath(); g.moveTo(12, 372); g.quadraticCurveTo(W*.35, 356, W*.6, 368); g.quadraticCurveTo(W*.85, 380, W - 12, 364); g.lineTo(W - 12, 445); g.lineTo(12, 445); g.fill();
  g.restore();
  g.fillStyle = '#ffffff'; g.font = 'italic bold 30px Arial, sans-serif'; g.fillText('RC-5', W/2, 180);
  // LCD
  g.fillStyle = '#2b2b2b'; g.fillRect(28, 196, W - 56, 92); g.fillStyle = '#d3d8cf'; g.fillRect(33, 201, W - 66, 82);
  g.fillStyle = '#222'; g.fillRect(40, 208, 18, 9); g.fillRect(58, 210, 2, 5);                        // battery
  g.fillStyle = '#d3d8cf'; g.fillRect(42, 210, 3, 5); g.fillStyle = '#222';
  if (recording){ g.beginPath(); g.moveTo(66, 207); g.lineTo(76, 212.5); g.lineTo(66, 218); g.fill(); }   // recording mark
  g.font = 'bold 50px "Courier New", monospace'; g.textAlign = 'right';
  g.fillText(Number.isFinite(temp) ? temp.toFixed(1) : '--.-', W - 52, 272);
  g.font = 'bold 16px Arial, sans-serif'; g.textAlign = 'left'; g.fillText('°C', W - 50, 272);
  // start and stop buttons
  for (const [cx, kind] of [[W*.31, 'play'], [W*.69, 'pause']]){
    g.beginPath(); g.arc(cx, 326, 27, 0, Math.PI*2); g.fillStyle = '#ffffff'; g.fill();
    g.beginPath(); g.arc(cx, 326, 22, 0, Math.PI*2); g.fillStyle = '#4a6fd8'; g.fill();
    g.fillStyle = '#ffffff';
    if (kind === 'play'){ g.beginPath(); g.moveTo(cx - 7, 314); g.lineTo(cx + 11, 326); g.lineTo(cx - 7, 338); g.fill(); }
    else { g.fillRect(cx - 9, 314, 6, 24); g.fillRect(cx + 3, 314, 6, 24); }
  }
  g.fillStyle = '#ffffff'; g.font = 'italic bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('Elitech', W/2, 418);
  // lanyard hole
  g.fillStyle = '#b9bdc2'; g.beginPath(); g.ellipse(W/2, 476, 30, 10, 0, 0, Math.PI*2); g.fill();
  g.fillStyle = '#7d828a'; g.beginPath(); g.ellipse(W/2, 478, 24, 6, 0, 0, Math.PI*2); g.fill();
}

// one logger: a group whose front (+z) shows the face; group.userData.setReading(t) repaints the LCD
export function buildLogger(){
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, bodyMat); g.add(body);
  const c = document.createElement('canvas'); c.width = 216; c.height = 512;
  const ctx = c.getContext('2d'), t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: .5, roughness: .4 }));
  face.position.z = LOGGER.d/2 + .0002; g.add(face);
  // a larger invisible target so a real-size logger is easy to click
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.part = 'loggerHit'; g.add(hit);
  let last = null;
  g.userData.setReading = (temp, recording = true) => { const k = (Number.isFinite(temp) ? temp.toFixed(1) : '') + recording;
    if (k === last) return; last = k; drawFace(ctx, c.width, c.height, temp, recording); t.needsUpdate = true; };
  g.userData.setReading(NaN);
  return g;
}

/* ---------- simulated readings ----------
   Each logger drifts slowly around the room set-point: warmer higher up (stratification), and warmer near an open door,
   so moving a logger or opening a door changes what it shows. */
export function makeSim(){
  const drift = new Map();
  return {
    reading(id, base, height, doorWarmth){
      let d = drift.get(id) ?? (Math.random() - .5)*.4;
      d = Math.max(-.6, Math.min(.6, d + (Math.random() - .5)*.12)); drift.set(id, d);
      return base + .35*height + doorWarmth + d;
    },
    forget(id){ drift.delete(id); },
  };
}
