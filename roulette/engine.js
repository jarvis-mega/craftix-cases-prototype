export const PRIZES = [
  { id: 'R1', name: 'Красный куб I', type: 'Редкий' },
  { id: 'R2', name: 'Красный куб II', type: 'Редкий' },
  { id: 'R3', name: 'Красный куб III', type: 'Редкий' },
  { id: 'G', name: 'Золотой куб', type: 'Главная награда' },
];

export const COSTS = [100, 200, 400, 800];
export const MODES = ['random', 'g-first', 'g-last'];
export const STORAGE_KEY = 'craftix-finite-roulette-v1';

export function createState({ cycle = 1, mode = 'random', balance = 1500, draftMode = mode } = {}) {
  if (!MODES.includes(mode) || !MODES.includes(draftMode)) throw new Error('Unknown mode');
  return {
    version: 1, cycle, mode, draftMode, balance, spent: 0,
    remaining: PRIZES.map(prize => prize.id), won: [], pending: null, paused: false,
  };
}

export function nextCost(state) {
  return state.won.length === PRIZES.length ? 0 : COSTS[state.won.length];
}

export function remainingTotal(state) {
  return COSTS.slice(state.won.length + (state.pending ? 1 : 0)).reduce((sum, cost) => sum + cost, 0);
}

export function probabilities(state) {
  return Object.fromEntries(state.remaining.map(id => [id, 1 / state.remaining.length]));
}

export function choosePrize(state, rng = Math.random) {
  const count = state.remaining.length;
  if (!count) throw new Error('Set is complete');
  if (state.mode === 'g-first' && state.won.length === 0) return 'G';
  if (state.mode === 'g-last' && count > 1) {
    const others = state.remaining.filter(id => id !== 'G');
    return others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
  }
  return state.remaining[Math.min(count - 1, Math.floor(rng() * count))];
}

export function beginSpin(state, rng = Math.random) {
  if (state.pending) return { state, error: 'spin-in-progress' };
  if (state.paused) return { state, error: 'paused' };
  if (!state.remaining.length) return { state, error: 'complete' };
  const cost = nextCost(state);
  if (state.balance < cost) return { state, error: 'insufficient-funds' };
  const prizeId = choosePrize(state, rng);
  return {
    state: {
      ...state, balance: state.balance - cost, spent: state.spent + cost,
      pending: { prizeId, cost },
    },
    error: null,
  };
}

export function revealSpin(state) {
  if (!state.pending) return state;
  const prizeId = state.pending.prizeId;
  return {
    ...state,
    remaining: state.remaining.filter(id => id !== prizeId),
    won: [...state.won, prizeId],
    pending: null,
  };
}

export function pauseSet(state) {
  if (!state.won.includes('G') || !state.remaining.length || state.pending) return state;
  return { ...state, paused: true };
}

export function resumeSet(state) {
  return { ...state, paused: false };
}

export function addCrystals(state) {
  return { ...state, balance: state.balance + 10000 };
}

export function setDraftMode(state, draftMode) {
  if (!MODES.includes(draftMode)) throw new Error('Unknown mode');
  return { ...state, draftMode };
}

export function newDemoSet(state) {
  return createState({ cycle: state.cycle + 1, mode: state.draftMode, draftMode: state.draftMode });
}

export function isValidState(value) {
  if (!value || value.version !== 1 || !MODES.includes(value.mode) || !MODES.includes(value.draftMode)) return false;
  if (!Number.isSafeInteger(value.cycle) || value.cycle < 1 || !Number.isSafeInteger(value.balance) || value.balance < 0) return false;
  if (!Array.isArray(value.remaining) || !Array.isArray(value.won) || typeof value.paused !== 'boolean') return false;
  const ids = PRIZES.map(prize => prize.id);
  if (value.remaining.length + value.won.length !== ids.length) return false;
  if ([...value.remaining, ...value.won].sort().join() !== ids.sort().join()) return false;
  if (value.pending !== null && (!value.pending || !value.remaining.includes(value.pending.prizeId) || value.pending.cost !== COSTS[value.won.length])) return false;
  if (value.pending && (value.paused || value.won.length === ids.length)) return false;
  const charged = value.won.length + (value.pending ? 1 : 0);
  return value.spent === COSTS.slice(0, charged).reduce((sum, cost) => sum + cost, 0);
}

export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createState();
    const parsed = JSON.parse(raw);
    return isValidState(parsed) ? parsed : createState();
  } catch {
    return createState();
  }
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
