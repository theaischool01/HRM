/**
 * Browser-safe synthesized gentle audio alarm for break overtime alerts.
 * Uses Web Audio API without requiring external audio files.
 * Safe against browser autoplay policy restrictions and SSR.
 */

let audioCtx: AudioContext | null = null;
let alarmIntervalId: ReturnType<typeof setInterval> | null = null;
let isMuted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Plays a short, gentle, non-jarring 2-tone chime:
 * 784 Hz (G5) for 100ms, pause 50ms, 880 Hz (A5) for 120ms at low volume.
 */
export function playGentleOvertimeChime(): void {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;

  try {
    const now = ctx.currentTime;

    // Tone 1: 784 Hz
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(784, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Tone 2: 880 Hz (starts 0.12s later)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.08, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.28);
  } catch {
    // Graceful silent fallback if Web Audio is blocked
  }
}

/**
 * Starts the periodic overtime alarm (repeats every 30 seconds).
 */
export function startOvertimeAlarm(): void {
  if (alarmIntervalId) return;
  playGentleOvertimeChime();
  alarmIntervalId = setInterval(() => {
    playGentleOvertimeChime();
  }, 30_000);
}

/**
 * Stops the overtime alarm.
 */
export function stopOvertimeAlarm(): void {
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
}

/**
 * Toggles mute status.
 */
export function toggleAlarmMute(): boolean {
  isMuted = !isMuted;
  if (isMuted) {
    stopOvertimeAlarm();
  } else {
    startOvertimeAlarm();
  }
  return isMuted;
}

export function isAlarmMuted(): boolean {
  return isMuted;
}
