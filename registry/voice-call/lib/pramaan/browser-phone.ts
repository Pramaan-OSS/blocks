// 8 kHz audio in and out of the browser: the microphone to the phone, and the other side to the
// speakers. Needs a real browser (AudioContext), so it is not unit tested.
export function startAudio(stream: MediaStream, send: (samples: Float32Array) => void) {
  const ctx = new AudioContext({ sampleRate: 8000 });
  const mic = ctx.createMediaStreamSource(stream);
  // Limit: ScriptProcessor is deprecated but works everywhere; move to an AudioWorklet if it is removed.
  const tap = ctx.createScriptProcessor(1024, 1, 1);
  tap.onaudioprocess = (e) => send(new Float32Array(e.inputBuffer.getChannelData(0)));
  mic.connect(tap);
  tap.connect(ctx.destination);
  let next = 0;
  return {
    play(samples: Float32Array) {
      const buffer = ctx.createBuffer(1, samples.length, 8000);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      next = Math.max(next, ctx.currentTime);
      src.start(next);
      next += buffer.duration;
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
