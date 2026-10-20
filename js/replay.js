// Replay de uma tentativa, estilo Aim Lab: a cena em primeira pessoa reproduzida a partir do caminho
// gravado da mira, mais um gráfico do caminho visto do alvo.

import { targetAt, visibleAt, offset, lifetime, TYPE_INFO } from './targets.js';
import { camera, fitCanvas, drawWorld, drawAgent, drawArrow, drawCrosshair, drawTrail, drawMarker, drawText, COLORS } from './scene.js';
import { resample, trialMetrics } from './analysis.js';

const RESULT_COLOR = { head: COLORS.hit, body: COLORS.bodyHit, miss: COLORS.miss };

export class ReplayPlayer {
  /**
   * @param {HTMLCanvasElement} canvas cena em primeira pessoa
   * @param {HTMLCanvasElement} plot gráfico do caminho
   * @param {(t:number, end:number, playing:boolean)=>void} [onTick]
   */
  constructor(canvas, plot, onTick) {
    this.canvas = canvas;
    this.plot = plot;
    this.onTick = onTick;
    this.speed = 0.5;
    this.playing = false;
    this._frame = this._frame.bind(this);
  }

  load(trial) {
    this.trial = trial;
    this.rs = resample(trial.path, 4);
    const lastClick = trial.clicks.length ? trial.clicks[trial.clicks.length - 1][0] : 0;
    this.end = Math.max(trial.time * 1000, lastClick, this.rs.length ? this.rs[this.rs.length - 1][0] : 0);
    this.end = Math.min(this.end, lifetime(trial.target.spec));
    this.metrics = trialMetrics(trial);
    this.t = 0;
    this.play();
  }

  play() {
    if (!this.trial) return;
    if (this.t >= this.end) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this._frame);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this._draw();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  stop() {
    this.pause();
  }

  _frame(now) {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    this.t = Math.min(this.end, this.t + dt * this.speed);
    this._draw();
    if (this.t >= this.end) {
      this.playing = false;
      this.onTick?.(this.t, this.end, false);
      return;
    }
    this.onTick?.(this.t, this.end, true);
    this.raf = requestAnimationFrame(this._frame);
  }

  _camAt(ms) {
    const rs = this.rs;
    if (!rs.length) return [this.trial.startYaw, this.trial.startPitch];
    const i = Math.max(0, Math.min(rs.length - 1, Math.floor(ms / 4)));
    return [rs[i][1], rs[i][2]];
  }

  _draw() {
    const tr = this.trial;
    if (!tr) return;
    const { W, H, dpr } = fitCanvas(this.canvas);
    const g = this.canvas.getContext('2d');
    const [yaw, pitch] = this._camAt(this.t);
    const cam = camera(yaw, pitch, W, H);
    drawWorld(g, cam, dpr);
    if (visibleAt(tr.target, this.t)) {
      const pos = targetAt(tr.target, this.t);
      if (!drawAgent(g, cam, pos, tr.radius, dpr)) drawArrow(g, cam, pos, dpr);
    }
    const from = Math.max(0, this.t - 350);
    drawTrail(g, cam, this.rs.filter((p) => p[0] >= from && p[0] <= this.t).map((p) => [p[1], p[2]]), dpr);
    for (const [ms, cy, cp, res] of tr.clicks) {
      if (ms <= this.t && this.t - ms < 700) drawMarker(g, cam, cy, cp, RESULT_COLOR[res], dpr);
    }
    drawCrosshair(g, cam, dpr);
    drawText(g, `${TYPE_INFO[tr.type].name} · ${(this.t / 1000).toFixed(2)} s · ${this.speed}×`, 12 * dpr, 22 * dpr, dpr);
    if (!this.playing && this.t >= this.end) {
      const txt = tr.hit ? `Acertou em ${tr.time.toFixed(2)} s` : 'Não acertou a cabeça';
      drawText(g, txt, W / 2, H - 20 * dpr, dpr, { size: 15, weight: 600, align: 'center', color: tr.hit ? COLORS.hit : COLORS.miss });
    }
    this._drawPlot();
  }

  /** Caminho da mira em relação à cabeça (0, 0), em graus. */
  _drawPlot() {
    const tr = this.trial;
    const c = this.plot;
    const { W, H, dpr } = fitCanvas(c);
    const g = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--text').trim() || '#ece8e1';
    const muted = css.getPropertyValue('--muted').trim() || '#9aa7b2';
    const line = css.getPropertyValue('--border').trim() || '#2c3e4c';
    const surface = css.getPropertyValue('--surface-2').trim() || '#1f2f3c';
    g.fillStyle = surface;
    g.fillRect(0, 0, W, H);

    const rel = this.rs.map((p) => {
      const o = offset(targetAt(tr.target, p[0]), p[1], p[2]);
      return [p[0], o.x, o.y];
    });
    if (!rel.length) return;
    const rh = tr.radius;
    let maxAbs = rh * 4;
    for (const [, x, y] of rel) maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    maxAbs = Math.min(maxAbs * 1.1, 60);
    const pad = 18 * dpr;
    const s = (Math.min(W, H) / 2 - pad) / maxAbs;
    const X = (x) => W / 2 + x * s;
    const Y = (y) => H / 2 - y * s;

    g.strokeStyle = line;
    g.lineWidth = dpr;
    g.beginPath();
    g.moveTo(0, H / 2); g.lineTo(W, H / 2);
    g.moveTo(W / 2, 0); g.lineTo(W / 2, H);
    g.stroke();

    // Corpo e cabeça no centro.
    g.fillStyle = 'rgba(255,70,85,0.18)';
    g.fillRect(X(-2.4 * rh), Y(-1.2 * rh), 4.8 * rh * s, 6.8 * rh * s);
    g.beginPath();
    g.arc(X(0), Y(0), Math.max(2 * dpr, rh * s), 0, Math.PI * 2);
    g.fillStyle = COLORS.head;
    g.fill();

    // Caminho: mais claro no começo, mais forte no fim.
    g.lineWidth = 2 * dpr;
    for (let i = 1; i < rel.length; i++) {
      const k = i / rel.length;
      g.strokeStyle = `rgba(0,190,200,${0.25 + 0.75 * k})`;
      g.beginPath();
      g.moveTo(X(rel[i - 1][1]), Y(rel[i - 1][2]));
      g.lineTo(X(rel[i][1]), Y(rel[i][2]));
      g.stroke();
    }
    const first = rel[0];
    g.fillStyle = muted;
    g.beginPath(); g.arc(X(first[1]), Y(first[2]), 4 * dpr, 0, Math.PI * 2); g.fill();

    const ep = this.metrics.endpoint;
    if (ep) {
      const p = rel.find((r) => r[0] >= ep.ms) || rel[rel.length - 1];
      g.save();
      g.translate(X(p[1]), Y(p[2]));
      g.rotate(Math.PI / 4);
      g.strokeStyle = ink;
      g.lineWidth = 2 * dpr;
      g.strokeRect(-4 * dpr, -4 * dpr, 8 * dpr, 8 * dpr);
      g.restore();
    }
    for (const [ms, cy, cp, res] of tr.clicks) {
      const o = offset(targetAt(tr.target, ms), cy, cp);
      g.beginPath();
      g.arc(X(o.x), Y(o.y), 4 * dpr, 0, Math.PI * 2);
      g.fillStyle = RESULT_COLOR[res];
      g.fill();
    }
    // Posição atual no replay.
    const cur = rel[Math.max(0, Math.min(rel.length - 1, Math.floor(this.t / 4)))];
    g.beginPath();
    g.arc(X(cur[1]), Y(cur[2]), 5 * dpr, 0, Math.PI * 2);
    g.strokeStyle = ink;
    g.lineWidth = 2 * dpr;
    g.stroke();

    g.font = `${11 * dpr}px "Barlow", system-ui, sans-serif`;
    g.fillStyle = muted;
    g.textAlign = 'left';
    g.fillText(`escala: ±${maxAbs.toFixed(1)}°`, 8 * dpr, H - 8 * dpr);
  }
}
