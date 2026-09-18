const DEFAULT_HIGH_WATER = 8;
const TEXT_SNIFF_BYTES = 4096;

export function chunkify(chunkSize = 1024 * 1024) {
  let buffer = new Uint8Array(0);
  let counter = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const combined = new Uint8Array(buffer.byteLength + incoming.byteLength);
      combined.set(buffer);
      combined.set(incoming, buffer.byteLength);
      buffer = combined;
      while (buffer.byteLength >= chunkSize) {
        const slice = buffer.slice(0, chunkSize);
        controller.enqueue({ index: counter++, data: slice });
        buffer = buffer.slice(chunkSize);
      }
    },
    flush(controller) {
      if (buffer.byteLength > 0) {
        controller.enqueue({ index: counter++, data: buffer });
        buffer = new Uint8Array(0);
      }
    },
  });
}

export function mergeChunks() {
  return new TransformStream({
    transform(chunk, controller) {
      const data = chunk && chunk.data ? chunk.data : chunk;
      if (data) controller.enqueue(data);
    },
  });
}

export function tap(fn) {
  return new TransformStream({
    transform(chunk, controller) {
      try { fn(chunk); } catch {}
      controller.enqueue(chunk);
    },
  });
}

export function filterStream(predicate) {
  return new TransformStream({
    transform(chunk, controller) {
      if (predicate(chunk)) controller.enqueue(chunk);
    },
  });
}

export function mapStream(fn) {
  let idx = 0;
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(fn(chunk, idx++));
    },
  });
}

export function limitStream(maxBytes) {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      if (seen >= maxBytes) return;
      const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const remaining = maxBytes - seen;
      if (incoming.byteLength <= remaining) {
        controller.enqueue(incoming);
        seen += incoming.byteLength;
      } else {
        controller.enqueue(incoming.slice(0, remaining));
        seen += remaining;
      }
    },
  });
}

export function skipStream(skipBytes) {
  let skipped = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (skipped >= skipBytes) {
        controller.enqueue(incoming);
        return;
      }
      const remaining = skipBytes - skipped;
      if (incoming.byteLength <= remaining) {
        skipped += incoming.byteLength;
      } else {
        controller.enqueue(incoming.slice(remaining));
        skipped = skipBytes;
      }
    },
  });
}

export function progressStream(onProgress, totalSize = 0) {
  let loaded = 0;
  const start = performance.now();
  return new TransformStream({
    transform(chunk, controller) {
      const size = chunk && chunk.byteLength ? chunk.byteLength : (chunk?.data?.byteLength || 0);
      loaded += size;
      const elapsed = performance.now() - start;
      try {
        onProgress({
          loaded,
          total: totalSize,
          progress: totalSize ? loaded / totalSize : 0,
          elapsed,
          rate: elapsed > 0 ? loaded / (elapsed / 1000) : 0,
        });
      } catch {}
      controller.enqueue(chunk);
    },
  });
}

export function hashStream(algorithm = 'SHA-256') {
  let chunks = [];
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const view = chunk instanceof Uint8Array
        ? chunk
        : (chunk && chunk.data ? chunk.data : new Uint8Array(chunk));
      chunks.push(view);
      total += view.byteLength;
      controller.enqueue(chunk);
    },
    async flush() {
      const combined = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        combined.set(c, off);
        off += c.byteLength;
      }
      const hash = await crypto.subtle.digest(algorithm, combined.buffer);
      const arr = new Uint8Array(hash);
      let s = '';
      for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
      this.checksum = s;
      chunks = [];
    },
  });
}

export function textDecodeStream(encoding = 'utf-8') {
  let decoder = new TextDecoder(encoding);
  return new TransformStream({
    transform(chunk, controller) {
      const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const text = decoder.decode(view, { stream: true });
      if (text) controller.enqueue(text);
    },
    flush(controller) {
      const text = decoder.decode();
      if (text) controller.enqueue(text);
    },
  });
}

export function textEncodeStream() {
  const encoder = new TextEncoder();
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(chunk));
    },
  });
}

export function backpressureStream(maxBuffered = DEFAULT_HIGH_WATER) {
  let buffered = 0;
  return new TransformStream({
    start(controller) {
      controller.desiredSize = maxBuffered;
    },
    transform(chunk, controller) {
      buffered++;
      controller.enqueue(chunk);
      buffered--;
    },
  }, { highWaterMark: maxBuffered });
}

export function timeoutStream(ms) {
  return new TransformStream({
    start(controller) {
      this._timer = setTimeout(() => {
        try { controller.error(new Error(`stream timeout after ${ms}ms`)); } catch {}
      }, ms);
    },
    transform(chunk, controller) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        try { controller.error(new Error(`stream timeout after ${ms}ms`)); } catch {}
      }, ms);
      controller.enqueue(chunk);
    },
    flush() {
      clearTimeout(this._timer);
    },
  });
}

export function rateLimitStream(bytesPerSecond) {
  let bytesThisSecond = 0;
  let windowStart = performance.now();
  return new TransformStream({
    async transform(chunk, controller) {
      const size = chunk.byteLength || (chunk.data && chunk.data.byteLength) || 0;
      bytesThisSecond += size;
      const now = performance.now();
      const elapsed = now - windowStart;
      if (elapsed < 1000 && bytesThisSecond > bytesPerSecond) {
        const wait = 1000 - elapsed;
        await new Promise(r => setTimeout(r, wait));
        bytesThisSecond = 0;
        windowStart = performance.now();
      } else if (elapsed >= 1000) {
        bytesThisSecond = size;
        windowStart = now;
      }
      controller.enqueue(chunk);
    },
  });
}

export function tee(...streams) {
  const source = streams[0];
  const [a, b] = source.tee();
  let current = b;
  for (let i = 1; i < streams.length; i++) {
    if (i === streams.length - 1) {
      streams[i].readable = current;
    } else {
      const [x, y] = current.tee();
      streams[i].readable = x;
      current = y;
    }
  }
  return a;
}

export function concatStreams(streams) {
  let index = 0;
  let reader = null;
  return new ReadableStream({
    async pull(controller) {
      while (index < streams.length) {
        if (!reader) {
          const stream = streams[index];
          reader = stream.getReader ? stream.getReader() : stream;
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          index++;
          continue;
        }
        controller.enqueue(value);
        return;
      }
      controller.close();
    },
    cancel() {
      if (reader && reader.cancel) reader.cancel();
    },
  });
}

export async function sniffEncoding(buffer) {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (view.length >= 2) {
    if (view[0] === 0xFE && view[1] === 0xFF) return 'utf-16be';
    if (view[0] === 0xFF && view[1] === 0xFE) return 'utf-16le';
  }
  if (view.length >= 3) {
    if (view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) return 'utf-8';
  }
  return 'utf-8';
}

export function detectContentType(headerBytes) {
  const view = headerBytes instanceof Uint8Array ? headerBytes : new Uint8Array(headerBytes);
  if (view.length >= 8) {
    if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) return 'image/png';
    if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) return 'image/jpeg';
    if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46) return 'image/gif';
    if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) return 'audio/wav';
  }
  if (view.length >= 4) {
    if (view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46) return 'application/pdf';
    if (view[0] === 0x50 && view[1] === 0x4B && view[2] === 0x03 && view[3] === 0x04) return 'application/zip';
    if (view[0] === 0x7F && view[1] === 0x45 && view[2] === 0x4C && view[3] === 0x46) return 'application/x-elf';
    if (view[0] === 0x1A && view[1] === 0x45 && view[2] === 0xDF && view[3] === 0xA3) return 'video/webm';
  }
  if (view.length >= 12) {
    if (
      view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70
    ) return 'video/mp4';
  }
  return 'application/octet-stream';
}

export async function isTextContent(buffer) {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const max = Math.min(view.length, TEXT_SNIFF_BYTES);
  let nulls = 0;
  let printable = 0;
  for (let i = 0; i < max; i++) {
    const b = view[i];
    if (b === 0) nulls++;
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printable++;
  }
  if (max === 0) return false;
  const ratio = printable / max;
  const nullRatio = nulls / max;
  return nullRatio < 0.05 && ratio > 0.85;
}

export function splitByDelimiter(delimiter) {
  const delim = typeof delimiter === 'string' ? new TextEncoder().encode(delimiter) : delimiter;
  let buffer = new Uint8Array(0);
  return new TransformStream({
    transform(chunk, controller) {
      const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const combined = new Uint8Array(buffer.byteLength + incoming.byteLength);
      combined.set(buffer);
      combined.set(incoming, buffer.byteLength);
      let start = 0;
      let idx = _indexOfBytes(combined, delim, start);
      while (idx !== -1) {
        controller.enqueue(combined.slice(start, idx));
        start = idx + delim.length;
        idx = _indexOfBytes(combined, delim, start);
      }
      buffer = combined.slice(start);
    },
    flush(controller) {
      if (buffer.byteLength) controller.enqueue(buffer);
    },
  });
}

function _indexOfBytes(haystack, needle, from) {
  if (needle.length === 0) return -1;
  const end = haystack.length - needle.length;
  for (let i = from; i <= end; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

export function readFromBlobRange(blob, start, end) {
  const slice = blob.slice(start, end);
  return slice.stream();
}

export function streamToAsyncIterator(readable) {
  const reader = readable.getReader();
  return {
    async next() {
      const { done, value } = await reader.read();
      return done ? { done: true } : { done: false, value };
    },
    async return() {
      if (reader.cancel) await reader.cancel();
      return { done: true };
    },
    [Symbol.asyncIterator]() { return this; },
  };
}

export async function collectStream(readableStream) {
  const reader = readableStream.getReader();
  const parts = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const view = value instanceof Uint8Array ? value : new Uint8Array(value);
    parts.push(view);
    total += view.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

export async function collectStreamAsText(readableStream, encoding = 'utf-8') {
  const bytes = await collectStream(readableStream);
  const enc = await sniffEncoding(bytes);
  return new TextDecoder(enc || encoding).decode(bytes);
}

export class StreamPipeline {
  constructor(source) {
    if (source instanceof ReadableStream) this.stream = source;
    else if (source && source.getReader) this.stream = source;
    else if (source && source.stream) this.stream = source.stream();
    else throw new TypeError('StreamPipeline: unsupported source');
  }

  static fromBlob(blob) {
    return new StreamPipeline(blob.stream());
  }

  static fromArrayBuffer(buffer) {
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new StreamPipeline(new ReadableStream({
      start(controller) {
        controller.enqueue(view);
        controller.close();
      },
    }));
  }

  chunkify(chunkSize) {
    this.stream = this.stream.pipeThrough(chunkify(chunkSize));
    return this;
  }

  merge() {
    this.stream = this.stream.pipeThrough(mergeChunks());
    return this;
  }

  tap(fn) {
    this.stream = this.stream.pipeThrough(tap(fn));
    return this;
  }

  filter(predicate) {
    this.stream = this.stream.pipeThrough(filterStream(predicate));
    return this;
  }

  map(fn) {
    this.stream = this.stream.pipeThrough(mapStream(fn));
    return this;
  }

  limit(maxBytes) {
    this.stream = this.stream.pipeThrough(limitStream(maxBytes));
    return this;
  }

  skip(bytes) {
    this.stream = this.stream.pipeThrough(skipStream(bytes));
    return this;
  }

  progress(onProgress, totalSize) {
    this.stream = this.stream.pipeThrough(progressStream(onProgress, totalSize));
    return this;
  }

  hash(algorithm = 'SHA-256') {
    this.hasher = hashStream(algorithm);
    this.stream = this.stream.pipeThrough(this.hasher);
    return this;
  }

  decode(encoding) {
    this.stream = this.stream.pipeThrough(textDecodeStream(encoding));
    return this;
  }

  encode() {
    this.stream = this.stream.pipeThrough(textEncodeStream());
    return this;
  }

  backpressure(max) {
    this.stream = this.stream.pipeThrough(backpressureStream(max));
    return this;
  }

  timeout(ms) {
    this.stream = this.stream.pipeThrough(timeoutStream(ms));
    return this;
  }

  rateLimit(bps) {
    this.stream = this.stream.pipeThrough(rateLimitStream(bps));
    return this;
  }

  split(delimiter) {
    this.stream = this.stream.pipeThrough(splitByDelimiter(delimiter));
    return this;
  }

  async collect() {
    return collectStream(this.stream);
  }

  async collectText(encoding) {
    return collectStreamAsText(this.stream, encoding);
  }

  async pipeTo(writableStream) {
    return this.stream.pipeTo(writableStream);
  }

  getReader() {
    return this.stream.getReader();
  }

  tee() {
    const [a, b] = this.stream.tee();
    return [new StreamPipeline(a), new StreamPipeline(b)];
  }

  get checksum() {
    return this.hasher ? this.hasher.checksum : null;
  }
}
