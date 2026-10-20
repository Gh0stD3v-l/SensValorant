// Teste de mira no navegador com a câmera do Valorant:
// 0,07° por contagem × sens, FOV vertical fixo (103° horizontais em 16:9), entrada crua via Pointer Lock,
// tela cheia para a mira andar na tela na mesma velocidade que no jogo. Grava tudo para o replay e o diagnóstico.

import { YAW, clamp } from './valorant.js';
import { spawn, targetAt, visibleAt, lifetime, hitTest } from './targets.js';
import { camera, fitCanvas, drawWorld, drawAgent, drawArrow, drawCrosshair, drawText, COLORS } from './scene.js';

const GAP_MS = 280;
const BLOCK_GAP_MS = 1600;

export class Drill {
  /**
   * @param {HTMLElement} stage elemento que vai para tela cheia
   * @param {HTMLCanvasElement} canvas
   * @param {{onDone:(r:{blocks:object[], fps:number})=>void, onState?:(s:{raw:boolean|null, locked:boolean, fullscreen:boolean})=>void}} cb
   */
  constructor(stage, canvas, cb) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.yaw = 0;
    this.pitch = 0;
    this.locked = false;
    this.raw = null;
    this.active = false;
    this.skipMoves = 0;
    this._frame = this._frame.bind(this);
    canvas.addEventListener('click', () => this._requestLock());
    document.addEventListener('pointerlockchange', () => this._onLockChange());
    // pointerrawupdate entrega os movimentos assim que chegam (sem juntar por quadro), quando existe.
    const moveEvent = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'mousemove';
    document.addEventListener(moveEvent, (e) => this._onMove(e));
    document.addEventListener('mousedown', (e) => this._onDown(e));
  }

  /**
   * @param {{blocks:{label:string, sens:number, plan:object[]}[], countScale?:number, fullscreen?:boolean}} o
   */
  run({ blocks, countScale = 1, fullscreen = true }) {
    this.blocks = blocks.map((b) => ({ ...b, trials: [] }));
    this.countScale = countScale;
    this.fullscreen = fullscreen;
    this.bi = 0;
    this.index = 0;
    this.target = null;
    this.flash = null;
    this.yaw = 0;
    this.pitch = 0;
    this.nextAt = 0;
    this.banner = null;
    this.frames = [];
    this.fpsShown = 0;
    this.fpsAt = 0;
    this.active = true;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this._frame);
  }

  get block() {
    return this.blocks[this.bi];
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this._release();
  }

  _release() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (document.fullscreenElement === this.stage) document.exitFullscreen().catch(() => {});
  }

  async _requestLock() {
    if (!this.active || this.locked) return;
    if (this.fullscreen && !document.fullscreenElement && this.stage.requestFullscreen) {
      await this.stage.requestFullscreen().catch(() => {});
    }
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
    this._emitState();
  }

  _emitState() {
    this.cb.onState?.({ raw: this.raw, locked: this.locked, fullscreen: document.fullscreenElement === this.stage });
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    this.skipMoves = 2;
    // Pausa: o alvo atual é descartado e refeito quando o jogador voltar.
    if (!this.locked) {
      this.target = null;
      if (this.active && document.fullscreenElement === this.stage) document.exitFullscreen().catch(() => {});
    } else {
      this.nextAt = performance.now() + 400;
    }
    this._emitState();
  }

  _spawn(now) {
    const spec = this.block.plan[this.index];
    const t = spawn(spec, this.yaw, this.pitch);
    const pos = targetAt(t, 0);
    this.target = {
      t, t0: now, startYaw: this.yaw, startPitch: this.pitch,
      dist: Math.hypot((pos.yaw - this.yaw) * Math.cos((pos.pitch * Math.PI) / 180), pos.pitch - this.pitch),
      path: [[0, this.yaw, this.pitch]], clicks: [], misses: 0, body: 0, overshoot: 0,
    };
  }

  _record(hit, now) {
    const c = this.target;
    this.block.trials.push({
      type: c.t.spec.type, dist: c.dist, radius: c.t.spec.head, time: (now - c.t0) / 1000,
      hit, misses: c.misses, body: c.body, overshoot: c.overshoot,
      path: c.path, clicks: c.clicks, target: c.t, startYaw: c.startYaw, startPitch: c.startPitch,
      sens: this.block.sens, label: this.block.label, at: now,
    });
    this.flash = { hit, at: now };
    this.target = null;
    this.index += 1;
    this.nextAt = now + GAP_MS;
    if (this.index >= this.block.plan.length) {
      this.bi += 1;
      this.index = 0;
      if (this.bi < this.blocks.length) {
        this.nextAt = now + BLOCK_GAP_MS;
        this.banner = { text: `Próximo: ${this.block.label}`, until: this.nextAt };
      }
    }
  }

  _finish() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this._release();
    const dts = this.frames.slice(1).map((t, i) => t - this.frames[i]).filter((d) => d > 0 && d < 200);
    const fps = dts.length ? 1000 / (dts.reduce((s, d) => s + d, 0) / dts.length) : 0;
    this.cb.onDone({ blocks: this.blocks, fps });
  }

  _onMove(e) {
    if (!this.locked || !this.active || !this.block) return;
    if (this.skipMoves > 0) { this.skipMoves--; return; }
    const k = YAW * this.block.sens * this.countScale;
    this.yaw += e.movementX * k;
    this.pitch = clamp(this.pitch - e.movementY * k, -89, 89);
    const c = this.target;
    if (!c) return;
    c.path.push([performance.now() - c.t0, this.yaw, this.pitch]);
    if (c.t.spec.type === 'flick' || c.t.spec.type === 'turn') {
      // Overshoot: quanto a mira passou além do alvo ao longo da linha do flick.
      const pos = targetAt(c.t, 0);
      const dy = pos.yaw - c.startYaw, dp = pos.pitch - c.startPitch;
      const len = Math.hypot(dy, dp);
      const proj = ((this.yaw - c.startYaw) * dy + (this.pitch - c.startPitch) * dp) / len;
      c.overshoot = Math.max(c.overshoot, proj - len - c.t.spec.head);
    }
  }

  _onDown(e) {
    if (!this.locked || !this.active || e.button !== 0) return;
    const c = this.target;
    if (!c) return;
    const now = performance.now();
    const ms = now - c.t0;
    const res = visibleAt(c.t, ms) ? hitTest(targetAt(c.t, ms), c.t.spec.head, this.yaw, this.pitch) : null;
    c.clicks.push([ms, this.yaw, this.pitch, res ?? 'miss']);
    if (res === 'head') this._record(true, now);
    else if (res === 'body') c.body += 1;
    else c.misses += 1;
  }

  _frame(now) {
    if (!this.active) return;
    this.frames.push(now);
    if (this.frames.length > 2000) this.frames.splice(0, 1000);
    if (this.target && now - this.target.t0 > lifetime(this.target.t.spec)) this._record(false, now);
    if (!this.target && this.locked && now >= this.nextAt) {
      if (this.bi >= this.blocks.length) return this._finish();
      this._spawn(now);
    }
    this._draw(now);
    this.raf = requestAnimationFrame(this._frame);
  }

  _draw(now) {
    const { W, H, dpr } = fitCanvas(this.canvas);
    const g = this.ctx;
    const cam = camera(this.yaw, this.pitch, W, H);
    drawWorld(g, cam, dpr);

    const c = this.target;
    if (c) {
      const ms = now - c.t0;
      if (visibleAt(c.t, ms)) {
        const pos = targetAt(c.t, ms);
        if (!drawAgent(g, cam, pos, c.t.spec.head, dpr)) drawArrow(g, cam, pos, dpr);
      }
    }
    drawCrosshair(g, cam, dpr);

    if (this.flash && now - this.flash.at < 160) {
      g.fillStyle = this.flash.hit ? 'rgba(79,209,139,0.14)' : 'rgba(255,70,85,0.14)';
      g.fillRect(0, 0, W, H);
    }

    if (now - this.fpsAt > 500 && this.frames.length > 10) {
      const n = this.frames.length;
      this.fpsShown = Math.round((10 * 1000) / (this.frames[n - 1] - this.frames[n - 11]));
      this.fpsAt = now;
    }
    const b = this.blocks[Math.min(this.bi, this.blocks.length - 1)];
    const total = this.blocks.reduce((s, x) => s + x.plan.length, 0);
    const done = this.blocks.slice(0, this.bi).reduce((s, x) => s + x.plan.length, 0) + this.index;
    drawText(g, `${b.label}  ·  alvo ${Math.min(done + 1, total)}/${total}`, 12 * dpr, 22 * dpr, dpr);
    drawText(g, `${this.fpsShown} FPS`, W - 12 * dpr, 22 * dpr, dpr, { align: 'right', color: this.fpsShown && this.fpsShown < 90 ? COLORS.bodyHit : COLORS.text });

    if (this.banner && now < this.banner.until && this.locked) {
      drawText(g, this.banner.text, W / 2, H * 0.32, dpr, { size: 22, weight: 600, align: 'center' });
    }

    if (!this.locked && this.active) {
      g.fillStyle = 'rgba(15,25,35,0.8)';
      g.fillRect(0, 0, W, H);
      const first = this.bi === 0 && this.index === 0;
      drawText(g, first ? 'Clique aqui para começar' : 'Pausado. Clique para continuar', W / 2, H / 2 - 10 * dpr, dpr, { size: 18, weight: 600, align: 'center' });
      drawText(g, 'Acerte as cabeças rápido e sem errar. Corpo não conta.', W / 2, H / 2 + 16 * dpr, dpr, { align: 'center' });
      drawText(g, 'Esc pausa.', W / 2, H / 2 + 36 * dpr, dpr, { align: 'center' });
    }
  }
}

/** Mede contagens do mouse para a calibração (mesmo tipo de captura do teste). */
export class CountMeter {
  constructor(el, onUpdate) {
    this.el = el;
    this.onUpdate = onUpdate;
    this.counts = 0;
    this.measuring = false;
    const moveEvent = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'mousemove';
    document.addEventListener(moveEvent, (e) => {
      if (!this.measuring || document.pointerLockElement !== this.el) return;
      this.counts += e.movementX;
      this.onUpdate(this.counts, false);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.el && this.measuring) {
        this.measuring = false;
        this.onUpdate(this.counts, true);
      }
    });
    el.addEventListener('click', () => this.toggle());
  }

  async toggle() {
    if (this.measuring) {
      // O pointerlockchange finaliza a medição.
      document.exitPointerLock();
      return;
    }
    this.counts = 0;
    try {
      await this.el.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try { await this.el.requestPointerLock(); } catch { return; }
    }
    this.measuring = true;
    this.onUpdate(0, false);
  }
}
