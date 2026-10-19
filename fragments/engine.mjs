export const STORAGE_KEY = 'craftix-random-fragments-v1';
export const TARGET = 100;
export const PRICE = 100;
export const MODES = ['repeatable', 'permanent'];
export const PAYMENTS = ['crystals', 'ticket'];
export const GAINS = [2, 5, 20];

export function freshState(mode = 'repeatable') {
  if (!MODES.includes(mode)) throw new Error('Неизвестный режим');
  return {
    version: 1, mode, payment: 'crystals', crystals: 1500, tickets: 3,
    fragments: 0, g: 0, d: 0, closed: false,
    attempts: 0, crystalsSpent: 0, ticketsUsed: 0,
    history: [], collections: [], forcedGain: null, lastGain: null,
  };
}

const safeInt = value => Number.isSafeInteger(value) && value >= 0;

export function isValidState(s) {
  return !!s && typeof s === 'object' && s.version === 1 &&
    MODES.includes(s.mode) && PAYMENTS.includes(s.payment) &&
    ['crystals', 'tickets', 'fragments', 'g', 'd', 'attempts', 'crystalsSpent', 'ticketsUsed'].every(k => safeInt(s[k])) &&
    s.crystalsSpent % PRICE === 0 && s.attempts === s.crystalsSpent / PRICE + s.ticketsUsed &&
    typeof s.closed === 'boolean' && (!s.closed || s.mode === 'permanent') &&
    (!s.closed || s.g === 1) && (s.mode !== 'permanent' || s.g <= 1) &&
    (s.forcedGain === null || GAINS.includes(s.forcedGain)) &&
    (s.lastGain === null || GAINS.includes(s.lastGain)) &&
    Array.isArray(s.history) && s.history.length === s.attempts &&
    s.history.every((h, i) => h && h.id === i + 1 && GAINS.includes(h.gain) && PAYMENTS.includes(h.payment) && typeof h.forced === 'boolean') &&
    s.history.filter(h => h.payment === 'crystals').length === s.crystalsSpent / PRICE &&
    s.history.filter(h => h.payment === 'ticket').length === s.ticketsUsed &&
    Array.isArray(s.collections) && s.collections.length === s.g &&
    s.collections.every((c, i) => c && typeof c.id === 'string' && c.id.length > 0 && c.id.length < 128 &&
      safeInt(c.before) && c.before >= TARGET && safeInt(c.leftover) && safeInt(c.converted) &&
      c.before - TARGET === c.leftover &&
      c.converted === (s.mode === 'permanent' ? c.leftover : 0) &&
      s.collections.findIndex(x => x.id === c.id) === i);
}

export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: freshState(), recovered: false };
    const parsed = JSON.parse(raw);
    if (isValidState(parsed)) return { state: parsed, recovered: false };
  } catch { /* damaged or unavailable local storage */ }
  return { state: freshState(), recovered: true };
}

export function saveState(storage, state) {
  if (!isValidState(state)) throw new Error('Некорректное состояние');
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function chooseGain(rng = Math.random) {
  const x = rng();
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x >= 1) throw new Error('Некорректное случайное число');
  return x < 0.80 ? 2 : x < 0.98 ? 5 : 20;
}

export function canPay(s) {
  return s.payment === 'crystals' ? s.crystals >= PRICE : s.tickets >= 1;
}

export function attempt(s, rng = Math.random) {
  if (s.closed) return { state: s, error: 'closed' };
  if (s.fragments >= TARGET) return { state: s, error: 'collect-first' };
  if (!canPay(s)) return { state: s, error: 'insufficient-funds' };
  const forced = s.forcedGain !== null;
  const gain = forced ? s.forcedGain : chooseGain(rng);
  const entry = { id: s.attempts + 1, gain, payment: s.payment, forced };
  return {
    state: {
      ...s,
      crystals: s.crystals - (s.payment === 'crystals' ? PRICE : 0),
      tickets: s.tickets - (s.payment === 'ticket' ? 1 : 0),
      fragments: s.fragments + gain,
      attempts: s.attempts + 1,
      crystalsSpent: s.crystalsSpent + (s.payment === 'crystals' ? PRICE : 0),
      ticketsUsed: s.ticketsUsed + (s.payment === 'ticket' ? 1 : 0),
      history: [...s.history, entry], forcedGain: null, lastGain: gain,
    }, error: null, gain,
  };
}

export function collect(s, id) {
  if (typeof id !== 'string' || !id || id.length >= 128) throw new Error('Некорректный ID операции');
  if (s.collections.some(c => c.id === id)) return { state: s, error: null, duplicate: true };
  if (s.closed) return { state: s, error: 'closed' };
  if (s.fragments < TARGET) return { state: s, error: 'not-ready' };
  const leftover = s.fragments - TARGET;
  const converted = s.mode === 'permanent' ? leftover : 0;
  const receipt = { id, before: s.fragments, leftover, converted };
  return {
    state: {
      ...s, fragments: s.mode === 'permanent' ? 0 : leftover,
      g: s.g + 1, d: s.d + converted, closed: s.mode === 'permanent',
      collections: [...s.collections, receipt], lastGain: null,
    }, error: null, receipt,
  };
}

export function selectPayment(s, payment) {
  if (!PAYMENTS.includes(payment)) return s;
  return { ...s, payment };
}

export function addResources(s, kind) {
  if (kind === 'crystals') return { ...s, crystals: s.crystals + 10000 };
  if (kind === 'tickets') return { ...s, tickets: s.tickets + 10 };
  return s;
}

export function setFragments98(s) {
  return s.closed ? s : { ...s, fragments: 98, lastGain: null };
}

export function forceNextGain(s, gain) {
  return GAINS.includes(gain) && !s.closed ? { ...s, forcedGain: gain } : s;
}
