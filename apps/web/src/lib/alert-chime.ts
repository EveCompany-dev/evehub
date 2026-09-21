/**
 * A short two-tone chime via Web Audio, rather than bundling an audio file —
 * one less binary asset to ship and license. Browsers block audio (and, on
 * some, the desktop Notification popup) until the user has interacted with
 * the page at least once in the tab's lifetime; that's a browser autoplay
 * policy, not something this code can bypass.
 */
export function playAlertChime(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, index) => {
      const start = now + index * 0.12;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Web Audio unsupported or blocked — a missed chime isn't worth surfacing an error for.
  }
}
