// All sound here is synthesized in the browser with the Web Audio API —
// there are no external audio files to download or license. Effects are
// short oscillator "blips"; the background music is a soft looping
// arpeggio, not a real recorded track.

const SOUND_KEY = "chess:soundEnabled";

let ctx = null;
function getCtx() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, duration, { type = "sine", gain = 0.15, delay = 0 } = {}) {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const startTime = audioCtx.currentTime + delay;
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.012);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gainNode).connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

export function isSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export function playMove() {
  if (!isSoundEnabled()) return;
  tone(520, 0.09, { type: "triangle", gain: 0.16 });
}

export function playCapture() {
  if (!isSoundEnabled()) return;
  tone(300, 0.06, { type: "square", gain: 0.15 });
  tone(190, 0.14, { type: "square", gain: 0.13, delay: 0.05 });
}

export function playCheck() {
  if (!isSoundEnabled()) return;
  tone(880, 0.12, { type: "sawtooth", gain: 0.12 });
  tone(660, 0.16, { type: "sawtooth", gain: 0.1, delay: 0.1 });
}

/** A queued premove that turned out illegal once it was actually your
 * turn (the opponent's move blocked it, captured the piece, left your
 * king in check, etc.) — a short, low buzz distinct from every other
 * sound here, so it reads as "that didn't happen" rather than a move. */
export function playIllegal() {
  if (!isSoundEnabled()) return;
  tone(160, 0.14, { type: "square", gain: 0.11 });
}

/** outcome: 'win' | 'loss' | 'draw' | 'neutral' */
export function playGameEnd(outcome) {
  if (!isSoundEnabled()) return;
  if (outcome === "win") {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: "triangle", gain: 0.16, delay: i * 0.12 }));
  } else if (outcome === "loss") {
    [523, 466, 415, 349].forEach((f, i) => tone(f, 0.26, { type: "sawtooth", gain: 0.13, delay: i * 0.13 }));
  } else if (outcome === "draw") {
    tone(440, 0.3, { type: "sine", gain: 0.14 });
    tone(440, 0.3, { type: "sine", gain: 0.14, delay: 0.28 });
  } else {
    tone(440, 0.2, { type: "sine", gain: 0.13 });
    tone(554, 0.25, { type: "sine", gain: 0.13, delay: 0.15 });
  }
}
