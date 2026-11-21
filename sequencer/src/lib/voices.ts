// The six instruments. Each is a function that builds a few nodes for one hit, starts them at
// `time` on the context's clock and lets them end by themselves: nothing is kept between hits.

export interface Voice {
  id: string;
  name: string;
  play(context: AudioContext, out: AudioNode, time: number, noise: AudioBuffer): void;
}

/** A gain that jumps to `peak` at `time` and decays to silence over `seconds`. */
function envelope(context: AudioContext, out: AudioNode, time: number, peak: number, seconds: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
  gain.connect(out);
  return gain;
}

function tone(
  context: AudioContext,
  out: AudioNode,
  time: number,
  seconds: number,
  type: OscillatorType,
  from: number,
  to = from,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, time);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, time + seconds);
  oscillator.connect(out);
  oscillator.start(time);
  oscillator.stop(time + seconds + 0.02);
}

function hiss(
  context: AudioContext,
  out: AudioNode,
  time: number,
  seconds: number,
  noise: AudioBuffer,
  filter: BiquadFilterType,
  frequency: number,
): void {
  const source = context.createBufferSource();
  const shape = context.createBiquadFilter();
  source.buffer = noise;
  shape.type = filter;
  shape.frequency.value = frequency;
  source.connect(shape).connect(out);
  // A different stretch of the noise every hit, so two hats in a row are not the same sample.
  source.start(time, Math.random() * (noise.duration - seconds - 0.05), seconds + 0.02);
}

export const VOICES: Voice[] = [
  {
    id: "kick",
    name: "Kick",
    play(context, out, time) {
      tone(context, envelope(context, out, time, 1, 0.34), time, 0.34, "sine", 150, 44);
    },
  },
  {
    id: "snare",
    name: "Snare",
    play(context, out, time, noise) {
      hiss(context, envelope(context, out, time, 0.7, 0.17), time, 0.17, noise, "bandpass", 1900);
      tone(context, envelope(context, out, time, 0.45, 0.09), time, 0.09, "triangle", 210, 150);
    },
  },
  {
    id: "hat",
    name: "Hat",
    play(context, out, time, noise) {
      hiss(context, envelope(context, out, time, 0.32, 0.045), time, 0.045, noise, "highpass", 7600);
    },
  },
  {
    id: "open",
    name: "Open hat",
    play(context, out, time, noise) {
      hiss(context, envelope(context, out, time, 0.26, 0.3), time, 0.3, noise, "highpass", 6400);
    },
  },
  {
    id: "clap",
    name: "Clap",
    play(context, out, time, noise) {
      for (const [after, peak, seconds] of [
        [0, 0.5, 0.012],
        [0.012, 0.5, 0.012],
        [0.024, 0.6, 0.16],
      ] as const) {
        hiss(context, envelope(context, out, time + after, peak, seconds), time + after, seconds, noise, "bandpass", 1250);
      }
    },
  },
  {
    id: "bass",
    name: "Bass",
    play(context, out, time) {
      const shape = context.createBiquadFilter();
      shape.type = "lowpass";
      shape.Q.value = 6;
      shape.frequency.setValueAtTime(900, time);
      shape.frequency.exponentialRampToValueAtTime(140, time + 0.2);
      shape.connect(envelope(context, out, time, 0.55, 0.24));
      tone(context, shape, time, 0.24, "sawtooth", 55);
    },
  },
];

/** Two seconds of white noise, shared by every voice that needs some. */
export function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}
