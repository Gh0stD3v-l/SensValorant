// Busca adaptativa da sens ideal: comparações A/B cegas que vão trocando de sens até convergir.
// - Escolheu um lado: o centro vai para ele e o intervalo encolhe (×0,55).
// - Escolheu o mesmo lado duas vezes seguidas: a sens ideal está mais longe, então o intervalo quase
//   não encolhe (×0,85) e a busca continua andando nessa direção.
// - Empate: fica no meio e encolhe pela metade.
// - O jogador pode parar a qualquer momento numa sens em que esteja confortável.
// Módulo puro, sem DOM.

import { clamp, roundSens, EDPI_MIN, EDPI_MAX } from './valorant.js';

export const SHRINK = 0.55;
export const SHRINK_SAME_SIDE = 0.85;
export const SHRINK_TIE = 0.5;

export class SensFinder {
  /**
   * @param {{startSens:number, dpi:number, spread?:number, minSpread?:number, maxRounds?:number, rng?:() => number}} o
   */
  constructor({ startSens, dpi, spread = 0.4, minSpread = 0.03, maxRounds = 12, rng = Math.random }) {
    this.dpi = dpi;
    this.center = this._limit(startSens);
    this.spread = spread;
    this.minSpread = minSpread;
    this.maxRounds = maxRounds;
    this.round = 0;
    this.repeats = 0;
    this.finished = false;
    this.lastKind = null;
    this.history = [];
    this.rng = rng;
    this._makePair();
  }

  _limit(s) {
    return roundSens(clamp(s, EDPI_MIN / this.dpi, EDPI_MAX / this.dpi));
  }

  _makePair() {
    const low = this._limit(this.center * (1 - this.spread));
    const high = this._limit(this.center * (1 + this.spread));
    // Ordem aleatória: o jogador não sabe qual é a mais baixa (teste cego).
    const lowFirst = this.rng() < 0.5;
    this.pair = lowFirst
      ? { A: { sens: low, kind: 'low' }, B: { sens: high, kind: 'high' } }
      : { A: { sens: high, kind: 'high' }, B: { sens: low, kind: 'low' } };
  }

  get done() {
    return this.finished || this.spread < this.minSpread || this.round >= this.maxRounds;
  }

  /** Estimativa de rodadas que faltam (supondo que a busca pare de andar para um lado). */
  get remaining() {
    if (this.done) return 0;
    const n = Math.ceil(Math.log(this.minSpread / this.spread) / Math.log(SHRINK));
    return clamp(n, 1, this.maxRounds - this.round);
  }

  /**
   * @param {'A'|'B'|'tie'} pick
   * @param {{nudge?:number, data?:object}} [o] nudge: ajuste fino (ex.: -0,03 se passou do alvo)
   */
  choose(pick, { nudge = 0, data = null } = {}) {
    if (this.done) throw new Error('Busca já terminou');
    const before = this.center;
    const spreadBefore = this.spread;
    if (pick === 'A' || pick === 'B') {
      const kind = this.pair[pick].kind;
      this.center = this._limit(this.pair[pick].sens * (1 + nudge));
      this.spread *= kind === this.lastKind ? SHRINK_SAME_SIDE : SHRINK;
      this.lastKind = kind;
    } else {
      this.center = this._limit(((this.pair.A.sens + this.pair.B.sens) / 2) * (1 + nudge));
      this.spread *= SHRINK_TIE;
      this.lastKind = null;
    }
    this.history.push({ round: this.round + 1, spread: spreadBefore, from: before, A: this.pair.A, B: this.pair.B, pick, nudge, data, result: this.center });
    this.round += 1;
    if (!this.done) this._makePair();
  }

  /** Refaz a rodada atual (nova ordem cega, mesmos valores de intervalo). */
  repeat() {
    this.repeats += 1;
    this._makePair();
  }

  /** O jogador está confortável: termina a busca nesta sens. */
  finishWith(sens) {
    this.history.push({ round: this.round + 1, spread: this.spread, from: this.center, A: this.pair.A, B: this.pair.B, pick: 'stop', nudge: 0, data: null, result: this._limit(sens) });
    this.center = this._limit(sens);
    this.round += 1;
    this.finished = true;
  }

  /** Reabre a busca em volta do resultado atual para conferir (ex.: ±10%). */
  recheck(spread = 0.1) {
    this.finished = false;
    this.spread = spread;
    this.lastKind = null;
    this.maxRounds = this.round + 5;
    this._makePair();
  }

  get result() {
    return roundSens(this.center);
  }
}
