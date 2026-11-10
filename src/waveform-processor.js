class WaveformProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peak = 0;
    this.sampleCount = 0;
    this.batchSize = 2048;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input) {
      for (const channel of input) {
        for (const sample of channel) this.peak = Math.max(this.peak, Math.abs(sample));
      }
      this.sampleCount += input[0]?.length || 0;
    }

    if (output) {
      for (const channel of output) channel.fill(0);
    }

    if (this.sampleCount >= this.batchSize) {
      this.port.postMessage(this.peak);
      this.peak = 0;
      this.sampleCount = 0;
    }

    return true;
  }
}

registerProcessor('mto-waveform', WaveformProcessor);
