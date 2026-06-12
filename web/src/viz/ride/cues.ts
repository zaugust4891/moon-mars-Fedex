// Sound-design hooks. No audio is played today; every cinematic beat emits a
// DOM CustomEvent so a future audio layer can subscribe without touching the
// renderer:  window.addEventListener('fable-audio-cue', (e) => ...detail...)
//
// Cue vocabulary emitted by Ride mode:
//   launch-ignition, rail-charge, rail-fire, burn-start, burn-end,
//   flip-maneuver, fact-spawn, dock-contact, capture-complete, arrival

const recent = new Map<string, number>();

export function cue(name: string, detail?: Record<string, unknown>): void {
  const now = performance.now();
  // debounce identical cues fired by per-frame logic
  if ((recent.get(name) ?? -1e9) > now - 500) return;
  recent.set(name, now);
  window.dispatchEvent(new CustomEvent('fable-audio-cue', { detail: { name, ...detail } }));
}
