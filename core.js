export const POLICIES = Object.freeze(['FIFO', 'LRU', 'CLOCK', 'OPT']);
export const examples = Object.freeze({
  anomaly: '1 2 3 4 1 2 5 1 2 3 4 5',
  locality: '1 2 1 2 3 1 2 4 1 2 5 1 2 6 1 2',
  writes: '1w 2w 3 1 4w 2 5 1w 2 3 4 5w',
});

export function parseTrace(text) {
  if (typeof text !== 'string' || text.length > 12000)
    throw Error('Trace must be text of at most 12,000 characters.');
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (!tokens.length || tokens.length > 1000)
    throw Error('Enter between 1 and 1,000 page accesses.');
  return tokens.map((token, i) => {
    if (!/^(?:0|[1-9]\d{0,3})[rw]?$/i.test(token))
      throw Error(`Access ${i + 1}: use a page from 0 to 9999, optionally followed by r or w.`);
    return { page: Number(token.replace(/[rw]$/i, '')), write: /w$/i.test(token) };
  });
}

function validate(trace, capacity, policy) {
  if (
    !Array.isArray(trace) ||
    !trace.length ||
    trace.length > 1000 ||
    trace.some(
      (a) =>
        !a ||
        !Number.isInteger(a.page) ||
        a.page < 0 ||
        a.page > 9999 ||
        typeof a.write !== 'boolean',
    )
  )
    throw Error('Invalid access trace.');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 16)
    throw Error('Choose between 1 and 16 frames.');
  if (!POLICIES.includes(policy)) throw Error('Unknown replacement policy.');
}

// Demand paging: every miss loads its page. Dirty evictions write back once.
// OPT minimizes faults, not writebacks; ties choose the lowest frame index.
export function simulate(trace, capacity, policy, { capture = true } = {}) {
  validate(trace, capacity, policy);
  const frames = Array(capacity).fill(null),
    steps = [];
  let hand = 0,
    faults = 0,
    hits = 0,
    writebacks = 0;
  const future = new Map();
  for (let i = trace.length - 1; i >= 0; i--) {
    if (!future.has(trace[i].page)) future.set(trace[i].page, []);
    future.get(trace[i].page).push(i);
  }
  for (let i = 0; i < trace.length; i++) {
    const access = trace[i];
    future.get(access.page).pop();
    let slot = frames.findIndex((f) => f?.page === access.page),
      evicted = null;
    const hit = slot !== -1,
      scanned = [];
    let reason;
    if (hit) {
      hits++;
      reason = `Page ${access.page} is already resident in frame ${slot + 1}.`;
      frames[slot].used = i;
      frames[slot].referenced = true;
      frames[slot].dirty ||= access.write;
    } else {
      faults++;
      slot = frames.findIndex((f) => f === null);
      if (slot !== -1) {
        reason = `Load page ${access.page} into empty frame ${slot + 1}.`;
      } else {
        if (policy === 'FIFO') {
          slot = frames.reduce((best, f, k) => (f.loaded < frames[best].loaded ? k : best), 0);
          reason = 'Evict the page loaded earliest; hits do not change arrival order.';
        } else if (policy === 'LRU') {
          slot = frames.reduce((best, f, k) => (f.used < frames[best].used ? k : best), 0);
          reason = 'Evict the page whose most recent access is oldest.';
        } else if (policy === 'OPT') {
          let farthest = -1;
          for (let k = 0; k < frames.length; k++) {
            const positions = future.get(frames[k].page);
            const next = positions?.length ? positions[positions.length - 1] : Infinity;
            if (next > farthest) {
              farthest = next;
              slot = k;
            }
          }
          reason = 'Evict the page used farthest in the future (never again counts as infinity).';
        } else {
          while (frames[hand].referenced) {
            scanned.push(hand);
            frames[hand].referenced = false;
            hand = (hand + 1) % capacity;
          }
          slot = hand;
          reason = `Clear ${scanned.length} reference bit${scanned.length === 1 ? '' : 's'}, then evict at the clock hand.`;
        }
        evicted = { ...frames[slot] };
        if (evicted.dirty) writebacks++;
      }
      frames[slot] = {
        page: access.page,
        dirty: access.write,
        referenced: true,
        loaded: i,
        used: i,
      };
      if (policy === 'CLOCK') hand = (slot + 1) % capacity;
    }
    if (capture)
      steps.push({
        index: i,
        access: { ...access },
        hit,
        slot,
        evicted,
        reason,
        scanned,
        frames: frames.map((f) => f && { ...f }),
        hand: policy === 'CLOCK' ? hand : null,
        totals: { hits, faults, writebacks },
      });
  }
  return {
    policy,
    capacity,
    accesses: trace.length,
    hits,
    faults,
    writebacks,
    dirtyResident: frames.filter((f) => f?.dirty).length,
    steps,
  };
}

export function capacitySweep(trace, maximum = 12) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 16)
    throw Error('Sweep maximum must be 1–16.');
  return Array.from({ length: maximum }, (_, i) => {
    const capacity = i + 1;
    return {
      capacity,
      results: Object.fromEntries(
        POLICIES.map((policy) => [
          policy,
          simulate(trace, capacity, policy, { capture: false }).faults,
        ]),
      ),
    };
  });
}

export function analyze(text, capacity) {
  const trace = parseTrace(text);
  const results = Object.fromEntries(
    POLICIES.map((policy) => [policy, simulate(trace, capacity, policy)]),
  );
  const sweep = capacitySweep(trace, Math.max(12, capacity));
  return { format: 'frame-garden-v1', trace, capacity, results, sweep };
}
