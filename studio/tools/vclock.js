// Injected before any page script when the recorder or shot.mjs captures a studio project frame by frame:
// performance.now, Date, requestAnimationFrame, setTimeout and setInterval follow a virtual time that only moves when
// the recorder calls window.__STUDIO_ADVANCE__(ms). CSS animations and transitions do not follow it, so studio
// projects animate everything from requestAnimationFrame.
(() => {
  let now = 0;
  const base = Date.now();
  const RealDate = Date;
  const raf = new Map();
  const timers = new Map();
  let ids = 0;
  window.__STUDIO_REAL_TIMEOUT__ = window.setTimeout.bind(window); // real time, for the kit's safety timeout
  performance.now = () => now;
  class VDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(base + now);
    }
    static now() {
      return base + now;
    }
  }
  window.Date = VDate;
  window.requestAnimationFrame = (cb) => {
    raf.set(++ids, cb);
    return ids;
  };
  window.cancelAnimationFrame = (id) => raf.delete(id);
  window.setTimeout = (cb, ms = 0, ...args) => {
    timers.set(++ids, { cb, at: now + Math.max(0, +ms || 0), args });
    return ids;
  };
  window.setInterval = (cb, ms = 0, ...args) => {
    const every = Math.max(1, +ms || 0);
    timers.set(++ids, { cb, at: now + every, every, args });
    return ids;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  const run = (fn, args) => {
    try {
      if (typeof fn === 'function') fn(...args);
    } catch (e) {
      console.error(e && e.stack ? e.stack : String(e));
    }
  };
  // Moves the clock by ms: due timers fire in order, then every requestAnimationFrame callback gets the new time.
  // Returns the real milliseconds the page spent, a measure of how heavy one frame is.
  window.__STUDIO_ADVANCE__ = (ms) => {
    const t0 = RealDate.now();
    const end = now + ms;
    for (let guard = 0; guard < 10000; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every;
      else timers.delete(id);
      run(t.cb, t.args);
    }
    now = end;
    const cbs = [...raf.values()];
    raf.clear();
    for (const cb of cbs) run(cb, [now]);
    return RealDate.now() - t0;
  };
})();
