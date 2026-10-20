// Teste de mira no navegador que reproduz a câmera do Valorant:
// 0,07° por contagem × sens, FOV vertical fixo (103° horizontais em 16:9), entrada crua via Pointer Lock.

import { YAW, VFOV, clamp } from './valorant.js';

const DEG = Math.PI / 180;
const TIMEOUT_MS = 6000;
const GAP_MS = 280;

function dir(yaw, pitch) {
  const y = yaw * DEG;
  const p = pitch * DEG;
  return [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function angleBetween(y1, p1, y2, p2) {
  return Math.acos(clamp(dot(dir(y1, p1), dir(y2, p2)), -1, 1)) / DEG;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Sequência de alvos de um teste: flicks, viradas e micro-ajustes de cabeça. */
export function makePlan(rng = Math.random, size = 'normal') {
  const n = size === 'warmup' ? { flick: 4, turn: 1, micro: 4 } : { flick: 6, turn: 2, micro: 8 };
  const side = () => (rng() < 0.5 ? 0 : 180);
  const plan = [];
  for (let i = 0; i < n.flick; i++) plan.push({ type: 'flick', dist: 15 + rng() * 30, angle: side() + (rng() - 0.5) * 30, radius: 1.1 });
  for (let i = 0; i < n.turn; i++) plan.push({ type: 'turn', dist: 90 + rng() * 60, angle: side() + (rng() - 0.5) * 10, radius: 1.6 });
  for (let i = 0; i < n.micro; i++) plan.push({ type: 'micro', dist: 2 + rng() * 6, angle: rng() * 360, radius: 0.45 });
  return shuffle(plan, rng);
}

export class Drill {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onFinish:(trials:object[])=>void, onState?:(s:{raw:boolean|null, locked:boolean})=>void}} cb
   */
  constructor(canvas, cb) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.yaw = 0;
    this.pitch = 0;
    this.locked = false;
    this.raw = null;
    this.active = false;
    this.skipMoves = 0;
    this._onMove = this._onMove.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._frame = this._frame.bind(this);
    canvas.addEventListener('click', () => this._requestLock());
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('mousedown', this._onDown);
  }

  /** @param {{sens:number, plan:object[], label:string}} o */
  start({ sens, plan, label }) {
    this.sens = sens;
    this.plan = plan;
    this.label = label;
    this.index = 0;
    this.trials = [];
    this.target = null;
    this.flash = null;
    this.yaw = 0;
    this.pitch = 0;
    this.active = true;
    this.nextAt = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.gapTimer);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  async _requestLock() {
    if (!this.active || this.locked) return;
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
      this.raw = true;
    } catch {
      try {
        await this.canvas.requestPointerLock();
        this.raw = false;
      } catch {
        this.raw = false;
      }
    }
    this.cb.onState?.({ raw: this.raw, locked: this.locked });
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    this.skipMoves = 2;
    // Pausa: o alvo atual é refeito do zero quando o jogador voltar.
    if (!this.locked) this.target = null;
    if (this.locked && this.active && !this.target) {
      clearTimeout(this.gapTimer);
      this._spawn();
    }
    this.cb.onState?.({ raw: this.raw, locked: this.locked });
  }

  _spawn() {
    if (this.index >= this.plan.length) return this._finish();
    const spec = this.plan[this.index];
    const ty = this.yaw + spec.dist * Math.cos(spec.angle * DEG);
    const tp = clamp(this.pitch + spec.dist * Math.sin(spec.angle * DEG), -35, 35);
    this.target = {
      spec, yaw: ty, pitch: tp,
      startYaw: this.yaw, startPitch: this.pitch,
      dist: angleBetween(this.yaw, this.pitch, ty, tp),
      t0: performance.now(), misses: 0, overshoot: 0,
    };
  }

  _record(hit) {
    const t = this.target;
    this.trials.push({
      type: t.spec.type, dist: t.dist, radius: t.spec.radius,
      time: (performance.now() - t.t0) / 1000, misses: t.misses, hit, overshoot: t.overshoot,
    });
    this.flash = { hit, at: performance.now() };
    this.target = null;
    this.index += 1;
    this.gapTimer = setTimeout(() => this.locked && this.active && this._spawn(), GAP_MS);
  }

  _finish() {
    this.active = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this._draw();
    this.cb.onFinish(this.trials);
  }

  _onMove(e) {
    if (!this.locked || !this.active) return;
    if (this.skipMoves > 0) { this.skipMoves--; return; }
    const k = YAW * this.sens;
    this.yaw += e.movementX * k;
    this.pitch = clamp(this.pitch - e.movementY * k, -89, 89);
    const t = this.target;
    if (t && t.spec.type !== 'micro') {
      // Overshoot: quanto a mira passou além do alvo ao longo da linha do flick.
      const dy = t.yaw - t.startYaw, dp = t.pitch - t.startPitch;
      const len = Math.hypot(dy, dp);
      const proj = ((this.yaw - t.startYaw) * dy + (this.pitch - t.startPitch) * dp) / len;
      t.overshoot = Math.max(t.overshoot, proj - len - t.spec.radius);
    }
  }

  _onDown(e) {
    if (!this.locked || !this.active || e.button !== 0) return;
    const t = this.target;
    if (!t) return;
    if (angleBetween(this.yaw, this.pitch, t.yaw, t.pitch) <= t.spec.radius) this._record(true);
    else t.misses += 1;
  }

  _frame() {
    if (!this.active) return;
    if (this.target && performance.now() - this.target.t0 > TIMEOUT_MS) this._record(false);
    this._draw();
    this.raf = requestAnimationFrame(this._frame);
  }

  _project(yaw, pitch, W, H) {
    const v = dir(yaw, pitch);
    const y = this.yaw * DEG, p = this.pitch * DEG;
    const f = dir(this.yaw, this.pitch);
    const r = [Math.cos(y), 0, -Math.sin(y)];
    const u = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
    const cz = dot(v, f);
    if (cz <= 0.02) return null;
    const tanV = Math.tan((VFOV / 2) * DEG);
    const tanH = tanV * (W / H);
    return { x: W / 2 + (dot(v, r) / cz / tanH) * (W / 2), y: H / 2 - (dot(v, u) / cz / tanV) * (H / 2) };
  }

  _draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = this.ctx;
    g.fillStyle = '#0f1923';
    g.fillRect(0, 0, W, H);

    // Grade esférica para dar referência de movimento.
    g.lineWidth = 1 * dpr;
    const base = Math.floor((this.yaw - 100) / 15) * 15;
    for (let yl = base; yl <= this.yaw + 100; yl += 15) {
      g.strokeStyle = 'rgba(236,232,225,0.08)';
      this._polyline(Array.from({ length: 41 }, (_, i) => [yl, -80 + i * 4]), W, H);
    }
    for (const pl of [-45, -30, -15, 0, 15, 30, 45]) {
      g.strokeStyle = pl === 0 ? 'rgba(236,232,225,0.25)' : 'rgba(236,232,225,0.08)';
      this._polyline(Array.from({ length: 61 }, (_, i) => [this.yaw - 90 + i * 3, pl]), W, H);
    }

    const t = this.target;
    if (t) {
      const pc = this._project(t.yaw, t.pitch, W, H);
      const pe = this._project(t.yaw, t.pitch + t.spec.radius, W, H);
      const onScreen = pc && pc.x > 0 && pc.x < W && pc.y > 0 && pc.y < H;
      if (onScreen && pe) {
        const rad = Math.max(2 * dpr, Math.hypot(pe.x - pc.x, pe.y - pc.y));
        g.beginPath();
        g.arc(pc.x, pc.y, rad, 0, Math.PI * 2);
        g.fillStyle = '#ff4655';
        g.fill();
        g.lineWidth = 1.5 * dpr;
        g.strokeStyle = '#ffffff';
        g.stroke();
      } else {
        // Seta na borda apontando para o alvo fora da tela.
        let dy = t.yaw - this.yaw;
        dy = ((dy + 540) % 360) - 180;
        const dp = t.pitch - this.pitch;
        const a = Math.atan2(-dp, dy);
        const R = Math.min(W, H) * 0.42;
        const x = W / 2 + Math.cos(a) * R, y = H / 2 + Math.sin(a) * R;
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.beginPath();
        g.moveTo(14 * dpr, 0);
        g.lineTo(-8 * dpr, -9 * dpr);
        g.lineTo(-8 * dpr, 9 * dpr);
        g.closePath();
        g.fillStyle = '#ff4655';
        g.fill();
        g.restore();
      }
    }

    // Mira: ponto + linhas curtas, ciano.
    const cx = W / 2, cy = H / 2;
    g.fillStyle = '#00ffff';
    g.fillRect(cx - dpr, cy - dpr, 2 * dpr, 2 * dpr);
    const gap = 4 * dpr, len = 5 * dpr, th = 2 * dpr;
    g.fillRect(cx + gap, cy - th / 2, len, th);
    g.fillRect(cx - gap - len, cy - th / 2, len, th);
    g.fillRect(cx - th / 2, cy + gap, th, len);
    g.fillRect(cx - th / 2, cy - gap - len, th, len);

    if (this.flash && performance.now() - this.flash.at < 160) {
      g.fillStyle = this.flash.hit ? 'rgba(80,220,140,0.15)' : 'rgba(255,70,85,0.15)';
      g.fillRect(0, 0, W, H);
    }

    g.font = `${13 * dpr}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(236,232,225,0.75)';
    g.textAlign = 'left';
    g.fillText(`${this.label}  ·  alvo ${Math.min(this.index + 1, this.plan.length)}/${this.plan.length}`, 12 * dpr, 22 * dpr);

    if (!this.locked && this.active) {
      g.fillStyle = 'rgba(15,25,35,0.78)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ece8e1';
      g.textAlign = 'center';
      g.font = `600 ${18 * dpr}px system-ui, sans-serif`;
      g.fillText(this.index === 0 ? 'Clique aqui para começar' : 'Pausado. Clique para continuar', W / 2, H / 2 - 8 * dpr);
      g.font = `${13 * dpr}px system-ui, sans-serif`;
      g.fillStyle = 'rgba(236,232,225,0.7)';
      g.fillText('Acerte os alvos vermelhos rápido e sem errar.', W / 2, H / 2 + 18 * dpr);
      g.fillText('Esc pausa.', W / 2, H / 2 + 38 * dpr);
    }
  }

  _polyline(points, W, H) {
    const g = this.ctx;
    g.beginPath();
    let open = false;
    for (const [y, p] of points) {
      const pr = this._project(y, p, W, H);
      if (!pr) { open = false; continue; }
      if (open) g.lineTo(pr.x, pr.y);
      else { g.moveTo(pr.x, pr.y); open = true; }
    }
    g.stroke();
  }
}
