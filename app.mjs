import { createTopUp } from './demo-ui.mjs';
import { REWARDS, grantTestResource, setTestPity, forceTestG } from './engine.mjs';
import { loadState, openAndPersist, updateAndPersist, finishPending, resetState } from './storage.mjs';

const $ = id => document.getElementById(id);
const rewardById = Object.fromEntries(REWARDS.map(reward => [reward.id, reward]));
const number = value => new Intl.NumberFormat('ru-RU').format(value);
let state;
let animating = false;
let animationTimer = null;
let reelIndex = 0;
let inventoryBefore = null;
let revealResult = false;

function selectedPayment() {
  return document.querySelector('input[name="payment"]:checked').value;
}

function rewardCard(reward) {
  const card = document.createElement('article');
  card.className = `reward-card ${reward.color}`;
  card.setAttribute('aria-label', `${reward.id}: ${reward.name}, шанс ${reward.odds}%`);
  card.innerHTML = `<div class="reward-art"><span class="reward-gem" aria-hidden="true"></span></div><div class="reward-meta"><strong>${reward.id}</strong><small>${reward.name}</small><span class="odds">${reward.odds}%</span></div>`;
  return card;
}
REWARDS.forEach(reward => $('reward-grid').append(rewardCard(reward)));

function makeText(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = content;
  return el;
}

function renderInventory() {
  const list = $('inventory-list');
  list.replaceChildren();
  for (const reward of REWARDS) {
    const row = makeText('div', `inventory-row ${reward.color}`, '');
    row.append(makeText('span', 'inventory-dot', ''), makeText('span', '', `${reward.id} · ${reward.name}`), makeText('strong', '', `× ${number((animating ? inventoryBefore : state.inventory)[reward.id])}`));
    list.append(row);
  }
}

function entryLabel(entry) {
  if (entry.source === 'test') return entry.guaranteeAlsoDue ? 'ТЕСТ · гарант тоже был активен' : 'ТЕСТ';
  if (entry.source === 'guarantee') return 'ГАРАНТ';
  return '';
}

function renderHistory() {
  const list = $('history-list');
  list.replaceChildren();
  if (!state.history.length) {
    list.append(makeText('p', 'empty-state', 'Пока нет открытий.'));
    return;
  }
  for (const result of state.history.filter(item => !animating || item.id !== state.pendingResult?.id)) {
    const block = makeText('article', 'history-entry', '');
    const top = makeText('div', 'history-entry-top', '');
    top.append(makeText('span', '', `#${result.id} · ${result.count} ${result.count === 1 ? 'открытие' : 'открытий'}`));
    const time = makeText('time', '', new Date(result.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }));
    time.dateTime = result.at;
    top.append(time);
    const payment = result.payment === 'crystals' ? '◆' : '▣';
    const rewards = result.entries.map(entry => `${rewardById[entry.reward].name}${entry.source === 'guarantee' ? ' (гарант)' : entry.source === 'test' ? ' (ТЕСТ)' : ''}`).join(' · ');
    block.append(top, makeText('p', 'history-entry-sub', `${number(result.cost)} ${payment} → ${rewards}`));
    list.append(block);
  }
}

function renderResult(reveal = false) {
  const host = $('result-content');
  host.replaceChildren();
  const result = state.lastResult;
  if (animating && result) {
    const stage = makeText('div', 'reel-stage', '');
    stage.append(makeText('div', 'reel-pointer', '▼'));
    stage.append(makeText('div', 'reel-track', ''));
    host.append(makeText('p', 'reel-caption', `Открытие ${reelIndex + 1} из ${result.count} · результат уже сохранён`), stage);
    if (reelIndex) {
      const previous = makeText('div', 'sequence-results', '');
      result.entries.slice(0, reelIndex).forEach((entry, index) => {
        const reward = rewardById[entry.reward];
        previous.append(makeText('span', `sequence-result ${reward.color}`, `${index + 1}. ${reward.name}${entry.source === 'guarantee' ? ' · ГАРАНТ' : entry.source === 'test' ? ' · ДЕМО' : ''}`));
      });
      host.append(previous);
    }
    return;
  }
  if (!result) {
    host.append(makeText('p', 'empty-state', 'Здесь появится результат первого открытия.'));
    return;
  }
  const summary = makeText('div', 'result-summary', '');
  summary.append(makeText('strong', '', `Открытие #${result.id} · ${result.count} шт.`));
  const unit = result.payment === 'crystals' ? 'кристаллов' : result.cost === 1 ? 'билет' : 'билетов';
  summary.append(makeText('span', '', `−${number(result.cost)} ${unit} · без G: ${result.beforePity} → ${result.afterPity}`));
  if (result.demoScenario) summary.append(makeText('span', 'tag test', `ДЕМО: ${result.demoScenario === 'grand' ? 'главная награда' : result.demoScenario === 'guarantee' ? 'гарантия' : 'обычное открытие'}`));
  if (result.entries.some(entry => entry.reward === 'G')) summary.append(makeText('span', 'result-next', 'G получена: счётчик гарантии сброшен. Можно открыть кейс снова.'));
  else summary.append(makeText('span', 'result-next', `До гаранта теперь ${80 - result.afterPity} открытий. Можно продолжать.`));
  host.append(summary);
  const grid = makeText('div', `result-grid${result.count === 1 ? ' single' : ''}`, '');
  result.entries.forEach((entry, index) => {
    const reward = rewardById[entry.reward];
    const card = makeText('div', `result-item ${reward.color}${reveal ? ' revealing' : ''}`, '');
    if (reveal) card.style.setProperty('--delay', `${index * 70}ms`);
    card.append(makeText('span', 'index', String(index + 1).padStart(2, '0')), makeText('strong', '', reward.name), makeText('small', '', `${reward.id} · ${reward.id === 'G' ? 'Главная награда' : reward.id === 'R4' ? 'Легендарная награда' : reward.id === 'R3' ? 'Редкая награда' : 'Обычная награда'}`));
    const label = entryLabel(entry);
    if (label) card.append(makeText('span', `tag ${entry.source}`, label));
    grid.append(card);
  });
  host.append(grid);
}

function render() {
  $('crystals').textContent = number(state.crystals);
  $('tickets').textContent = number(state.tickets);
  const shownPity = animating ? state.lastResult.beforePity : state.pity;
  $('pity-count').textContent = `Открытий без G: ${shownPity} из 79`;
  $('pity-remaining').textContent = `G гарантирован не позднее чем через ${80 - shownPity} открытий`;
  $('pity-progress').style.width = `${shownPity / 79 * 100}%`;
  const crystals = selectedPayment() === 'crystals';
  $('price-one').textContent = crystals ? '100 ◆' : '1 ▣';
  $('price-ten').textContent = crystals ? '1 000 ◆' : '10 ▣';
  $('open-one').disabled = animating;
  $('open-ten').disabled = animating;
  document.querySelectorAll('input[name="payment"], .test-actions button').forEach(control => { control.disabled = animating; });
  $('skip-animation').hidden = !animating;
  $('fund-demo').disabled = animating;
  $('fund-header').disabled = animating;
  $('animation-speed').disabled = animating;
  renderInventory();
  renderHistory();
  renderResult(revealResult);
  revealResult = false;
}

function finishOpening(skipped = false) {
  if (!animating) return;
  clearTimeout(animationTimer);
  animating = false;
  inventoryBefore = null;
  revealResult = true;
  try { state = finishPending(localStorage); }
  catch { $('payment-help').textContent = 'Результат сохранён, но не удалось завершить анимацию в хранилище. Перезагрузите страницу.'; }
  render();
  if (skipped) $('result-title').focus();
}

function playReelStep() {
  if (!animating) return;
  const result = state.lastResult;
  const target = result.entries[reelIndex].reward;
  const stage = document.querySelector('.reel-stage');
  const track = stage.querySelector('.reel-track');
  const ids = Array.from({ length: 19 }, (_, index) => index === 16 ? target : REWARDS[(index * 3 + reelIndex) % REWARDS.length].id);
  track.replaceChildren(...ids.map(id => {
    const reward = rewardById[id];
    return makeText('div', `reel-card ${reward.color}`, reward.name);
  }));
  const goal = track.children[16];
  const offset = stage.clientWidth / 2 - (goal.offsetLeft + goal.offsetWidth / 2);
  const fast = $('animation-speed').value === 'fast';
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : result.count === 1 ? (fast ? 950 : 2900) : (fast ? 90 : 280);
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!animating) return;
    track.style.transition = `transform ${duration}ms cubic-bezier(.13,.76,.16,1)`;
    track.style.transform = `translateX(${offset}px)`;
  }));
  animationTimer = setTimeout(() => {
    if (!animating) return;
    reelIndex++;
    if (reelIndex === result.count) finishOpening();
    else { renderResult(); playReelStep(); }
  }, duration + 80);
}

function startOpening(count) {
  if (animating) return;
  try {
    const outcome = openAndPersist(localStorage, { count, payment: selectedPayment() });
    if (!outcome.ok) {
      const unit = selectedPayment() === 'crystals' ? 'кристаллов' : 'билетов';
      $('payment-help').textContent = `Недостаточно ${unit}: нужно ${number(outcome.required)}, доступно ${number(outcome.available)}. Ресурс не менялся.`;
      $('payment-help').setAttribute('role', 'alert');
      topUp.open();
      return;
    }
    inventoryBefore = state.inventory;
    state = outcome.state;
    animating = true;
    reelIndex = 0;
    $('payment-help').textContent = `Списано ${number(outcome.result.cost)} ${outcome.result.payment === 'crystals' ? 'кристаллов' : outcome.result.cost === 1 ? 'билет' : 'билетов'}. Результат уже сохранён.`;
    $('payment-help').removeAttribute('role');
    render();
    playReelStep();
  } catch {
    $('payment-help').textContent = 'Не удалось сохранить открытие в браузере. Ресурсы и награды не изменились. Проверьте доступность локального хранилища.';
    $('payment-help').setAttribute('role', 'alert');
  }
}

function testUpdate(update, message) {
  if (animating) return;
  try {
    state = updateAndPersist(localStorage, update);
    $('test-status').textContent = message;
    render();
  } catch { $('test-status').textContent = 'Не удалось сохранить изменение.'; }
}

$('open-one').addEventListener('click', () => startOpening(1));
$('open-ten').addEventListener('click', () => startOpening(10));
$('skip-animation').addEventListener('click', () => finishOpening(true));
document.querySelectorAll('input[name="payment"]').forEach(input => input.addEventListener('change', () => {
  $('payment-help').textContent = 'Оплата только выбранным ресурсом. Если его не хватает, открытие не начнётся.';
  render();
}));
const topUp = createTopUp({ getBalance: () => state, onGrant: (kind, amount) => {
  try { state = updateAndPersist(localStorage, current => grantTestResource(current, kind, amount)); render(); return true; }
  catch { return false; }
} });
$('fund-demo').addEventListener('click', () => topUp.open());
$('fund-header').addEventListener('click', () => topUp.open());
$('scenario-ordinary').addEventListener('click', () => testUpdate(current => ({ ...current, pity: 0, forceNextG: false, demoPrepared: 'ordinary' }), 'Обычный случайный результат подготовлен. Нажмите «Открыть 1».'));
$('scenario-grand').addEventListener('click', () => testUpdate(forceTestG, 'ДЕМО: главная награда подготовлена. Нажмите «Открыть 1».'));
$('scenario-guarantee').addEventListener('click', () => testUpdate(setTestPity, 'ДЕМО: гарант подготовлен. Нажмите «Открыть 1».'));
$('reset').addEventListener('click', () => {
  if (animating) return;
  topUp.close();
  try {
    state = resetState(localStorage);
    $('test-status').textContent = 'Демо полностью сброшено.';
    $('payment-help').textContent = 'Оплата только выбранным ресурсом. Если его не хватает, открытие не начнётся.';
    render();
  } catch { $('test-status').textContent = 'Не удалось удалить сохранённые данные.'; }
});

try {
  state = loadState(localStorage);
  if (state.pendingResult) state = finishPending(localStorage); // Show saved result without replaying charge/grant.
} catch {
  state = loadState({ getItem: () => null });
  $('payment-help').textContent = 'Локальное хранилище недоступно. Для сохранения прогресса откройте страницу по HTTP и разрешите хранение данных.';
}
render();
