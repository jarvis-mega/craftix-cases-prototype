import { STORAGE_KEY, TARGET, freshState, loadState, saveState, attempt, collect, selectPayment, addResources, setFragments98, forceNextGain, canPay } from './engine.mjs';

const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('ru-RU').format(n);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const loaded = loadState(storage);
let state = loaded.state;
let busy = false;
let collectionLock = false;
let animationTimer = null;

const errors = {
  'closed': 'Набор завершён. Для нового теста перезапустите режим в тестовой панели.',
  'collect-first': 'Сначала соберите G за 100 фрагментов.',
  'insufficient-funds': 'Недостаточно выбранной валюты. Пополнение доступно в тестовой панели.',
  'not-ready': 'Для сбора требуется минимум 100 фрагментов.',
};

function commit(next) {
  try {
    saveState(storage, next); // durable result before any visual reveal
    state = next;
    return true;
  } catch {
    render('Не удалось сохранить данные браузера. Действие отменено; освободите место или разрешите localStorage.');
    return false;
  }
}

function render(message) {
  $('mode-badge').textContent = state.mode === 'repeatable' ? 'РЕЖИМ A · ПОВТОРЯЕМЫЙ' : 'РЕЖИМ B · ОДИН РАЗ';
  $('mode-description').textContent = state.mode === 'repeatable'
    ? 'Фрагменты сверх 100 остаются. После сбора можно продолжать набор и собирать G снова.'
    : 'Один сбор закрывает цель до перезапуска теста. После списания 100 весь остаток конвертируется в D по курсу 1:1.';
  $('conversion-rule').hidden = state.mode !== 'permanent';
  $('g-count').textContent = fmt(state.g);
  $('d-count').textContent = fmt(state.d);
  $('fragment-count').textContent = fmt(state.fragments);
  const ready = !state.closed && state.fragments >= TARGET;
  const leftover = state.fragments - TARGET;
  $('remaining').textContent = state.closed ? 'Цель закрыта до перезапуска теста' : ready ? 'Готово к сбору G' : `Осталось ${fmt(TARGET - state.fragments)} фрагментов`;
  $('progress').setAttribute('aria-valuenow', String(Math.min(state.fragments, TARGET)));
  $('progress').setAttribute('aria-valuetext', state.closed
    ? `После сбора осталось ${fmt(state.fragments)} фрагментов; цель закрыта`
    : ready ? `${fmt(state.fragments)} фрагментов собрано при цели ${TARGET}; ${fmt(leftover)} сверх цели`
      : `${fmt(state.fragments)} из ${TARGET} фрагментов`);
  $('progress-fill').style.width = `${Math.min(100, state.fragments)}%`;
  $('crystal-balance').textContent = fmt(state.crystals);
  $('ticket-balance').textContent = fmt(state.tickets);
  document.querySelectorAll('input[name="payment"]').forEach(input => { input.checked = input.value === state.payment; input.disabled = busy || state.closed || state.fragments >= TARGET; });
  $('payment-area').hidden = state.closed || ready;
  $('payment-rule').hidden = state.mode !== 'permanent';
  $('payment-rule').textContent = 'Режим B: за один сбор спишутся 100 фрагментов; остаток превратится в D по курсу 1:1. После сбора цель закроется до перезапуска теста.';
  $('collection-preview').hidden = !ready;
  $('collection-preview').textContent = state.mode === 'permanent'
    ? `Сбор один раз: −100 фрагментов, +1 G, остаток ${fmt(leftover)} → +${fmt(leftover)} D (1:1). После сбора цель закроется до перезапуска теста.`
    : `Сбор: −100 фрагментов, +1 G. Останется ${fmt(leftover)} фрагментов; набор можно продолжить.`;
  $('attempts').textContent = fmt(state.attempts);
  $('spent').textContent = fmt(state.crystalsSpent);
  $('used').textContent = fmt(state.ticketsUsed);
  $('history-total').textContent = `${fmt(state.attempts)} ВСЕГО`;
  $('force-status').textContent = state.forcedGain === null ? 'Не задан · реальные шансы действуют' : `ТЕСТОВОЕ ВМЕШАТЕЛЬСТВО: следующая попытка даст +${state.forcedGain}`;
  $('restart-mode').value = state.mode;
  $('set-98').disabled = busy || state.closed;
  document.querySelectorAll('[data-force]').forEach(button => { button.disabled = busy || state.closed; });
  for (const id of ['add-crystals', 'add-tickets', 'restart']) $(id).disabled = busy;
  $('restart-mode').disabled = busy;
  const primary = $('primary');
  if (state.closed) primary.textContent = 'Набор завершён';
  else if (state.fragments >= TARGET) primary.textContent = 'Собрать G за 100 фрагментов';
  else primary.textContent = state.payment === 'crystals' ? 'Открыть за 100 TEST-кристаллов' : 'Открыть за 1 билет';
  primary.disabled = busy || collectionLock || state.closed;
  $('history').innerHTML = state.history.length
    ? state.history.slice(-12).reverse().map(h => `<div class="history-row"><span>№ ${h.id} · ${h.payment === 'crystals' ? '100 TEST-кристаллов' : '1 билет'}</span>${h.forced ? '<span class="forced">ТЕСТОВОЕ ВМЕШАТЕЛЬСТВО</span>' : ''}<strong>+${h.gain}</strong></div>`).join('')
    : '<div class="empty">Пока нет попыток. Выберите оплату и откройте первый фрагмент.</div>';
  const receipt = state.collections.at(-1);
  $('receipt').innerHTML = receipt
    ? `<div class="receipt-lines"><div><span>Фрагментов до сбора</span><strong>${fmt(receipt.before)}</strong></div><div><span>Списано за G</span><strong>−100</strong></div><div><span>Осталось фрагментов после сбора</span><strong>${state.mode === 'permanent' ? '0' : fmt(receipt.leftover)}</strong></div>${state.mode === 'permanent' ? `<div><span>Конвертировано в D · 1:1</span><strong>+${fmt(receipt.converted)}</strong></div>` : ''}<div class="receipt-final"><span>Получено</span><strong>+1 G</strong></div></div>`
    : '<div class="empty">Когда соберёте G, здесь появится точная разбивка операции.</div>';
  $('status').textContent = message ?? (state.closed ? 'G получен. Цель закрыта до перезапуска теста; новые попытки недоступны.' : state.fragments >= TARGET ? 'Можно собрать G. Новые попытки заблокированы до сбора.' : !canPay(state) ? 'Недостаточно выбранной валюты. Оплата не переключается автоматически.' : state.lastGain ? `Последний результат +${state.lastGain} сохранён. Следующая попытка только по нажатию.` : 'Выберите валюту и сделайте попытку.');
}

function endAnimation() {
  if (animationTimer) clearTimeout(animationTimer);
  animationTimer = null;
  $('gain-stage').hidden = true;
  $('skip').hidden = true;
  busy = false;
  render();
}

function showGain(gain, forced) {
  $('gain-value').textContent = `+${gain}`;
  $('gain-note').textContent = forced ? 'ТЕСТОВОЕ ВМЕШАТЕЛЬСТВО' : 'ФРАГМЕНТОВ';
  $('gain-stage').hidden = false;
  $('skip').hidden = false;
  animationTimer = setTimeout(endAnimation, 1700);
}

$('primary').addEventListener('click', () => {
  if (busy || collectionLock || state.closed) return;
  if (state.fragments >= TARGET) {
    collectionLock = true;
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `collection-${Date.now()}-${Math.random()}`;
    const result = collect(state, id);
    if (result.error) { collectionLock = false; render(errors[result.error]); return; }
    if (!commit(result.state)) { collectionLock = false; render('Не удалось сохранить данные браузера. Сбор отменён.'); return; }
    render(`Собран +1 G. Списано 100 фрагментов${result.receipt.converted ? `, +${result.receipt.converted} D за остаток` : ''}.`);
    setTimeout(() => { collectionLock = false; render(); }, 650);
    return;
  }
  const result = attempt(state);
  if (result.error) { render(errors[result.error]); return; }
  if (!commit(result.state)) return;
  busy = true;
  render(`Сохранено: +${result.gain} фрагментов.`);
  showGain(result.gain, result.state.history.at(-1).forced);
});
$('skip').addEventListener('click', endAnimation);
document.querySelectorAll('input[name="payment"]').forEach(input => input.addEventListener('change', () => {
  if (busy || state.closed || state.fragments >= TARGET) { render(); return; }
  const next = selectPayment(state, input.value);
  if (next !== state && commit(next)) render();
}));
$('add-crystals').addEventListener('click', () => { if (!busy && commit(addResources(state, 'crystals'))) render('Тестовое пополнение: +10 000 TEST-кристаллов.'); });
$('add-tickets').addEventListener('click', () => { if (!busy && commit(addResources(state, 'tickets'))) render('Тестовое пополнение: +10 билетов.'); });
$('set-98').addEventListener('click', () => { if (!busy && !state.closed && commit(setFragments98(state))) render('Тестовое вмешательство: установлено 98 фрагментов.'); });
document.querySelectorAll('[data-force]').forEach(button => button.addEventListener('click', () => {
  if (!busy && !state.closed && commit(forceNextGain(state, Number(button.dataset.force)))) render('Тестовое вмешательство: следующий результат зафиксирован.');
}));
$('restart').addEventListener('click', () => {
  if (busy) return;
  const mode = $('restart-mode').value;
  if (commit(freshState(mode))) render('Тестовый набор перезапущен в выбранном режиме.');
});

render(loaded.recovered ? 'Повреждённое или недоступное сохранение: создан новый тестовый набор.' : undefined);
