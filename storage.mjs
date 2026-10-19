import { STORAGE_KEY, initialState, isValidState, openCase, finishAnimation } from './engine.mjs';

export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw);
    return isValidState(parsed) ? parsed : initialState();
  } catch {
    return initialState();
  }
}

export function saveState(storage, state) {
  if (!isValidState(state)) throw new TypeError('Invalid demo state');
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

// The result, charge, inventory, history and pending presentation are one storage write.
// Reload only reads this committed snapshot; it never replays an opening.
export function openAndPersist(storage, options) {
  const outcome = openCase(loadState(storage), options);
  if (outcome.ok) saveState(storage, outcome.state);
  return outcome;
}

export function updateAndPersist(storage, update) {
  const next = update(loadState(storage));
  return saveState(storage, next);
}

export function finishPending(storage) {
  return updateAndPersist(storage, finishAnimation);
}

export function resetState(storage) {
  storage.removeItem(STORAGE_KEY);
  return initialState();
}
