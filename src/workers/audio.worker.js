"use strict";

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

function hammingWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}

function blackmanWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (2 * Math.PI * i) / (size - 1);
    w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }
  return w;
}

function getWindow(type, size) {
  switch (type) {
    case 'hamming': return hammingWindow(size);
    case 'blackman': return blackmanWindow(size);
    case 'hann':
    default: return hannWindow(size);
  }
}

function computeFFT(samples, fftSize, windowType) {
  const N = fftSize;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const win = getWindow(windowType || 'hann', N);
  for (let i = 0; i < N; i++) {
    re[i] = (samples[i] || 0) * win[i];
  }
  fftInPlace(re, im);
  const magnitudes = new Float32Array(N / 2);
  const phases = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    magnitudes[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    phases[i] = Math.atan2(im[i], re[i]);
  }
  return { magnitudes, phases };
}

function computeSpectrogram(samples, sampleRate, options) {
  const fftSize = options.fftSize || 2048;
  const hopSize = options.hopSize || Math.floor(fftSize / 4);
  const windowType = options.window || 'hann';
  const maxFrames = options.maxFrames || 2000;
  const totalSamples = samples.length;
  const frames = Math.floor((totalSamples - fftSize) / hopSize) + 1;
  const frameCount = Math.min(frames, maxFrames);
  const binCount = fftSize / 2;
  const spec = new Float32Array(frameCount * binCount);
  let maxMag = 1e-10;
  const win = getWindow(windowType, fftSize);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[start + i] || 0) * win[i];
    }
    fftInPlace(re, im);
    for (let i = 0; i < binCount; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      spec[f * binCount + i] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }

  const db = new Float32Array(spec.length);
  for (let i = 0; i < spec.length; i++) {
    const v = spec[i] / maxMag;
    db[i] = 20 * Math.log10(Math.max(1e-10, v));
  }

  return {
    data: db.buffer,
    frameCount,
    binCount,
    fftSize,
    hopSize,
    sampleRate,
    nyquist: sampleRate / 2,
  };
}

function computePeaks(samples, bucketCount) {
  const count = bucketCount || 512;
  const blockSize = Math.max(1, Math.floor(samples.length / count));
  const peaks = new Float32Array(count);
  const rms = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let max = 0;
    let sumSq = 0;
    let n = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, samples.length);
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
      sumSq += samples[j] * samples[j];
      n++;
    }
    peaks[i] = max;
    rms[i] = n > 0 ? Math.sqrt(sumSq / n) : 0;
  }
  return { peaks, rms };
}

function computeMultiChannelPeaks(channels, bucketCount) {
  const results = [];
  for (const samples of channels) {
    const { peaks, rms } = computePeaks(samples, bucketCount);
    results.push({ peaks, rms });
  }
  return results;
}

function computeWaveformData(samples, width) {
  const samplesPerPixel = Math.max(1, Math.floor(samples.length / width));
  const min = new Float32Array(width);
  const max = new Float32Array(width);
  const rms = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const start = x * samplesPerPixel;
    const end = Math.min(start + samplesPerPixel, samples.length);
    let mn = 0, mx = 0;
    let sumSq = 0;
    let n = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sumSq += v * v;
      n++;
    }
    min[x] = mn;
    max[x] = mx;
    rms[x] = n > 0 ? Math.sqrt(sumSq / n) : 0;
  }
  return { min, max, rms };
}

function detectSilence(samples, sampleRate, thresholdDb, minDurationMs) {
  const threshold = Math.pow(10, (thresholdDb || -40) / 20);
  const minSamples = Math.floor((minDurationMs || 500) * sampleRate / 1000);
  const regions = [];
  let silenceStart = -1;
  for (let i = 0; i < samples.length; i++) {
    const isSilent = Math.abs(samples[i]) < threshold;
    if (isSilent && silenceStart === -1) silenceStart = i;
    else if (!isSilent && silenceStart !== -1) {
      if (i - silenceStart >= minSamples) {
        regions.push({
          start: silenceStart / sampleRate,
          end: i / sampleRate,
          duration: (i - silenceStart) / sampleRate,
        });
      }
      silenceStart = -1;
    }
  }
  if (silenceStart !== -1 && samples.length - silenceStart >= minSamples) {
    regions.push({
      start: silenceStart / sampleRate,
      end: samples.length / sampleRate,
      duration: (samples.length - silenceStart) / sampleRate,
    });
  }
  return regions;
}

function detectBPM(samples, sampleRate) {
  const fftSize = 2048;
  const hopSize = 512;
  const frames = Math.floor((samples.length - fftSize) / hopSize) + 1;
  const onset = new Float32Array(frames);
  const win = hannWindow(fftSize);

  let prevSpectrum = null;
  for (let f = 0; f < frames; f++) {
    const start = f * hopSize;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[start + i] || 0) * win[i];
    }
    fftInPlace(re, im);
    const mag = new Float32Array(fftSize / 2);
    for (let i = 0; i < fftSize / 2; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    if (prevSpectrum) {
      let flux = 0;
      for (let i = 0; i < mag.length; i++) {
        const diff = mag[i] - prevSpectrum[i];
        if (diff > 0) flux += diff;
      }
      onset[f] = flux;
    }
    prevSpectrum = mag;
  }

  const smoothOnset = new Float32Array(onset.length);
  for (let i = 1; i < onset.length - 1; i++) {
    smoothOnset[i] = (onset[i - 1] + onset[i] + onset[i + 1]) / 3;
  }

  let peakCount = 0;
  let lastPeak = -10;
  const peaks = [];
  for (let i = 1; i < smoothOnset.length - 1; i++) {
    if (smoothOnset[i] > smoothOnset[i - 1] && smoothOnset[i] > smoothOnset[i + 1]) {
      if (i - lastPeak > 8) {
        peaks.push(i);
        lastPeak = i;
        peakCount++;
      }
    }
  }

  if (peaks.length < 2) return { bpm: 0, peaks: 0 };

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push(peaks[i] - peaks[i - 1]);
  }
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  const secondsPerFrame = hopSize / sampleRate;
  const bpm = 60 / (medianInterval * secondsPerFrame);

  return {
    bpm: Math.round(bpm * 10) / 10,
    peaks: peaks.length,
    confidence: intervals.length > 0 ? 1 - (intervals[intervals.length - 1] - intervals[0]) / medianInterval : 0,
  };
}

function applyFadeIn(samples, durationSeconds, sampleRate) {
  const out = new Float32Array(samples);
  const fadeSamples = Math.min(Math.floor(durationSeconds * sampleRate), samples.length);
  for (let i = 0; i < fadeSamples; i++) {
    out[i] = samples[i] * (i / fadeSamples);
  }
  return out;
}

function applyFadeOut(samples, durationSeconds, sampleRate) {
  const out = new Float32Array(samples);
  const fadeSamples = Math.min(Math.floor(durationSeconds * sampleRate), samples.length);
  const start = samples.length - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) {
    out[start + i] = samples[start + i] * (1 - i / fadeSamples);
  }
  return out;
}

function normalize(samples, targetDb) {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > max) max = v;
  }
  if (max === 0) return new Float32Array(samples);
  const targetLinear = Math.pow(10, (targetDb || -1) / 20);
  const gain = targetLinear / max;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return out;
}

function reverse(samples) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[samples.length - 1 - i];
  }
  return out;
}

function amplify(samples, gainDb) {
  const gain = Math.pow(10, gainDb / 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return out;
}

function trimSilence(samples, sampleRate, thresholdDb) {
  const threshold = Math.pow(10, (thresholdDb || -40) / 20);
  let start = 0;
  let end = samples.length - 1;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const out = new Float32Array(end - start + 1);
  for (let i = start; i <= end; i++) {
    out[i - start] = samples[i];
  }
  return out;
}

function resampleLinear(samples, srcRate, dstRate) {
  if (srcRate === dstRate) return new Float32Array(samples);
  const ratio = dstRate / srcRate;
  const newLength = Math.round(samples.length * ratio);
  const out = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = samples[idx] || 0;
    const b = samples[idx + 1] || 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function mixChannels(channels) {
  const length = channels[0].length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] || 0;
    out[i] = sum / channels.length;
  }
  return out;
}

function stereoToMono(left, right) {
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    out[i] = (left[i] + right[i]) / 2;
  }
  return out;
}

function applyGainRamp(samples, startDb, endDb) {
  const out = new Float32Array(samples.length);
  const startGain = Math.pow(10, startDb / 20);
  const endGain = Math.pow(10, endDb / 20);
  for (let i = 0; i < samples.length; i++) {
    const t = i / samples.length;
    const gain = startGain + (endGain - startGain) * t;
    out[i] = samples[i] * gain;
  }
  return out;
}

function computeRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function computeLoudness(samples) {
  const rms = computeRMS(samples);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function computeZeroCrossings(samples) {
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) count++;
  }
  return count;
}

function computeZeroCrossingRate(samples, sampleRate) {
  return computeZeroCrossings(samples) / (samples.length / sampleRate);
}

function applySimpleReverb(samples, sampleRate, options) {
  const { decay = 0.5, delayMs = 40, mix = 0.3 } = options || {};
  const delaySamples = Math.floor((delayMs * sampleRate) / 1000);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i];
    if (i >= delaySamples) {
      out[i] += out[i - delaySamples] * decay * mix;
    }
  }
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]);
    if (v > max) max = v;
  }
  if (max > 1) {
    for (let i = 0; i < out.length; i++) out[i] /= max;
  }
  return out;
}

function applySimpleDelay(samples, sampleRate, options) {
  const { delayMs = 250, feedback = 0.4, mix = 0.3 } = options || {};
  const delaySamples = Math.floor((delayMs * sampleRate) / 1000);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i];
    if (i >= delaySamples) {
      out[i] += out[i - delaySamples] * feedback * mix;
    }
  }
  return out;
}

function applySimpleDistortion(samples, amount) {
  const k = amount || 20;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    out[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return out;
}

function applyLowPass(samples, sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = out[i - 1] + alpha * (samples[i] - out[i - 1]);
  }
  return out;
}

function applyHighPass(samples, sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = alpha * (out[i - 1] + samples[i] - samples[i - 1]);
  }
  return out;
}

function applyCompressor(samples, options) {
  const { threshold = -20, ratio = 4, attack = 0.003, release = 0.25, sampleRate = 48000 } = options || {};
  const out = new Float32Array(samples.length);
  const thresholdLin = Math.pow(10, threshold / 20);
  let env = 0;
  const attackCoef = Math.exp(-1 / (attack * sampleRate));
  const releaseCoef = Math.exp(-1 / (release * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    const absIn = Math.abs(samples[i]);
    if (absIn > env) env = attackCoef * env + (1 - attackCoef) * absIn;
    else env = releaseCoef * env + (1 - releaseCoef) * absIn;

    let gain = 1;
    if (env > thresholdLin) {
      const overDb = 20 * Math.log10(env / thresholdLin);
      const reducedDb = overDb * (1 - 1 / ratio);
      gain = Math.pow(10, -reducedDb / 20);
    }
    out[i] = samples[i] * gain;
  }
  return out;
}

function normalizeMulti(channels, targetDb) {
  let max = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > max) max = v;
    }
  }
  if (max === 0) return channels.map((c) => new Float32Array(c));
  const targetLinear = Math.pow(10, (targetDb || -1) / 20);
  const gain = targetLinear / max;
  return channels.map((c) => {
    const out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) {
      out[i] = Math.max(-1, Math.min(1, c[i] * gain));
    }
    return out;
  });
}

function spectralCentroid(magnitudes, sampleRate, fftSize) {
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    sum += magnitudes[i];
    weighted += freq * magnitudes[i];
  }
  return sum > 0 ? weighted / sum : 0;
}

function spectralRolloff(magnitudes, sampleRate, fftSize, threshold) {
  const t = (threshold || 0.85);
  let total = 0;
  for (let i = 0; i < magnitudes.length; i++) total += magnitudes[i];
  let acc = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    acc += magnitudes[i];
    if (acc >= total * t) {
      return (i * sampleRate) / fftSize;
    }
  }
  return sampleRate / 2;
}

function estimateKey(samples, sampleRate) {
  const fftSize = 4096;
  const hopSize = 2048;
  const frames = Math.floor((samples.length - fftSize) / hopSize) + 1;
  const chroma = new Float32Array(12);
  const win = hannWindow(fftSize);
  const A4 = 440;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  for (let f = 0; f < frames; f++) {
    const start = f * hopSize;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[start + i] || 0) * win[i];
    }
    fftInPlace(re, im);
    for (let i = 1; i < fftSize / 2; i++) {
      const freq = (i * sampleRate) / fftSize;
      if (freq < 80 || freq > 2000) continue;
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      const midi = Math.round(69 + 12 * Math.log2(freq / A4));
      const pitchClass = ((midi % 12) + 12) % 12;
      chroma[pitchClass] += mag;
    }
  }

  let maxIdx = 0;
  for (let i = 1; i < 12; i++) {
    if (chroma[i] > chroma[maxIdx]) maxIdx = i;
  }

  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  let bestMajorKey = 0, bestMajorCorr = -Infinity;
  let bestMinorKey = 0, bestMinorCorr = -Infinity;

  for (let k = 0; k < 12; k++) {
    let majorCorr = 0, minorCorr = 0;
    let magSum = 0;
    for (let i = 0; i < 12; i++) magSum += chroma[i] * chroma[i];
    const mag = Math.sqrt(magSum) || 1;
    for (let i = 0; i < 12; i++) {
      majorCorr += chroma[(i + k) % 12] * majorProfile[i];
      minorCorr += chroma[(i + k) % 12] * minorProfile[i];
    }
    majorCorr /= mag;
    minorCorr /= mag;
    if (majorCorr > bestMajorCorr) { bestMajorCorr = majorCorr; bestMajorKey = k; }
    if (minorCorr > bestMinorCorr) { bestMinorCorr = minorCorr; bestMinorKey = k; }
  }

  return {
    key: bestMajorCorr > bestMinorCorr
      ? noteNames[bestMajorKey] + ' major'
      : noteNames[bestMinorKey] + ' minor',
    confidence: Math.max(bestMajorCorr, bestMinorCorr),
    chroma: Array.from(chroma),
  };
}

const handlers = {
  async fft(data) {
    const { samples, fftSize, window: win } = data;
    const src = new Float32Array(samples);
    const result = computeFFT(src, fftSize || 1024, win);
    return {
      magnitudes: result.magnitudes.buffer,
      phases: result.phases.buffer,
      size: result.magnitudes.length,
    };
  },

  async spectrogram(data) {
    const { samples, sampleRate, options } = data;
    const src = new Float32Array(samples);
    return computeSpectrogram(src, sampleRate, options || {});
  },

  async peaks(data) {
    const { samples, buckets } = data;
    const src = new Float32Array(samples);
    const result = computePeaks(src, buckets || 512);
    return {
      peaks: result.peaks.buffer,
      rms: result.rms.buffer,
      count: result.peaks.length,
    };
  },

  async multiChannelPeaks(data) {
    const { channels, buckets } = data;
    const srcs = channels.map((c) => new Float32Array(c));
    const results = computeMultiChannelPeaks(srcs, buckets || 512);
    return {
      channels: results.map((r) => ({
        peaks: r.peaks.buffer,
        rms: r.rms.buffer,
      })),
    };
  },

  async waveform(data) {
    const { samples, width } = data;
    const src = new Float32Array(samples);
    const result = computeWaveformData(src, width || 800);
    return {
      min: result.min.buffer,
      max: result.max.buffer,
      rms: result.rms.buffer,
      width: result.min.length,
    };
  },

  async silence(data) {
    const { samples, sampleRate, thresholdDb, minDurationMs } = data;
    const src = new Float32Array(samples);
    return {
      regions: detectSilence(src, sampleRate, thresholdDb, minDurationMs),
    };
  },

  async bpm(data) {
    const { samples, sampleRate } = data;
    const src = new Float32Array(samples);
    return detectBPM(src, sampleRate);
  },

  async analyze(data) {
    const { samples, sampleRate, fftSize } = data;
    const src = new Float32Array(samples);
    const fft = computeFFT(src, fftSize || 2048, 'hann');
    const centroid = spectralCentroid(fft.magnitudes, sampleRate, fftSize || 2048);
    const rolloff = spectralRolloff(fft.magnitudes, sampleRate, fftSize || 2048);
    return {
      rms: computeRMS(src),
      loudness: computeLoudness(src),
      zeroCrossings: computeZeroCrossings(src),
      zcr: computeZeroCrossingRate(src, sampleRate),
      spectralCentroid: centroid,
      spectralRolloff: rolloff,
    };
  },

  async key(data) {
    const { samples, sampleRate } = data;
    const src = new Float32Array(samples);
    return estimateKey(src, sampleRate);
  },

  async fadeIn(data) {
    const { samples, duration, sampleRate } = data;
    const src = new Float32Array(samples);
    const out = applyFadeIn(src, duration, sampleRate);
    return { data: out.buffer };
  },

  async fadeOut(data) {
    const { samples, duration, sampleRate } = data;
    const src = new Float32Array(samples);
    const out = applyFadeOut(src, duration, sampleRate);
    return { data: out.buffer };
  },

  async normalize(data) {
    const { samples, targetDb } = data;
    const src = new Float32Array(samples);
    const out = normalize(src, targetDb);
    return { data: out.buffer };
  },

  async reverse(data) {
    const { samples } = data;
    const src = new Float32Array(samples);
    const out = reverse(src);
    return { data: out.buffer };
  },

  async amplify(data) {
    const { samples, gainDb } = data;
    const src = new Float32Array(samples);
    const out = amplify(src, gainDb);
    return { data: out.buffer };
  },

  async trimSilence(data) {
    const { samples, sampleRate, thresholdDb } = data;
    const src = new Float32Array(samples);
    const out = trimSilence(src, sampleRate, thresholdDb);
    return { data: out.buffer, length: out.length };
  },

  async resample(data) {
    const { samples, srcRate, dstRate } = data;
    const src = new Float32Array(samples);
    const out = resampleLinear(src, srcRate, dstRate);
    return { data: out.buffer, length: out.length };
  },

  async mixToMono(data) {
    const { channels } = data;
    const srcs = channels.map((c) => new Float32Array(c));
    const out = mixChannels(srcs);
    return { data: out.buffer };
  },

  async stereoToMono(data) {
    const { left, right } = data;
    const out = stereoToMono(new Float32Array(left), new Float32Array(right));
    return { data: out.buffer };
  },

  async gainRamp(data) {
    const { samples, startDb, endDb } = data;
    const src = new Float32Array(samples);
    const out = applyGainRamp(src, startDb, endDb);
    return { data: out.buffer };
  },

  async reverb(data) {
    const { samples, sampleRate, options } = data;
    const src = new Float32Array(samples);
    const out = applySimpleReverb(src, sampleRate, options);
    return { data: out.buffer };
  },

  async delay(data) {
    const { samples, sampleRate, options } = data;
    const src = new Float32Array(samples);
    const out = applySimpleDelay(src, sampleRate, options);
    return { data: out.buffer };
  },

  async distortion(data) {
    const { samples, amount } = data;
    const src = new Float32Array(samples);
    const out = applySimpleDistortion(src, amount);
    return { data: out.buffer };
  },

  async lowpass(data) {
    const { samples, sampleRate, cutoff } = data;
    const src = new Float32Array(samples);
    const out = applyLowPass(src, sampleRate, cutoff);
    return { data: out.buffer };
  },

  async highpass(data) {
    const { samples, sampleRate, cutoff } = data;
    const src = new Float32Array(samples);
    const out = applyHighPass(src, sampleRate, cutoff);
    return { data: out.buffer };
  },

  async compress(data) {
    const { samples, options } = data;
    const src = new Float32Array(samples);
    const out = applyCompressor(src, options);
    return { data: out.buffer };
  },

  async normalizeMulti(data) {
    const { channels, targetDb } = data;
    const srcs = channels.map((c) => new Float32Array(c));
    const out = normalizeMulti(srcs, targetDb);
    return { channels: out.map((c) => c.buffer) };
  },

  async batchProcess(data) {
    const { samples, sampleRate, operations } = data;
    let src = new Float32Array(samples);
    const applied = [];
    for (const op of operations) {
      switch (op.type) {
        case 'fadeIn': src = applyFadeIn(src, op.duration, sampleRate); break;
        case 'fadeOut': src = applyFadeOut(src, op.duration, sampleRate); break;
        case 'normalize': src = normalize(src, op.targetDb); break;
        case 'reverse': src = reverse(src); break;
        case 'amplify': src = amplify(src, op.gainDb); break;
        case 'reverb': src = applySimpleReverb(src, sampleRate, op.options); break;
        case 'delay': src = applySimpleDelay(src, sampleRate, op.options); break;
        case 'distortion': src = applySimpleDistortion(src, op.amount); break;
        case 'lowpass': src = applyLowPass(src, sampleRate, op.cutoff); break;
        case 'highpass': src = applyHighPass(src, sampleRate, op.cutoff); break;
        case 'compress': src = applyCompressor(src, op.options); break;
      }
      applied.push(op.type);
    }
    return { data: src.buffer, applied };
  },
};

self.onmessage = async function (e) {
  const { taskId, operation, data } = e.data;
  try {
    const handler = handlers[operation];
    if (!handler) throw new Error('Unknown operation: ' + operation);
    const result = await handler(data || {});
    const transfers = [];
    if (result && typeof result === 'object') {
      for (const key of Object.keys(result)) {
        const v = result[key];
        if (v instanceof ArrayBuffer) transfers.push(v);
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item instanceof ArrayBuffer) transfers.push(item);
            if (item && typeof item === 'object') {
              for (const k of Object.keys(item)) {
                if (item[k] instanceof ArrayBuffer) transfers.push(item[k]);
              }
            }
          }
        }
      }
    }
    self.postMessage({ taskId, result }, transfers);
  } catch (err) {
    self.postMessage({ taskId, error: err.message || String(err) });
  }
};

self.postMessage({ type: 'ready', worker: 'audio' });
