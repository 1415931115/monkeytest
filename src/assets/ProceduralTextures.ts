import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}

/** Ink-moss orchard floor: pine-smoke soil, teal moss, fallen leaves, pink petals. */
export function groundTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = createSeededRandom(11);
  ctx.fillStyle = '#34402f';
  ctx.fillRect(0, 0, size, size);
  const blot = (x: number, y: number, r: number, col: string, a: number) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  };
  // large moss / soil patches (tileable)
  for (let i = 0; i < 70; i++) {
    const tone = rng();
    const col = tone < 0.45 ? '62,92,66' : tone < 0.75 ? '74,58,44' : '42,54,58';
    blot(rng() * size, rng() * size, 40 + rng() * 80, col, 0.45);
  }
  for (let i = 0; i < 700; i++) {
    const tone = rng();
    const col = tone < 0.5 ? '78,108,70' : tone < 0.8 ? '66,52,40' : '36,46,40';
    blot(rng() * size, rng() * size, 5 + rng() * 22, col, 0.4);
  }
  // grass strokes
  for (let i = 0; i < 4200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.strokeStyle = `rgba(${80 + rng() * 50},${110 + rng() * 60},${70 + rng() * 30},${0.25 + rng() * 0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 4, y - 3 - rng() * 7);
    ctx.stroke();
  }
  // fallen leaves (umber + old gold)
  for (let i = 0; i < 320; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI);
    const gold = rng() < 0.3;
    ctx.fillStyle = gold ? `rgba(${170 + rng() * 40},${130 + rng() * 30},50,0.6)` : `rgba(${100 + rng() * 50},${70 + rng() * 30},40,0.6)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 4 + rng() * 3, 1.6 + rng(), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,12,0.45)';
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(4, 0);
    ctx.stroke();
    ctx.restore();
  }
  // peach-blossom petals
  for (let i = 0; i < 300; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = `rgba(${225 + rng() * 30},${140 + rng() * 40},${165 + rng() * 30},${0.7})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rng() * 1.8, 1.2 + rng(), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** Ancient flagstone trail: worn slabs with moss seams (u across, v along). */
export function pathTexture(): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = createSeededRandom(23);
  // moss/soil grout
  ctx.fillStyle = '#2f3a2a';
  ctx.fillRect(0, 0, size, size);
  // slabs: 3 rows per tile, staggered, irregular widths
  const rows = 3;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 === 0 ? -18 : -52;
    while (x < size) {
      const w = 54 + rng() * 46;
      const inset = 3 + rng() * 2;
      const shade = 112 + rng() * 40;
      const x0 = x + inset;
      const y0 = r * rh + inset;
      const ww = w - inset * 2;
      const hh = rh - inset * 2;
      ctx.fillStyle = `rgb(${shade},${shade - 6},${shade - 18})`;
      ctx.beginPath();
      const k = 6;
      ctx.moveTo(x0 + k, y0);
      ctx.lineTo(x0 + ww - k * rng(), y0 + rng() * 2);
      ctx.lineTo(x0 + ww, y0 + hh - k * rng());
      ctx.lineTo(x0 + k * rng(), y0 + hh);
      ctx.lineTo(x0, y0 + k);
      ctx.closePath();
      ctx.fill();
      // worn centre highlight + edge darkening
      const g = ctx.createRadialGradient(x0 + ww / 2, y0 + hh / 2, 4, x0 + ww / 2, y0 + hh / 2, ww * 0.7);
      g.addColorStop(0, 'rgba(255,240,215,0.14)');
      g.addColorStop(1, 'rgba(20,16,12,0.35)');
      ctx.fillStyle = g;
      ctx.fill();
      // cracks
      ctx.strokeStyle = 'rgba(30,26,20,0.55)';
      ctx.lineWidth = 1;
      for (let n = 0; n < 2; n++) {
        let cx = x0 + rng() * ww;
        let cy = y0 + rng() * hh;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 4; s++) {
          cx += (rng() - 0.5) * 18;
          cy += (rng() - 0.5) * 14;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      x += w;
    }
  }
  // speckle / lichen
  for (let i = 0; i < 900; i++) {
    const v = rng();
    ctx.fillStyle = v < 0.5 ? `rgba(40,34,26,0.35)` : v < 0.8 ? `rgba(110,140,100,0.3)` : `rgba(200,190,160,0.25)`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${220 + rng() * 30},${140 + rng() * 40},${160},0.7)`;
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, 2.2, 1.3, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // soft moss edges blending into the floor
  const edge = ctx.createLinearGradient(0, 0, size, 0);
  edge.addColorStop(0, 'rgba(52,64,47,1)');
  edge.addColorStop(0.14, 'rgba(52,64,47,0)');
  edge.addColorStop(0.86, 'rgba(52,64,47,0)');
  edge.addColorStop(1, 'rgba(52,64,47,1)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
}

/** Leaf-dapple mask: moonlight cut into shards by the canopy (white on black, additive). */
export function dappleTexture(): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = createSeededRandom(77);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2;
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.pow(rng(), 0.7) * size * 0.42;
    const x = cx + Math.cos(a) * d;
    const y = cx + Math.sin(a) * d;
    const r = 4 + rng() * 16;
    const fall = 1 - d / (size * 0.45);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * fall})`);
    g.addColorStop(0.55, `rgba(255,255,255,${0.55 * fall})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI);
    ctx.scale(1, 0.4 + rng() * 0.5);
    ctx.translate(-x, -y);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }
  return finish(c, false);
}

/** Gnarled peach bark: vertical fissures and lichen. */
export function barkTexture(): THREE.CanvasTexture {
  const w = 256;
  const [c, ctx] = makeCanvas(w);
  const rng = createSeededRandom(31);
  ctx.fillStyle = '#5a463a';
  ctx.fillRect(0, 0, w, w);
  for (let i = 0; i < 140; i++) {
    const x = rng() * w;
    ctx.strokeStyle = `rgba(${18 + rng() * 15},${12 + rng() * 10},${10},${0.5 + rng() * 0.4})`;
    ctx.lineWidth = 1 + rng() * 3;
    ctx.beginPath();
    let y = 0;
    let cx = x;
    ctx.moveTo(cx, y);
    while (y < w) {
      y += 6 + rng() * 14;
      cx += (rng() - 0.5) * 6;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${90 + rng() * 40},${70 + rng() * 30},${55},0.18)`;
    ctx.fillRect(rng() * w, rng() * w, 2 + rng() * 6, 1 + rng() * 2);
  }
  // lichen patches
  for (let i = 0; i < 40; i++) {
    const x = rng() * w;
    const y = rng() * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 6 + rng() * 10);
    g.addColorStop(0, 'rgba(110,130,90,0.45)');
    g.addColorStop(1, 'rgba(110,130,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 16, y - 16, 32, 32);
  }
  return finish(c);
}

/** Lacquered red wood with grain. */
export function lacquerTexture(): THREE.CanvasTexture {
  const w = 128;
  const [c, ctx] = makeCanvas(w);
  const rng = createSeededRandom(41);
  ctx.fillStyle = '#6e1714';
  ctx.fillRect(0, 0, w, w);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(${30 + rng() * 30},5,5,${0.2 + rng() * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x = rng() * w;
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 4, w * 0.3, x - 4, w * 0.6, x + 2, w);
    ctx.stroke();
  }
  // worn paint chips
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(60,45,35,${0.5 + rng() * 0.4})`;
    ctx.fillRect(rng() * w, rng() * w, 1 + rng() * 5, 1 + rng() * 3);
  }
  return finish(c);
}

/** Weathered stone. */
export function stoneTexture(): THREE.CanvasTexture {
  const w = 256;
  const [c, ctx] = makeCanvas(w);
  const rng = createSeededRandom(51);
  ctx.fillStyle = '#5a5a55';
  ctx.fillRect(0, 0, w, w);
  for (let i = 0; i < 1200; i++) {
    const s = 60 + rng() * 60;
    ctx.fillStyle = `rgba(${s},${s},${s - 6},0.25)`;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * w, 1 + rng() * 8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 25; i++) {
    ctx.strokeStyle = 'rgba(25,25,22,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = rng() * w;
    let y = rng() * w;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 30;
      y += (rng() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 50; i++) {
    const x = rng() * w;
    const y = rng() * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
    g.addColorStop(0, 'rgba(70,95,55,0.5)');
    g.addColorStop(1, 'rgba(70,95,55,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 12, y - 12, 24, 24);
  }
  return finish(c);
}

/** Pale veined skin for the Grabber. */
export function skinTexture(): THREE.CanvasTexture {
  const w = 256;
  const [c, ctx] = makeCanvas(w);
  const rng = createSeededRandom(61);
  ctx.fillStyle = '#a9a294';
  ctx.fillRect(0, 0, w, w);
  for (let i = 0; i < 300; i++) {
    const x = rng() * w;
    const y = rng() * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 4 + rng() * 18);
    g.addColorStop(0, `rgba(${110 + rng() * 40},${90 + rng() * 30},${90},0.25)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 22, y - 22, 44, 44);
  }
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(70,60,95,${0.25 + rng() * 0.25})`;
    ctx.lineWidth = 0.8 + rng();
    ctx.beginPath();
    let x = rng() * w;
    let y = rng() * w;
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (rng() - 0.5) * 22;
      y += rng() * 16;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // grime
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(40,35,30,${0.15 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * w, 2 + rng() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** Tattered robe cloth. */
export function clothTexture(): THREE.CanvasTexture {
  const w = 256;
  const [c, ctx] = makeCanvas(w);
  const rng = createSeededRandom(71);
  ctx.fillStyle = '#4b4943';
  ctx.fillRect(0, 0, w, w);
  for (let i = 0; i < 90; i++) {
    const x = rng() * w;
    ctx.strokeStyle = `rgba(${20 + rng() * 30},${20 + rng() * 30},${20 + rng() * 25},0.35)`;
    ctx.lineWidth = 2 + rng() * 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 10, w / 3, x - 10, (2 * w) / 3, x + 5, w);
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(90,30,25,${0.15 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.arc(rng() * w, w * 0.6 + rng() * w * 0.4, 3 + rng() * 12, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** Paifang plaque with calligraphy characters. */
export function plaqueTexture(text: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256);
  c.height = 96;
  const g = ctx.createLinearGradient(0, 0, 0, 96);
  g.addColorStop(0, '#1e1a14');
  g.addColorStop(1, '#0f0c09');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = '#b08a3e';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = '#d8b25a';
  ctx.font = 'bold 54px "Noto Serif CJK SC", "Songti SC", "SimSun", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  return finish(c, false);
}

/** Soft radial sprite for halos, fireflies, lantern glows. */
export function glowSprite(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, false);
}

/** Four-point star sparkle for ancient peaches. */
export function sparkleSprite(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  ctx.translate(64, 64);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, 40, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(60, 0);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fill();
  }
  return finish(c, false);
}
