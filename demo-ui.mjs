/** Local-only demo funding. The caller persists the change before the dialog closes. */
export function createTopUp({ onGrant, getBalance, tickets = true }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'demo-topup';
  dialog.innerHTML = `<div class="demo-topup-head"><div><small>ТОЛЬКО ДЕМО</small><h2>Пополнить тестовый баланс</h2></div><button class="demo-close" type="button" aria-label="Закрыть">×</button></div><p>Реальных платежей нет. Прогресс, награды и текущий набор сохраняются.</p><div class="demo-balances" aria-live="polite"></div><div class="demo-topup-actions"><button type="button" data-kind="crystals" data-amount="1000">+1 000 ◆</button><button type="button" data-kind="crystals" data-amount="5000">+5 000 ◆</button><button type="button" data-kind="crystals" data-amount="10000">+10 000 ◆</button><button type="button" data-kind="tickets" data-amount="10">+10 тестовых билетов</button></div><p class="demo-topup-status" role="status"></p>`;
  document.body.append(dialog);
  if (!tickets) dialog.querySelector('[data-kind="tickets"]').remove();
  const balances = dialog.querySelector('.demo-balances');
  const status = dialog.querySelector('.demo-topup-status');
  function refresh() {
    const value = getBalance();
    balances.textContent = `Баланс: ${new Intl.NumberFormat('ru-RU').format(value.crystals)} ◆${tickets ? ` · ${new Intl.NumberFormat('ru-RU').format(value.tickets)} билетов` : ''}`;
  }
  dialog.querySelector('.demo-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
    const amount = Number(button.dataset.amount);
    const kind = button.dataset.kind;
    try {
      const ok = onGrant(kind, amount);
      status.textContent = ok === false ? 'Не удалось сохранить пополнение.' : `Добавлено ${new Intl.NumberFormat('ru-RU').format(amount)} ${kind === 'crystals' ? 'тестовых кристаллов' : 'тестовых билетов'}.`;
      refresh();
    } catch { status.textContent = 'Не удалось сохранить пополнение. Баланс не изменён.'; }
  }));
  return {
    open() { refresh(); status.textContent = ''; if (!dialog.open) dialog.showModal(); },
    close() { if (dialog.open) dialog.close(); },
  };
}

// Two-tap reset: no window.confirm (blocked in some in-app browsers, e.g. Telegram WebView).
export function bindResetButton(button, isBusy, doReset) {
  const label = button.textContent;
  let armedUntil = 0, timer = null;
  const disarm = () => { armedUntil = 0; button.textContent = label; button.classList.remove('armed'); };
  button.addEventListener('click', () => {
    if (isBusy()) return;
    if (Date.now() > armedUntil) {
      armedUntil = Date.now() + 4000; button.textContent = 'Ещё раз = сброс'; button.classList.add('armed');
      clearTimeout(timer); timer = setTimeout(disarm, 4000); return;
    }
    clearTimeout(timer); disarm(); doReset();
  });
}
