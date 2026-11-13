import { analyze, examples, POLICIES } from './core.js';
const $ = (id) => document.getElementById(id);
const notes = {
  FIFO: 'First in, first out. A hit does not refresh a page’s place in line.',
  LRU: 'Least recently used. Every access refreshes the page’s recency.',
  CLOCK: 'Second chances. The hand skips pages with a set reference bit, clearing it on the way.',
  OPT: 'Offline optimum. Knows future accesses and minimizes faults, not writebacks.',
};
let report = null,
  position = 0,
  timer = null,
  revision = 0;
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = error ? 'error' : '';
}
function stop() {
  clearInterval(timer);
  timer = null;
  $('play').textContent = 'Play';
}
function invalidate() {
  revision++;
  stop();
  report = null;
  position = 0;
  render();
  notice('Inputs changed. Analyze the trace to update results.');
}
function build() {
  revision++;
  stop();
  try {
    const next = analyze($('trace').value, Number($('capacity').value));
    report = next;
    position = 0;
    renderAccesses();
    render();
    notice(`Analyzed ${report.trace.length} accesses across four policies.`);
  } catch (error) {
    report = null;
    position = 0;
    render();
    notice(error.message, true);
  }
}
function render() {
  const ready = !!report,
    policy = $('policy').value;
  $('policy-note').textContent = notes[policy];
  for (const id of ['export-report', 'position', 'play', 'back', 'next']) $(id).disabled = !ready;
  $('export-trace').disabled = !$('trace').value.trim();
  $('position').max = report?.trace.length ?? 0;
  $('position').value = position;
  $('position-label').textContent = `${position} / ${report?.trace.length ?? 0}`;
  if (!ready) {
    $('accesses').replaceChildren();
    $('frames').replaceChildren();
    $('results').replaceChildren();
    $('sweep').replaceChildren();
    $('anomalies').textContent = '';
    $('outcome').textContent = 'ANALYSIS PENDING';
    $('explanation').textContent = 'Analyze a trace to inspect memory.';
    $('eviction').textContent = '';
    for (const id of ['hits', 'faults', 'writes']) $(id).textContent = '—';
    return;
  }
  for (const button of $('accesses').children)
    button.setAttribute('aria-current', String(Number(button.dataset.position) === position));
  const active = $('accesses').querySelector('[aria-current="true"]');
  if (active) {
    const box = $('accesses').getBoundingClientRect(),
      item = active.getBoundingClientRect();
    if (item.left < box.left) $('accesses').scrollLeft += item.left - box.left;
    else if (item.right > box.right) $('accesses').scrollLeft += item.right - box.right;
  }
  const result = report.results[policy],
    step = result.steps[position - 1],
    frames = step?.frames ?? Array(report.capacity).fill(null);
  $('back').disabled = position === 0;
  $('next').disabled = position === report.trace.length;
  $('frames').innerHTML = frames
    .map(
      (f, i) =>
        `<div class="frame ${f ? 'occupied' : ''} ${f?.dirty ? 'dirty' : ''} ${step?.slot === i ? 'active' : ''} ${policy === 'CLOCK' && (step?.hand ?? 0) === i ? 'hand' : ''}"><small>FRAME ${i + 1}</small><span class="page-number">${f?.page ?? '·'}</span><span class="frame-meta">${f ? (f.dirty ? 'DIRTY' : 'CLEAN') + (policy === 'CLOCK' ? ` / R=${Number(f.referenced)}` : '') : 'EMPTY'}</span></div>`,
    )
    .join('');
  $('outcome').textContent = step
    ? `${step.access.write ? 'WRITE' : 'READ'} PAGE ${step.access.page} / ${step.hit ? 'HIT' : 'PAGE FAULT'}`
    : 'EMPTY MEMORY';
  $('explanation').textContent =
    step?.reason ?? 'Every frame starts empty. Step forward to bring the first page into memory.';
  $('eviction').textContent = step?.evicted
    ? `Page ${step.evicted.page} evicted${step.evicted.dirty ? ' → one dirty-page writeback.' : '; no writeback needed.'}`
    : step
      ? 'No page was evicted.'
      : '';
  $('hits').textContent = step?.totals.hits ?? 0;
  $('faults').textContent = step?.totals.faults ?? 0;
  $('writes').textContent = step?.totals.writebacks ?? 0;
  $('results').innerHTML = POLICIES.map((p) => {
    const r = report.results[p];
    return `<article class="result"><h3>${p === 'OPT' ? 'Offline optimum' : p === 'CLOCK' ? 'Clock' : p}</h3><strong>${r.faults}</strong> <span class="help">faults</span><meter min="0" max="${r.accesses}" value="${r.hits}" aria-label="${p} hits out of ${r.accesses} accesses">${r.hits}</meter><p>${r.hits} hits · ${((100 * r.hits) / r.accesses).toFixed(1)}% hit rate<br>${r.writebacks} writebacks · ${r.dirtyResident} dirty resident</p></article>`;
  }).join('');
  const anomalies = [];
  $('sweep').innerHTML = report.sweep
    .map(
      (row, i) =>
        `<tr class="${row.capacity === report.capacity ? 'selected' : ''}"><th scope="row">${row.capacity}</th>${POLICIES.map(
          (p) => {
            const worse = i > 0 && row.results[p] > report.sweep[i - 1].results[p];
            if (worse)
              anomalies.push(
                `${p}: ${i} → ${i + 1} frames increases faults from ${report.sweep[i - 1].results[p]} to ${row.results[p]}.`,
              );
            return `<td class="${worse ? 'worse' : ''}">${row.results[p]}${worse ? ' ↑' : ''}</td>`;
          },
        ).join('')}</tr>`,
    )
    .join('');
  $('anomalies').textContent = anomalies.length
    ? anomalies.join(' ')
    : 'No fault increases appear in this capacity range for this trace.';
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('experiment').addEventListener('submit', (event) => {
  event.preventDefault();
  build();
  if (report) $('workload-panel').close();
});
for (const id of ['trace', 'capacity']) $(id).addEventListener('input', invalidate);
$('sample').addEventListener('change', () => {
  $('trace').value = examples[$('sample').value];
  build();
});
$('policy').addEventListener('change', () => {
  stop();
  render();
});
$('back').addEventListener('click', () => {
  stop();
  position = Math.max(0, position - 1);
  render();
});
$('next').addEventListener('click', () => {
  stop();
  position = Math.min(report.trace.length, position + 1);
  render();
});
$('position').addEventListener('input', () => {
  stop();
  position = Number($('position').value);
  render();
});
$('play').addEventListener('click', () => {
  if (timer) {
    stop();
    return;
  }
  if (!report) return;
  if (position === report.trace.length) position = 0;
  $('play').textContent = 'Pause';
  timer = setInterval(() => {
    if (!report) {
      stop();
      return;
    }
    position++;
    if (position >= report.trace.length) stop();
    render();
  }, 700);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});
$('export-trace').addEventListener('click', () =>
  download('page-trace.txt', $('trace').value, 'text/plain'),
);
$('export-report').addEventListener('click', () => {
  if (report) download('frame-analysis.json', JSON.stringify(report, null, 2), 'application/json');
});
$('import').addEventListener('change', async () => {
  const file = $('import').files[0];
  $('import').value = '';
  if (!file) return;
  const current = ++revision;
  stop();
  try {
    if (file.size > 48000) throw Error('Trace file exceeds 48 KB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    const candidate = analyze(text, Number($('capacity').value));
    if (current !== revision) return;
    $('trace').value = text;
    report = candidate;
    position = 0;
    renderAccesses();
    render();
    notice('Trace imported and analyzed.');
  } catch (error) {
    if (current === revision)
      notice('Import failed: ' + error.message + ' Current analysis is unchanged.', true);
  }
});
build();

function renderAccesses() {
  $('accesses').replaceChildren(
    ...report.trace.map((access, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.position = i + 1;
      button.textContent = String(access.page) + (access.write ? 'w' : '');
      button.setAttribute(
        'aria-label',
        `Access ${i + 1}: ${access.write ? 'write' : 'read'} page ${access.page}`,
      );
      button.onclick = () => {
        stop();
        position = i + 1;
        render();
      };
      return button;
    }),
  );
}
$('workload-open').onclick = () => {
  stop();
  $('workload-panel').showModal();
};
$('workload-close').onclick = () => $('workload-panel').close();
