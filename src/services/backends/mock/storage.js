// localStorage wrapper that falls back to memory (used by Node tests / blocked storage).
const memory = new Map();

function ls() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const storage = {
  get(key) {
    try {
      const s = ls();
      const raw = s ? s.getItem(key) : memory.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      const s = ls();
      if (s) s.setItem(key, raw);
      else memory.set(key, raw);
    } catch {
      memory.set(key, raw);
    }
  },
  remove(key) {
    try {
      const s = ls();
      if (s) s.removeItem(key);
    } catch {
      /* ignore */
    }
    memory.delete(key);
  },
};
