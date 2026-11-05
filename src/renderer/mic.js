'use strict';

/**
 * Microphone pipeline shared by the level meter, the mic test and the
 * recording, so what you hear in the test is what ends up in the video.
 *
 * Noise cancellation modes:
 *   off      – raw microphone
 *   standard – the browser's built-in noise suppression (plus echo
 *              cancellation and automatic gain)
 *   strong   – RNNoise, a small neural network that removes fans, typing,
 *              traffic and hum, on top of echo cancellation and gain
 */
(function () {
  const RNNOISE_PROCESSOR = '@sapphi-red/web-noise-suppressor/rnnoise';
  const WORKLET_URL = 'vendor/rnnoise/rnnoiseWorklet.js';
  let wasmPromise = null;

  // Same check the library uses to pick its SIMD build.
  const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

  function loadWasm() {
    if (!wasmPromise) {
      const simd = WebAssembly.validate(SIMD_PROBE);
      // file:// can't be fetched from the page, so the main process reads it.
      wasmPromise = window.zcord.invoke('nr:wasm', simd).then((bytes) => {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      });
      wasmPromise.catch(() => (wasmPromise = null));
    }
    return wasmPromise;
  }

  function constraints(deviceId, mode) {
    const processed = mode !== 'off';
    return {
      deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: processed,
      autoGainControl: processed,
      // RNNoise replaces the browser's suppressor; running both muffles voices.
      noiseSuppression: mode === 'standard',
    };
  }

  /**
   * Opens the microphone with the chosen noise cancellation.
   * @returns {Promise<{stream: MediaStream, ctx: AudioContext, dest: MediaStreamAudioDestinationNode,
   *   analyser: AnalyserNode, mode: string, warning: string|null, close: () => void}>}
   */
  async function open({ deviceId, mode = 'strong' } = {}) {
    const raw = await navigator.mediaDevices.getUserMedia({ audio: constraints(deviceId, mode) });
    // RNNoise is trained on 48 kHz audio; the browser resamples the mic for us.
    const ctx = new AudioContext({ sampleRate: 48000 });
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(raw);
    let output = source;
    let denoiser = null;
    let usedMode = mode;
    let warning = null;

    if (mode === 'strong') {
      try {
        const wasmBinary = await loadWasm();
        await ctx.audioWorklet.addModule(WORKLET_URL);
        denoiser = new AudioWorkletNode(ctx, RNNOISE_PROCESSOR, {
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: { maxChannels: 1, wasmBinary },
        });
        source.connect(denoiser);
        output = denoiser;
      } catch (e) {
        // Fall back to the browser's suppressor rather than recording noise.
        console.error('RNNoise unavailable', e);
        raw.getTracks().forEach((t) => t.stop());
        await ctx.close();
        const fallback = await open({ deviceId, mode: 'standard' });
        fallback.warning = 'Strong noise cancellation could not start on this computer, so Standard is being used.';
        return fallback;
      }
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    output.connect(analyser);
    const dest = ctx.createMediaStreamDestination();
    output.connect(dest);

    let closed = false;
    return {
      stream: dest.stream,
      ctx,
      dest,
      analyser,
      mode: usedMode,
      warning,
      close() {
        if (closed) return;
        closed = true;
        raw.getTracks().forEach((t) => t.stop());
        if (denoiser) denoiser.port.postMessage('destroy');
        ctx.close().catch(() => {});
      },
    };
  }

  /** 0..1 loudness for a level meter. */
  function level(analyser, buf) {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    // Speech peaks around 0.3–0.6; scale so normal talking fills most of the meter.
    return Math.min(1, peak * 1.8);
  }

  window.ZcordMic = { open, level };
})();
