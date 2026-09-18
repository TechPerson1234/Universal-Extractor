"use strict";

const VIDEO_CODECS = [
  { codec: 'avc1.42E01E', name: 'H.264 Baseline' },
  { codec: 'avc1.4D401E', name: 'H.264 Main' },
  { codec: 'avc1.640028', name: 'H.264 High' },
  { codec: 'avc1.640032', name: 'H.264 High 10' },
  { codec: 'vp8', name: 'VP8' },
  { codec: 'vp09.00.10.08', name: 'VP9 Profile 0' },
  { codec: 'vp09.00.41.08', name: 'VP9 Profile 2' },
  { codec: 'av01.0.04M.08', name: 'AV1 Main' },
];

const AUDIO_CODECS = [
  { codec: 'opus', name: 'Opus' },
  { codec: 'mp4a.40.2', name: 'AAC-LC' },
  { codec: 'mp4a.40.5', name: 'AAC-HE' },
  { codec: 'vorbis', name: 'Vorbis' },
  { codec: 'flac', name: 'FLAC' },
];

let _videoDecoder = null;
let _videoEncoder = null;
let _audioDecoder = null;
let _audioEncoder = null;
let _frameBuffer = [];
let _chunkBuffer = [];
let _currentTaskId = null;

function postProgress(taskId, progress, stage, detail) {
  self.postMessage({
    taskId,
    progress: true,
    value: progress,
    stage: stage || 'processing',
    detail: detail || '',
  });
}

async function probeVideoCodecs(width, height, fps, preference) {
  const results = [];
  const order = preference === 'speed'
    ? ['avc1.42E01E', 'vp8', 'avc1.4D401E', 'vp09.00.10.08']
    : ['avc1.640028', 'avc1.640032', 'vp09.00.41.08', 'av01.0.04M.08', 'avc1.4D401E'];
  for (const c of order) {
    try {
      const config = {
        codec: c,
        width: width || 1920,
        height: height || 1080,
        framerate: fps || 30,
        bitrate: Math.round((width || 1920) * (height || 1080) * (fps || 30) * 0.07),
      };
      const support = await VideoEncoder.isConfigSupported(config);
      results.push({ codec: c, supported: support.supported });
    } catch {
      results.push({ codec: c, supported: false });
    }
  }
  return results;
}

async function probeAudioCodecs() {
  const results = [];
  for (const c of AUDIO_CODECS) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: c.codec,
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });
      results.push({ codec: c.codec, supported: support.supported });
    } catch {
      results.push({ codec: c.codec, supported: false });
    }
  }
  return results;
}

async function encodeAudioBuffer(audioBuffer, options, taskId) {
  const codec = options.codec || 'opus';
  const bitrate = options.bitrate || 128000;
  const config = {
    codec,
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels,
    bitrate,
  };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error('Audio codec unsupported: ' + codec);

  const chunks = [];
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      chunks.push({
        buffer,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration,
        meta: meta ? { decoderConfig: serializeDecoderConfig(meta.decoderConfig) } : null,
      });
    },
    error: (e) => { throw e; },
  });
  encoder.configure(config);

  const numChannels = audioBuffer.numberOfChannels;
  const totalFrames = audioBuffer.length;
  const chunkSize = 4096;
  const channelData = [];
  for (let c = 0; c < numChannels; c++) channelData.push(audioBuffer.getChannelData(c));

  for (let offset = 0; offset < totalFrames; offset += chunkSize) {
    const frameCount = Math.min(chunkSize, totalFrames - offset);
    const interleaved = new Float32Array(frameCount * numChannels);
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        interleaved[i * numChannels + c] = channelData[c][offset + i];
      }
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: audioBuffer.sampleRate,
      numberOfFrames: frameCount,
      numberOfChannels: numChannels,
      timestamp: Math.round((offset / audioBuffer.sampleRate) * 1e6),
      data: interleaved.buffer,
    });
    encoder.encode(audioData);
    audioData.close();
    if (taskId && (offset / chunkSize) % 16 === 0) {
      postProgress(taskId, (offset + frameCount) / totalFrames, 'audio-encode');
    }
  }
  await encoder.flush();
  encoder.close();
  return chunks;
}

function serializeDecoderConfig(config) {
  if (!config) return null;
  return {
    codec: config.codec,
    description: config.description instanceof ArrayBuffer
      ? Array.from(new Uint8Array(config.description))
      : null,
    codedWidth: config.codedWidth,
    codedHeight: config.codedHeight,
    sampleRate: config.sampleRate,
    numberOfChannels: config.numberOfChannels,
  };
}

async function encodeVideoFrames(frames, options, taskId) {
  const codec = options.codec || 'avc1.640028';
  const width = options.width;
  const height = options.height;
  const fps = options.fps || 30;
  const bitrate = options.bitrate || Math.round(width * height * fps * 0.07);
  const keyframeInterval = options.keyframeInterval || 60;

  const config = {
    codec,
    width,
    height,
    framerate: fps,
    bitrate,
    latencyMode: options.latencyMode || 'quality',
    hardwareAcceleration: options.hardwareAcceleration || 'no-preference',
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error('Video codec unsupported: ' + codec);

  const chunks = [];
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      chunks.push({
        buffer,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration,
        byteLength: chunk.byteLength,
        meta: meta ? { decoderConfig: serializeDecoderConfig(meta.decoderConfig) } : null,
      });
    },
    error: (e) => { throw e; },
  });
  encoder.configure(config);

  const frameDuration = Math.round(1e6 / fps);
  let encodeQueue = 0;

  for (let i = 0; i < frames.length; i++) {
    const frameData = frames[i];
    const timestamp = frameData.timestamp || i * frameDuration;

    let source;
    if (frameData.buffer) {
      source = new VideoFrame(new Uint8ClampedArray(frameData.buffer), {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp,
        duration: frameDuration,
      });
    } else if (frameData.canvas) {
      source = new VideoFrame(frameData.canvas, {
        timestamp,
        duration: frameDuration,
      });
    } else {
      continue;
    }

    const keyFrame = i % keyframeInterval === 0;
    encoder.encode(source, { keyFrame });
    source.close();
    encodeQueue++;

    if (taskId && (i + 1) % 10 === 0) {
      postProgress(taskId, (i + 1) / frames.length, 'video-encode', `frame ${i + 1}/${frames.length}`);
    }
    if (encodeQueue >= 8) {
      await encoder.flush();
      encodeQueue = 0;
    }
  }

  await encoder.flush();
  encoder.close();
  return chunks;
}

async function decodeVideoFile(data, taskId) {
  const { blob, maxFrames, interval, startTime, endTime } = data;
  const arrayBuffer = await blob.arrayBuffer();

  const chunks = parseMp4Chunks(arrayBuffer);
  if (!chunks.length) throw new Error('No video chunks found in file');

  const frames = [];
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (frames.length < (maxFrames || Infinity)) {
        frames.push({
          timestamp: frame.timestamp,
          format: frame.format,
          codedWidth: frame.codedWidth,
          codedHeight: frame.codedHeight,
        });
      }
      frame.close();
    },
    error: (e) => { throw e; },
  });

  const config = chunks[0].config;
  decoder.configure(config);

  const startUs = (startTime || 0) * 1e6;
  const endUs = endTime ? endTime * 1e6 : Infinity;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.timestamp < startUs || c.timestamp > endUs) continue;
    const chunk = new EncodedVideoChunk({
      type: c.type,
      timestamp: c.timestamp,
      duration: c.duration,
      data: c.data,
    });
    decoder.decode(chunk);
    if (taskId && i % 20 === 0) {
      postProgress(taskId, i / chunks.length, 'video-decode', `chunk ${i + 1}/${chunks.length}`);
    }
  }

  await decoder.flush();
  decoder.close();
  return { frames: frames.length, chunks: chunks.length };
}

function parseMp4Chunks(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const chunks = [];
  let offset = 0;

  while (offset < bytes.length - 8) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (size < 8 || offset + size > bytes.length) break;

    if (type === 'mdat') {
      const dataStart = offset + 8;
      const chunkData = bytes.slice(dataStart, offset + size);
      chunks.push({
        type: 'key',
        timestamp: chunks.length * 33333,
        duration: 33333,
        data: chunkData,
        config: {
          codec: 'avc1.640028',
          codedWidth: 1920,
          codedHeight: 1080,
        },
      });
    }
    offset += size;
  }

  return chunks;
}

async function extractFramesFromCanvas(data, taskId) {
  const { canvas, times, width, height } = data;
  const frames = [];
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    ctx.clearRect(0, 0, width, height);
    if (data.renderFrame) {
      const imgData = await data.renderFrame(t);
      if (imgData) {
        const imageData = new ImageData(new Uint8ClampedArray(imgData), width, height);
        ctx.putImageData(imageData, 0, 0);
      }
    }
    const bitmap = await createImageBitmap(canvas);
    frames.push({ time: t, bitmap });
    if (taskId) postProgress(taskId, (i + 1) / times.length, 'extract-frame');
  }
  return frames;
}

async function applyFrameEffect(frames, effect, options, taskId) {
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.buffer) {
      const src = new Uint8ClampedArray(f.buffer);
      const processed = applyFrameFilter(src, options.width, options.height, effect, options);
      out.push({ ...f, buffer: processed.buffer });
    } else {
      out.push(f);
    }
    if (taskId && i % 10 === 0) postProgress(taskId, i / frames.length, 'frame-effect');
  }
  return out;
}

function applyFrameFilter(src, width, height, effect, opts) {
  const out = new Uint8ClampedArray(src.length);
  switch (effect) {
    case 'grayscale':
      for (let i = 0; i < src.length; i += 4) {
        const g = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
        out[i] = out[i + 1] = out[i + 2] = g;
        out[i + 3] = src[i + 3];
      }
      break;
    case 'sepia':
      for (let i = 0; i < src.length; i += 4) {
        const r = src[i], g = src[i + 1], b = src[i + 2];
        out[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        out[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        out[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        out[i + 3] = src[i + 3];
      }
      break;
    case 'invert':
      for (let i = 0; i < src.length; i += 4) {
        out[i] = 255 - src[i];
        out[i + 1] = 255 - src[i + 1];
        out[i + 2] = 255 - src[i + 2];
        out[i + 3] = src[i + 3];
      }
      break;
    case 'brightness': {
      const amount = opts.amount || 0;
      for (let i = 0; i < src.length; i += 4) {
        out[i] = Math.max(0, Math.min(255, src[i] + amount));
        out[i + 1] = Math.max(0, Math.min(255, src[i + 1] + amount));
        out[i + 2] = Math.max(0, Math.min(255, src[i + 2] + amount));
        out[i + 3] = src[i + 3];
      }
      break;
    }
    case 'vignette': {
      const cx = width / 2;
      const cy = height / 2;
      const maxD = Math.sqrt(cx * cx + cy * cy);
      const strength = (opts.strength || 50) / 100;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy) / maxD;
          const factor = 1 - strength * d * d;
          const idx = (y * width + x) * 4;
          out[idx] = src[idx] * factor;
          out[idx + 1] = src[idx + 1] * factor;
          out[idx + 2] = src[idx + 2] * factor;
          out[idx + 3] = src[idx + 3];
        }
      }
      break;
    }
    default:
      out.set(src);
  }
  return out;
}

async function generateThumbnailsStrip(data, taskId) {
  const { frames, thumbWidth, thumbHeight, columns } = data;
  const rows = Math.ceil(frames.length / columns);
  const stripW = thumbWidth * columns;
  const stripH = thumbHeight * rows;
  const canvas = new OffscreenCanvas(stripW, stripH);
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const col = i % columns;
    const row = Math.floor(i / columns);
    if (f.buffer) {
      const imageData = new ImageData(new Uint8ClampedArray(f.buffer), f.width, f.height);
      const temp = new OffscreenCanvas(f.width, f.height);
      temp.getContext('2d').putImageData(imageData, 0, 0);
      ctx.drawImage(temp, 0, 0, f.width, f.height, col * thumbWidth, row * thumbHeight, thumbWidth, thumbHeight);
    }
    if (taskId && i % 5 === 0) postProgress(taskId, i / frames.length, 'thumbnail-strip');
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { blob };
}

async function concatenateFrames(frameSets, options, taskId) {
  const all = [];
  for (const set of frameSets) {
    for (const f of set) all.push(f);
  }
  return all;
}

const handlers = {
  async probe(data) {
    const video = await probeVideoCodecs(data.width, data.height, data.fps, data.preference);
    const audio = await probeAudioCodecs();
    return { video, audio };
  },

  async encodeVideo(data) {
    const chunks = await encodeVideoFrames(data.frames, data.options, data.taskId || _currentTaskId);
    return {
      chunks: chunks.map((c) => ({
        buffer: c.buffer,
        type: c.type,
        timestamp: c.timestamp,
        duration: c.duration,
        byteLength: c.byteLength,
        meta: c.meta,
      })),
      count: chunks.length,
    };
  },

  async encodeAudio(data) {
    const chunks = await encodeAudioBuffer(data.audioBuffer, data.options, data.taskId || _currentTaskId);
    return {
      chunks: chunks.map((c) => ({
        buffer: c.buffer,
        type: c.type,
        timestamp: c.timestamp,
        duration: c.duration,
        meta: c.meta,
      })),
      count: chunks.length,
    };
  },

  async decodeVideo(data) {
    return decodeVideoFile(data, data.taskId || _currentTaskId);
  },

  async extractFrames(data) {
    const frames = await extractFramesFromCanvas(data, data.taskId || _currentTaskId);
    return {
      frames: frames.map((f) => ({ time: f.time, bitmap: f.bitmap })),
      count: frames.length,
    };
  },

  async applyEffect(data) {
    const out = await applyFrameEffect(data.frames, data.effect, data.options, data.taskId || _currentTaskId);
    return { frames: out, count: out.length };
  },

  async makeThumbStrip(data) {
    return generateThumbnailsStrip(data, data.taskId || _currentTaskId);
  },

  async concat(data) {
    const all = await concatenateFrames(data.frameSets, data.options, data.taskId || _currentTaskId);
    return { count: all.length };
  },

  async initDecoder(data) {
    if (_videoDecoder) {
      try { _videoDecoder.close(); } catch {}
    }
    _videoDecoder = new VideoDecoder({
      output: (frame) => {
        _frameBuffer.push(frame);
        self.postMessage({ type: 'frame', timestamp: frame.timestamp });
      },
      error: (e) => {
        self.postMessage({ type: 'decoder-error', error: e.message });
      },
    });
    _videoDecoder.configure(data.config);
    return { initialized: true };
  },

  async decodeChunk(data) {
    if (!_videoDecoder) throw new Error('Decoder not initialized');
    const chunk = new EncodedVideoChunk({
      type: data.type,
      timestamp: data.timestamp,
      duration: data.duration,
      data: data.data,
    });
    _videoDecoder.decode(chunk);
    return { queued: true };
  },

  async flushDecoder() {
    if (_videoDecoder) {
      await _videoDecoder.flush();
      return { flushed: true };
    }
    return { flushed: false };
  },

  async initEncoder(data) {
    if (_videoEncoder) {
      try { _videoEncoder.close(); } catch {}
    }
    _chunkBuffer = [];
    _videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        const buffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buffer);
        _chunkBuffer.push({
          buffer,
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
        });
      },
      error: (e) => {
        self.postMessage({ type: 'encoder-error', error: e.message });
      },
    });
    _videoEncoder.configure(data.config);
    return { initialized: true };
  },

  async encodeFrame(data) {
    if (!_videoEncoder) throw new Error('Encoder not initialized');
    const frame = new VideoFrame(data.data, {
      format: data.format || 'RGBA',
      codedWidth: data.width,
      codedHeight: data.height,
      timestamp: data.timestamp,
      duration: data.duration,
    });
    _videoEncoder.encode(frame, { keyFrame: data.keyFrame || false });
    frame.close();
    return { encoded: true };
  },

  async flushEncoder() {
    if (_videoEncoder) {
      await _videoEncoder.flush();
      const chunks = _chunkBuffer;
      _chunkBuffer = [];
      return {
        chunks: chunks.map((c) => ({
          buffer: c.buffer,
          type: c.type,
          timestamp: c.timestamp,
          duration: c.duration,
        })),
      };
    }
    return { chunks: [] };
  },

  async closeAll() {
    if (_videoDecoder) { try { _videoDecoder.close(); } catch {} _videoDecoder = null; }
    if (_videoEncoder) { try { _videoEncoder.close(); } catch {} _videoEncoder = null; }
    if (_audioDecoder) { try { _audioDecoder.close(); } catch {} _audioDecoder = null; }
    if (_audioEncoder) { try { _audioEncoder.close(); } catch {} _audioEncoder = null; }
    _frameBuffer = [];
    _chunkBuffer = [];
    return { closed: true };
  },
};

self.onmessage = async function (e) {
  const { taskId, operation, data } = e.data;
  _currentTaskId = taskId;
  try {
    const handler = handlers[operation];
    if (!handler) throw new Error('Unknown operation: ' + operation);
    if (data && !data.taskId) data.taskId = taskId;
    const result = await handler(data || {});
    const transfers = [];
    if (result && typeof result === 'object') {
      if (Array.isArray(result.chunks)) {
        for (const c of result.chunks) {
          if (c.buffer instanceof ArrayBuffer) transfers.push(c.buffer);
        }
      }
      if (Array.isArray(result.frames)) {
        for (const f of result.frames) {
          if (f.buffer instanceof ArrayBuffer) transfers.push(f.buffer);
          if (f.bitmap && f.bitmap instanceof ImageBitmap) transfers.push(f.bitmap);
        }
      }
      for (const key of Object.keys(result)) {
        if (result[key] instanceof ArrayBuffer) transfers.push(result[key]);
      }
    }
    self.postMessage({ taskId, result }, transfers);
  } catch (err) {
    self.postMessage({ taskId, error: err.message || String(err) });
  }
};

self.postMessage({ type: 'ready', worker: 'video' });
