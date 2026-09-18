"use strict";

const HEX_CHARS = '0123456789abcdef';

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += HEX_CHARS[(bytes[i] >> 4) & 0x0F];
    s += HEX_CHARS[bytes[i] & 0x0F];
  }
  return s;
}

async function sha(buffer, algorithm) {
  const algo = algorithm || 'SHA-256';
  const hash = await crypto.subtle.digest(algo, buffer);
  return { hash: bytesToHex(new Uint8Array(hash)), algorithm: algo };
}

function md5(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }

  const originalLen = bytes.length;
  const bitLen = originalLen * 8;
  const paddedLen = ((originalLen + 8) >> 6) + 1;
  const padded = new Uint8Array(paddedLen * 64);
  padded.set(bytes);

  padded[originalLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen * 64 - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen * 64 - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xEFCDAB89;
  let c0 = 0x98BADCFE;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < paddedLen; chunk++) {
    const offset = chunk * 64;
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(offset + i * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const shift = S[i];
      B = (B + ((F << shift) | (F >>> (32 - shift)))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);

  return bytesToHex(out);
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = crc32Table();

function crc32(input, seed) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let crc = (seed !== undefined ? seed : 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0);
}

function crc32Hex(input, seed) {
  const value = crc32(input, seed);
  return value.toString(16).padStart(8, '0');
}

function adler32(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function fnv1a(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function murmur3(input, seed) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const s = seed || 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const nblocks = bytes.length >> 2;
  let h1 = s;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < nblocks; i++) {
    let k1 = view.getUint32(i * 4, true);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  let k1 = 0;
  const tail = nblocks * 4;
  switch (bytes.length & 3) {
    case 3: k1 ^= bytes[tail + 2] << 16;
    case 2: k1 ^= bytes[tail + 1] << 8;
    case 1:
      k1 ^= bytes[tail];
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= bytes.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b) >>> 0;
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35) >>> 0;
  h1 ^= h1 >>> 16;

  return (h1 >>> 0).toString(16).padStart(8, '0');
}

function xxhash32(input, seed) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const PRIME1 = 2654435761;
  const PRIME2 = 2246822519;
  const PRIME3 = 3266489917;
  const PRIME4 = 668265263;
  const PRIME5 = 374761393;

  let h32;
  let i = 0;
  const len = bytes.length;
  const s = (seed || 0) >>> 0;

  if (len >= 16) {
    let v1 = (s + PRIME1 + PRIME2) >>> 0;
    let v2 = (s + PRIME2) >>> 0;
    let v3 = s;
    let v4 = (s - PRIME1) >>> 0;

    const limit = len - 16;
    while (i <= limit) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + i, 16);
      v1 = Math.imul((v1 + Math.imul(view.getUint32(0, true), PRIME2)) >>> 0, PRIME1) >>> 0;
      v1 = ((v1 << 13) | (v1 >>> 19)) >>> 0;
      v2 = Math.imul((v2 + Math.imul(view.getUint32(4, true), PRIME2)) >>> 0, PRIME1) >>> 0;
      v2 = ((v2 << 13) | (v2 >>> 19)) >>> 0;
      v3 = Math.imul((v3 + Math.imul(view.getUint32(8, true), PRIME2)) >>> 0, PRIME1) >>> 0;
      v3 = ((v3 << 13) | (v3 >>> 19)) >>> 0;
      v4 = Math.imul((v4 + Math.imul(view.getUint32(12, true), PRIME2)) >>> 0, PRIME1) >>> 0;
      v4 = ((v4 << 13) | (v4 >>> 19)) >>> 0;
      i += 16;
    }

    h32 = (((v1 << 1) | (v1 >>> 31)) + ((v2 << 7) | (v2 >>> 25)) +
           ((v3 << 12) | (v3 >>> 20)) + ((v4 << 18) | (v4 >>> 14))) >>> 0;
  } else {
    h32 = (s + PRIME5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;

  while (i <= len - 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i, 4);
    h32 = (h32 + Math.imul(view.getUint32(0, true), PRIME3)) >>> 0;
    h32 = Math.imul((h32 << 17) | (h32 >>> 15), PRIME4) >>> 0;
    i += 4;
  }

  while (i < len) {
    h32 = (h32 + Math.imul(bytes[i], PRIME5)) >>> 0;
    h32 = Math.imul((h32 << 11) | (h32 >>> 21), PRIME1) >>> 0;
    i++;
  }

  h32 ^= h32 >>> 15;
  h32 = Math.imul(h32, PRIME2) >>> 0;
  h32 ^= h32 >>> 13;
  h32 = Math.imul(h32, PRIME3) >>> 0;
  h32 ^= h32 >>> 16;

  return (h32 >>> 0).toString(16).padStart(8, '0');
}

function sha1Pure(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  const originalLen = bytes.length;
  const bitLen = originalLen * 8;
  const paddedLen = (((originalLen + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[originalLen] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 4294967296));
  view.setUint32(paddedLen - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xEFCDAB89;
  let h2 = 0x98BADCFE;
  let h3 = 0x10325476;
  let h4 = 0xC3D2E1F0;

  const w = new Uint32Array(80);

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4);
    }
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = ((v << 1) | (v >>> 31)) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;

    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);

  return bytesToHex(out);
}

const handlers = {
  async hash(data) {
    const { buffer, algorithm } = data;
    return sha(buffer, algorithm || 'SHA-256');
  },

  async hashMulti(data) {
    const { buffer, algorithms } = data;
    const results = {};
    for (const algo of algorithms) {
      const { hash } = await sha(buffer, algo);
      results[algo] = hash;
    }
    return results;
  },

  async md5(data) {
    return { hash: md5(data.buffer), algorithm: 'MD5' };
  },

  async sha1(data) {
    return { hash: sha1Pure(data.buffer), algorithm: 'SHA-1' };
  },

  async crc32(data) {
    return { hash: crc32Hex(data.buffer, data.seed), algorithm: 'CRC32' };
  },

  async adler32(data) {
    return { hash: adler32(data.buffer).toString(16), algorithm: 'ADLER32' };
  },

  async fnv1a(data) {
    return { hash: fnv1a(data.buffer), algorithm: 'FNV-1a' };
  },

  async murmur3(data) {
    return { hash: murmur3(data.buffer, data.seed), algorithm: 'Murmur3' };
  },

  async xxhash(data) {
    return { hash: xxhash32(data.buffer, data.seed), algorithm: 'xxHash32' };
  },

  async all(data) {
    const { buffer } = data;
    const [sha256, sha1, sha512] = await Promise.all([
      sha(buffer, 'SHA-256'),
      sha(buffer, 'SHA-1'),
      sha(buffer, 'SHA-512'),
    ]);
    return {
      'SHA-256': sha256.hash,
      'SHA-1': sha1.hash,
      'SHA-512': sha512.hash,
      'MD5': md5(buffer),
      'CRC32': crc32Hex(buffer),
      'FNV-1a': fnv1a(buffer),
      'Murmur3': murmur3(buffer, 0),
      'xxHash32': xxhash32(buffer, 0),
      'Adler32': adler32(buffer).toString(16).padStart(8, '0'),
    };
  },

  async streamHash(data) {
    const { chunks, algorithm } = data;
    const algo = algorithm || 'SHA-256';
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      combined.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    return sha(combined.buffer, algo);
  },

  async streamCRC32(data) {
    const { chunks } = data;
    let crc = 0xFFFFFFFF;
    for (const c of chunks) {
      const bytes = new Uint8Array(c);
      for (let i = 0; i < bytes.length; i++) {
        crc = (CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
      }
    }
    const value = (crc ^ 0xFFFFFFFF) >>> 0;
    return { hash: value.toString(16).padStart(8, '0'), algorithm: 'CRC32' };
  },

  async streamMD5(data) {
    const { chunks } = data;
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      combined.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    return { hash: md5(combined.buffer), algorithm: 'MD5' };
  },

  async verify(data) {
    const { buffer, expected, algorithm } = data;
    const { hash } = await sha(buffer, algorithm || 'SHA-256');
    return { hash, expected, match: hash === expected };
  },

  async compare(data) {
    const { a, b, algorithm } = data;
    const [ha, hb] = await Promise.all([
      sha(a, algorithm || 'SHA-256'),
      sha(b, algorithm || 'SHA-256'),
    ]);
    return { hashA: ha.hash, hashB: hb.hash, identical: ha.hash === hb.hash };
  },
};

self.onmessage = async function (e) {
  const { taskId, operation, data } = e.data;
  try {
    const handler = handlers[operation];
    if (!handler) throw new Error('Unknown operation: ' + operation);
    const result = await handler(data || {});
    self.postMessage({ taskId, result });
  } catch (err) {
    self.postMessage({ taskId, error: err.message || String(err) });
  }
};

self.postMessage({ type: 'ready', worker: 'hash' });
