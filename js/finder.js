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
   * @param {{startSens:number, dpi:number, spread?:number, minSpread?:number, maxRounds?:number, min?:number, max?:number, rng?:() => number}} o
   *   min/max: limites do valor buscado (padrão: eDPI de 100 a 700). Usado também para o multiplicador com mira.
   */
  constructor({ startSens, dpi, spread = 0.4, minSpread = 0.03, maxRounds = 12, min, max, rng = Math.random }) {
    this.dpi = dpi;
    this.min = min ?? EDPI_MIN / dpi;
    this.max = max ?? EDPI_MAX / dpi;
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
    // Limites da sensação: nunca abaixo de uma sens que você achou lenta nem acima de uma que achou rápida.
    const lo = this.lo != null ? Math.max(this.min, this.lo * 1.01) : this.min;
    const hi = this.hi != null ? Math.min(this.max, this.hi * 0.99) : this.max;
    return roundSens(lo <= hi ? clamp(s, lo, hi) : clamp(s, this.min, this.max));
  }

  /** Define os limites vindos da sensação (lenta em lo, rápida em hi). */
  setBounds(lo, hi) {
    this.lo = lo;
    this.hi = hi;
    this.center = this._limit(this.center);
    if (!this.done) this._makePair();
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
   * @param {{nudge?:number, data?:object, guide?:{sens:number, weight:number}|null, target?:number|null}} [o]
   *   nudge: ajuste fino (ex.: -0,03 se passou do alvo); guide: estimativa do modelo de desempenho,
   *   que puxa o próximo centro na direção dela (weight 0–1)
   */
  choose(pick, { nudge = 0, data = null, guide = null, target = null } = {}) {
    if (this.done) throw new Error('Busca já terminou');
    const before = this.center;
    const spreadBefore = this.spread;
    if (pick === 'A' || pick === 'B') {
      const kind = this.pair[pick].kind;
      this.center = this._limit(this.pair[pick].sens * (1 + nudge));
      this.spread *= kind === this.lastKind ? SHRINK_SAME_SIDE : SHRINK;
      this.lastKind = kind;
    } else {
      // target: ponto entre as duas onde a sensação vira de lenta para rápida.
      this.center = this._limit((target ?? (this.pair.A.sens + this.pair.B.sens) / 2) * (1 + nudge));
      this.spread *= SHRINK_TIE;
      this.lastKind = null;
    }
    if (guide && guide.sens > 0 && guide.weight > 0) {
      const w = Math.min(1, guide.weight);
      this.center = this._limit(Math.exp((1 - w) * Math.log(this.center) + w * Math.log(guide.sens)));
    }
    this.history.push({ round: this.round + 1, spread: spreadBefore, from: before, A: this.pair.A, B: this.pair.B, pick, nudge, guide, data, result: this.center });
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
