// Procedural texture factory for Ride mode. Everything is generated once at
// scene boot from seeded canvas drawing — no asset downloads, fully cosmetic.

import * as THREE from 'three';

/** Deterministic PRNG so visuals are stable across sessions. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- billboard sprites ----------

export function glowTexture(color: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.4, color.replace('1)', '0.35)'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex(c);
}

export function discTexture(inner: string, mid: string, edge: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createRadialGradient(100, 92, 10, 128, 128, 124);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, mid);
  g.addColorStop(0.92, edge);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 124, 0, Math.PI * 2);
  ctx.fill();
  return tex(c);
}

export function streakTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 16);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(255,220,160,0)');
  g.addColorStop(0.5, 'rgba(255,236,200,0.9)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 16);
  return tex(c);
}

/** Soft elliptical smudge — distant galaxies / very faint deep-sky objects. */
export function smudgeTexture(hue: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 64);
  const g = ctx.createRadialGradient(64, 32, 1, 64, 32, 60);
  g.addColorStop(0, `hsla(${hue}, 45%, 82%, 0.9)`);
  g.addColorStop(0.35, `hsla(${hue}, 40%, 60%, 0.35)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(64, 32);
  ctx.scale(1, 0.42);
  ctx.beginPath();
  ctx.arc(0, 0, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return tex(c);
}

/** Very subtle nebula wash — believable deep-sky background, not fantasy. */
export function nebulaTexture(seed: number, hueA: number, hueB: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const rnd = mulberry(seed);
  for (let i = 0; i < 26; i++) {
    const x = 80 + rnd() * 352;
    const y = 80 + rnd() * 352;
    const r = 40 + rnd() * 150;
    const hue = rnd() < 0.5 ? hueA : hueB;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, `hsla(${hue}, 38%, ${30 + rnd() * 25}%, ${0.05 + rnd() * 0.07})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  // sparse embedded stars
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.4})`;
    ctx.fillRect(rnd() * 512, rnd() * 512, 1.2, 1.2);
  }
  return tex(c);
}

// ---------- planet equirect maps (drive real lit spheres) ----------

export function marsMap(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  const rnd = mulberry(40);
  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#caa183');
  base.addColorStop(0.18, '#c2825c');
  base.addColorStop(0.5, '#b9663d');
  base.addColorStop(0.82, '#c2825c');
  base.addColorStop(1, '#caa183');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 512);
  // dark albedo features (Syrtis-like maria)
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 1024;
    const y = 90 + rnd() * 330;
    const rx = 28 + rnd() * 120;
    const ry = rx * (0.3 + rnd() * 0.5);
    const g = ctx.createRadialGradient(x, y, 1, x, y, rx);
    g.addColorStop(0, `rgba(74, 38, 22, ${0.16 + rnd() * 0.22})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    ctx.restore();
  }
  // bright dusty basins
  for (let i = 0; i < 18; i++) {
    const x = rnd() * 1024;
    const y = 120 + rnd() * 270;
    const r = 30 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, `rgba(235, 190, 150, ${0.10 + rnd() * 0.12})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
  }
  // polar caps with ragged edges
  for (const top of [true, false]) {
    const yBase = top ? 26 : 512 - 26;
    const h = top ? 34 : 30;
    ctx.fillStyle = 'rgba(245, 247, 250, 0.95)';
    ctx.beginPath();
    ctx.moveTo(0, top ? 0 : 512);
    for (let x = 0; x <= 1024; x += 16) {
      const j = (rnd() - 0.5) * 18;
      ctx.lineTo(x, yBase + (top ? Math.sin(x / 90) * 8 + j : -Math.sin(x / 80) * 8 - j) - (top ? h - 26 : -(h - 26)));
    }
    ctx.lineTo(1024, top ? 0 : 512);
    ctx.closePath();
    ctx.fill();
  }
  return tex(c);
}

export function earthMap(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  const rnd = mulberry(7);
  ctx.fillStyle = '#1c4d8f';
  ctx.fillRect(0, 0, 1024, 512);
  const og = ctx.createLinearGradient(0, 0, 0, 512);
  og.addColorStop(0, 'rgba(120,170,220,0.5)');
  og.addColorStop(0.5, 'rgba(20,80,160,0.25)');
  og.addColorStop(1, 'rgba(120,170,220,0.5)');
  ctx.fillStyle = og;
  ctx.fillRect(0, 0, 1024, 512);
  // continents: blobby chains
  for (let i = 0; i < 9; i++) {
    let x = rnd() * 1024;
    let y = 110 + rnd() * 290;
    for (let k = 0; k < 24; k++) {
      const r = 14 + rnd() * 42;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      const green = 70 + rnd() * 60;
      g.addColorStop(0, `rgba(${60 + rnd() * 40}, ${green + 30}, ${48}, 0.85)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 512);
      x = (x + (rnd() - 0.45) * 70 + 1024) % 1024;
      y = Math.min(Math.max(y + (rnd() - 0.5) * 55, 70), 440);
    }
  }
  // cloud swirls
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 1024;
    const y = rnd() * 512;
    const r = 12 + rnd() * 60;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.12 + rnd() * 0.2})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.8, 0.55);
    ctx.translate(-x, -y);
    ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.restore();
  }
  // polar ice
  ctx.fillStyle = 'rgba(240,247,255,0.92)';
  ctx.fillRect(0, 0, 1024, 30);
  ctx.fillRect(0, 482, 1024, 30);
  return tex(c);
}

export function moonMap(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  const rnd = mulberry(11);
  ctx.fillStyle = '#8d8d92';
  ctx.fillRect(0, 0, 1024, 512);
  // maria
  for (let i = 0; i < 16; i++) {
    const x = rnd() * 1024;
    const y = 100 + rnd() * 300;
    const r = 40 + rnd() * 110;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, `rgba(70,72,80,${0.25 + rnd() * 0.25})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
  }
  // craters
  for (let i = 0; i < 240; i++) {
    const x = rnd() * 1024;
    const y = rnd() * 512;
    const r = 1.5 + rnd() * (rnd() < 0.06 ? 22 : 7);
    ctx.fillStyle = `rgba(60,60,66,${0.25 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(200,200,205,${0.18 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c);
}

export function sunCoreTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 126);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#fff7df');
  g.addColorStop(0.62, '#ffd98c');
  g.addColorStop(0.85, 'rgba(255,170,60,0.55)');
  g.addColorStop(1, 'rgba(255,140,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return tex(c);
}

// ---------- spacecraft material maps ----------

/** Hull paneling: albedo + matching roughness variation. */
export function panelMaps(seed: number, base = '#aeb9c6'): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const rnd = mulberry(seed);
  const [c, ctx] = canvas(512, 512);
  const [cr, ctxr] = canvas(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  ctxr.fillStyle = '#9a9a9a';
  ctxr.fillRect(0, 0, 512, 512);
  // tonal panels
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rnd() * 8) * 64;
    const y = Math.floor(rnd() * 8) * 64;
    const w = (1 + Math.floor(rnd() * 2)) * 64;
    const h = (1 + Math.floor(rnd() * 2)) * 64;
    const v = 0.85 + rnd() * 0.25;
    ctx.fillStyle = `rgba(${Math.round(174 * v)}, ${Math.round(185 * v)}, ${Math.round(198 * v)}, 0.55)`;
    ctx.fillRect(x, y, w, h);
    ctxr.fillStyle = `rgba(${Math.round(150 * v)},${Math.round(150 * v)},${Math.round(150 * v)},0.6)`;
    ctxr.fillRect(x, y, w, h);
  }
  // seams
  ctx.strokeStyle = 'rgba(40,48,60,0.55)';
  ctxr.strokeStyle = 'rgba(60,60,60,0.8)';
  ctx.lineWidth = ctxr.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = i * 64 + (rnd() - 0.5) * 4;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
    ctxr.beginPath(); ctxr.moveTo(p, 0); ctxr.lineTo(p, 512); ctxr.stroke();
    ctxr.beginPath(); ctxr.moveTo(0, p); ctxr.lineTo(512, p); ctxr.stroke();
  }
  // rivets + vents + markings
  for (let i = 0; i < 280; i++) {
    ctx.fillStyle = 'rgba(30,36,46,0.5)';
    ctx.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  for (let i = 0; i < 9; i++) {
    const x = rnd() * 470;
    const y = rnd() * 470;
    ctx.fillStyle = 'rgba(25,30,40,0.7)';
    for (let k = 0; k < 5; k++) ctx.fillRect(x, y + k * 5, 26, 2.4);
  }
  ctx.fillStyle = 'rgba(255,180,60,0.8)';
  ctx.font = 'bold 22px ui-monospace, monospace';
  ctx.fillText('CRG-45T', 18, 498);
  ctx.fillStyle = 'rgba(102,224,255,0.6)';
  ctx.fillRect(0, 470, 512, 3);
  const m = tex(c);
  const r = tex(cr, false);
  return { map: m, roughnessMap: r };
}

/** Crinkled MLI foil (albedo + bump). */
export function foilMaps(seed: number): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const rnd = mulberry(seed);
  const [c, ctx] = canvas(256, 256);
  const [cb, ctxb] = canvas(256, 256);
  ctx.fillStyle = '#c89a3c';
  ctx.fillRect(0, 0, 256, 256);
  ctxb.fillStyle = '#808080';
  ctxb.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 950; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const w = 3 + rnd() * 16;
    const h = 2 + rnd() * 7;
    const a = rnd() * Math.PI;
    const lum = 0.55 + rnd() * 0.85;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = `rgba(${Math.round(214 * lum)}, ${Math.round(164 * lum)}, ${Math.round(64 * lum)}, 0.75)`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    ctxb.save();
    ctxb.translate(x, y);
    ctxb.rotate(a);
    const bl = Math.round(128 + (rnd() - 0.5) * 170);
    ctxb.fillStyle = `rgb(${bl},${bl},${bl})`;
    ctxb.fillRect(-w / 2, -h / 2, w, h);
    ctxb.restore();
  }
  return { map: tex(c), bumpMap: tex(cb, false) };
}

/** Solar cell grid for the interceptor wings. */
export function solarCellMap(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#10204a';
  ctx.fillRect(0, 0, 256, 256);
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, 'rgba(90,140,255,0.35)');
  g.addColorStop(0.5, 'rgba(20,40,110,0.1)');
  g.addColorStop(1, 'rgba(120,170,255,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(190,210,255,0.5)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(256, i * 32); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(220,230,255,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, 254, 254);
  return tex(c);
}

/** Regolith ground: grey-brown with ejecta rays and small craters. */
export function regolithMap(): THREE.CanvasTexture {
  const rnd = mulberry(99);
  const [c, ctx] = canvas(1024, 1024);
  ctx.fillStyle = '#6f6b66';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 4000; i++) {
    const v = 0.7 + rnd() * 0.6;
    ctx.fillStyle = `rgba(${Math.round(111 * v)},${Math.round(107 * v)},${Math.round(102 * v)},0.5)`;
    ctx.fillRect(rnd() * 1024, rnd() * 1024, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  for (let i = 0; i < 130; i++) {
    const x = rnd() * 1024;
    const y = rnd() * 1024;
    const r = 4 + rnd() * (rnd() < 0.08 ? 60 : 16);
    ctx.fillStyle = `rgba(48,46,44,${0.3 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(150,146,140,${0.35 + rnd() * 0.3})`;
    ctx.lineWidth = 1.5 + rnd() * 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

// ---------- deep-sky point clouds ----------

export function starField(
  n: number,
  rMin: number,
  rMax: number,
  size: number,
  color: number,
  opacity: number,
): THREE.Points {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity }),
  );
}

/** Faint band of points around a tilted great circle — a stylized Milky Way. */
export function milkyWayPoints(): THREE.Points {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.05, 0.35, 0.6));
  const v = new THREE.Vector3();
  const rnd = mulberry(77);
  for (let i = 0; i < n; i++) {
    const th = rnd() * Math.PI * 2;
    const u1 = Math.max(rnd(), 1e-9);
    const spread = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rnd()) * 0.09;
    const r = 6200 + rnd() * 1400;
    v.set(r * Math.cos(th), r * Math.sin(th), r * Math.tan(spread)).applyQuaternion(q);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0x9bb0d4,
      size: 1.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.3,
    }),
  );
}
