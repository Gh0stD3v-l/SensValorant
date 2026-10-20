// Busca da sens ideal: comparações A/B cegas com intervalo que se estreita a cada rodada
// (inspirado no método PSA). Módulo puro, sem DOM.

import { clamp, roundSens, EDPI_MIN, EDPI_MAX } from './valorant.js';

export class SensFinder {
  /**
   * @param {{startSens:number, dpi:number, rounds?:number, spread?:number, rng?:() => number}} o
   */
  constructor({ startSens, dpi, rounds = 7, spread = 0.5, rng = Math.random }) {
    this.dpi = dpi;
    this.center = startSens;
    this.spread = spread;
    this.totalRounds = rounds;
    this.round = 0;
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
    return this.round >= this.totalRounds;
  }

  /** @param {'A'|'B'|'tie'} pick */
  choose(pick) {
    if (this.done) throw new Error('Busca já terminou');
    const before = this.center;
    if (pick === 'A' || pick === 'B') this.center = this.pair[pick].sens;
    else this.center = this._limit((this.pair.A.sens + this.pair.B.sens) / 2);
    this.history.push({ round: this.round + 1, spread: this.spread, from: before, A: this.pair.A, B: this.pair.B, pick, result: this.center });
    this.spread /= 2;
    this.round += 1;
    if (!this.done) this._makePair();
  }

  /** Adiciona rodadas extras de refinamento a partir do resultado atual. */
  extend(extra = 3) {
    this.totalRounds += extra;
    this._makePair();
  }

  get result() {
    return roundSens(this.center);
  }
}
