import * as V from './valorant.js';
import { SensFinder } from './finder.js';
import { summarize, compare } from './scoring.js';
import { makeBlockPlan, TYPE_INFO } from './targets.js';
import { diagnose, sensTendency } from './analysis.js';
import { Drill, CountMeter } from './drill.js';
import { ReplayPlayer } from './replay.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const num = (n, d = 3) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const readNum = (el) => parseFloat(String(el.value).replace(',', '.'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HISTORY_KEY = 'sensfinder.history';
const CAL_KEY = 'sensfinder.cal';
const hasMouse = window.matchMedia('(pointer: fine)').matches;

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* sem armazenamento */ }
  return null;
}

// ---------------- Abas ----------------
$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((t) => { t.classList.toggle('active', t === b); t.setAttribute('aria-selected', t === b); });
  $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
}));

// ---------------- Navegação entre passos ----------------
const STEPS = ['profile', 'start', 'calibrate', 'test', 'range', 'choice', 'result', 'replay'];
let current = 'profile';
function show(step) {
  if (current === 'replay' && step !== 'replay') player.stop();
  current = step;
  STEPS.forEach((s) => { $(`#step-${s}`).hidden = s !== step; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

// ---------------- Perfil ----------------
for (const [key, g] of Object.entries(V.GAMES)) {
  $('#f-game').add(new Option(g.name, key));
  $('#c3-game').add(new Option(g.name, key));
}
$('#f-game').addEventListener('change', () => { $('#f-game-sens').disabled = !$('#f-game').value; });
if (!hasMouse) {
  $('#mode-browser input').disabled = true;
  $('#mode-browser').classList.add('disabled');
  $('#mobile-note').hidden = false;
}
const syncMode = () => { $('#attempts-wrap').hidden = document.querySelector('input[name=mode]:checked').value !== 'range'; };
$$('input[name=mode]').forEach((r) => r.addEventListener('change', syncMode));
syncMode();

const st = { profile: null, finder: null, mode: 'range', results: null, warmup: false, trials: [], rangeQueue: [] };

function readProfile() {
  const dpi = readNum($('#f-dpi'));
  let currentSens = readNum($('#f-sens'));
  const game = $('#f-game').value;
  const gameSens = readNum($('#f-game-sens'));
  let converted = null;
  if (!(currentSens > 0) && game && gameSens > 0) {
    currentSens = V.fromOtherGame(gameSens, V.GAMES[game].yaw, dpi);
    converted = { game: V.GAMES[game].name, gameSens, sens: currentSens };
  }
  return {
    dpi,
    currentSens: currentSens > 0 ? currentSens : undefined,
    converted,
    style: document.querySelector('input[name=style]:checked').value,
    padWidthCm: +$('#f-pad').value,
    role: $('#f-role').value,
    mode: document.querySelector('input[name=mode]:checked').value,
    attempts: +$('#f-attempts').value,
  };
}

function statLine(sens, dpi) {
  const e = sens * dpi;
  return `<div class="stats">
    <div><span>Sens</span><strong>${num(sens)}</strong></div>
    <div><span>eDPI</span><strong>${Math.round(e)}</strong></div>
    <div><span>cm/360</span><strong>${num(V.cm360(sens, dpi), 1)}</strong></div>
    <div><span>vs. pros</span><strong>${Math.round(V.proPercentile(e))}º pct</strong></div>
  </div>`;
}

function calibration() {
  const c = store(CAL_KEY);
  return c && st.profile && c.dpi === st.profile.dpi ? c : null;
}

function renderCalStatus() {
  const c = calibration();
  const el = $('#cal-status');
  if (!c) {
    el.className = 'note warn';
    el.innerHTML = 'Mouse ainda não calibrado. Leva 30 segundos e evita a diferença de sensação entre o site e o jogo.';
  } else if (c.ok) {
    el.className = 'note ok';
    el.textContent = `Calibrado: o navegador recebe ~${Math.round(c.measuredDpi)} DPI (você informou ${c.dpi}). Sem correção necessária.`;
  } else {
    el.className = 'note ok';
    el.textContent = `Calibrado: o navegador recebe ~${Math.round(c.measuredDpi)} DPI em vez de ${c.dpi}. O teste corrige isso automaticamente (×${num(c.factor, 2)}).`;
  }
}

$('#profile-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const p = readProfile();
  if (!(p.dpi >= 100)) return;
  st.profile = p;
  const s = V.suggestStart(p);
  st.startSens = s.sens;
  const tc = V.turnCheck(s.sens, p.dpi, p.padWidthCm);
  $('#start-summary').innerHTML = `
    ${p.converted ? `<p>${esc(p.converted.game)} ${num(p.converted.gameSens)} equivale a <strong>${num(p.converted.sens)}</strong> no Valorant com ${p.dpi} DPI.</p>` : ''}
    ${statLine(s.sens, p.dpi)}
    <p>Faixa <strong>${V.edpiLabel(s.edpi)}</strong>. A busca começa testando ~40% abaixo e acima e vai trocando de sens até convergir. Em geral leva de 5 a 8 rodadas.</p>
    <ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${tc ? `<p class="${tc.ok ? 'ok' : 'warn'}">Giro de 180° = ${num(tc.cm180, 1)} cm. ${tc.msg}</p>` : ''}`;
  const browser = p.mode === 'browser';
  $('#browser-opts').hidden = !browser;
  $('#btn-calibrate').hidden = !browser;
  if (browser) renderCalStatus();
  show('start');
});

// ---------------- Calibração ----------------
for (const [k, r] of Object.entries(V.CAL_REFS)) $('#cal-ref').add(new Option(`${r.name}: ${num(r.cm, 2)} cm`, k));
const cal = { swipes: [] };
const SWIPE_SPEEDS = ['lento', 'rapido'];
function calLabel() {
  const i = cal.swipes.length;
  if (i >= 2) return 'Pronto. Confira o resultado abaixo.';
  return `Movimento ${i + 1} de 2: ${i === 0 ? 'devagar' : 'rápido'}. Clique para começar`;
}
function resetCal() {
  cal.swipes = [];
  $('#cal-counts').textContent = '0';
  $('#cal-label').textContent = calLabel();
  $('#cal-result').innerHTML = '';
  $('#cal-save').disabled = true;
}
new CountMeter($('#cal-pad'), (counts, final) => {
  $('#cal-counts').textContent = Math.abs(counts).toLocaleString('pt-BR');
  if (!final) {
    $('#cal-label').textContent = 'Medindo… arraste até a outra ponta e clique para parar';
    return;
  }
  if (cal.swipes.length >= 2) return;
  if (Math.abs(counts) < 50) { $('#cal-label').textContent = 'Movimento muito curto. ' + calLabel(); return; }
  cal.swipes.push({ counts, speed: SWIPE_SPEEDS[cal.swipes.length] });
  $('#cal-label').textContent = calLabel();
  if (cal.swipes.length === 2) {
    const ref = V.CAL_REFS[$('#cal-ref').value];
    const r = V.calibrationResult(cal.swipes, ref.cm, st.profile.dpi);
    cal.result = r;
    $('#cal-result').innerHTML = `
      <div class="stats">
        <div><span>DPI informado</span><strong>${st.profile.dpi}</strong></div>
        <div><span>Recebido (devagar)</span><strong>${Math.round(r.dpis[0])}</strong></div>
        <div><span>Recebido (rápido)</span><strong>${Math.round(r.dpis[1])}</strong></div>
      </div>
      ${r.accel ? '<p class="warn">A diferença entre devagar e rápido indica <strong>aceleração do mouse</strong>. Desligue "Aumentar precisão do ponteiro" no Windows e a aceleração do software do mouse. No Valorant isso não pesa, mas aqui no navegador pode pesar.</p>' : ''}
      ${r.ok ? '<p class="ok">O navegador recebe o mouse igual ao jogo. Nenhuma correção necessária.</p>'
        : `<p class="warn">O navegador recebe ${Math.round(r.measuredDpi)} DPI em vez de ${st.profile.dpi} (${r.ratio < 1 ? 'provavelmente a escala de tela do Windows' : 'o DPI real do mouse pode ser diferente do informado; confira no software do mouse'}). O teste vai corrigir com ×${num(r.factor, 2)}.</p>`}
      <p class="muted small">Se o número ficou muito diferente, confira se o objeto não escorregou e refaça.</p>`;
    $('#cal-save').disabled = false;
  }
});
$('#btn-calibrate').addEventListener('click', () => { resetCal(); show('calibrate'); });
$('#cal-redo').addEventListener('click', resetCal);
$('#cal-ref').addEventListener('change', resetCal);
$('#cal-back').addEventListener('click', () => show('start'));
$('#cal-save').addEventListener('click', () => {
  const r = cal.result;
  store(CAL_KEY, { dpi: st.profile.dpi, measuredDpi: r.measuredDpi, factor: r.factor, ok: r.ok, accel: r.accel, date: new Date().toISOString() });
  renderCalStatus();
  show('start');
});

// ---------------- Busca ----------------
const drill = new Drill($('#stage'), $('#drill-canvas'), { onDone: onDrillDone, onState: onDrillState });

$('#btn-begin').addEventListener('click', () => {
  const p = st.profile;
  st.mode = p.mode;
  st.trials = [];
  st.finder = new SensFinder({ startSens: st.startSens, dpi: p.dpi });
  if (st.mode === 'browser' && $('#f-warmup').checked) {
    st.warmup = true;
    show('test');
    $('#test-title').textContent = 'Aquecimento';
    $('#test-sub').textContent = '· não conta na pontuação';
    drill.run({ blocks: [{ label: 'Aquecimento', sens: st.startSens, plan: makeBlockPlan() }], ...drillOpts() });
  } else {
    startRound();
  }
});

function drillOpts() {
  return { countScale: calibration()?.factor ?? 1, fullscreen: $('#f-fullscreen').checked };
}

function roundLabel() {
  const f = st.finder;
  return `Rodada ${f.round + 1}`;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startRound() {
  const { A, B } = st.finder.pair;
  if (st.mode === 'browser') {
    show('test');
    $('#test-title').textContent = roundLabel();
    $('#test-sub').textContent = '· 32 alvos, Sens A e Sens B alternadas';
    const p1 = makeBlockPlan(), p2 = makeBlockPlan();
    drill.run({
      blocks: [
        { label: 'Sens A', sens: A.sens, plan: p1 },
        { label: 'Sens B', sens: B.sens, plan: shuffled(p1) },
        { label: 'Sens B', sens: B.sens, plan: p2 },
        { label: 'Sens A', sens: A.sens, plan: shuffled(p2) },
      ],
      ...drillOpts(),
    });
  } else {
    const order = st.profile.attempts === 2 ? ['A', 'B', 'B', 'A'] : ['A', 'B'];
    st.rangeQueue = order.map((side, i) => ({ side, n: order.slice(0, i + 1).filter((s) => s === side).length }));
    st.rangeLog = { A: [], B: [] };
    nextRangeAttempt();
  }
}

function onDrillState({ raw, locked }) {
  const b = $('#raw-badge');
  if (raw === null) return;
  b.hidden = false;
  b.textContent = raw ? 'Entrada crua: ativa' : 'Entrada crua: indisponível';
  b.className = `badge ${raw ? 'ok' : 'warn'}`;
  b.title = raw ? '' : 'Seu navegador pode aplicar a aceleração do sistema. Use o Chrome ou o Edge e faça a calibração.';
  if (!locked && st.lowFps) b.title += ' FPS baixo detectado.';
}

function onDrillDone({ blocks, fps }) {
  st.fps = fps;
  if (st.warmup) {
    st.warmup = false;
    startRound();
    return;
  }
  const round = st.finder.round + 1;
  const tag = (t, side) => ({ ...t, round, side });
  const aTrials = [...blocks[0].trials, ...blocks[3].trials].map((t) => tag(t, 'A'));
  const bTrials = [...blocks[1].trials, ...blocks[2].trials].map((t) => tag(t, 'B'));
  st.roundTrials = [...aTrials, ...bTrials];
  st.results = {
    A: { ...st.finder.pair.A, stats: summarize(aTrials), blocks: [summarize(blocks[0].trials), summarize(blocks[3].trials)], diags: diagnose(aTrials) },
    B: { ...st.finder.pair.B, stats: summarize(bTrials), blocks: [summarize(blocks[1].trials), summarize(blocks[2].trials)], diags: diagnose(bTrials) },
  };
  showChoice();
}

// ---------------- Campo de Tiro ----------------
function nextRangeAttempt() {
  const item = st.rangeQueue[0];
  const cand = st.finder.pair[item.side];
  const per = st.profile.attempts;
  show('range');
  $('#range-title').textContent = `${roundLabel()} · Sens ${item.side}`;
  $('#range-sub').textContent = per > 1 ? `tentativa ${item.n} de ${per}` : '';
  $('#range-sens').textContent = num(cand.sens);
  $('#range-kills').value = '';
  $$('input[name=feel]').forEach((c) => { c.checked = false; });
  $('#range-kills').focus({ preventScroll: true });
}

$('#btn-range-done').addEventListener('click', () => {
  const item = st.rangeQueue.shift();
  const k = readNum($('#range-kills'));
  const feel = $$('input[name=feel]:checked').map((c) => c.value);
  st.rangeLog[item.side].push({ kills: Number.isFinite(k) ? k : null, feel });
  if (st.rangeQueue.length) nextRangeAttempt();
  else {
    const side = (s) => {
      const log = st.rangeLog[s];
      const ks = log.map((x) => x.kills).filter((x) => x != null);
      const flags = {};
      for (const x of log) for (const f of x.feel) flags[f] = (flags[f] || 0) + 1;
      return { ...st.finder.pair[s], log, total: ks.length ? ks.reduce((a, b) => a + b, 0) : null, avg: ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : null, flags };
    };
    st.results = { A: side('A'), B: side('B') };
    showChoice();
  }
});

const FEEL_TEXT = { over: 'passou do alvo', under: 'chegou curto', shaky: 'mira tremendo', good: 'confortável' };

function rangeSuggestion(A, B) {
  if (A.avg == null || B.avg == null) return null;
  const d = A.avg - B.avg;
  const notes = [];
  const lowS = A.kind === 'low' ? A : B, highS = A.kind === 'high' ? A : B;
  if (highS.flags.over && !lowS.flags.over) notes.push('Você passou do alvo só na sens mais alta: a ideal deve estar entre as duas ou abaixo.');
  if (lowS.flags.under && !highS.flags.under) notes.push('Você chegou curto só na sens mais baixa: a ideal deve estar entre as duas ou acima.');
  if (A.flags.shaky && B.flags.shaky) notes.push('Mira tremendo nas duas: pode ser cansaço. Descanse 1 minuto antes da próxima rodada.');
  const perAttempt = st.profile.attempts;
  if (Math.abs(d) < (perAttempt > 1 ? 1.5 : 2)) return { pick: 'tie', confidence: 'baixa', notes: ['Diferença pequena de abates: decida pela sensação.', ...notes] };
  return { pick: d > 0 ? 'A' : 'B', confidence: Math.abs(d) >= 4 ? 'alta' : 'média', notes };
}

/** Ajuste fino a partir das marcações: passou do alvo → desce 3%, chegou curto → sobe 3%. */
function rangeNudge(pick) {
  if (st.mode !== 'range' || (pick !== 'A' && pick !== 'B')) return 0;
  const f = st.results[pick].flags;
  return (f.under ? 0.03 : 0) - (f.over ? 0.03 : 0);
}

// ---------------- Escolha ----------------
function diagList(diags, max = 3) {
  if (!diags.length) return '<p class="ok small">Nenhum problema claro nesta sens.</p>';
  return `<ul class="diag">${diags.slice(0, max).map((d) => `<li class="sev-${d.severity === 'média' ? 'media' : d.severity}"><strong>${esc(d.title)}</strong><span>${esc(d.detail)}</span></li>`).join('')}</ul>`;
}

function showChoice() {
  const { A, B } = st.results;
  const f = st.finder;
  $('#choice-title').textContent = `${roundLabel()}: qual foi melhor?`;
  let suggestion = null;
  const head = '<thead><tr><th></th><th>Sens A</th><th>Sens B</th></tr></thead>';
  if (st.mode === 'browser') {
    const row = (label, fn) => `<tr><th>${label}</th><td>${fn(A.stats)}</td><td>${fn(B.stats)}</td></tr>`;
    $('#choice-table').innerHTML = `<table class="tbl ab">${head}<tbody>
      ${row('Pontuação', (s) => num(s.score, 2))}
      ${row('Precisão na cabeça', (s) => `${Math.round(s.accuracy * 100)}%`)}
      ${row('Tempo médio no flick', (s) => `${num(s.flickTime, 2)} s`)}
      ${row('Tempo no micro-ajuste', (s) => `${num(s.microTime, 2)} s`)}
      ${row('Tempo no strafe', (s) => `${num(s.strafeTime, 2)} s`)}
      ${row('Peeks pegos', (s) => (s.peekRate == null ? '–' : `${Math.round(s.peekRate * 100)}%`))}
      ${row('Passou do alvo', (s) => `${Math.round(s.overshootPct)}%`)}
    </tbody></table>`;
    suggestion = compare(A, B);
    $('#choice-diag').innerHTML = `<div><h3>O que você errou com A</h3>${diagList(A.diags)}</div><div><h3>O que você errou com B</h3>${diagList(B.diags)}</div>`;
    if (st.fps && st.fps < 90) suggestion.notes.push(`Seu navegador rodou a ~${Math.round(st.fps)} FPS. Abaixo de 90 a mira parece mais pesada que no jogo.`);
  } else {
    const per = st.profile.attempts;
    const att = (s) => s.log.map((x) => x.kills ?? '–').join(' + ');
    const feel = (s) => Object.keys(s.flags).map((k) => `${FEEL_TEXT[k]}${s.flags[k] > 1 ? ` (${s.flags[k]}×)` : ''}`).join(', ') || '–';
    $('#choice-table').innerHTML = `<table class="tbl ab">${head}<tbody>
      <tr><th>Sens</th><td>${num(A.sens)}</td><td>${num(B.sens)}</td></tr>
      <tr><th>Abates${per > 1 ? ' por tentativa' : ''}</th><td>${att(A)}</td><td>${att(B)}</td></tr>
      ${per > 1 ? `<tr><th>Média</th><td>${A.avg == null ? '–' : num(A.avg, 1)}</td><td>${B.avg == null ? '–' : num(B.avg, 1)}</td></tr>` : ''}
      <tr><th>Como sentiu</th><td>${feel(A)}</td><td>${feel(B)}</td></tr></tbody></table>`;
    suggestion = rangeSuggestion(A, B);
    $('#choice-diag').innerHTML = '';
  }
  $$('[data-pick]').forEach((b) => b.classList.toggle('suggested', suggestion?.pick === b.dataset.pick));
  $('#choice-suggest').innerHTML = suggestion
    ? `<p><strong>Sugestão pelos dados: ${suggestion.pick === 'tie' ? 'empate' : `Sens ${suggestion.pick}`}</strong> (confiança ${suggestion.confidence}).</p>${suggestion.notes.map((n) => `<p>${esc(n)}</p>`).join('')}`
    : '';
  $('#btn-replays-round').hidden = st.mode !== 'browser';
  $('#btn-repeat').hidden = f.repeats >= 3;
  $('#choice-progress').textContent = `Faltam cerca de ${f.remaining} rodada${f.remaining > 1 ? 's' : ''}. A busca continua enquanto você escolher sempre o mesmo lado.`;
  show('choice');
}

function commitRoundTrials() {
  if (st.roundTrials) st.trials.push(...st.roundTrials);
  st.roundTrials = null;
}

$$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
  const pick = b.dataset.pick;
  commitRoundTrials();
  st.finder.choose(pick, { nudge: rangeNudge(pick), data: { mode: st.mode } });
  if (st.finder.done) showResult();
  else startRound();
}));
$$('[data-stop]').forEach((b) => b.addEventListener('click', () => {
  commitRoundTrials();
  st.finder.finishWith(st.finder.pair[b.dataset.stop].sens);
  showResult();
}));
$('#btn-repeat').addEventListener('click', () => {
  st.roundTrials = null;
  st.finder.repeat();
  startRound();
});

// ---------------- Resultado ----------------
function showResult() {
  const f = st.finder;
  const p = st.profile;
  const sens = f.result;
  const e = sens * p.dpi;
  const tc = V.turnCheck(sens, p.dpi, p.padWidthCm);
  $('#result-main').innerHTML = `${statLine(sens, p.dpi)}
    <p>Sens <strong>${V.edpiLabel(e)}</strong>. Mais alta que a de ${Math.round(V.proPercentile(e))}% dos pros (dados de 2026).</p>
    ${tc ? `<p class="${tc.ok ? 'ok' : 'warn'}">Giro de 180° = ${num(tc.cm180, 1)} cm. ${tc.msg}</p>` : ''}
    ${st.mode === 'browser' ? '<p class="note">Próximo passo: confirme no Campo de Tiro. O botão abaixo testa esta sens contra ±6% em 2 rodadas.</p>' : ''}`;

  // Diagnóstico com as tentativas das sens mais próximas do resultado (últimas rodadas).
  const near = st.trials.filter((t) => Math.abs(t.sens - sens) / sens <= 0.15);
  const diags = near.length >= 12 ? diagnose(near) : [];
  const diagEl = $('#result-diag');
  diagEl.hidden = !near.length;
  if (near.length) {
    const tend = sensTendency(diags);
    const tendTxt = tend <= -2 ? 'Seus erros apontam para sens um pouco <strong>alta</strong>. Se continuar passando do alvo no jogo, desça 3–5%.'
      : tend >= 2 ? 'Seus erros apontam para sens um pouco <strong>baixa</strong>. Se continuar chegando curto no jogo, suba 3–5%.'
        : 'Seus erros não apontam para a sens: o que sobra é técnica.';
    diagEl.innerHTML = `<h2>O que você está errando</h2><p>${tendTxt}</p>
      ${diags.length ? `<ul class="diag big">${diags.map((d) => `<li class="sev-${d.severity === 'média' ? 'media' : d.severity}"><strong>${esc(d.title)}</strong><span>${esc(d.detail)}</span><em>${esc(d.tip)}</em></li>`).join('')}</ul>` : '<p class="ok">Nenhum problema claro. Boa mira!</p>'}`;
  }

  const dpis = [400, 800, 1600, 3200];
  $('#result-extra').innerHTML = `
    <div class="card mini"><h3>Mesma sens em outros DPIs</h3><table class="tbl">${dpis.map((d) => `<tr><th>${d} DPI</th><td>${num(V.roundSens(V.convertDpi(sens, p.dpi, d)))}</td></tr>`).join('')}</table></div>
    <div class="card mini"><h3>Configurações do Valorant</h3><table class="tbl">
      <tr><th>Sensibilidade</th><td>${num(sens)}</td></tr>
      <tr><th>Multiplicador ADS</th><td>1,000</td></tr>
      <tr><th>Multiplicador com mira</th><td>1,000</td></tr>
      <tr><th>Ponteiro do Windows</th><td>6/11, sem precisão aprimorada</td></tr></table></div>
    <div class="card mini"><h3>Em outros jogos (mesmo DPI)</h3><table class="tbl">
      <tr><th>CS2</th><td>${num(V.toOtherGame(sens, V.GAMES.cs2.yaw))}</td></tr>
      <tr><th>Apex Legends</th><td>${num(V.toOtherGame(sens, V.GAMES.apex.yaw))}</td></tr>
      <tr><th>Overwatch 2</th><td>${num(V.toOtherGame(sens, V.GAMES.ow2.yaw), 2)}</td></tr></table></div>`;
  $('#result-history').innerHTML = f.history.map((h) => {
    if (h.pick === 'stop') return `<li>Você parou: confortável com <strong>${num(h.result)}</strong></li>`;
    const chosen = h.pick === 'tie' ? 'empate' : `${h.pick} (${h[h.pick].kind === 'low' ? 'mais baixa' : 'mais alta'})`;
    const nudge = h.nudge ? ` ${h.nudge > 0 ? '+' : ''}${Math.round(h.nudge * 100)}% pela sensação` : '';
    return `<li>A ${num(h.A.sens)} vs. B ${num(h.B.sens)} → ${chosen}${nudge} → <strong>${num(h.result)}</strong></li>`;
  }).join('');
  $('#btn-replays-all').hidden = !st.trials.length;
  $('#btn-confirm-range').hidden = st.mode === 'range';
  saveHistory({ date: new Date().toISOString(), sens, dpi: p.dpi, mode: st.mode });
  show('result');
}

$('#btn-recheck').addEventListener('click', () => { st.finder.recheck(0.1); startRound(); });
$('#btn-confirm-range').addEventListener('click', () => {
  const sens = st.finder.result;
  st.mode = 'range';
  st.confirming = true;
  if (!st.profile.attempts) st.profile.attempts = 2;
  st.finder = new SensFinder({ startSens: sens, dpi: st.profile.dpi, spread: 0.06, minSpread: 0.03, maxRounds: 3 });
  startRound();
});
$('#btn-restart').addEventListener('click', () => { st.confirming = false; renderPast(); show('profile'); });
$('#btn-copy').addEventListener('click', async () => {
  const p = st.profile, s = st.finder.result;
  const txt = `Minha sens no Valorant: ${num(s)} @ ${p.dpi} DPI | eDPI ${Math.round(s * p.dpi)} | ${num(V.cm360(s, p.dpi), 1)} cm/360`;
  try {
    await navigator.clipboard.writeText(txt);
    $('#btn-copy').textContent = 'Copiado';
  } catch {
    $('#btn-copy').textContent = txt;
  }
  setTimeout(() => { $('#btn-copy').textContent = 'Copiar resultado'; }, 2500);
});

function saveHistory(entry) {
  store(HISTORY_KEY, [entry, ...(store(HISTORY_KEY) || [])].slice(0, 10));
}
function renderPast() {
  const h = store(HISTORY_KEY) || [];
  const el = $('#past');
  el.hidden = !h.length;
  el.innerHTML = `<h3>Seus resultados anteriores</h3><ul>${h.map((x) =>
    `<li>${new Date(x.date).toLocaleDateString('pt-BR')}: <strong>${num(x.sens)}</strong> @ ${x.dpi} DPI (eDPI ${Math.round(x.sens * x.dpi)}, ${x.mode === 'range' ? 'Campo de Tiro' : 'navegador'})</li>`).join('')}</ul>`;
}
renderPast();

// ---------------- Replay ----------------
const rp = { list: [], i: 0, back: 'result', filter: 'all', blind: false };
const player = new ReplayPlayer($('#replay-canvas'), $('#replay-plot'), (t, end, playing) => {
  $('#rp-seek').value = Math.round((t / end) * 1000);
  $('#rp-play').textContent = playing ? 'Pausar' : 'Assistir';
});

function openReplays(trials, back, blind) {
  rp.all = trials;
  rp.back = back;
  rp.blind = blind;
  rp.filter = 'all';
  $$('[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));
  applyFilter();
  show('replay');
  // Começa pela pior tentativa: é a que mais ensina.
  const worst = rp.list.reduce((w, t, i) => (score(t) < score(rp.list[w]) ? i : w), 0);
  selectReplay(worst);
}
const score = (t) => (t.hit ? 1 / t.time : 0) - t.misses * 0.2 - (t.body || 0) * 0.2;

function applyFilter() {
  let l = rp.all;
  if (rp.filter === 'miss') l = l.filter((t) => !t.hit || t.misses || t.body);
  if (rp.filter === 'slow') l = [...l].filter((t) => t.hit).sort((a, b) => b.time - a.time).slice(0, 10);
  rp.list = l.length ? l : rp.all;
  $('#replay-list').innerHTML = rp.list.map((t, i) => {
    const res = t.hit ? (t.misses || t.body ? 'warn' : 'ok') : 'bad';
    const who = rp.blind ? `Sens ${t.side}` : `${num(t.sens)}${t.round ? ` · rodada ${t.round}` : ''}`;
    return `<li><button type="button" data-i="${i}" class="rp-item ${res}">
      <span>${TYPE_INFO[t.type].name}</span><span class="muted">${who}</span>
      <strong>${t.hit ? `${num(t.time, 2)} s` : 'errou'}</strong></button></li>`;
  }).join('');
  $$('#replay-list [data-i]').forEach((b) => b.addEventListener('click', () => selectReplay(+b.dataset.i)));
}

function selectReplay(i) {
  rp.i = (i + rp.list.length) % rp.list.length;
  const t = rp.list[rp.i];
  $$('#replay-list [data-i]').forEach((b) => b.classList.toggle('active', +b.dataset.i === rp.i));
  player.load(t);
  const m = player.metrics;
  const parts = [`<strong>${TYPE_INFO[t.type].name}</strong> (${TYPE_INFO[t.type].desc})`,
    `distância ${num(t.dist, 1)}°`,
    t.hit ? `acertou em ${num(t.time, 2)} s` : 'não acertou a cabeça',
    `${t.misses} erro${t.misses === 1 ? '' : 's'}, ${t.body || 0} no corpo`];
  if (m.reactionMs != null) parts.push(`reação ${Math.round(m.reactionMs)} ms`);
  if (m.endpoint && (t.type === 'flick' || t.type === 'turn')) {
    const pct = Math.round(m.endpoint.alongPct * 100);
    parts.push(pct > 6 ? `1º movimento passou ${pct}% do alvo` : pct < -15 ? `1º movimento parou ${-pct}% antes` : '1º movimento certeiro');
    if (m.corrections) parts.push(`${m.corrections} correç${m.corrections === 1 ? 'ão' : 'ões'}`);
  }
  $('#replay-info').innerHTML = parts.join(' · ');
}

$('#rp-play').addEventListener('click', () => player.toggle());
$('#rp-prev').addEventListener('click', () => selectReplay(rp.i - 1));
$('#rp-next').addEventListener('click', () => selectReplay(rp.i + 1));
$('#rp-seek').addEventListener('input', (e) => {
  player.pause();
  player.t = (e.target.value / 1000) * player.end;
  player._draw();
});
$$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  player.speed = +b.dataset.speed;
  $$('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
}));
$$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  rp.filter = b.dataset.filter;
  $$('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
  applyFilter();
  selectReplay(0);
}));
$('#replay-back').addEventListener('click', () => show(rp.back));
$('#btn-replays-round').addEventListener('click', () => openReplays(st.roundTrials || [], 'choice', true));
$('#btn-replays-all').addEventListener('click', () => openReplays(st.trials, 'result', false));

// ---------------- Calculadora ----------------
function calc() {
  const d1 = readNum($('#c1-dpi')), s1 = readNum($('#c1-sens'));
  $('#c1-out').innerHTML = d1 > 0 && s1 > 0
    ? `eDPI <strong>${Math.round(d1 * s1)}</strong> · <strong>${num(V.cm360(s1, d1), 1)}</strong> cm/360 · ${num(V.inch360(s1, d1), 1)} pol/360<br>Faixa ${V.edpiLabel(d1 * s1)} · mais alta que ${Math.round(V.proPercentile(d1 * s1))}% dos pros`
    : '';
  const s2 = readNum($('#c2-sens')), f2 = readNum($('#c2-from')), t2 = readNum($('#c2-to'));
  $('#c2-out').innerHTML = s2 > 0 && f2 > 0 && t2 > 0 ? `Nova sens: <strong>${num(V.roundSens(V.convertDpi(s2, f2, t2)))}</strong> (mesmo eDPI: ${Math.round(s2 * f2)})` : '';
  const g = V.GAMES[$('#c3-game').value], s3 = readNum($('#c3-sens')), df = readNum($('#c3-dpi-from')), dt = readNum($('#c3-dpi-to'));
  $('#c3-out').innerHTML = g && s3 > 0 && df > 0 && dt > 0 ? `Sens no Valorant: <strong>${num(V.roundSens(V.fromOtherGame(s3, g.yaw, df, dt)))}</strong> @ ${dt} DPI` : '';
  const cm = readNum($('#c4-cm')), d4 = readNum($('#c4-dpi'));
  $('#c4-out').innerHTML = cm > 0 && d4 > 0 ? `Sens: <strong>${num(V.roundSens(V.sensFromCm360(cm, d4)))}</strong> · eDPI ${Math.round(V.CM360_CONST / cm)}` : '';
}
$$('#tab-calc input, #tab-calc select').forEach((el) => el.addEventListener('input', calc));
$('#zoom-table tbody').innerHTML = V.ZOOMS.map((z) => `<tr><td>${num(z.zoom, 2)}×</td><td>${z.weapons}</td></tr>`).join('');
calc();

// Acesso para depuração no console do navegador.
window.sensFinderDebug = { drill, st, player };
