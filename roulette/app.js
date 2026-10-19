import { createTopUp } from '../demo-ui.mjs';
import {
  PRIZES, COSTS, createState, loadState, saveState, beginSpin, revealSpin,
  nextCost, remainingTotal, probabilities, pauseSet, resumeSet,
  addCrystals,
} from './engine.js';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('ru-RU').format(value);
const labels = { random: '', 'g-first': 'ДЕМО: G ПЕРВЫМ', 'g-last': 'ДЕМО: G ПОСЛЕДНИМ' };
const colors = { R1: '#d44d5b', R2: '#b72f44', R3: '#ed7280', G: '#e5ae45' };
let state = loadState(localStorage);
let animationToken = 0;
let animating = false;
let lastWin = null;
let notice = '';

function commit(next) {
  try {
    saveState(localStorage, next);
    state = next;
    return true;
  } catch {
    notice = 'Не удалось сохранить набор. Проверьте настройки браузера.';
    render();
    return false;
  }
}

function cube(gold = false) {
  return `<svg class="cube-art ${gold ? 'gold' : ''}" viewBox="0 0 88 88" fill="none" aria-hidden="true">
    <path d="M44 7 78 25 44 44 10 25 44 7Z" fill="currentColor" opacity=".95"/>
    <path d="M10 25 44 44v36L10 60V25Z" fill="currentColor" opacity=".64"/>
    <path d="M78 25 44 44v36l34-20V25Z" fill="currentColor" opacity=".78"/>
    <path d="m44 7 34 18-34 19-34-19L44 7Z" stroke="white" stroke-opacity=".48" stroke-width="2"/>
    <path d="M44 44v36M10 25v35M78 25v35" stroke="white" stroke-opacity=".26" stroke-width="2"/>
    <path d="m27 17 34 19" stroke="white" stroke-opacity=".27" stroke-width="2"/>
  </svg>`;
}

function renderWheel() {
  const disc = $('wheel-disc');
  const items = state.remaining;
  if (!items.length) {
    disc.style.background = 'conic-gradient(#394253, #252c3d)';
    disc.innerHTML = '<span class="wheel-finished">НАБОР<br>СОБРАН</span>';
    disc.setAttribute('aria-label', 'Все награды получены');
    return;
  }
  const sector = 360 / items.length;
  const stops = items.map((id, index) => {
    const start = index * sector;
    const end = (index + 1) * sector;
    return `${colors[id]} ${start}deg ${end - 1.2}deg, #192130 ${end - 1.2}deg ${end}deg`;
  }).join(', ');
  disc.style.background = `conic-gradient(from 0deg, ${stops})`;
  const odds = probabilities(state);
  disc.innerHTML = items.map((id, index) => {
    const angle = (index + .5) * sector;
    const percent = items.length === 3 ? '33⅓%' : `${Math.round(odds[id] * 100)}%`;
    return `<span class="sector-label" style="transform:translate(-50%,-50%) rotate(${angle}deg) translateY(calc(var(--wheel-size) * -.31)) rotate(${-angle}deg)"><b>${id}</b><small>${percent}</small></span>`;
  }).join('');
  disc.setAttribute('aria-label', `Активные сектора: ${items.map(id => PRIZES.find(prize => prize.id === id).name).join(', ')}. Каждый имеет равную вероятность.`);
}

function prizeCard(prize) {
  const isWon = state.won.includes(prize.id);
  const index = state.won.indexOf(prize.id);
  const odds = probabilities(state)[prize.id];
  const probability = state.remaining.length === 3 ? '33⅓%' : `${Math.round((odds || 0) * 100)}%`;
  return `<article class="prize-card ${prize.id === 'G' ? 'grand' : ''} ${isWon ? 'is-won' : ''} ${isWon && prize.id === lastWin ? 'new-win' : ''}">
    <div class="card-top"><span class="card-id">${prize.id}</span><span class="card-status">${isWon ? '✓ ПОЛУЧЕНО' : 'В НАБОРЕ'}</span></div>
    <div class="cube-wrap">${cube(prize.id === 'G')}</div>
    <div class="card-bottom"><div><span class="card-type">${prize.type}</span><h3>${prize.name}</h3></div><span class="card-odds">${isWon ? `ХОД ${index + 1}` : probability}</span></div>
  </article>`;
}

function render() {
  $('balance').textContent = format(state.balance);
  $('mode-badge').hidden = state.mode === 'random';
  $('mode-badge').textContent = state.demoScenario === 'last' ? 'ДЕМО: ФИНАЛ НАБОРА' : labels[state.mode];
  document.querySelector('.eyebrow').firstChild.nextSibling.textContent = ` НАБОР / ${String(state.cycle).padStart(3, '0')} `;
  $('wheel-count').textContent = `${state.remaining.length} В ИГРЕ`;
  $('collection-counter').textContent = `${state.won.length} / 4 СОБРАНО`;
  $('remaining-section').hidden = state.remaining.length === 0;
  $('results-section').hidden = state.won.length === 0;
  $('prize-grid').innerHTML = state.remaining.map(id => prizeCard(PRIZES.find(prize => prize.id === id))).join('');
  $('won-grid').innerHTML = state.won.map(id => prizeCard(PRIZES.find(prize => prize.id === id))).join('');
  $('steps').innerHTML = COSTS.map((cost, index) => {
    const done = index < state.won.length;
    const current = index === state.won.length && !state.pending;
    const pending = index === state.won.length && !!state.pending;
    return `<div class="step ${done ? 'done' : ''} ${current ? 'current' : ''} ${pending ? 'pending' : ''}"><span class="step-marker">${done ? '✓' : String(index + 1).padStart(2, '0')}</span><span class="step-label"><strong>Вращение ${index + 1}</strong><small>${done ? 'Завершено' : pending ? 'Результат готов' : current ? 'Следующий шаг' : 'Впереди'}</small></span><strong class="step-cost"><span class="crystal-icon">◆</span> ${format(cost)}</strong></div>`;
  }).join('');
  $('spent').textContent = format(state.spent);
  $('remaining-total').textContent = format(remainingTotal(state));
  $('next-price').textContent = state.pending ? '—' : nextCost(state) ? format(nextCost(state)) : '—';
  const hasGrand = state.won.includes('G');
  const complete = state.won.length === PRIZES.length;
  const banner = $('win-banner');
  banner.hidden = !hasGrand && !complete && !lastWin;
  if (complete) {
    banner.className = 'win-banner complete-banner';
    banner.innerHTML = `<span>✦ НАБОР СОБРАН</span><strong>Все 4 награды ваши</strong><small>Итого потрачено: ◆ ${format(state.spent)} кристаллов</small>`;
  } else if (hasGrand) {
    banner.className = 'win-banner grand-banner';
    banner.innerHTML = `<span>✦ ГЛАВНЫЙ ПРИЗ</span><strong>Главная награда получена</strong><small>${state.paused ? 'Вы остановились. Оставшиеся призы сохраняются.' : 'Можно остановиться или продолжить собирать набор.'}</small>`;
  } else if (lastWin) {
    const prize = PRIZES.find(item => item.id === lastWin);
    banner.className = 'win-banner';
    banner.innerHTML = `<span>✦ ПОЛУЧЕНО</span><strong>${prize.name}</strong><small>Этот приз больше не выпадет в данном наборе.</small>`;
  }
  const latestId = state.won.at(-1);
  const receipt = $('spin-receipt');
  receipt.hidden = !latestId || !!state.pending || (state.demoScenario === 'last' && state.won.length === 3);
  if (!receipt.hidden) {
    const prize = PRIZES.find(item => item.id === latestId);
    const cost = COSTS[state.won.length - 1];
    const nextAction = state.balance < nextCost(state) ? `пополнить баланс для вращения за ◆ ${format(nextCost(state))}` : `крутить за ◆ ${format(nextCost(state))}`;
    const next = complete ? 'Набор завершён.' : state.paused ? 'Далее: вернуться к рулетке или оставить набор сохранённым.' : hasGrand ? `Далее: остановиться или ${nextAction}.` : `Далее: ${nextAction}.`;
    receipt.textContent = `Ход ${state.won.length}: ${prize.name}. Списано ◆ ${format(cost)}; приз добавлен в коллекцию, осталось ${state.remaining.length} в рулетке. ${next}`;
  }
  $('stop-button').hidden = !hasGrand || state.paused || complete || !!state.pending;
  $('skip-button').hidden = !state.pending;
  const button = $('spin-button');
  const buttonLabel = button.querySelector('span:first-child');
  const buttonCost = $('button-cost');
  if (complete) {
    buttonLabel.textContent = 'Набор завершён';
    buttonCost.hidden = true;
  } else if (state.pending) {
    buttonLabel.textContent = 'Рулетка вращается...';
    buttonCost.hidden = true;
  } else if (state.paused) {
    buttonLabel.textContent = 'Вернуться к рулетке';
    buttonCost.hidden = true;
  } else {
    buttonLabel.textContent = hasGrand ? 'Продолжить вращения' : 'Крутить рулетку';
    buttonCost.hidden = false;
    buttonCost.innerHTML = `<span class="crystal-icon">◆</span> ${format(nextCost(state))}`;
  }
  button.disabled = complete || !!state.pending;
  $('fund-demo').disabled = !!state.pending;
  $('fund-demo').hidden = state.balance >= nextCost(state) || complete || state.paused;
  $('status').textContent = notice || (complete ? 'Набор завершён · Новое вращение недоступно' : state.pending ? 'Результат уже определён. Можно пропустить анимацию.' : state.paused ? 'Набор сохранён. Возвращайтесь когда захотите.' : state.balance < nextCost(state) ? 'Недостаточно кристаллов для следующего вращения.' : 'Один приз за вращение · Без повторов');
  ['scenario-new', 'scenario-grand-first', 'scenario-last', 'animation-speed', 'fund-header'].forEach(id => { $(id).disabled = !!state.pending; });
  $('open-funding').disabled = !!state.pending;
  $('reset-demo').disabled = !!state.pending;
  renderWheel();
}

function finishSpin(token) {
  if (token !== animationToken || !state.pending) return;
  const id = state.pending.prizeId;
  if (!commit(revealSpin(state))) return;
  animating = false;
  ++animationToken; // invalidate a queued frame after Skip
  lastWin = id;
  notice = '';
  const disc = $('wheel-disc');
  disc.style.transition = 'none';
  disc.style.transform = 'rotate(0deg)';
  render();
}

function animatePending() {
  if (!state.pending || animating) return;
  animating = true;
  const token = ++animationToken;
  const id = state.pending.prizeId;
  const index = state.remaining.indexOf(id);
  const target = (360 - (index + .5) * 360 / state.remaining.length + 360) % 360;
  const disc = $('wheel-disc');
  disc.style.transition = 'none';
  disc.style.transform = 'rotate(0deg)';
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : $('animation-speed').value === 'fast' ? 1000 : 3600;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== animationToken || !state.pending) return;
    disc.style.transition = `transform ${duration}ms cubic-bezier(.12,.72,.12,1)`;
    disc.style.transform = `rotate(${2160 + target}deg)`;
  }));
  window.setTimeout(() => finishSpin(token), duration + 80);
}

$('spin-button').addEventListener('click', () => {
  if (state.paused) {
    if (commit(resumeSet(state))) { notice = ''; render(); }
    return;
  }
  const result = beginSpin(state);
  if (result.error) {
    notice = result.error === 'insufficient-funds' ? 'Недостаточно кристаллов для вращения.' : 'Вращение сейчас недоступно.';
    render();
    if (result.error === 'insufficient-funds') topUp.open();
    return;
  }
  if (commit(result.state)) {
    notice = '';
    lastWin = null;
    render();
    animatePending();
  }
});

$('skip-button').addEventListener('click', () => {
  if (state.pending) finishSpin(animationToken);
});
$('stop-button').addEventListener('click', () => {
  if (commit(pauseSet(state))) { notice = ''; render(); }
});
const topUp = createTopUp({ tickets: false, getBalance: () => ({ crystals: state.balance }), onGrant: (kind, amount) => {
  if (state.pending || kind !== 'crystals') return false;
  if (!commit(addCrystals(state, amount))) return false;
  notice = `${format(amount)} демо-кристаллов добавлено.`; render(); return true;
} });
$('fund-demo').addEventListener('click', () => topUp.open());
$('fund-header').addEventListener('click', () => topUp.open());
$('open-funding').addEventListener('click', () => topUp.open());
function prepareSet(mode, scenario) {
  if (state.pending) return;
  const next = createState({ cycle: state.cycle + 1, mode, draftMode: mode });
  if (scenario === 'last') {
    next.won = ['R1', 'R2', 'R3'];
    next.remaining = ['G'];
    next.balance = 800;
    next.spent = 700;
  }
  next.demoScenario = scenario;
  if (commit(next)) { lastWin = null; notice = `ДЕМО подготовлено: ${scenario === 'last' ? 'нажмите основную кнопку для финала' : 'нажмите «Крутить рулетку»'}.`; render(); }
}
$('scenario-new').addEventListener('click', () => prepareSet('random', 'new'));
$('scenario-grand-first').addEventListener('click', () => prepareSet('g-first', 'first'));
$('scenario-last').addEventListener('click', () => prepareSet('g-last', 'last'));
$('reset-demo').addEventListener('click', () => {
  if (state.pending) return;
  try { localStorage.removeItem('craftix-finite-roulette-v1'); state = createState(); lastWin = null; notice = 'Демо сброшено.'; topUp.close(); render(); }
  catch { notice = 'Не удалось сбросить демо.'; render(); }
});

if (state.pending) {
  // The charge and selected result were committed before the old page unloaded.
  const recovered = revealSpin(state);
  if (commit(recovered)) { lastWin = recovered.won.at(-1); notice = 'Сохранённый результат показан после перезагрузки.'; }
}
render();
