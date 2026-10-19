import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, freshState, isValidState, loadState, saveState, chooseGain, attempt, collect, selectPayment, addResources, setFragments98, forceNextGain } from '../fragments/engine.mjs';

function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

test('80/18/2 probability cutoffs and no zero', () => {
  assert.equal(chooseGain(() => 0), 2);
  assert.equal(chooseGain(() => .799999), 2);
  assert.equal(chooseGain(() => .8), 5);
  assert.equal(chooseGain(() => .979999), 5);
  assert.equal(chooseGain(() => .98), 20);
  assert.equal(chooseGain(() => .999999), 20);
});

test('exact threshold blocks attempt and separate collection deducts exactly 100', () => {
  let s = setFragments98(freshState());
  s = attempt(s, () => 0).state;
  assert.equal(s.fragments, 100);
  assert.equal(s.crystals, 1400);
  assert.equal(attempt(s).error, 'collect-first');
  const result = collect(s, 'g-1');
  assert.equal(result.state.fragments, 0);
  assert.equal(result.state.g, 1);
  assert.equal(result.state.attempts, 1);
  assert.equal(result.state.crystalsSpent, 100);
  assert.equal(attempt(result.state, () => 0).error, null);
});

test('overshoot is uncapped and repeatable leftovers can keep collection primary', () => {
  let s = { ...freshState(), fragments: 199 };
  s = collect(s, 'g-1').state;
  assert.equal(s.fragments, 99);
  assert.equal(s.g, 1);
  s = attempt(s, () => .99).state;
  assert.equal(s.fragments, 119);
  s = collect(s, 'g-2').state;
  assert.equal(s.fragments, 19);
  assert.equal(s.g, 2);
  const artificialLarge = { ...s, fragments: 220 };
  const collected = collect(artificialLarge, 'g-3').state;
  assert.equal(collected.fragments, 120);
  assert.equal(collect(collected, 'g-4').state.fragments, 20);
});

test('permanent collection closes target and converts only leftover at 1:1', () => {
  let s = setFragments98(freshState('permanent'));
  s = forceNextGain(s, 20);
  s = attempt(s).state;
  assert.equal(s.fragments, 118);
  const result = collect(s, 'g-1');
  assert.deepEqual(result.receipt, { id: 'g-1', before: 118, leftover: 18, converted: 18, demo: false });
  assert.equal(result.state.fragments, 0);
  assert.equal(result.state.d, 18);
  assert.equal(result.state.g, 1);
  assert.equal(result.state.closed, true);
  assert.equal(attempt(result.state).error, 'closed');
  assert.equal(collect(result.state, 'g-2').error, 'closed');
});

test('explicit payment never switches on insufficient funds', () => {
  let s = { ...freshState(), crystals: 0, tickets: 3 };
  const first = attempt(s);
  assert.equal(first.error, 'insufficient-funds');
  assert.equal(first.state, s);
  s = selectPayment(s, 'ticket');
  s = attempt(s, () => 0).state;
  assert.equal(s.tickets, 2);
  assert.equal(s.crystals, 0);
  assert.equal(s.ticketsUsed, 1);
  assert.equal(s.crystalsSpent, 0);
  s = { ...s, tickets: 0, crystals: 500 };
  assert.equal(attempt(s).error, 'insufficient-funds');
  assert.equal(s.payment, 'ticket');
});

test('50 attempts from zero guarantee threshold with enough resources', () => {
  let s = addResources(freshState(), 'crystals');
  for (let i = 0; i < 50; i++) s = attempt(s, () => 0).state;
  assert.equal(s.fragments, 100);
  assert.equal(s.attempts, 50);
  assert.equal(attempt(s).error, 'collect-first');
});

test('save/load preserves full state incl mode, payment, history and forced result', () => {
  const storage = memoryStorage();
  let s = selectPayment(freshState('permanent'), 'ticket');
  s = forceNextGain(s, 5);
  saveState(storage, s);
  assert.deepEqual(loadState(storage), { state: s, recovered: false });
  s = attempt(s).state;
  saveState(storage, s);
  assert.deepEqual(loadState(storage).state, s);
  assert.equal(s.history[0].forced, true);
  assert.equal(s.history[0].payment, 'ticket');
});

test('duplicate collection ID cannot deduct twice or award twice', () => {
  const ready = { ...freshState(), fragments: 200 };
  const once = collect(ready, 'click-1').state;
  const twice = collect(once, 'click-1');
  assert.equal(twice.duplicate, true);
  assert.equal(twice.state, once);
  assert.equal(once.fragments, 100);
  assert.equal(once.g, 1);
  assert.equal(collect(once, 'click-2').state.g, 2); // a separate deliberate collection remains possible
});

test('corrupt storage recovers, and invalid state is not saved', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{broken');
  assert.equal(loadState(storage).recovered, true);
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...freshState(), fragments: -2 }));
  assert.equal(loadState(storage).recovered, true);
  assert.equal(isValidState(freshState()), true);
  assert.throws(() => saveState(storage, { ...freshState(), g: 1 }));
});

test('demo funding and assembly metadata preserve fragment accounting', () => {
  const base = setFragments98(freshState());
  const funded = addResources(base, 'crystals', 1000);
  assert.equal(funded.crystals, 2500);
  assert.equal(funded.fragments, 98);
  const ready = { ...funded, fragments: 105, demoPrepared: 'assembly' };
  const result = collect(ready, 'demo-assembly');
  assert.equal(result.receipt.demo, true);
  assert.equal(result.state.fragments, 5);
  assert.equal(result.state.demoPrepared, null);
  assert.equal(isValidState(result.state), true);
});
