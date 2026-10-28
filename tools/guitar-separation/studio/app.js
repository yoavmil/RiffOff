// RiffOff Studio front end: queue + clip editor. Talks to studio.py on localhost.

const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

const fmt = (t) => {
  if (!Number.isFinite(t)) return '';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};
const parseTime = (text) => {
  const parts = String(text).trim().split(':');
  if (!parts.length || parts.some((p) => p !== '' && !/^\d*\.?\d*$/.test(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + (parseFloat(p) || 0), 0);
};
const songName = (job) => (job.meta ? `${job.meta.artist} – ${job.meta.title}` : job.source);

// ------------------------------------------------------------------ queue

let jobs = [];
let selectedId = null;
const openLogs = new Set(); // failed jobs whose log is expanded (survives re-renders)
const ORDER = { running: 0, ready: 1, queued: 2, failed: 3, saved: 4 };

async function refresh() {
  try {
    const data = await api('/api/jobs');
    jobs = data.jobs;
    $('playlist-size').textContent = `Private playlist: ${data.playlistSize} song${data.playlistSize === 1 ? '' : 's'}`;
    renderQueue();
    const selected = jobs.find((j) => j.id === selectedId);
    if (selectedId && (!selected || selected.status !== 'ready')) closeEditor();
  } catch {
    $('playlist-size').textContent = 'Studio server is not responding. Is studio.py running?';
  }
}

function renderQueue() {
  const list = $('queue');
  list.replaceChildren();
  $('queue-empty').hidden = jobs.length > 0;
  const sorted = [...jobs].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.added - b.added);
  for (const job of sorted) {
    const li = document.createElement('li');
    li.className = `job is-${job.status}${job.id === selectedId ? ' is-selected' : ''}`;

    const name = document.createElement('div');
    name.className = 'job-name';
    name.dir = 'auto';
    const chip = document.createElement('span');
    chip.className = `chip ${job.status}`;
    chip.textContent = job.status;
    name.append(chip, songName(job));

    const actions = document.createElement('div');
    actions.className = 'job-actions';
    if (job.status === 'failed') actions.append(button('Retry', () => api(`/api/jobs/${job.id}/retry`, {}).then(refresh)));
    if (job.status === 'saved') {
      actions.append(button('Hide', () => api(`/api/jobs/${job.id}/discard`, {}).then(refresh)));
    } else {
      actions.append(button('Give up', () => giveUp(job), 'danger ghost'));
    }

    const sub = document.createElement('div');
    sub.className = 'job-sub';
    if (job.status === 'running') sub.textContent = `${job.step || 'Working'}… ${job.log.at(-1) ?? ''}`;
    else if (job.status === 'queued') sub.textContent = 'Waiting for its turn';
    else if (job.status === 'ready') sub.textContent = 'Ready: click to mark the clip';
    else if (job.status === 'saved') sub.textContent = `In the playlist as ${job.savedAs}`;
    else if (job.status === 'failed') {
      sub.textContent = job.error || 'Failed';
      sub.classList.add('is-error');
    }

    li.append(name, actions, sub);
    if (job.status === 'failed' && job.log?.length) {
      const details = document.createElement('details');
      details.className = 'job-log';
      details.open = openLogs.has(job.id);
      details.addEventListener('toggle', () => (details.open ? openLogs.add(job.id) : openLogs.delete(job.id)));
      const summary = document.createElement('summary');
      summary.textContent = 'Show log';
      const pre = document.createElement('pre');
      pre.textContent = job.log.slice(-15).join('\n');
      details.append(summary, pre);
      li.append(details);
    }
    if (job.status === 'ready') li.addEventListener('click', (e) => !e.target.closest('button') && openEditor(job));
    list.append(li);
  }
}

function button(label, onClick, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = className;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

async function giveUp(job) {
  const what = job.status === 'running' ? 'This stops the separation and deletes its files.' : 'Its prepared files are deleted.';
  if (!confirm(`Give up on “${songName(job)}”? ${what}`)) return;
  if (job.id === selectedId) closeEditor();
  await api(`/api/jobs/${job.id}/discard`, {});
  refresh();
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sources = $('sources').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!sources.length) return;
  try {
    const { added, skipped } = await api('/api/jobs', { sources, language: $('add-language').value });
    $('add-message').textContent = `Added ${added}${skipped ? `, skipped ${skipped} already in the queue` : ''}.`;
    $('sources').value = '';
    refresh();
  } catch (err) {
    $('add-message').textContent = `Could not add: ${err.message}`;
  }
});

// ----------------------------------------------------------------- player

const ctx = new AudioContext();
let buffer = null;
let source = null;
let startedAt = 0; // ctx time corresponding to position 0 of the current source
let pausedAt = 0;
let clipMode = false;
let clip = { start: 0, end: 0 };
let peaks = null;

const playing = () => source !== null;
const position = () => (playing() ? ctx.currentTime - startedAt : pausedAt);

function stop() {
  if (source) {
    pausedAt = Math.min(position(), buffer?.duration ?? 0);
    if (clipMode && $('loop').checked) pausedAt = clip.start + ((pausedAt - clip.start) % (clip.end - clip.start));
    source.onended = null;
    source.stop();
    source = null;
  }
  clipMode = false;
  syncButtons();
}

function play(from, clipOnly = false) {
  if (!buffer) return;
  stop();
  ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  clipMode = clipOnly;
  if (clipOnly && $('loop').checked) {
    src.loop = true;
    src.loopStart = clip.start;
    src.loopEnd = clip.end;
    src.start(0, clip.start);
    from = clip.start;
  } else if (clipOnly) {
    src.start(0, clip.start, clip.end - clip.start);
    from = clip.start;
  } else {
    src.start(0, from);
  }
  startedAt = ctx.currentTime - from;
  src.onended = () => {
    if (source !== src) return;
    pausedAt = clipOnly ? clip.end : buffer.duration;
    source = null;
    clipMode = false;
    syncButtons();
  };
  source = src;
  syncButtons();
}

function syncButtons() {
  $('play').textContent = playing() && !clipMode ? '❚❚ Pause' : '▶ Play';
  $('play-clip').textContent = playing() && clipMode ? '■ Stop clip' : '▶ Play clip';
}

$('play').addEventListener('click', () => (playing() && !clipMode ? stop() : play(pausedAt >= (buffer?.duration ?? 0) ? 0 : pausedAt)));
$('play-clip').addEventListener('click', () => (playing() && clipMode ? stop() : play(clip.start, true)));
$('loop').addEventListener('change', () => playing() && clipMode && play(clip.start, true));

// --------------------------------------------------------------- waveform

const canvas = $('wave');
const g = canvas.getContext('2d');

function computePeaks(width) {
  const data = buffer.getChannelData(0);
  const other = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const step = Math.max(1, Math.floor(data.length / width));
  const out = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let max = 0;
    const end = Math.min(data.length, (x + 1) * step);
    for (let i = x * step; i < end; i += 4) {
      const v = Math.abs(other ? (data[i] + other[i]) / 2 : data[i]);
      if (v > max) max = v;
    }
    out[x] = max;
  }
  return out;
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    peaks = null;
  }
  g.clearRect(0, 0, w, h);
  if (!buffer) return;
  if (!peaks || peaks.length !== w) peaks = computePeaks(w);

  const toX = (t) => (t / buffer.duration) * w;
  const x0 = toX(clip.start);
  const x1 = toX(clip.end);
  g.fillStyle = 'rgba(255, 173, 51, 0.16)';
  g.fillRect(x0, 0, x1 - x0, h);

  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const inClip = x >= x0 && x <= x1;
    g.fillStyle = inClip ? '#ffad33' : '#6d5c45';
    const amp = Math.max(1, peaks[x] * mid * 0.95);
    g.fillRect(x, mid - amp, 1, amp * 2);
  }

  g.fillStyle = '#ffcf6e';
  g.fillRect(x0 - dpr, 0, 2 * dpr, h);
  g.fillRect(x1 - dpr, 0, 2 * dpr, h);

  // second ticks every 10 s
  g.fillStyle = 'rgba(243, 231, 201, 0.35)';
  g.font = `${11 * dpr}px system-ui`;
  for (let t = 0; t < buffer.duration; t += 10) {
    const x = toX(t);
    g.fillRect(x, h - 6 * dpr, dpr, 6 * dpr);
    if (t % 30 === 0) g.fillText(fmt(t).replace('.0', ''), x + 3 * dpr, h - 8 * dpr);
  }

  g.fillStyle = '#ffffff';
  g.fillRect(toX(position()) - dpr / 2, 0, dpr, h);
}

function tick() {
  if (buffer) {
    draw();
    $('time').textContent = `${fmt(position())} / ${fmt(buffer.duration)}`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const timeAt = (e) => {
  const r = canvas.getBoundingClientRect();
  return Math.min(buffer.duration, Math.max(0, ((e.clientX - r.left) / r.width) * buffer.duration));
};

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!buffer) return;
  canvas.setPointerCapture(e.pointerId);
  const t = timeAt(e);
  const near = (v) => Math.abs(v - t) < (8 / canvas.clientWidth) * buffer.duration;
  drag = { anchor: t, x: e.clientX, moved: false, edge: near(clip.start) ? 'start' : near(clip.end) ? 'end' : null };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
  if (!drag.moved) return;
  const t = timeAt(e);
  if (drag.edge === 'start') setClip(Math.min(t, clip.end - 0.1), clip.end);
  else if (drag.edge === 'end') setClip(clip.start, Math.max(t, clip.start + 0.1));
  else setClip(Math.min(drag.anchor, t), Math.max(drag.anchor, t));
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    const t = timeAt(e);
    if (playing() && !clipMode) play(t);
    else {
      stop();
      pausedAt = t;
    }
  } else if (playing() && clipMode) {
    play(clip.start, true);
  }
  drag = null;
});
window.addEventListener('resize', () => (peaks = null));

// ------------------------------------------------------------------ marks

function setClip(start, end) {
  if (!buffer) return;
  start = Math.max(0, Math.min(start, buffer.duration));
  end = Math.max(0, Math.min(end, buffer.duration));
  clip = { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
  $('start').value = fmt(clip.start);
  $('end').value = fmt(clip.end);
  const len = clip.end - clip.start;
  $('clip-length').textContent = len > 0 ? `Clip length ${fmt(len)} (${len.toFixed(1)} s)` : 'Mark a clip: start must be before end';
}

for (const id of ['start', 'end']) {
  $(id).addEventListener('change', () => {
    const t = parseTime($(id).value);
    if (Number.isNaN(t)) return setClip(clip.start, clip.end);
    id === 'start' ? setClip(t, clip.end) : setClip(clip.start, t);
  });
}
document.querySelectorAll('[data-nudge]').forEach((b) =>
  b.addEventListener('click', () => {
    const [which, delta] = b.dataset.nudge.split(':');
    which === 'start' ? setClip(clip.start + Number(delta), clip.end) : setClip(clip.start, clip.end + Number(delta));
  }),
);
$('set-start').addEventListener('click', () => setClip(position(), Math.max(clip.end, position() + 1)));
$('set-end').addEventListener('click', () => setClip(Math.min(clip.start, position() - 1), position()));

document.addEventListener('keydown', (e) => {
  if (!buffer || $('editor').hidden || e.target.closest('input, textarea, select')) return;
  if (e.key === ' ') {
    e.preventDefault();
    $('play').click();
  } else if (e.key === '[') $('set-start').click();
  else if (e.key === ']') $('set-end').click();
  else if (e.key === 'c' || e.key === 'C') $('play-clip').click();
});

// ----------------------------------------------------------------- editor

let loadToken = 0;

async function openEditor(job) {
  if (job.id === selectedId) return;
  stop();
  selectedId = job.id;
  buffer = null;
  peaks = null;
  pausedAt = 0;
  renderQueue();
  $('placeholder').hidden = true;
  $('editor').hidden = false;
  $('editor-title').textContent = songName(job);
  $('wave-status').hidden = false;
  $('wave-status').textContent = 'Loading the guitar track…';
  $('save-message').textContent = '';
  $('save-message').className = 'small';

  const meta = job.meta || {};
  $('title').value = meta.title ?? '';
  $('artist').value = meta.artist ?? '';
  $('language').value = meta.language ?? job.language ?? '';
  $('decade').value = meta.decade ?? '';

  const token = ++loadToken;
  try {
    const res = await fetch(`/api/jobs/${job.id}/guitar.mp3`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
    if (token !== loadToken) return;
    buffer = decoded;
    const prev = meta.clip;
    setClip(prev?.start ?? 0, prev?.end ?? Math.min(30, buffer.duration));
    $('wave-status').hidden = true;
  } catch (err) {
    if (token === loadToken) $('wave-status').textContent = `Could not load the guitar track (${err.message}).`;
  }
}

function closeEditor() {
  stop();
  loadToken++;
  selectedId = null;
  buffer = null;
  $('editor').hidden = true;
  $('placeholder').hidden = false;
  renderQueue();
}

$('discard').addEventListener('click', () => {
  const job = jobs.find((j) => j.id === selectedId);
  if (job) giveUp(job);
});

$('save-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = jobs.find((j) => j.id === selectedId);
  if (!job || !buffer) return;
  const msg = $('save-message');
  $('save').disabled = true;
  msg.className = 'small';
  msg.textContent = 'Cutting the clip and publishing the library…';
  try {
    const result = await api(`/api/jobs/${job.id}/save`, {
      title: $('title').value,
      artist: $('artist').value,
      language: $('language').value,
      decade: $('decade').value,
      start: clip.start,
      end: clip.end,
    });
    stop();
    msg.className = 'small is-ok';
    msg.textContent = `Saved as ${result.savedAs}. ${result.published}`;
    setTimeout(() => {
      if (selectedId === job.id) closeEditor();
      const next = jobs.find((j) => j.status === 'ready' && j.id !== job.id);
      if (next) openEditor(next);
    }, 1800);
    refresh();
  } catch (err) {
    msg.className = 'small is-error';
    msg.textContent = err.message;
  } finally {
    $('save').disabled = false;
  }
});

refresh();
setInterval(refresh, 2000);
