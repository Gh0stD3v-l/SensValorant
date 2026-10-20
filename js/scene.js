// Desenho da cena 3D (câmera do Valorant) em canvas 2D. Usado pelo teste e pelo replay.

import { VFOV } from './valorant.js';
import { BODY, wrap } from './targets.js';

const DEG = Math.PI / 180;

export const COLORS = {
  bg: '#0f1923',
  grid: 'rgba(236,232,225,0.07)',
  horizon: 'rgba(236,232,225,0.22)',
  head: '#ff4655',
  body: 'rgba(255,70,85,0.28)',
  outline: '#ffffff',
  cross: '#00ffff',
  text: 'rgba(236,232,225,0.82)',
  trail: 'rgba(0,255,255,0.55)',
  hit: '#4fd18b',
  bodyHit: '#ffb547',
  miss: '#ff4655',
};

function dir(yaw, pitch) {
  const y = yaw * DEG, p = pitch * DEG;
  return [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Câmera com FOV vertical fixo do Valorant; o horizontal acompanha o aspecto da tela. */
export function camera(yaw, pitch, W, H) {
  const y = yaw * DEG, p = pitch * DEG;
  const f = dir(yaw, pitch);
  const r = [Math.cos(y), 0, -Math.sin(y)];
  const u = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
  const tanV = Math.tan((VFOV / 2) * DEG);
  const tanH = tanV * (W / H);
  return {
    yaw, pitch, W, H,
    project(ty, tp) {
      const v = dir(ty, tp);
      const cz = dot(v, f);
      if (cz <= 0.02) return null;
      return { x: W / 2 + (dot(v, r) / cz / tanH) * (W / 2), y: H / 2 - (dot(v, u) / cz / tanV) * (H / 2) };
    },
  };
}

function polyline(g, cam, points) {
  g.beginPath();
  let open = false;
  for (const [y, p] of points) {
    const pr = cam.project(y, p);
    if (!pr) { open = false; continue; }
    if (open) g.lineTo(pr.x, pr.y);
    else { g.moveTo(pr.x, pr.y); open = true; }
  }
  g.stroke();
}

export function drawWorld(g, cam, dpr) {
  const { W, H, yaw } = cam;
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, W, H);
  g.lineWidth = dpr;
  g.strokeStyle = COLORS.grid;
  const base = Math.floor((yaw - 100) / 15) * 15;
  for (let yl = base; yl <= yaw + 100; yl += 15) polyline(g, cam, Array.from({ length: 41 }, (_, i) => [yl, -80 + i * 4]));
  for (const pl of [-45, -30, -15, 15, 30, 45]) polyline(g, cam, Array.from({ length: 61 }, (_, i) => [yaw - 90 + i * 3, pl]));
  g.strokeStyle = COLORS.horizon;
  polyline(g, cam, Array.from({ length: 61 }, (_, i) => [yaw - 90 + i * 3, 0]));
}

function rect(g, cam, pos, rh, x0, x1, y0, y1) {
  const c = Math.cos(pos.pitch * DEG) || 1;
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => cam.project(pos.yaw + (x * rh) / c, pos.pitch + y * rh));
  if (pts.some((p) => !p)) return;
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fill();
}

/** Desenha o agente. Retorna false se a cabeça estiver fora da tela. */
export function drawAgent(g, cam, pos, rh, dpr) {
  const pc = cam.project(pos.yaw, pos.pitch);
  const pe = cam.project(pos.yaw, pos.pitch + rh);
  if (!pc || !pe || pc.x < 0 || pc.x > cam.W || pc.y < 0 || pc.y > cam.H) return false;
  g.fillStyle = COLORS.body;
  const { torso, legs } = BODY;
  rect(g, cam, pos, rh, -torso.halfWidth, torso.halfWidth, torso.top, torso.bottom);
  rect(g, cam, pos, rh, -legs.halfWidth, -0.25, legs.top, legs.bottom);
  rect(g, cam, pos, rh, 0.25, legs.halfWidth, legs.top, legs.bottom);
  const rad = Math.max(2 * dpr, Math.hypot(pe.x - pc.x, pe.y - pc.y));
  g.beginPath();
  g.arc(pc.x, pc.y, rad, 0, Math.PI * 2);
  g.fillStyle = COLORS.head;
  g.fill();
  g.lineWidth = 1.5 * dpr;
  g.strokeStyle = COLORS.outline;
  g.stroke();
  return true;
}

/** Seta na borda apontando para um alvo fora da tela. */
export function drawArrow(g, cam, pos, dpr) {
  const dy = wrap(pos.yaw - cam.yaw);
  const dp = pos.pitch - cam.pitch;
  const a = Math.atan2(-dp, dy);
  const R = Math.min(cam.W, cam.H) * 0.42;
  g.save();
  g.translate(cam.W / 2 + Math.cos(a) * R, cam.H / 2 + Math.sin(a) * R);
  g.rotate(a);
  g.beginPath();
  g.moveTo(14 * dpr, 0);
  g.lineTo(-8 * dpr, -9 * dpr);
  g.lineTo(-8 * dpr, 9 * dpr);
  g.closePath();
  g.fillStyle = COLORS.head;
  g.fill();
  g.restore();
}

export function drawCrosshair(g, cam, dpr) {
  const cx = cam.W / 2, cy = cam.H / 2;
  g.fillStyle = COLORS.cross;
  g.fillRect(cx - dpr, cy - dpr, 2 * dpr, 2 * dpr);
  const gap = 4 * dpr, len = 5 * dpr, th = 2 * dpr;
  g.fillRect(cx + gap, cy - th / 2, len, th);
  g.fillRect(cx - gap - len, cy - th / 2, len, th);
  g.fillRect(cx - th / 2, cy + gap, th, len);
  g.fillRect(cx - th / 2, cy - gap - len, th, len);
}

/** Rastro da mira (direções passadas projetadas na câmera atual). */
export function drawTrail(g, cam, pts, dpr) {
  if (pts.length < 2) return;
  g.lineWidth = 2 * dpr;
  g.strokeStyle = COLORS.trail;
  polyline(g, cam, pts);
}

export function drawMarker(g, cam, yaw, pitch, color, dpr) {
  const p = cam.project(yaw, pitch);
  if (!p) return;
  g.beginPath();
  g.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
  g.lineWidth = 2 * dpr;
  g.strokeStyle = color;
  g.stroke();
}

export function drawText(g, text, x, y, dpr, { size = 13, weight = 400, align = 'left', color = COLORS.text } = {}) {
  g.font = `${weight} ${size * dpr}px "Barlow", system-ui, sans-serif`;
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(text, x, y);
}

/** Ajusta o tamanho interno do canvas ao tamanho exibido. */
export function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(c.clientWidth * dpr)), H = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return { W, H, dpr };
}
