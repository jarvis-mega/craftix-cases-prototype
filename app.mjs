import { REWARDS, grantTestResource, setTestPity, forceTestG } from './engine.mjs';
import { loadState, openAndPersist, updateAndPersist, finishPending, resetState } from './storage.mjs';

const $ = id => document.getElementById(id);
const rewardById = Object.fromEntries(REWARDS.map(reward => [reward.id, reward]));
const number = value => new Intl.NumberFormat('ru-RU').format(value);
let state;
let animating = false;
let animationTimer = null;

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
    row.append(makeText('span', 'inventory-dot', ''), makeText('span', '', `${reward.id} · ${reward.name}`), makeText('strong', '', `× ${number(state.inventory[reward.id])}`));
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
  for (const result of state.history) {
    const block = makeText('article', 'history-entry', '');
    const top = makeText('div', 'history-entry-top', '');
    top.append(makeText('span', '', `#${result.id} · ${result.count} ${result.count === 1 ? 'открытие' : 'открытий'}`));
    const time = makeText('time', '', new Date(result.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }));
    time.dateTime = result.at;
    top.append(time);
    const payment = result.payment === 'crystals' ? '◆' : '▣';
    const rewards = result.entries.map(entry => `${entry.reward}${entry.source === 'guarantee' ? ' (гарант)' : entry.source === 'test' ? ' (ТЕСТ)' : ''}`).join(' · ');
    block.append(top, makeText('p', 'history-entry-sub', `${number(result.cost)} ${payment} → ${rewards}`));
    list.append(block);
  }
}

function renderResult(reveal = false) {
  const host = $('result-content');
  host.replaceChildren();
  const result = state.lastResult;
  if (!result) {
    host.append(makeText('p', 'empty-state', 'Здесь появится результат первого открытия.'));
    return;
  }
  const summary = makeText('div', 'result-summary', '');
  summary.append(makeText('strong', '', `Открытие #${result.id} · ${result.count} шт.`));
  const unit = result.payment === 'crystals' ? 'кристаллов' : 'билетов';
  summary.append(makeText('span', '', `−${number(result.cost)} ${unit} · без G: ${result.beforePity} → ${result.afterPity}`));
  host.append(summary);
  const grid = makeText('div', `result-grid${result.count === 1 ? ' single' : ''}`, '');
  result.entries.forEach((entry, index) => {
    const reward = rewardById[entry.reward];
    const card = makeText('div', `result-item ${reward.color}${reveal ? ' revealing' : ''}`, '');
    if (reveal) card.style.setProperty('--delay', `${index * 70}ms`);
    card.append(makeText('span', 'index', String(index + 1).padStart(2, '0')), makeText('strong', '', reward.id), makeText('small', '', reward.name));
    const label = entryLabel(entry);
    if (label) card.append(makeText('span', `tag ${entry.source}`, label));
    grid.append(card);
  });
  host.append(grid);
}

function render() {
  $('crystals').textContent = number(state.crystals);
  $('tickets').textContent = number(state.tickets);
  $('pity-count').textContent = `Открытий без G: ${state.pity} из 79`;
  $('pity-remaining').textContent = `G гарантирован не позднее чем через ${80 - state.pity} открытий`;
  $('pity-progress').style.width = `${state.pity / 79 * 100}%`;
  const crystals = selectedPayment() === 'crystals';
  $('price-one').textContent = crystals ? '100 ◆' : '1 ▣';
  $('price-ten').textContent = crystals ? '1 000 ◆' : '10 ▣';
  $('open-one').disabled = animating;
  $('open-ten').disabled = animating;
  document.querySelectorAll('input[name="payment"], .test-actions button').forEach(control => { control.disabled = animating; });
  $('skip-animation').hidden = !animating;
  renderInventory();
  renderHistory();
  renderResult(animating);
  $('force-g').textContent = state.forceNextG ? 'G в следующем открытии · включено' : 'G в следующем открытии';
}

function finishOpening(skipped = false) {
  if (!animating) return;
  clearTimeout(animationTimer);
  animating = false;
  try { state = finishPending(localStorage); }
  catch { $('payment-help').textContent = 'Результат сохранён, но не удалось завершить анимацию в хранилище. Перезагрузите страницу.'; }
  render();
  if (skipped) $('result-title').focus();
}

function startOpening(count) {
  if (animating) return;
  try {
    const outcome = openAndPersist(localStorage, { count, payment: selectedPayment() });
    if (!outcome.ok) {
      const unit = selectedPayment() === 'crystals' ? 'кристаллов' : 'билетов';
      $('payment-help').textContent = `Недостаточно ${unit}: нужно ${number(outcome.required)}, доступно ${number(outcome.available)}. Ресурс не менялся.`;
      $('payment-help').setAttribute('role', 'alert');
      return;
    }
    state = outcome.state;
    animating = true;
    $('payment-help').textContent = `Списано ${number(outcome.result.cost)} ${outcome.result.payment === 'crystals' ? 'кристаллов' : 'билетов'}. Результат уже сохранён.`;
    $('payment-help').removeAttribute('role');
    render();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    animationTimer = setTimeout(finishOpening, reducedMotion ? 0 : 650 + count * 70);
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
$('add-crystals').addEventListener('click', () => testUpdate(current => grantTestResource(current, 'crystals'), 'Добавлено 10 000 тестовых кристаллов.'));
$('add-tickets').addEventListener('click', () => testUpdate(current => grantTestResource(current, 'tickets'), 'Добавлено 10 тестовых билетов.'));
$('set-pity').addEventListener('click', () => testUpdate(setTestPity, 'Счётчик установлен на 79: следующее открытие гарантирует G.'));
$('force-g').addEventListener('click', () => testUpdate(forceTestG, 'Следующее открытие даст G с меткой «ТЕСТ»; настройка одноразовая.'));
$('reset').addEventListener('click', () => {
  if (animating) return;
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
