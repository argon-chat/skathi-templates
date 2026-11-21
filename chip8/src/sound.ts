/** The machine's one sound: a square wave that is on while the sound timer runs. */
export class Beeper {
  #context: AudioContext | null = null;
  #gain: GainNode | null = null;
  #on = false;

  set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    if (on && !this.#context) this.#start();
    const gain = this.#gain;
    const context = this.#context;
    // A short ramp: a gain that jumps clicks.
    if (gain && context) gain.gain.setTargetAtTime(on ? 0.08 : 0, context.currentTime, 0.004);
  }

  #start(): void {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 440;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    this.#context = context;
    this.#gain = gain;
  }
}
