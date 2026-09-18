const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_HIGH_WATER = 4;
const TEXT_SNIFF_BYTES = 4096;

export function chunkify(chunkSize = DEFAULT_CHUNK_SIZE) {
  let buffer = new Uint8Array(0);
  let counter = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const incoming = toUint8(chunk);
      if (!incoming.byteLength) return;
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

export function unchunkify() {
  return new TransformStream({
    transform(chunk, controller) {
      const data = chunk && chunk.data ? chunk.data : chunk;
      if (data) controller.enqueue(toUint8(data));
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

export function tapAsync(fn) {
  return new TransformStream({
    async transform(chunk, controller) {
      try { await fn(chunk); } catch {}
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

export function mapAsyncStream(fn) {
  let idx = 0;
  return new TransformStream({
    async transform(chunk, controller) {
      controller.enqueue(await fn(chunk, idx++));
    },
  });
}

export function flatMapStream(fn) {
  return new TransformStream({
    transform(chunk, controller) {
      const results = fn(chunk);
      if (Array.isArray(results)) {
        for (const r of results) controller.enqueue(r);
      } else if (results != null) {
        controller.enqueue(results);
      }
    },
  });
}

export function limitStream(maxBytes) {
  let seen = 0;
  let done = false;
  return new TransformStream({
    transform(chunk, controller) {
      if (done) return;
      const incoming = toUint8(chunk);
      const remaining = maxBytes - seen;
      if (incoming.byteLength <= remaining) {
        controller.enqueue(incoming);
        seen += incoming.byteLength;
      } else {
        controller.enqueue(incoming.slice(0, remaining));
        seen += remaining;
        done = true;
      }
    },
  });
}

export function skipStream(skipBytes) {
  let skipped = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const incoming = toUint8(chunk);
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

export function sliceStream(start, end) {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  }).pipeThrough(skipStream(start)).pipeThrough(limitStream(end - start));
}

export function progressStream(onProgress, totalSize = 0) {
  let loaded = 0;
  const start = performance.now();
  return new TransformStream({
    transform(chunk, controller) {
      const size = chunkSize(chunk);
      loaded += size;
      const elapsed = performance.now() - start;
      try {
        onProgress({
          loaded,
          total: totalSize,
          progress: totalSize ? loaded / totalSize : 0,
          elapsed,
          rate: elapsed > 0 ? loaded / (elapsed / 1000) : 0,
          eta: elapsed > 0 && totalSize && loaded > 0
            ? ((totalSize - loaded) / (loaded / elapsed))
            : 0,
        });
      } catch {}
      controller.enqueue(chunk);
    },
  });
}

export function hashStream(algorithm = 'SHA-256') {
  let chunks = [];
  let total = 0;
  const transform = new TransformStream({
    transform(chunk, controller) {
      const view = toUint8(chunk);
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
      transform.checksum = s;
      chunks = [];
    },
  });
  return transform;
}

export function textDecodeStream(encoding = 'utf-8') {
  const decoder = new TextDecoder(encoding);
  return new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(toUint8(chunk), { stream: true });
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

export function lineSplitStream(delimiter = '\n') {
  let buffer = '';
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split(delimiter);
      buffer = lines.pop();
      for (const line of lines) controller.enqueue(line);
    },
    flush(controller) {
      if (buffer) controller.enqueue(buffer);
    },
  });
}

export function byteSplitStream(delimiter) {
  const delim = toUint8(delimiter);
  let buffer = new Uint8Array(0);
  return new TransformStream({
    transform(chunk, controller) {
      const incoming = toUint8(chunk);
      const combined = new Uint8Array(buffer.byteLength + incoming.byteLength);
      combined.set(buffer);
      combined.set(incoming, buffer.byteLength);
      let start = 0;
      let idx = indexOfBytes(combined, delim, start);
      while (idx !== -1) {
        controller.enqueue(combined.slice(start, idx));
        start = idx + delim.byteLength;
        idx = indexOfBytes(combined, delim, start);
      }
      buffer = combined.slice(start);
    },
    flush(controller) {
      if (buffer.byteLength) controller.enqueue(buffer);
    },
  });
}

export function backpressureStream(maxBuffered = DEFAULT_HIGH_WATER) {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
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
      const size = chunkSize(chunk);
      bytesThisSecond += size;
      const now = performance.now();
      const elapsed = now - windowStart;
      if (elapsed < 1000 && bytesThisSecond > bytesPerSecond) {
        const wait = 1000 - elapsed;
        await new Promise((r) => setTimeout(r, wait));
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

export function bufferStream(count) {
  let buffer = [];
  return new TransformStream({
    transform(chunk, controller) {
      buffer.push(chunk);
      if (buffer.length >= count) {
        controller.enqueue(buffer);
        buffer = [];
      }
    },
    flush(controller) {
      if (buffer.length) controller.enqueue(buffer);
    },
  });
}

export function debounceStream(ms) {
  let timer = null;
  let lastChunk = null;
  return new TransformStream({
    transform(chunk, controller) {
      lastChunk = chunk;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (lastChunk) controller.enqueue(lastChunk);
        lastChunk = null;
        timer = null;
      }, ms);
    },
    flush(controller) {
      if (lastChunk) controller.enqueue(lastChunk);
    },
  });
}

export function throttleStream(ms) {
  let last = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const now = performance.now();
      if (now - last >= ms) {
        last = now;
        controller.enqueue(chunk);
      }
    },
  });
}

export function retryStream(fn, attempts = 3) {
  return new TransformStream({
    async transform(chunk, controller) {
      let lastErr;
      for (let i = 0; i < attempts; i++) {
        try {
          const result = await fn(chunk);
          if (result !== undefined) controller.enqueue(result);
          return;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, i)));
        }
      }
      try { controller.error(lastErr); } catch {}
    },
  });
}

export function collectStream(readableStream) {
  const reader = readableStream.getReader();
  const parts = [];
  let total = 0;
  return {
    async run() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const view = toUint8(value);
        parts.push(view);
        total += view.byteLength;
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.byteLength;
      }
      return out;
    },
    cancel() { return reader.cancel(); },
  };
}

export async function collectStreamAsUint8(readableStream) {
  const reader = readableStream.getReader();
  const parts = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const view = toUint8(value);
    parts.push(view);
    total += view.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export async function collectStreamAsText(readableStream, encoding = 'utf-8') {
  const bytes = await collectStreamAsUint8(readableStream);
  const detected = await sniffEncoding(bytes);
  return new TextDecoder(detected || encoding).decode(bytes);
}

export async function collectStreamAsBlob(readableStream, mimeType) {
  const reader = readableStream.getReader();
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return new Blob(parts, { type: mimeType || 'application/octet-stream' });
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

export async function* streamToGenerator(readable) {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function readableFromArray(chunks) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]);
    },
  });
}

export function readableFromBlob(blob, chunkSize = DEFAULT_CHUNK_SIZE) {
  return blob.slice(0, blob.size).stream().pipeThrough(new TransformStream({
    transform(chunk, controller) { controller.enqueue(chunk); },
  }));
}

export function readableFromAsyncIterable(iterable) {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      if (iterator.return) await iterator.return();
    },
  });
}

export function readableFromCallback(onPull, onCancel) {
  return new ReadableStream({
    async pull(controller) {
      const result = await onPull();
      if (result === null || result === undefined) controller.close();
      else controller.enqueue(result);
    },
    cancel(reason) { if (onCancel) return onCancel(reason); },
  });
}

export function concatStreams(streams) {
  let index = 0;
  let reader = null;
  return new ReadableStream({
    async pull(controller) {
      while (index < streams.length) {
        if (!reader) reader = streams[index].getReader();
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
      if (reader && reader.cancel) return reader.cancel();
    },
  });
}

export function mergeStreams(streams, options = {}) {
  const { strategy = 'round-robin' } = options;
  const readers = streams.map((s) => s.getReader());
  const done = new Set();
  let index = 0;

  return new ReadableStream({
    async pull(controller) {
      let attempts = 0;
      while (attempts < readers.length) {
        if (done.size >= readers.length) {
          controller.close();
          return;
        }
        index = index % readers.length;
        if (done.has(index)) {
          index++;
          attempts++;
          continue;
        }
        try {
          const { done: isDone, value } = await readers[index].read();
          if (isDone) {
            done.add(index);
            index++;
            attempts++;
            continue;
          }
          controller.enqueue(value);
          index++;
          return;
        } catch (err) {
          done.add(index);
          index++;
          attempts++;
        }
      }
      controller.close();
    },
    async cancel(reason) {
      for (const r of readers) {
        if (r.cancel) await r.cancel(reason).catch(() => {});
      }
    },
  });
}

export async function teeTo(stream, count) {
  let current = stream;
  const output = [];
  for (let i = 0; i < count - 1; i++) {
    const [a, b] = current.tee();
    output.push(a);
    current = b;
  }
  output.push(current);
  return output;
}

export function createStreamPipe(input, transforms) {
  let stream = input;
  for (const t of transforms) {
    stream = stream.pipeThrough(t);
  }
  return stream;
}

export function createPipeline(input) {
  const transforms = [];
  return {
    pipe(transform) { transforms.push(transform); return this; },
    build() {
      let s = input;
      for (const t of transforms) s = s.pipeThrough(t);
      return s;
    },
    async collect() {
      let s = input;
      for (const t of transforms) s = s.pipeThrough(t);
      return collectStreamAsUint8(s);
    },
  };
}

export async function sniffEncoding(buffer) {
  const view = toUint8(buffer);
  if (view.length >= 4) {
    if (view[0] === 0x00 && view[1] === 0x00 && view[2] === 0xFE && view[3] === 0xFF) return 'utf-32be';
    if (view[0] === 0xFF && view[1] === 0xFE && view[2] === 0x00 && view[3] === 0x00) return 'utf-32le';
  }
  if (view.length >= 3) {
    if (view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) return 'utf-8';
  }
  if (view.length >= 2) {
    if (view[0] === 0xFE && view[1] === 0xFF) return 'utf-16be';
    if (view[0] === 0xFF && view[1] === 0xFE) return 'utf-16le';
  }
  return 'utf-8';
}

export function detectContentType(headerBytes) {
  const b = toUint8(headerBytes);
  if (b.length >= 8) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'audio/wav';
    if (b[0] === 0x46 && b[1] === 0x4F && b[2] === 0x52 && b[3] === 0x4D) return 'audio/aiff';
  }
  if (b.length >= 4) {
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'application/zip';
    if (b[0] === 0x1F && b[1] === 0x8B) return 'application/gzip';
    if (b[0] === 0x42 && b[1] === 0x5A && b[2] === 0x68) return 'application/x-bzip2';
    if (b[0] === 0xFD && b[1] === 0x37 && b[2] === 0x7A) return 'application/x-xz';
    if (b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF) return 'application/x-7z';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'application/vnd.rar';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';
    if (b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6D) return 'application/wasm';
    if (b[0] === 0x7F && b[1] === 0x45 && b[2] === 0x4C && b[3] === 0x46) return 'application/x-elf';
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x46) return 'font/woff';
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x32) return 'font/woff2';
  }
  if (b.length >= 12) {
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand.startsWith('M4A')) return 'audio/mp4';
      if (brand.startsWith('M4V')) return 'video/x-m4v';
      return 'video/mp4';
    }
  }
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'audio/mpeg';
  if (b.length >= 4 && b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
  if (b.length >= 4 && b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'audio/flac';
  return 'application/octet-stream';
}

export async function isTextStream(readable) {
  const clone = readable.tee()[0];
  const reader = clone.getReader();
  const { value } = await reader.read();
  reader.cancel().catch(() => {});
  if (!value) return false;
  const bytes = toUint8(value).slice(0, TEXT_SNIFF_BYTES);
  let nulls = 0;
  let printable = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) nulls++;
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13 || b >= 128) printable++;
  }
  return nulls / bytes.length < 0.05 && printable / bytes.length > 0.85;
}

export class StreamPipeline {
  constructor(source) {
    if (source instanceof ReadableStream) this.stream = source;
    else if (source && source.getReader) this.stream = source;
    else if (source && typeof source.stream === 'function') this.stream = source.stream();
    else throw new TypeError('StreamPipeline: unsupported source');
  }

  static fromBlob(blob) {
    return new StreamPipeline(blob.stream());
  }

  static fromArrayBuffer(buffer) {
    return new StreamPipeline(readableFromArray([new Uint8Array(buffer)]));
  }

  static fromChunks(chunks) {
    return new StreamPipeline(readableFromArray(chunks.map(toUint8)));
  }

  static fromText(str) {
    return new StreamPipeline(readableFromArray([new TextEncoder().encode(str)]));
  }

  chunkify(size) { this.stream = this.stream.pipeThrough(chunkify(size)); return this; }
  unchunkify() { this.stream = this.stream.pipeThrough(unchunkify()); return this; }
  tap(fn) { this.stream = this.stream.pipeThrough(tap(fn)); return this; }
  tapAsync(fn) { this.stream = this.stream.pipeThrough(tapAsync(fn)); return this; }
  filter(pred) { this.stream = this.stream.pipeThrough(filterStream(pred)); return this; }
  map(fn) { this.stream = this.stream.pipeThrough(mapStream(fn)); return this; }
  mapAsync(fn) { this.stream = this.stream.pipeThrough(mapAsyncStream(fn)); return this; }
  flatMap(fn) { this.stream = this.stream.pipeThrough(flatMapStream(fn)); return this; }
  limit(bytes) { this.stream = this.stream.pipeThrough(limitStream(bytes)); return this; }
  skip(bytes) { this.stream = this.stream.pipeThrough(skipStream(bytes)); return this; }
  slice(start, end) { this.stream = this.stream.pipeThrough(sliceStream(start, end)); return this; }
  progress(fn, total) { this.stream = this.stream.pipeThrough(progressStream(fn, total)); return this; }
  hash(algo) { this._hasher = hashStream(algo); this.stream = this.stream.pipeThrough(this._hasher); return this; }
  decode(enc) { this.stream = this.stream.pipeThrough(textDecodeStream(enc)); return this; }
  encode() { this.stream = this.stream.pipeThrough(textEncodeStream()); return this; }
  splitLines(delim) { this.stream = this.stream.pipeThrough(lineSplitStream(delim)); return this; }
  splitBytes(delim) { this.stream = this.stream.pipeThrough(byteSplitStream(delim)); return this; }
  backpressure(n) { this.stream = this.stream.pipeThrough(backpressureStream(n)); return this; }
  timeout(ms) { this.stream = this.stream.pipeThrough(timeoutStream(ms)); return this; }
  rateLimit(bps) { this.stream = this.stream.pipeThrough(rateLimitStream(bps)); return this; }
  buffer(count) { this.stream = this.stream.pipeThrough(bufferStream(count)); return this; }
  throttle(ms) { this.stream = this.stream.pipeThrough(throttleStream(ms)); return this; }

  async collect() { return collectStreamAsUint8(this.stream); }
  async collectText(enc) { return collectStreamAsText(this.stream, enc); }
  async collectBlob(mime) { return collectStreamAsBlob(this.stream, mime); }
  async pipeTo(writable) { return this.stream.pipeTo(writable); }
  getReader() { return this.stream.getReader(); }
  tee() {
    const [a, b] = this.stream.tee();
    return [new StreamPipeline(a), new StreamPipeline(b)];
  }
  get checksum() { return this._hasher ? this._hasher.checksum : null; }
}

export function toUint8(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk && chunk.data) return toUint8(chunk.data);
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (Array.isArray(chunk)) return new Uint8Array(chunk);
  throw new TypeError('Cannot convert to Uint8Array');
}

export function chunkSize(chunk) {
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  if (chunk && chunk.data) return chunkSize(chunk.data);
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk).byteLength;
  return 0;
}

function indexOfBytes(haystack, needle, from) {
  if (!needle.length) return -1;
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
