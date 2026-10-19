import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIZES, COSTS, STORAGE_KEY, createState, beginSpin, revealSpin, nextCost,
  remainingTotal, probabilities, pauseSet, resumeSet, addCrystals,
  setDraftMode, newDemoSet, saveState, loadState, isValidState,
} from '../roulette/engine.js';

function spin(state, rng = () => 0) {
  const result = beginSpin(state, rng);
  assert.equal(result.error, null);
  return revealSpin(result.state);
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test('finite set never repeats; probabilities track 4, 3, 2, 1 equal sectors', () => {
  let state = createState();
  const odds = [0.25, 1 / 3, 0.5, 1];
  for (let turn = 0; turn < 4; turn++) {
    const values = Object.values(probabilities(state));
    assert.equal(values.length, 4 - turn);
    values.forEach(value => assert.equal(value, odds[turn]));
    state = spin(state, () => 0);
    assert.equal(new Set(state.won).size, turn + 1);
    assert.equal(state.remaining.length, 3 - turn);
  }
  assert.deepEqual(new Set(state.won), new Set(PRIZES.map(prize => prize.id)));
  assert.deepEqual(probabilities(state), {});
});

test('prices advance 100/200/400/800, total 1500, balance and remaining cost agree', () => {
  let state = createState();
  assert.equal(remainingTotal(state), 1500);
  for (const [index, cost] of COSTS.entries()) {
    assert.equal(nextCost(state), cost);
    state = spin(state);
    assert.equal(state.spent, COSTS.slice(0, index + 1).reduce((a, b) => a + b, 0));
    assert.equal(state.balance, 1500 - state.spent);
    assert.equal(remainingTotal(state), COSTS.slice(index + 1).reduce((a, b) => a + b, 0));
  }
  assert.equal(state.spent, 1500);
  assert.equal(state.balance, 0);
  assert.equal(nextCost(state), 0);
  assert.equal(beginSpin(state).error, 'complete');
});

test('G first is explicit script; early G can pause and resume with remaining prizes intact', () => {
  let state = createState({ mode: 'g-first' });
  state = spin(state, () => .99);
  assert.equal(state.won[0], 'G');
  assert.equal(state.remaining.length, 3);
  state = pauseSet(state);
  assert.equal(beginSpin(state).error, 'paused');
  state = resumeSet(state);
  state = spin(state);
  assert.equal(state.won.length, 2);
  assert.equal(state.won.filter(id => id === 'G').length, 1);
});

test('G last script excludes G until the fourth spin', () => {
  let state = createState({ mode: 'g-last' });
  for (let i = 0; i < 3; i++) {
    state = spin(state, () => .99);
    assert.notEqual(state.won.at(-1), 'G');
  }
  assert.deepEqual(state.remaining, ['G']);
  state = spin(state);
  assert.equal(state.won.at(-1), 'G');
});

test('insufficient funds never charges or selects a result; adding crystals enables spin', () => {
  let state = createState({ balance: 99 });
  const original = structuredClone(state);
  const result = beginSpin(state);
  assert.equal(result.error, 'insufficient-funds');
  assert.deepEqual(result.state, original);
  state = addCrystals(state);
  assert.equal(state.balance, 10099);
  assert.equal(beginSpin(state).error, null);
});

test('rapid duplicate spin requests charge once while result is pending', () => {
  const first = beginSpin(createState(), () => .75);
  assert.equal(first.state.balance, 1400);
  const second = beginSpin(first.state, () => 0);
  assert.equal(second.error, 'spin-in-progress');
  assert.strictEqual(second.state, first.state);
  assert.equal(second.state.spent, 100);
  const revealed = revealSpin(second.state);
  assert.equal(revealed.won.length, 1);
  assert.deepEqual(revealSpin(revealed), revealed);
});

test('reload retains pending chosen result and charge, then reveal cannot duplicate it', () => {
  const storage = memoryStorage();
  const chosen = beginSpin(createState(), () => .99).state;
  assert.equal(chosen.pending.prizeId, 'G');
  saveState(storage, chosen);
  const restored = loadState(storage);
  assert.deepEqual(restored, chosen);
  assert.equal(beginSpin(restored).error, 'spin-in-progress');
  const final = revealSpin(restored);
  saveState(storage, final);
  assert.deepEqual(loadState(storage), final);
  assert.equal(final.balance, 1400);
  assert.equal(final.spent, 100);
  assert.equal(final.won[0], 'G');
  assert.equal(final.remaining.includes('G'), false);
});

test('new demo cycle uses selected scenario and restores demo balance', () => {
  let state = spin(createState());
  state = setDraftMode(state, 'g-last');
  state = newDemoSet(state);
  assert.equal(state.cycle, 2);
  assert.equal(state.balance, 1500);
  assert.equal(state.spent, 0);
  assert.deepEqual(state.won, []);
  assert.equal(state.mode, 'g-last');
});

test('invalid saved partition is rejected without resurrecting from a valid save', () => {
  const storage = memoryStorage();
  let state = spin(createState());
  saveState(storage, state);
  assert.deepEqual(loadState(storage).won, state.won);
  const corrupt = { ...state, remaining: [...state.remaining, state.won[0]] };
  assert.equal(isValidState(corrupt), false);
  storage.setItem(STORAGE_KEY, JSON.stringify(corrupt));
  assert.deepEqual(loadState(storage), createState());
});

test('demo funding sizes preserve roulette partition and final scenario remains valid', () => {
  const base = createState();
  const funded = addCrystals(base, 5000);
  assert.equal(funded.balance, 6500);
  assert.deepEqual(funded.remaining, base.remaining);
  const final = { ...createState({ mode: 'g-last' }), won: ['R1', 'R2', 'R3'], remaining: ['G'], balance: 800, spent: 700, demoScenario: 'last' };
  assert.equal(isValidState(final), true);
  assert.equal(beginSpin(final).state.pending.prizeId, 'G');
  assert.equal(beginSpin(final).state.pending.cost, 800);
});
