/**
 * Non-visual scan feedback. Hands are full and the phone is somewhere between
 * a box and a knee — the scan has to be legible without looking at the screen,
 * so every cue is a distinct shape rather than a distinct pitch.
 */

const PATTERNS = {
  /** Packed — two notes going up. Something landed in the box. */
  rising: { tones: [[660, 0.06], [990, 0.09]], vibrate: [18] },
  /** Unknown code — two notes going down. You are about to enrol. */
  falling: { tones: [[740, 0.07], [440, 0.11]], vibrate: [28] },
  /** Looked something up. Neutral blip. */
  neutral: { tones: [[880, 0.05]], vibrate: [12] },
  /** A question is on screen and needs an answer. */
  query: { tones: [[620, 0.06], [620, 0.06]], vibrate: [16, 60, 16] },
  /** Refused: unreadable code, foreign URL, duplicate enrolment. */
  error: { tones: [[180, 0.16], [140, 0.2]], vibrate: [60, 40, 60] },
};

let audio = null;
let muted = false;

/** Browsers only allow audio after a gesture, so build the context lazily. */
function context() {
  if (!audio) {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    audio = Ctor ? new Ctor() : null;
  }
  if (audio?.state === 'suspended') audio.resume();
  return audio;
}

export function setMuted(value) {
  muted = Boolean(value);
}

export function isMuted() {
  return muted;
}

/** @param {keyof typeof PATTERNS|null} cue */
export function play(cue) {
  const pattern = PATTERNS[cue];
  if (!pattern) return;

  if (!muted) {
    const ctx = context();
    if (ctx) {
      let at = ctx.currentTime;
      for (const [frequency, duration] of pattern.tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = frequency;
        // A short ramp instead of a hard stop — a clipped square wave clicks.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + duration + 0.02);
        at += duration + 0.01;
      }
    }
  }

  navigator.vibrate?.(pattern.vibrate);
}

/** Call from the first tap so the very first scan is audible. */
export function warmUp() {
  context();
}
