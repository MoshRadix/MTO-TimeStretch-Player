import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import soundTouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const state = { buffer: null, name: '', context: null, source: null, stretch: null, clarity: false, playing: false, loop: false, offset: 0, startedAt: 0, speed: 1, pitch: 0, volume: 0.8, shortcuts: {} };
const waveform = $('#waveform');
const waveCtx = waveform.getContext('2d');
let scrubbing = false;
let scrubWasPlaying = false;
let recordingShortcut = null;

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2400); }
function formatTime(time) { if (!Number.isFinite(time)) return '00:00'; const s = Math.max(0, Math.floor(time)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function currentTime() { if (!state.buffer) return 0; return state.playing ? Math.min(state.buffer.duration, state.offset + (state.context.currentTime - state.startedAt) * state.speed) : state.offset; }

function drawWaveform() {
  const rect = waveform.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  waveform.width = Math.max(1, rect.width * dpr); waveform.height = Math.max(1, rect.height * dpr); waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height; waveCtx.clearRect(0, 0, width, height);
  if (!state.buffer) { $('#wave-empty').classList.remove('hidden'); return; }
  $('#wave-empty').classList.add('hidden');
  const data = state.buffer.getChannelData(0); const barCount = Math.floor(width / 4); const step = Math.floor(data.length / barCount); const mid = height / 2; const progress = currentTime() / state.buffer.duration;
  for (let i = 0; i < barCount; i++) {
    let peak = 0; const start = i * step;
    for (let j = 0; j < step; j += 4) peak = Math.max(peak, Math.abs(data[start + j] || 0));
    const envelope = Math.max(0.1, Math.min(1, peak * 2.5)); const barHeight = 5 + envelope * (height * 0.72); const x = (i / barCount) * width; const played = x < width * progress;
    waveCtx.fillStyle = played ? '#80e2c3' : '#35434a'; waveCtx.globalAlpha = played ? 0.96 : 0.84;
    waveCtx.beginPath(); waveCtx.roundRect(x, mid - barHeight / 2, 2, barHeight, 2); waveCtx.fill();
  }
  waveCtx.globalAlpha = 1;
}

function drawProgress() {
  const time = currentTime(); const duration = state.buffer?.duration || 0; const ratio = duration ? time / duration : 0;
  $('#wave-playhead').style.left = `${ratio * 100}%`; $('#elapsed').textContent = formatTime(time);
  if (state.playing) requestAnimationFrame(drawProgress);
}
function paintDials() {
  const speedAngle = -135 + ((state.speed - 0.5) / 1.5) * 270; const pitchAngle = -135 + ((state.pitch + 12) / 24) * 270;
  $('#speed-value').textContent = state.speed.toFixed(2); $('#pitch-value').textContent = state.pitch > 0 ? `+${state.pitch}` : String(state.pitch);
  $('.speed-card .dial-pointer').style.transform = `translateX(-50%) rotate(${speedAngle}deg)`;
  $('.pitch-card .dial-pointer').style.transform = `translateX(-50%) rotate(${pitchAngle}deg)`;
  $('.speed-card .dial-shell').style.setProperty('--dial-progress', `${(state.speed - 0.5) / 1.5 * 100}%`);
  $('.pitch-card .dial-shell').style.setProperty('--dial-progress', `${(state.pitch + 12) / 24 * 100}%`);
  if (state.stretch) state.stretch.playbackRate.setTargetAtTime(state.speed, state.context.currentTime, 0.02);
  if (state.source) state.source.playbackRate.setTargetAtTime(state.speed, state.context.currentTime, 0.02);
  if (state.stretch) state.stretch.pitchSemitones.setTargetAtTime(state.pitch, state.context.currentTime, 0.04);
}
function setSpeed(value) { state.speed = Math.round(Math.max(0.5, Math.min(2, value)) * 100) / 100; paintDials(); }
function setPitch(value) { state.pitch = Math.max(-12, Math.min(12, Math.round(value))); paintDials(); }

function makeClarityChain() {
  const input = state.stretch || state.context.createGain();
  const highpass = state.context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = state.clarity ? 115 : 25;
  const presence = state.context.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.8; presence.gain.value = state.clarity ? 4.5 : 0;
  const compressor = state.context.createDynamicsCompressor(); compressor.threshold.value = -24; compressor.knee.value = 18; compressor.ratio.value = state.clarity ? 2.2 : 1; compressor.attack.value = 0.012; compressor.release.value = 0.22;
  const gain = state.context.createGain(); gain.gain.value = state.volume;
  input.connect(highpass); highpass.connect(presence); presence.connect(compressor); compressor.connect(gain); gain.connect(state.context.destination);
  state.clarityNodes = { highpass, presence, compressor, gain };
}
function updateClarity() {
  state.clarity = !state.clarity; const { highpass, presence, compressor } = state.clarityNodes || {};
  if (highpass) highpass.frequency.setTargetAtTime(state.clarity ? 115 : 25, state.context.currentTime, 0.08);
  if (presence) presence.gain.setTargetAtTime(state.clarity ? 4.5 : 0, state.context.currentTime, 0.08);
  if (compressor) compressor.ratio.setTargetAtTime(state.clarity ? 2.2 : 1, state.context.currentTime, 0.08);
  $('#clarity-toggle').classList.toggle('on', state.clarity); $('#clarity-status').textContent = state.clarity ? 'Clarity on' : 'Clarity off'; $('.clarity-card').classList.toggle('clarity-active', state.clarity);
}

async function ensureAudio() {
  if (state.context) { if (state.context.state === 'suspended') await state.context.resume(); return; }
  state.context = new AudioContext();
  await SoundTouchNode.register(state.context, soundTouchProcessorUrl);
}
function stopSource() {
  if (state.source) { try { state.source.onended = null; state.source.stop(); } catch {} try { state.source.disconnect(); } catch {} }
  if (state.stretch) { try { state.stretch.disconnect(); } catch {} }
  state.source = null; state.stretch = null;
}
function createPlaybackGraph() {
  stopSource(); state.stretch = new SoundTouchNode({ context: state.context });
  const source = state.context.createBufferSource(); source.buffer = state.buffer; source.loop = state.loop; source.playbackRate.value = state.speed;
  state.source = source; source.connect(state.stretch); state.stretch.playbackRate.value = state.speed; state.stretch.pitchSemitones.value = state.pitch;
  makeClarityChain(); source.onended = () => { if (state.playing && !state.loop) { state.playing = false; state.offset = 0; $('#play-symbol').textContent = '▶'; $('#play-btn').classList.remove('is-playing'); drawProgress(); drawWaveform(); } };
}
async function play() {
  if (!state.buffer) { await openAudio(); if (!state.buffer) return; }
  await ensureAudio(); if (state.playing) return;
  if (state.offset >= state.buffer.duration) state.offset = 0;
  createPlaybackGraph(); state.startedAt = state.context.currentTime; state.source.start(0, state.offset); state.playing = true;
  $('#play-symbol').textContent = 'Ⅱ'; $('#play-btn').classList.add('is-playing'); drawProgress();
}
function pause() {
  if (!state.playing) return;
  state.offset = currentTime(); state.playing = false; stopSource(); $('#play-symbol').textContent = '▶'; $('#play-btn').classList.remove('is-playing'); drawWaveform(); drawProgress();
}
async function togglePlay() { if (state.playing) pause(); else await play(); }
async function seekTo(value) {
  if (!state.buffer) return; state.offset = Math.max(0, Math.min(state.buffer.duration, value));
  const resume = state.playing; if (resume) { state.playing = false; stopSource(); }
  drawWaveform(); drawProgress(); if (resume) await play();
}
async function openAudio() {
  const file = await window.mto.openAudio(); if (!file) return;
  try {
    await ensureAudio(); pause(); const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes.data || file.bytes);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); state.buffer = await state.context.decodeAudioData(copy); state.name = file.name; state.offset = 0;
    $('#track-title').textContent = file.name.replace(/\.(mp3|wav)$/i, ''); $('#track-meta').textContent = `${file.name.toLowerCase().endsWith('.wav') ? 'WAV' : 'MP3'} · ${formatTime(state.buffer.duration)} · ${Math.round(state.buffer.sampleRate / 1000)} kHz`;
    $('#duration').textContent = formatTime(state.buffer.duration); $('#end-time').textContent = formatTime(state.buffer.duration); $('#mid-time').textContent = formatTime(state.buffer.duration / 2);
    $('#recent-title').textContent = $('#track-title').textContent; $('#recent-subtitle').textContent = `${formatTime(state.buffer.duration)} · Just added`; $('.status-pill span').textContent = 'TRACK LOADED'; $('.status-pill i').classList.add('ready');
    drawWaveform(); await play();
  } catch (error) { console.error(error); toast('Could not decode this audio file.'); }
}

function setDialTicks(element, count, accent) {
  for (let i = 0; i <= count; i++) { const tick = document.createElement('i'); tick.style.transform = `translateX(-50%) rotate(${-135 + i * 270 / count}deg)`; if (i === Math.round(count / 2)) tick.classList.add('major'); if (accent) tick.style.setProperty('--tick-accent', accent); element.append(tick); }
}
function dialValueFromPointer(event, type, dial) {
  const rect = dial.getBoundingClientRect(); const angle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI + 90;
  let normalized = ((angle + 135 + 360) % 360); normalized = Math.max(0, Math.min(270, normalized));
  if (type === 'speed') setSpeed(0.5 + normalized / 270 * 1.5); else setPitch(Math.round(-12 + normalized / 270 * 24));
}
function wireDial(type) {
  const shell = $(`.${type}-card .dial-shell`); const dial = shell.querySelector('.dial');
  dial.addEventListener('pointerdown', (event) => { event.preventDefault(); dial.setPointerCapture(event.pointerId); dialValueFromPointer(event, type, dial); });
  dial.addEventListener('pointermove', (event) => { if (dial.hasPointerCapture(event.pointerId)) dialValueFromPointer(event, type, dial); });
  dial.addEventListener('wheel', (event) => { event.preventDefault(); type === 'speed' ? setSpeed(state.speed + Math.sign(event.deltaY) * 0.025) : setPitch(state.pitch - Math.sign(event.deltaY)); }, { passive: false });
}

function keyCombo(event) { const bits = []; if (event.ctrlKey) bits.push('Ctrl'); if (event.altKey) bits.push('Alt'); if (event.shiftKey) bits.push('Shift'); if (event.metaKey) bits.push('Super'); let key = event.key; if (key === ' ') key = 'Space'; else if (key === 'ArrowUp') key = 'Up'; else if (key === 'ArrowDown') key = 'Down'; else if (key === 'ArrowLeft') key = 'Left'; else if (key === 'ArrowRight') key = 'Right'; else if (key.length === 1) key = key.toUpperCase(); if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) bits.push(key); return bits.join('+'); }
function showSettings() { $('#settings-overlay').classList.add('visible'); }
function hideSettings() { $('#settings-overlay').classList.remove('visible'); recordingShortcut = null; }
async function loadSettings() {
  state.shortcuts = await window.mto.getShortcuts();
  for (const input of document.querySelectorAll('[data-shortcut]')) input.value = state.shortcuts[input.dataset.shortcut] || '';
}
function doGlobalAction(action) { if (action === 'toggle-play') togglePlay(); else if (action === 'speed-down') setSpeed(state.speed - 0.05); else if (action === 'speed-up') setSpeed(state.speed + 0.05); else if (action === 'pitch-down') setPitch(state.pitch - 1); else if (action === 'pitch-up') setPitch(state.pitch + 1); }

setDialTicks($('#speed-ticks'), 24, '#7fe3c2'); setDialTicks($('#pitch-ticks'), 24, '#b49cff'); paintDials(); wireDial('speed'); wireDial('pitch'); drawWaveform(); loadSettings();
$('#open-file').onclick = $('#open-track').onclick = openAudio; $('#play-btn').onclick = togglePlay;
$('#stop-btn').onclick = () => { pause(); state.offset = 0; drawWaveform(); drawProgress(); };
$('#jump-back').onclick = () => seekTo(currentTime() - 5); $('#jump-forward').onclick = () => seekTo(currentTime() + 5);
$('#loop-btn').onclick = () => { state.loop = !state.loop; $('#loop-btn').classList.toggle('selected', state.loop); if (state.source) state.source.loop = state.loop; };
$('#volume').oninput = (event) => { state.volume = Number(event.target.value); $('#volume-value').textContent = `${Math.round(state.volume * 100)}%`; if (state.clarityNodes?.gain) state.clarityNodes.gain.gain.setTargetAtTime(state.volume, state.context.currentTime, 0.02); };
$('#clarity-toggle').onclick = () => updateClarity();
document.querySelectorAll('[data-reset]').forEach((button) => button.onclick = () => button.dataset.reset === 'speed' ? setSpeed(1) : setPitch(0));
document.querySelectorAll('[data-step]').forEach((button) => button.onclick = () => button.dataset.step === 'speed' ? setSpeed(state.speed + Number(button.dataset.delta)) : setPitch(state.pitch + Number(button.dataset.delta)));
$('#wave-hit').addEventListener('pointerdown', (event) => { if (!state.buffer) return; scrubbing = true; scrubWasPlaying = state.playing; if (scrubWasPlaying) pause(); $('#wave-hit').setPointerCapture(event.pointerId); const rect = $('#wave-hit').getBoundingClientRect(); state.offset = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * state.buffer.duration; drawWaveform(); drawProgress(); });
$('#wave-hit').addEventListener('pointermove', (event) => { const rect = $('#wave-hit').getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); $('#wave-hover').style.left = `${ratio * 100}%`; if (scrubbing && state.buffer) { state.offset = ratio * state.buffer.duration; drawWaveform(); drawProgress(); } });
$('#wave-hit').addEventListener('pointerup', async () => { if (!scrubbing) return; scrubbing = false; if (scrubWasPlaying) await play(); scrubWasPlaying = false; });
window.addEventListener('resize', drawWaveform);
$('#open-settings').onclick = $('#top-settings').onclick = showSettings; $('#close-settings').onclick = hideSettings;
$('#settings-overlay').addEventListener('click', (event) => { if (event.target === $('#settings-overlay')) hideSettings(); });
document.querySelectorAll('[data-shortcut]').forEach((input) => { input.onclick = () => { recordingShortcut = input; input.classList.add('recording'); input.value = 'Press shortcut…'; $('#shortcut-message').textContent = `Recording ${input.parentElement.firstChild.textContent.trim()}`; }; });
document.addEventListener('keydown', (event) => {
  if (recordingShortcut) { event.preventDefault(); const combo = keyCombo(event); if (!['Alt', 'Ctrl', 'Shift', 'Super'].includes(combo)) { recordingShortcut.value = combo; recordingShortcut.classList.remove('recording'); state.shortcuts[recordingShortcut.dataset.shortcut] = combo; recordingShortcut = null; $('#shortcut-message').textContent = 'Shortcut captured'; } return; }
  if (event.target.matches('input')) { if (event.key === 'Escape') hideSettings(); return; }
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'ArrowLeft') seekTo(currentTime() - 5); else if (event.key === 'ArrowRight') seekTo(currentTime() + 5);
  else if (event.key === 'Escape') hideSettings();
});
$('#save-settings').onclick = async () => { try { state.shortcuts = await window.mto.saveShortcuts(state.shortcuts); $('#shortcut-message').textContent = 'Shortcuts saved'; toast('Global shortcuts saved'); } catch { toast('Could not save shortcuts'); } };
window.mto.onGlobalAction(doGlobalAction);
