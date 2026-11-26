// Tiny event bus so pages refresh after a mutation (e.g. status update -> dashboard + timeline).
const listeners = new Set();

export const subscribeToChanges = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const emitDataChanged = (topic = 'incidents') => {
  listeners.forEach((fn) => {
    try {
      fn(topic);
    } catch {
      /* a failing listener must not break others */
    }
  });
};
