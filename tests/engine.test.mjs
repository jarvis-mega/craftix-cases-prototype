import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, openCase, drawByOdds, setTestPity, forceTestG, finishAnimation, grantTestResource, STORAGE_KEY } from '../engine.mjs';
import { loadState, openAndPersist, finishPending, resetState } from '../storage.mjs';

const fixed = value => () => value;
function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
    map,
  };
}

test('shown odds map to exact cumulative boundaries', () => {
  const samples = [[0, 'R1'], [.499999, 'R1'], [.5, 'R2'], [.799999, 'R2'], [.8, 'R3'], [.949999, 'R3'], [.95, 'R4'], [.979999, 'R4'], [.98, 'G'], [.999999, 'G']];
  for (const [roll, expected] of samples) assert.equal(drawByOdds(fixed(roll)), expected, String(roll));
});

test('regular opening charges selected crystals and records reward', () => {
  const outcome = openCase(initialState(), { count: 1, payment: 'crystals', random: fixed(.2), now: () => 0 });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.state.crystals, 2400);
  assert.equal(outcome.state.tickets, 3);
  assert.equal(outcome.state.inventory.R1, 1);
  assert.equal(outcome.state.pity, 1);
  assert.deepEqual(outcome.result.entries.map(entry => entry.reward), ['R1']);
  assert.equal(outcome.state.pendingResult.id, outcome.result.id);
});

test('rewards stay in the pool, repetitions count twice', () => {
  const first = openCase(initialState(), { count: 1, payment: 'tickets', random: fixed(.1) });
  const second = openCase(first.state, { count: 1, payment: 'tickets', random: fixed(.1) });
  assert.equal(second.state.inventory.R1, 2);
  assert.equal(second.state.tickets, 1);
  assert.equal(second.state.history.length, 2);
});

test('early G immediately resets pity and other rewards do not', () => {
  let state = { ...initialState(), pity: 37 };
  state = openCase(state, { count: 1, payment: 'crystals', random: fixed(.98) }).state;
  assert.equal(state.pity, 0);
  state = openCase(state, { count: 1, payment: 'crystals', random: fixed(.8) }).state;
  assert.equal(state.pity, 1);
  assert.equal(state.inventory.G, 1);
});

test('80th non-G opening guarantees G without calling random', () => {
  const state = setTestPity(initialState());
  const result = openCase(state, { count: 1, payment: 'crystals', random: () => { throw Error('random should not run'); } });
  assert.equal(result.result.entries[0].reward, 'G');
  assert.equal(result.result.entries[0].source, 'guarantee');
  assert.equal(result.state.pity, 0);
});

test('guarantee inside 10 pack is sequential; later draws continue and can yield another G', () => {
  const state = { ...grantTestResource(initialState(), 'tickets'), pity: 77 };
  const rolls = [.1, .1, .98, .1, .1, .1, .1, .1, .1];
  let calls = 0;
  const outcome = openCase(state, { count: 10, payment: 'tickets', random: () => rolls[calls++] });
  assert.equal(calls, 9);
  assert.deepEqual(outcome.result.entries.map(entry => entry.reward), ['R1', 'R1', 'G', 'G', 'R1', 'R1', 'R1', 'R1', 'R1', 'R1']);
  assert.equal(outcome.result.entries[2].source, 'guarantee');
  assert.equal(outcome.result.entries[3].source, 'odds');
  assert.equal(outcome.state.pity, 6);
  assert.equal(outcome.state.inventory.G, 2);
});

test('insufficient selected resource rejects whole pack without state change or switch', () => {
  const state = initialState();
  const snapshot = structuredClone(state);
  const result = openCase(state, { count: 10, payment: 'tickets', random: () => { throw Error('should not draw'); } });
  assert.deepEqual(result, { ok: false, reason: 'insufficient', required: 10, available: 3 });
  assert.deepEqual(state, snapshot);
  assert.equal(state.crystals, 2500);
});

test('one-shot forced G is marked TEST, including when guarantee is also due', () => {
  let state = forceTestG(setTestPity(initialState()));
  const first = openCase(state, { count: 1, payment: 'crystals', random: () => { throw Error('should not draw'); } });
  assert.deepEqual(first.result.entries[0], { reward: 'G', source: 'test', guaranteeAlsoDue: true, pityAfter: 0 });
  assert.equal(first.state.forceNextG, false);
  const second = openCase(first.state, { count: 1, payment: 'crystals', random: fixed(.1) });
  assert.equal(second.result.entries[0].source, 'odds');
  assert.equal(second.state.pity, 1);
});

test('skip/finish changes presentation only, never rerolls or recharges', () => {
  const outcome = openCase(initialState(), { count: 1, payment: 'crystals', random: fixed(.98) });
  const finished = finishAnimation(outcome.state);
  assert.equal(finished.pendingResult, null);
  assert.deepEqual(finished.inventory, outcome.state.inventory);
  assert.deepEqual(finished.lastResult, outcome.result);
  assert.equal(finished.crystals, outcome.state.crystals);
});

test('reload reads committed snapshot; pending presentation does not duplicate grant or charge', () => {
  const storage = memoryStorage();
  const first = openAndPersist(storage, { count: 1, payment: 'crystals', random: fixed(.1) });
  assert.equal(first.ok, true);
  const reloaded = loadState(storage);
  assert.equal(reloaded.crystals, 2400);
  assert.equal(reloaded.inventory.R1, 1);
  assert.equal(reloaded.pendingResult.id, first.result.id);
  const finished = finishPending(storage);
  assert.equal(finished.crystals, 2400);
  assert.equal(loadState(storage).inventory.R1, 1);
  assert.equal(loadState(storage).history.length, 1);
  assert.equal(loadState(storage).pendingResult, null);
});

test('failed storage write leaves persisted balance and inventory unchanged', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(initialState()));
  storage.setItem = () => { throw Error('storage blocked'); };
  assert.throws(() => openAndPersist(storage, { count: 1, payment: 'crystals', random: fixed(.1) }), /storage blocked/);
  assert.equal(loadState(storage).crystals, 2500);
  assert.equal(loadState(storage).inventory.R1, 0);
});

test('full reset clears persisted demo', () => {
  const storage = memoryStorage();
  openAndPersist(storage, { count: 1, payment: 'crystals', random: fixed(.1) });
  const reset = resetState(storage);
  assert.deepEqual(reset, initialState());
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(loadState(storage), initialState());
});

test('corrupt nested persisted result is ignored safely on load', () => {
  const storage = memoryStorage();
  const broken = initialState();
  broken.history = [{ entries: [{ reward: '<img src=x onerror=alert(1)>' }] }];
  storage.setItem(STORAGE_KEY, JSON.stringify(broken));
  assert.deepEqual(loadState(storage), initialState());
});

test('demo funding sizes preserve case progress and selected result is marked once', () => {
  const base = setTestPity(initialState());
  const funded = grantTestResource(grantTestResource(base, 'crystals', 1000), 'tickets', 10);
  assert.equal(funded.crystals, 3500);
  assert.equal(funded.tickets, 13);
  assert.equal(funded.pity, 79);
  const opening = openCase(funded, { count: 1, payment: 'crystals' });
  assert.equal(opening.result.entries[0].source, 'guarantee');
  assert.equal(opening.result.demoScenario, 'guarantee');
  assert.equal(opening.state.demoPrepared, null);
  assert.equal(opening.state.crystals, 3400);
});
