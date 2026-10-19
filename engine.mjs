export const REWARDS = Object.freeze([
  { id: 'R1', name: 'Кубик искр', odds: 50, color: 'mint' },
  { id: 'R2', name: 'Кубик энергии', odds: 30, color: 'blue' },
  { id: 'R3', name: 'Кубик мастера', odds: 15, color: 'violet' },
  { id: 'R4', name: 'Кубик легенды', odds: 3, color: 'orange' },
  { id: 'G', name: 'Главный приз', odds: 2, color: 'gold' },
]);

export const PRICES = Object.freeze({ crystals: 100, tickets: 1 });
export const STORAGE_KEY = 'craftix-cases-demo-v1';
export const MAX_HISTORY = 40;

export function initialState() {
  return {
    version: 1,
    crystals: 2500,
    tickets: 3,
    pity: 0,
    forceNextG: false,
    demoPrepared: null,
    inventory: Object.fromEntries(REWARDS.map(reward => [reward.id, 0])),
    history: [],
    lastResult: null,
    pendingResult: null,
    nextId: 1,
  };
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidResult(result) {
  return Boolean(result && isCount(result.id) && result.id > 0 &&
    (result.count === 1 || result.count === 10) && Object.hasOwn(PRICES, result.payment) &&
    result.cost === PRICES[result.payment] * result.count &&
    Number.isInteger(result.beforePity) && result.beforePity >= 0 && result.beforePity <= 79 &&
    Number.isInteger(result.afterPity) && result.afterPity >= 0 && result.afterPity <= 79 &&
    typeof result.at === 'string' && Number.isFinite(Date.parse(result.at)) &&
    Array.isArray(result.entries) && result.entries.length === result.count &&
    result.entries.every(entry => entry && REWARDS.some(reward => reward.id === entry.reward) &&
      ['odds', 'guarantee', 'test'].includes(entry.source) &&
      typeof entry.guaranteeAlsoDue === 'boolean' && Number.isInteger(entry.pityAfter) &&
      entry.pityAfter >= 0 && entry.pityAfter <= 79));
}

export function isValidState(state) {
  return Boolean(state && state.version === 1 && isCount(state.crystals) &&
    isCount(state.tickets) && Number.isInteger(state.pity) && state.pity >= 0 &&
    state.pity <= 79 && typeof state.forceNextG === 'boolean' &&
    (state.demoPrepared === undefined || state.demoPrepared === null || ['ordinary', 'grand', 'guarantee'].includes(state.demoPrepared)) &&
    state.inventory && REWARDS.every(reward => isCount(state.inventory[reward.id])) &&
    Array.isArray(state.history) && state.history.length <= MAX_HISTORY &&
    state.history.every(isValidResult) &&
    (state.lastResult === null || isValidResult(state.lastResult)) &&
    (state.pendingResult === null || isValidResult(state.pendingResult)) &&
    isCount(state.nextId) && state.nextId > 0);
}

export function drawByOdds(random = Math.random) {
  const roll = random();
  if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError('Random value must be in [0, 1)');
  }
  // Compare against integer percentage boundaries to keep 0.95 and 0.98 exact.
  let cumulative = 0;
  for (const reward of REWARDS) {
    cumulative += reward.odds;
    if (roll * 100 < cumulative) return reward.id;
  }
  return 'G';
}

export function openCase(state, { count, payment, random = Math.random, now = Date.now } = {}) {
  if (!isValidState(state)) throw new TypeError('Invalid demo state');
  if (count !== 1 && count !== 10) throw new RangeError('Count must be 1 or 10');
  if (!Object.hasOwn(PRICES, payment)) throw new RangeError('Choose crystals or tickets');
  const cost = PRICES[payment] * count;
  if (state[payment] < cost) return { ok: false, reason: 'insufficient', required: cost, available: state[payment] };

  const next = structuredClone(state);
  const beforePity = next.pity;
  const id = next.nextId++;
  const entries = [];
  next[payment] -= cost;

  for (let i = 0; i < count; i++) {
    const forcedTest = next.forceNextG;
    const guaranteed = next.pity === 79;
    let reward;
    let source;
    if (forcedTest) {
      reward = 'G';
      source = 'test'; // Test override wins even if pity is also at 79.
      next.forceNextG = false;
    } else if (guaranteed) {
      reward = 'G';
      source = 'guarantee';
    } else {
      reward = drawByOdds(random);
      source = 'odds';
    }
    next.inventory[reward]++;
    next.pity = reward === 'G' ? 0 : next.pity + 1;
    entries.push({ reward, source, guaranteeAlsoDue: forcedTest && guaranteed, pityAfter: next.pity });
  }

  const result = {
    id,
    count,
    payment,
    cost,
    beforePity,
    afterPity: next.pity,
    entries,
    at: new Date(now()).toISOString(),
    demoScenario: next.demoPrepared ?? null,
  };
  next.demoPrepared = null;
  next.lastResult = result;
  next.pendingResult = result;
  next.history.unshift(result);
  next.history = next.history.slice(0, MAX_HISTORY);
  return { ok: true, state: next, result };
}

export function finishAnimation(state) {
  if (!isValidState(state)) throw new TypeError('Invalid demo state');
  if (!state.pendingResult) return state;
  return { ...state, pendingResult: null };
}

export function grantTestResource(state, resource, amount = resource === 'crystals' ? 10000 : 10) {
  if (!isValidState(state)) throw new TypeError('Invalid demo state');
  if (resource !== 'crystals' && resource !== 'tickets') throw new RangeError('Unknown resource');
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(state[resource] + amount)) throw new RangeError('Invalid test amount');
  return { ...state, [resource]: state[resource] + amount };
}

export function setTestPity(state) {
  if (!isValidState(state)) throw new TypeError('Invalid demo state');
  return { ...state, pity: 79, forceNextG: false, demoPrepared: 'guarantee' };
}

export function forceTestG(state) {
  if (!isValidState(state)) throw new TypeError('Invalid demo state');
  return { ...state, forceNextG: true, demoPrepared: 'grand' };
}
