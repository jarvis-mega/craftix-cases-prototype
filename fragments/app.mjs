import { createTopUp, bindResetButton } from '../demo-ui.mjs?v=3';
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
  'insufficient-funds': 'Недостаточно выбранной валюты. Нажмите «Пополнить тестовый баланс» рядом с действием.',
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
  $('header-crystals').textContent = fmt(state.crystals);
  $('header-tickets').textContent = fmt(state.tickets);
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
  document.querySelectorAll('.qa-actions button').forEach(button => { button.disabled = busy || state.closed; });
  for (const id of ['restart', 'reset-demo', 'reset-header', 'fund-header', 'animation-speed']) $(id).disabled = busy;
  $('restart-mode').disabled = busy;
  const primary = $('primary');
  if (state.closed) primary.textContent = 'Набор завершён';
  else if (state.fragments >= TARGET) primary.textContent = 'Собрать G за 100 фрагментов';
  else primary.textContent = state.payment === 'crystals' ? 'Открыть за 100 TEST-кристаллов' : 'Открыть за 1 билет';
  primary.disabled = busy || collectionLock || state.closed;
  $('fund-demo').hidden = state.closed || ready || canPay(state);
  $('fund-demo').disabled = busy;
  $('history').innerHTML = state.history.length
    ? state.history.slice(-12).reverse().map(h => `<div class="history-row"><span>№ ${h.id} · ${h.payment === 'crystals' ? '100 TEST-кристаллов' : '1 билет'}</span>${h.forced ? '<span class="forced">ТЕСТОВОЕ ВМЕШАТЕЛЬСТВО</span>' : ''}<strong>+${h.gain}</strong></div>`).join('')
    : '<div class="empty">Пока нет попыток. Выберите оплату и откройте первый фрагмент.</div>';
  const receipt = state.collections.at(-1);
  $('receipt').innerHTML = receipt
    ? `<div class="receipt-lines">${receipt.demo ? '<strong class="forced">ДЕМО-СБОРКА</strong>' : ''}<div><span>Фрагментов до сбора</span><strong>${fmt(receipt.before)}</strong></div><div><span>Списано за G</span><strong>−100</strong></div><div><span>Осталось фрагментов после сбора</span><strong>${state.mode === 'permanent' ? '0' : fmt(receipt.leftover)}</strong></div>${state.mode === 'permanent' ? `<div><span>Конвертировано в D · 1:1</span><strong>+${fmt(receipt.converted)}</strong></div>` : ''}<div class="receipt-final"><span>Получено</span><strong>+1 G</strong></div></div>`
    : '<div class="empty">Когда соберёте G, здесь появится точная разбивка операции.</div>';
  $('status').textContent = message ?? (state.closed ? 'G получен. Цель закрыта до перезапуска теста; новые попытки недоступны.' : state.fragments >= TARGET ? 'Можно собрать G. Новые попытки заблокированы до сбора.' : !canPay(state) ? 'Недостаточно выбранной валюты. Оплата не переключается автоматически.' : state.lastGain ? `Последний результат +${state.lastGain} сохранён. Следующая попытка только по нажатию.` : 'Выберите валюту и сделайте попытку.');
  const lastAttempt = state.lastGain === null ? null : state.history.at(-1);
  const attemptReceipt = $('attempt-receipt');
  attemptReceipt.hidden = !lastAttempt;
  if (lastAttempt) {
    const payment = lastAttempt.payment === 'crystals' ? '100 TEST-кристаллов' : '1 билет';
    const next = state.fragments >= TARGET ? 'Далее: собрать G за 100 фрагментов.' : canPay(state) ? `Далее: новая попытка за ${state.payment === 'crystals' ? '100 TEST-кристаллов' : '1 билет'}.` : 'Далее: пополнить выбранную валюту или выбрать другую.';
    attemptReceipt.textContent = `Попытка №${lastAttempt.id}: +${lastAttempt.gain} ${lastAttempt.gain === 2 ? 'фрагмента' : 'фрагментов'}. Списано ${payment}; запас вырос до ${fmt(state.fragments)}. ${next}`;
  }
}

function endAnimation() {
  if (animationTimer) clearTimeout(animationTimer);
  animationTimer = null;
  $('gain-stage').hidden = true;
  $('gain-stage').classList.remove('assembly', 'big');
  $('gain-stage').querySelectorAll('.fragment-particle').forEach(el => el.remove());
  $('skip').hidden = true;
  busy = false;
  collectionLock = false;
  render();
}

function showGain(gain, forced, before) {
  $('gain-value').textContent = `+${gain}`;
  $('gain-note').textContent = `${forced ? 'ДЕМО · ' : ''}ФРАГМЕНТОВ ЦЕЛИ G`;
  $('gain-stage').classList.toggle('big', gain === 20);
  const stage = $('gain-stage');
  stage.classList.remove('assembly');
  stage.hidden = false;
  const source = stage.getBoundingClientRect();
  const target = document.querySelector('.reward-art').getBoundingClientRect();
  const dx = target.left + target.width / 2 - (source.left + source.width / 2);
  const dy = target.top + target.height / 2 - (source.top + source.height / 2);
  for (let i = 0; i < Math.min(gain, 12); i++) {
    const particle = document.createElement('span');
    particle.className = 'fragment-particle'; particle.textContent = '◆';
    particle.style.setProperty('--fly-x', `${dx + (i - 5) * 5}px`);
    particle.style.setProperty('--fly-y', `${dy}px`);
    particle.style.setProperty('--particle-delay', `${i * 55}ms`);
    stage.append(particle);
  }
  $('fragment-count').textContent = fmt(before);
  $('progress').setAttribute('aria-valuenow', String(Math.min(100, before)));
  $('progress-fill').style.width = `${Math.min(100, before)}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => { $('progress-fill').style.width = `${Math.min(100, state.fragments)}%`; }));
  $('skip').hidden = false;
  setTimeout(() => { if (state.fragments >= before) { $('fragment-count').textContent = fmt(state.fragments); $('progress').setAttribute('aria-valuenow', String(Math.min(100, state.fragments))); } }, 1050);
  animationTimer = setTimeout(endAnimation, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : $('animation-speed').value === 'fast' ? 950 : 2800);
}

function showAssembly(receipt) {
  const stage = $('gain-stage');
  stage.classList.remove('big');
  stage.classList.add('assembly');
  $('gain-value').textContent = 'G';
  $('gain-note').textContent = `СОБРАНО ИЗ 100 ФРАГМЕНТОВ · ОСТАТОК ${receipt.leftover}`;
  stage.hidden = false;
  $('skip').hidden = false;
  animationTimer = setTimeout(endAnimation, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : $('animation-speed').value === 'fast' ? 950 : 3000);
}

$('primary').addEventListener('click', () => {
  if (busy || collectionLock || state.closed) return;
  if (state.fragments >= TARGET) {
    collectionLock = true;
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `collection-${Date.now()}-${Math.random()}`;
    const result = collect(state, id);
    if (result.error) { collectionLock = false; render(errors[result.error]); return; }
    if (!commit(result.state)) { collectionLock = false; render('Не удалось сохранить данные браузера. Сбор отменён.'); return; }
    busy = true;
    render(`Собран +1 G. Списано 100 фрагментов${result.receipt.converted ? `, +${result.receipt.converted} D за остаток` : ''}.`);
    showAssembly(result.receipt);
    return;
  }
  const before = state.fragments;
  const result = attempt(state);
  if (result.error) { render(errors[result.error]); if (result.error === 'insufficient-funds') topUp.open(); return; }
  if (!commit(result.state)) return;
  busy = true;
  render(`Сохранено: +${result.gain} ${result.gain === 2 ? 'фрагмента' : 'фрагментов'}.`);
  showGain(result.gain, result.state.history.at(-1).forced, before);
});
$('skip').addEventListener('click', endAnimation);
document.querySelectorAll('input[name="payment"]').forEach(input => input.addEventListener('change', () => {
  if (busy || state.closed || state.fragments >= TARGET) { render(); return; }
  const next = selectPayment(state, input.value);
  if (next !== state && commit(next)) render();
}));
const topUp = createTopUp({ getBalance: () => state, onGrant: (kind, amount) => {
  if (busy || !commit(addResources(state, kind, amount))) return false;
  render(`Тестовое пополнение: +${fmt(amount)} ${kind === 'crystals' ? 'кристаллов' : 'билетов'}.`); return true;
} });
$('fund-demo').addEventListener('click', () => topUp.open());
$('fund-header').addEventListener('click', () => topUp.open());
function prepareScenario(kind) {
  if (busy || state.closed) return;
  let next = state;
  if (kind === 'ordinary') next = { ...forceNextGain(state, 2), demoPrepared: 'ordinary' };
  if (kind === 'big') next = { ...forceNextGain(state, 20), demoPrepared: 'big' };
  if (kind === 'threshold') next = { ...forceNextGain(setFragments98(state), 2), demoPrepared: 'threshold' };
  if (kind === 'assembly') next = { ...state, fragments: 105, forcedGain: null, demoPrepared: 'assembly' };
  if (commit(next)) render(`ДЕМО подготовлено: ${kind === 'assembly' ? 'нажмите «Собрать G»' : 'нажмите основную кнопку'}.`);
}
$('scenario-ordinary').addEventListener('click', () => prepareScenario('ordinary'));
$('scenario-big').addEventListener('click', () => prepareScenario('big'));
$('scenario-threshold').addEventListener('click', () => prepareScenario('threshold'));
$('scenario-assembly').addEventListener('click', () => prepareScenario('assembly'));
bindResetButton($('reset-header'), () => busy, () => $('reset-demo').click());
$('reset-demo').addEventListener('click', () => {
  if (busy) return;
  try { storage.removeItem(STORAGE_KEY); state = freshState(); topUp.close(); render('Демо полностью сброшено.'); }
  catch { render('Не удалось сбросить демо.'); }
});
$('restart').addEventListener('click', () => {
  if (busy) return;
  const mode = $('restart-mode').value;
  if (commit(freshState(mode))) render('Тестовый набор перезапущен в выбранном режиме.');
});

render(loaded.recovered ? 'Повреждённое или недоступное сохранение: создан новый тестовый набор.' : undefined);
