import {
  PRIZES, COSTS, createState, loadState, saveState, beginSpin, revealSpin,
  nextCost, remainingTotal, probabilities, pauseSet, resumeSet,
  addCrystals, setDraftMode, newDemoSet,
} from './engine.js';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('ru-RU').format(value);
const labels = { random: '', 'g-first': 'ТЕСТ: G ПЕРВЫМ', 'g-last': 'ТЕСТ: G ПОСЛЕДНИМ' };
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
  disc.setAttribute('aria-label', `Активные сектора: ${items.join(', ')}. Каждый имеет равную вероятность.`);
}

function prizeCard(prize) {
  const isWon = state.won.includes(prize.id);
  const index = state.won.indexOf(prize.id);
  const odds = probabilities(state)[prize.id];
  const probability = state.remaining.length === 3 ? '33⅓%' : `${Math.round((odds || 0) * 100)}%`;
  return `<article class="prize-card ${prize.id === 'G' ? 'grand' : ''} ${isWon ? 'is-won' : ''}">
    <div class="card-top"><span class="card-id">${prize.id}</span><span class="card-status">${isWon ? '✓ ПОЛУЧЕНО' : 'В НАБОРЕ'}</span></div>
    <div class="cube-wrap">${cube(prize.id === 'G')}</div>
    <div class="card-bottom"><div><span class="card-type">${prize.type}</span><h3>${prize.name}</h3></div><span class="card-odds">${isWon ? `ХОД ${index + 1}` : probability}</span></div>
  </article>`;
}

function render() {
  $('balance').textContent = format(state.balance);
  $('mode-badge').hidden = state.mode === 'random';
  $('mode-badge').textContent = labels[state.mode];
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
  $('scenario').value = state.draftMode;
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
  button.disabled = complete || !!state.pending || (!state.paused && state.balance < nextCost(state));
  $('status').textContent = notice || (complete ? 'Набор завершён · Новое вращение недоступно' : state.pending ? 'Результат уже определён. Можно пропустить анимацию.' : state.paused ? 'Набор сохранён. Возвращайтесь когда захотите.' : state.balance < nextCost(state) ? 'Недостаточно кристаллов для следующего вращения.' : 'Один приз за вращение · Без повторов');
  $('new-set').disabled = !!state.pending;
  $('add-crystals').disabled = !!state.pending;
  $('scenario').disabled = !!state.pending;
  renderWheel();
}

function finishSpin(token) {
  if (token !== animationToken || !state.pending) return;
  const id = state.pending.prizeId;
  if (!commit(revealSpin(state))) return;
  animating = false;
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
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 3600;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== animationToken) return;
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
$('add-crystals').addEventListener('click', () => {
  if (state.pending) return;
  if (commit(addCrystals(state))) { notice = '10 000 демо-кристаллов добавлено.'; render(); }
});
$('scenario').addEventListener('change', event => {
  if (state.pending) return;
  if (commit(setDraftMode(state, event.target.value))) render();
});
$('new-set').addEventListener('click', () => {
  if (state.pending) return;
  if (commit(newDemoSet(state))) {
    lastWin = null;
    notice = 'Новый демо-набор создан.';
    render();
  }
});

render();
if (state.pending) animatePending();
