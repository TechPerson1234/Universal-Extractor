const CODEC_CAPABILITIES = {
  video: [
    'avc1.42E01E', 'avc1.4D401E', 'avc1.640028', 'avc1.640032',
    'vp8', 'vp09.00.10.08', 'vp09.00.41.08',
    'av01.0.04M.08', 'av01.0.05M.08',
    'hev1.1.6.L93.B0', 'hvc1.1.6.L93.B0',
  ],
  audio: [
    'mp4a.40.2', 'mp4a.40.5', 'mp4a.40.29',
    'opus', 'vorbis', 'flac', 'alaw', 'ulaw',
  ],
};

const MP4_MEDIA_TYPES = {
  'video/mp4': 'video',
  'audio/mp4': 'audio',
  'video/webm': 'video',
  'audio/webm': 'audio',
  'video/quicktime': 'video',
};

export class CodecService {
  constructor() {
    this.videoDecoderSupport = new Map();
    this.videoEncoderSupport = new Map();
    this.audioDecoderSupport = new Map();
    this.audioEncoderSupport = new Map();
    this._probed = false;
    this._supported = this._detectSupport();
  }

  _detectSupport() {
    return {
      videoDecoder: typeof window !== 'undefined' && typeof window.VideoDecoder !== 'undefined',
      videoEncoder: typeof window !== 'undefined' && typeof window.VideoEncoder !== 'undefined',
      audioDecoder: typeof window !== 'undefined' && typeof window.AudioDecoder !== 'undefined',
      audioEncoder: typeof window !== 'undefined' && typeof window.AudioEncoder !== 'undefined',
      audioData: typeof window !== 'undefined' && typeof window.AudioData !== 'undefined',
      videoFrame: typeof window !== 'undefined' && typeof window.VideoFrame !== 'undefined',
      mediaStreamTrackProcessor: typeof window !== 'undefined' && typeof window.MediaStreamTrackProcessor !== 'undefined',
      mediaStreamTrackGenerator: typeof window !== 'undefined' && typeof window.MediaStreamTrackGenerator !== 'undefined',
    };
  }

  async probe() {
    if (this._probed) return this._supported;
    this._probed = true;

    if (this._supported.videoDecoder) {
      for (const codec of CODEC_CAPABILITIES.video) {
        try {
          const config = {
            codec,
            codedWidth: 1920,
            codedHeight: 1080,
            hardwareAcceleration: 'no-preference',
          };
          const support = await VideoDecoder.isConfigSupported(config);
          this.videoDecoderSupport.set(codec, support.supported);
        } catch {
          this.videoDecoderSupport.set(codec, false);
        }
      }
    }

    if (this._supported.audioDecoder) {
      for (const codec of CODEC_CAPABILITIES.audio) {
        try {
          const config = { codec, sampleRate: 48000, numberOfChannels: 2 };
          const support = await AudioDecoder.isConfigSupported(config);
          this.audioDecoderSupport.set(codec, support.supported);
        } catch {
          this.audioDecoderSupport.set(codec, false);
        }
      }
    }

    return this._supported;
  }

  isSupported() {
    return { ...this._supported };
  }

  async findBestVideoCodec(width = 1920, height = 1080, fps = 30, preference = 'quality') {
    await this.probe();
    const candidates = preference === 'speed'
      ? ['avc1.42E01E', 'vp8', 'avc1.4D401E', 'vp09.00.10.08']
      : ['avc1.640028', 'avc1.640032', 'vp09.00.41.08', 'av01.0.04M.08', 'avc1.4D401E'];
    for (const codec of candidates) {
      try {
        const config = {
          codec,
          width,
          height,
          framerate: fps,
          bitrate: this._estimateBitrate(width, height, fps, preference),
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) return { codec, config: support.config };
      } catch {}
    }
    return null;
  }

  async findBestAudioCodec(sampleRate = 48000, channels = 2) {
    await this.probe();
    const candidates = ['opus', 'mp4a.40.2', 'mp4a.40.5'];
    for (const codec of candidates) {
      try {
        const config = {
          codec,
          sampleRate,
          numberOfChannels: channels,
          bitrate: 128000,
        };
        const support = await AudioEncoder.isConfigSupported(config);
        if (support.supported) return { codec, config: support.config };
      } catch {}
    }
    return null;
  }

  _estimateBitrate(width, height, fps, preference) {
    const pixels = width * height;
    const base = pixels * fps * 0.07;
    const multipliers = { speed: 0.6, balanced: 1.0, quality: 1.5 };
    return Math.round(base * (multipliers[preference] || 1));
  }

  async createVideoDecoder(options = {}) {
    if (!this._supported.videoDecoder) throw new Error('VideoDecoder unavailable');
    const onFrame = options.onFrame || (() => {});
    const onError = options.onError || ((e) => console.error('[CodecService] decoder error', e));
    const decoder = new VideoDecoder({
      output: (frame) => onFrame(frame),
      error: onError,
    });
    if (options.config) decoder.configure(options.config);
    return decoder;
  }

  async createVideoEncoder(options = {}) {
    if (!this._supported.videoEncoder) throw new Error('VideoEncoder unavailable');
    const onChunk = options.onChunk || (() => {});
    const onError = options.onError || ((e) => console.error('[CodecService] encoder error', e));
    const encoder = new VideoEncoder({
      output: (chunk, meta) => onChunk(chunk, meta),
      error: onError,
    });
    if (options.config) encoder.configure(options.config);
    return encoder;
  }

  async createAudioDecoder(options = {}) {
    if (!this._supported.audioDecoder) throw new Error('AudioDecoder unavailable');
    const onData = options.onData || (() => {});
    const onError = options.onError || ((e) => console.error('[CodecService] audio decoder error', e));
    const decoder = new AudioDecoder({
      output: (data) => onData(data),
      error: onError,
    });
    if (options.config) decoder.configure(options.config);
    return decoder;
  }

  async createAudioEncoder(options = {}) {
    if (!this._supported.audioEncoder) throw new Error('AudioEncoder unavailable');
    const onChunk = options.onChunk || (() => {});
    const onError = options.onError || ((e) => console.error('[CodecService] audio encoder error', e));
    const encoder = new AudioEncoder({
      output: (chunk, meta) => onChunk(chunk, meta),
      error: onError,
    });
    if (options.config) encoder.configure(options.config);
    return encoder;
  }

  async decodeAudioBuffer(audioBuffer, options = {}) {
    if (!this._supported.audioDecoder) throw new Error('AudioDecoder unavailable');
    const codec = options.codec || 'mp4a.40.2';
    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const frames = audioBuffer.length;
    const config = { codec, sampleRate, numberOfChannels: channels };
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error('Codec not supported: ' + codec);
    const decoder = new AudioDecoder({
      output: () => {},
      error: () => {},
    });
    decoder.configure(config);
    return { codec, sampleRate, channels, frames };
  }

  async extractVideoFrames(videoElement, options = {}) {
    const {
      interval = 1,
      startTime = 0,
      endTime = videoElement.duration,
      targetWidth = videoElement.videoWidth,
      targetHeight = videoElement.videoHeight,
      onProgress = null,
    } = options;

    const frames = [];
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const wasPlaying = !videoElement.paused;
    if (wasPlaying) videoElement.pause();

    const originalTime = videoElement.currentTime;
    const steps = Math.floor((endTime - startTime) / interval);
    for (let i = 0; i <= steps; i++) {
      const t = startTime + i * interval;
      if (t > endTime) break;
      await this._seekVideo(videoElement, t);
      ctx.drawImage(videoElement, 0, 0, targetWidth, targetHeight);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      frames.push({ time: t, blob, width: targetWidth, height: targetHeight });
      if (onProgress) onProgress((i + 1) / (steps + 1), i, steps);
    }

    videoElement.currentTime = originalTime;
    if (wasPlaying) videoElement.play().catch(() => {});
    return frames;
  }

  _seekVideo(videoElement, time) {
    return new Promise((resolve) => {
      const handler = () => {
        videoElement.removeEventListener('seeked', handler);
        requestAnimationFrame(() => resolve());
      };
      videoElement.addEventListener('seeked', handler);
      videoElement.currentTime = time;
    });
  }

  async grabVideoFrame(videoElement, time) {
    const original = videoElement.currentTime;
    const wasPaused = videoElement.paused;
    if (!wasPaused) videoElement.pause();
    await this._seekVideo(videoElement, time);
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    canvas.getContext('2d').drawImage(videoElement, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    videoElement.currentTime = original;
    if (!wasPaused) videoElement.play().catch(() => {});
    return blob;
  }

  async extractAudioData(videoBlob, options = {}) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const arrayBuffer = await videoBlob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      return audioBuffer;
    } finally {
      ctx.close().catch(() => {});
    }
  }

  async encodeAudioBuffer(audioBuffer, options = {}) {
    if (!this._supported.audioEncoder) throw new Error('AudioEncoder unavailable');
    const codec = options.codec || 'opus';
    const bitrate = options.bitrate || 128000;
    const config = {
      codec,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      bitrate,
    };
    const support = await AudioEncoder.isConfigSupported(config);
    if (!support.supported) throw new Error('Encoder not supported: ' + codec);

    const chunks = [];
    const encoder = new AudioEncoder({
      output: (chunk, meta) => chunks.push({ chunk, meta }),
      error: (e) => { throw e; },
    });
    encoder.configure(config);

    const numChannels = audioBuffer.numberOfChannels;
    const totalFrames = audioBuffer.length;
    const chunkSize = 4096;
    const channelData = [];
    for (let c = 0; c < numChannels; c++) channelData.push(audioBuffer.getChannelData(c));

    const interleaved = new Float32Array(totalFrames * numChannels);
    for (let i = 0; i < totalFrames; i++) {
      for (let c = 0; c < numChannels; c++) {
        interleaved[i * numChannels + c] = channelData[c][i];
      }
    }

    for (let offset = 0; offset < totalFrames; offset += chunkSize) {
      const frameCount = Math.min(chunkSize, totalFrames - offset);
      const sliced = interleaved.slice(offset * numChannels, (offset + frameCount) * numChannels);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: audioBuffer.sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: numChannels,
        timestamp: Math.round((offset / audioBuffer.sampleRate) * 1e6),
        data: sliced.buffer,
      });
      encoder.encode(audioData);
      audioData.close();
      if (options.onProgress) options.onProgress((offset + frameCount) / totalFrames);
    }

    await encoder.flush();
    encoder.close();
    return chunks;
  }

  async encodeVideoFromCanvas(canvas, options = {}) {
    if (!this._supported.videoEncoder) throw new Error('VideoEncoder unavailable');
    const codec = options.codec || 'avc1.640028';
    const fps = options.fps || 30;
    const duration = options.duration || 5;
    const bitrate = options.bitrate || this._estimateBitrate(canvas.width, canvas.height, fps, 'balanced');
    const config = {
      codec,
      width: canvas.width,
      height: canvas.height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) throw new Error('Video encoder not supported: ' + codec);

    const chunks = [];
    const encoder = new VideoEncoder({
      output: (chunk, meta) => chunks.push({ chunk, meta }),
      error: (e) => { throw e; },
    });
    encoder.configure(config);

    const totalFrames = Math.floor(duration * fps);
    const frameDuration = 1e6 / fps;
    for (let i = 0; i < totalFrames; i++) {
      const timestamp = Math.round(i * frameDuration);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: Math.round(frameDuration),
      });
      const keyFrame = i % 30 === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      if (options.onProgress) options.onProgress((i + 1) / totalFrames);
      if (options.renderFrame) {
        await options.renderFrame(i, canvas);
      }
    }

    await encoder.flush();
    encoder.close();
    return chunks;
  }

  async trimVideo(videoBlob, startTime, endTime, options = {}) {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoBlob);
    video.muted = true;
    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });

    const duration = endTime - startTime;
    const fps = options.fps || 30;
    const width = options.width || video.videoWidth;
    const height = options.height || video.videoHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const frames = await this.extractVideoFrames(video, {
      interval: 1 / fps,
      startTime,
      endTime,
      targetWidth: width,
      targetHeight: height,
      onProgress: options.onProgress,
    });

    URL.revokeObjectURL(video.src);

    const chunks = await this.encodeVideoFromCanvas(canvas, {
      fps,
      duration,
      codec: options.codec,
      onProgress: options.onProgress,
      renderFrame: async (i, c) => {
        const frame = frames[i];
        if (frame && frame.blob) {
          const img = await this._loadImage(URL.createObjectURL(frame.blob));
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(img.src);
        }
      },
    });

    return chunks;
  }

  async mergeVideos(videoBlobs, options = {}) {
    const videos = [];
    for (const blob of videoBlobs) {
      const v = document.createElement('video');
      v.src = URL.createObjectURL(blob);
      v.muted = true;
      await new Promise((resolve) => { v.onloadedmetadata = resolve; });
      videos.push(v);
    }

    const width = options.width || videos[0].videoWidth;
    const height = options.height || videos[0].videoHeight;
    const fps = options.fps || 30;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const allFrames = [];
    for (const v of videos) {
      const frames = await this.extractVideoFrames(v, {
        interval: 1 / fps,
        targetWidth: width,
        targetHeight: height,
      });
      allFrames.push(...frames);
      URL.revokeObjectURL(v.src);
    }

    const totalDuration = allFrames.length / fps;
    const chunks = await this.encodeVideoFromCanvas(canvas, {
      fps,
      duration: totalDuration,
      onProgress: options.onProgress,
      renderFrame: async (i) => {
        const frame = allFrames[i];
        if (frame && frame.blob) {
          const img = await this._loadImage(URL.createObjectURL(frame.blob));
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(img.src);
        }
      },
    });

    return chunks;
  }

  async screenshotVideo(videoElement, time = null) {
    const t = time ?? videoElement.currentTime;
    return this.grabVideoFrame(videoElement, t);
  }

  async generateVideoThumbnails(videoBlob, count = 10, options = {}) {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoBlob);
    video.muted = true;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });

    const thumbs = [];
    const interval = video.duration / count;
    const width = options.width || 160;
    const height = options.height || Math.round(width * video.videoHeight / video.videoWidth);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < count; i++) {
      const t = i * interval;
      await this._seekVideo(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.7));
      thumbs.push({ time: t, blob });
      if (options.onProgress) options.onProgress((i + 1) / count);
    }

    URL.revokeObjectURL(video.src);
    return thumbs;
  }

  async transcodeVideo(videoBlob, options = {}) {
    const targetCodec = options.codec || 'avc1.640028';
    const targetFps = options.fps || 30;
    const targetWidth = options.width;
    const targetHeight = options.height;

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoBlob);
    video.muted = true;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });

    const width = targetWidth || video.videoWidth;
    const height = targetHeight || video.videoHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const frames = await this.extractVideoFrames(video, {
      interval: 1 / targetFps,
      targetWidth: width,
      targetHeight: height,
    });

    URL.revokeObjectURL(video.src);

    const duration = frames.length / targetFps;
    const chunks = await this.encodeVideoFromCanvas(canvas, {
      codec: targetCodec,
      fps: targetFps,
      duration,
      onProgress: options.onProgress,
      renderFrame: async (i) => {
        const frame = frames[i];
        if (frame) {
          const img = await this._loadImage(URL.createObjectURL(frame.blob));
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(img.src);
        }
      },
    });

    return chunks;
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  getCapabilitiesReport() {
    return {
      support: { ...this._supported },
      videoDecoders: Array.from(this.videoDecoderSupport.entries()),
      videoEncoders: Array.from(this.videoEncoderSupport.entries()),
      audioDecoders: Array.from(this.audioDecoderSupport.entries()),
      audioEncoders: Array.from(this.audioEncoderSupport.entries()),
    };
  }
}

export const codecService = new CodecService();
