class WaveformProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peak = 0;
    this.frames = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input) {
      for (const channel of input) {
        for (const sample of channel) this.peak = Math.max(this.peak, Math.abs(sample));
      }
    }

    if (output) {
      for (const channel of output) channel.fill(0);
    }

    if (++this.frames >= 32) {
      this.port.postMessage(this.peak);
      this.peak = 0;
      this.frames = 0;
    }

    return true;
  }
}

registerProcessor('mto-waveform', WaveformProcessor);
