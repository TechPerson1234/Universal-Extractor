"use strict";

let zipLib = null;

function ensureZipLib() {
  if (zipLib) return zipLib;
  if (typeof self.zip !== 'undefined') {
    zipLib = self.zip;
    return zipLib;
  }
  try {
    importScripts('https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.29/dist/zip.min.js');
    zipLib = self.zip;
  } catch (e) {
    throw new Error('Failed to load zip.js: ' + e.message);
  }
  return zipLib;
}

function readUint16LE(view, offset) {
  return view.getUint16(offset, true);
}

function readUint32LE(view, offset) {
  return view.getUint32(offset, true);
}

function readString(bytes, start, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
  return s;
}

function parseTar(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const entries = [];
  let offset = 0;

  while (offset < bytes.length - 512) {
    const name = readString(bytes, offset, 100).replace(/\0/g, '').trim();
    if (!name) break;

    const mode = readString(bytes, offset + 100, 8).replace(/\0/g, '').trim();
    const uid = readString(bytes, offset + 108, 8).replace(/\0/g, '').trim();
    const gid = readString(bytes, offset + 116, 8).replace(/\0/g, '').trim();
    const sizeStr = readString(bytes, offset + 124, 12).replace(/\0/g, '').trim();
    const mtimeStr = readString(bytes, offset + 136, 12).replace(/\0/g, '').trim();
    const typeFlag = bytes[offset + 156];
    const linkName = readString(bytes, offset + 157, 100).replace(/\0/g, '').trim();
    const prefix = readString(bytes, offset + 345, 155).replace(/\0/g, '').trim();
    const fullName = prefix ? prefix + '/' + name : name;
    const size = parseInt(sizeStr, 8) || 0;
    const mtime = parseInt(mtimeStr, 8) * 1000 || 0;

    const isDir = typeFlag === 0x35 || fullName.endsWith('/');
    const isFile = typeFlag === 0x30 || typeFlag === 0x00;
    const isSymlink = typeFlag === 0x32;
    const isHardlink = typeFlag === 0x31;

    entries.push({
      name: fullName,
      size,
      mode,
      uid,
      gid,
      mtime,
      type: isDir ? 'directory' : isSymlink ? 'symlink' : isHardlink ? 'hardlink' : 'file',
      linkName: linkName || null,
      offset: offset + 512,
    });

    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
  }

  return entries;
}

function parseGzipHeader(bytes) {
  if (bytes[0] !== 0x1F || bytes[1] !== 0x8B) {
    throw new Error('Not a gzip file');
  }
  const method = bytes[2];
  const flags = bytes[3];
  const mtime = readUint32LE(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 4);
  const xfl = bytes[8];
  const os = bytes[9];

  let offset = 10;
  if (flags & 0x04) {
    const xlen = bytes[offset] | (bytes[offset + 1] << 8);
    offset += 2 + xlen;
  }
  let originalName = null;
  if (flags & 0x08) {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    originalName = readString(bytes, offset, end - offset);
    offset = end + 1;
  }
  if (flags & 0x10) {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    offset = end + 1;
  }
  if (flags & 0x02) offset += 2;

  return {
    method,
    flags,
    mtime: mtime * 1000,
    xfl,
    os,
    originalName,
    dataOffset: offset,
  };
}

async function decompressGzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const header = parseGzipHeader(bytes);
  const compressed = arrayBuffer.slice(header.dataOffset, arrayBuffer.byteLength - 8);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream unavailable');
  }
  const ds = new DecompressionStream('gzip');
  const fullStream = new Blob([arrayBuffer]).stream();
  const decompressedStream = fullStream.pipeThrough(ds);
  const decompressed = await new Response(decompressedStream).arrayBuffer();
  return {
    header,
    data: decompressed,
    originalSize: decompressed.byteLength,
  };
}

function parseZipCentralDirectory(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  let eocdOffset = -1;

  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) throw new Error('EOCD not found');
  const totalEntries = readUint16LE(view, eocdOffset + 10);
  const cdSize = readUint32LE(view, eocdOffset + 12);
  const cdOffset = readUint32LE(view, eocdOffset + 16);
  const commentLen = readUint16LE(view, eocdOffset + 20);
  const comment = commentLen > 0 ? readString(bytes, eocdOffset + 22, commentLen) : '';

  const entries = [];
  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (readUint32LE(view, offset) !== 0x02014B50) break;
    const flags = readUint16LE(view, offset + 8);
    const method = readUint16LE(view, offset + 10);
    const mtime = readUint16LE(view, offset + 12);
    const mdate = readUint16LE(view, offset + 14);
    const crc = readUint32LE(view, offset + 16);
    const compressedSize = readUint32LE(view, offset + 20);
    const uncompressedSize = readUint32LE(view, offset + 24);
    const nameLen = readUint16LE(view, offset + 28);
    const extraLen = readUint16LE(view, offset + 30);
    const commentLen2 = readUint16LE(view, offset + 32);
    const localOffset = readUint32LE(view, offset + 42);
    const name = readString(bytes, offset + 46, nameLen);

    const year = ((mdate >> 9) & 0x7F) + 1980;
    const month = (mdate >> 5) & 0x0F;
    const day = mdate & 0x1F;
    const hour = (mtime >> 11) & 0x1F;
    const minute = (mtime >> 5) & 0x3F;
    const second = (mtime & 0x1F) * 2;
    const lastMod = new Date(year, month - 1, day, hour, minute, second).getTime();

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      method,
      flags,
      lastMod,
      localOffset,
      directory: name.endsWith('/'),
    });

    offset += 46 + nameLen + extraLen + commentLen2;
  }

  return {
    entries,
    comment,
    totalEntries,
    centralDirectorySize: cdSize,
    centralDirectoryOffset: cdOffset,
  };
}

async function listZipContents(arrayBuffer) {
  const central = parseZipCentralDirectory(arrayBuffer);
  return central;
}

async function extractZipEntry(arrayBuffer, entry) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const localOffset = entry.localOffset;

  if (readUint32LE(view, localOffset) !== 0x04034B50) {
    throw new Error('Local file header signature mismatch');
  }
  const nameLen = readUint16LE(view, localOffset + 26);
  const extraLen = readUint16LE(view, localOffset + 28);
  const dataOffset = localOffset + 30 + nameLen + extraLen;
  const compressedData = bytes.slice(dataOffset, dataOffset + entry.compressedSize);

  if (entry.method === 0) {
    return compressedData.buffer;
  } else if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream unavailable');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compressedData]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
  } else {
    throw new Error('Unsupported compression method: ' + entry.method);
  }
}

async function extractAllZip(arrayBuffer, onProgress) {
  const central = await listZipContents(arrayBuffer);
  const results = [];
  const total = central.entries.length;
  for (let i = 0; i < total; i++) {
    const entry = central.entries[i];
    if (entry.directory) {
      results.push({ name: entry.name, directory: true, size: 0 });
    } else {
      try {
        const data = await extractZipEntry(arrayBuffer, entry);
        results.push({
          name: entry.name,
          directory: false,
          size: data.byteLength,
          compressedSize: entry.compressedSize,
          data,
        });
      } catch (err) {
        results.push({ name: entry.name, error: err.message });
      }
    }
    if (onProgress) onProgress((i + 1) / total, i, total);
  }
  return results;
}

function detectFormat(bytes) {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x05 && bytes[3] === 0x06) return 'zip-empty';
    if (bytes[0] === 0x1F && bytes[1] === 0x8B) return 'gzip';
    if (bytes[0] === 0x42 && bytes[1] === 0x5A && bytes[2] === 0x68) return 'bzip2';
    if (bytes[0] === 0xFD && bytes[1] === 0x37 && bytes[2] === 0x7A) return 'xz';
    if (bytes[0] === 0x37 && bytes[1] === 0x7A && bytes[2] === 0xBC && bytes[3] === 0xAF) return '7z';
    if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return 'rar';
  }
  if (bytes.length >= 262) {
    const str = readString(bytes, 257, 5);
    if (str === 'ustar') return 'tar';
  }
  if (bytes.length >= 100) {
    let looksLikeTar = true;
    for (let i = 0; i < 100; i++) {
      if (bytes[i] === 0) break;
      const c = bytes[i];
      if (c < 32 || c > 126) { looksLikeTar = false; break; }
    }
    if (looksLikeTar) return 'tar';
  }
  return 'unknown';
}

const handlers = {
  async detect(data) {
    const { buffer } = data;
    const bytes = new Uint8Array(buffer);
    return { format: detectFormat(bytes), size: bytes.length };
  },

  async listZip(data) {
    const { buffer } = data;
    const central = await listZipContents(buffer);
    return {
      format: 'zip',
      entries: central.entries.map((e) => ({
        name: e.name,
        directory: e.directory,
        compressedSize: e.compressedSize,
        uncompressedSize: e.uncompressedSize,
        lastMod: e.lastMod,
        method: e.method,
        crc32: e.crc32.toString(16).padStart(8, '0'),
      })),
      totalEntries: central.totalEntries,
      comment: central.comment,
    };
  },

  async listTar(data) {
    const { buffer } = data;
    const entries = parseTar(buffer);
    return {
      format: 'tar',
      entries,
      totalEntries: entries.length,
    };
  },

  async list(data) {
    const { buffer } = data;
    const bytes = new Uint8Array(buffer);
    const format = detectFormat(bytes);
    if (format === 'zip' || format === 'zip-empty') {
      const central = await listZipContents(buffer);
      return {
        format: 'zip',
        entries: central.entries.map((e) => ({
          name: e.name,
          directory: e.directory,
          compressedSize: e.compressedSize,
          uncompressedSize: e.uncompressedSize,
          lastMod: e.lastMod,
        })),
        totalEntries: central.totalEntries,
      };
    }
    if (format === 'tar') {
      const entries = parseTar(buffer);
      return { format: 'tar', entries, totalEntries: entries.length };
    }
    if (format === 'gzip') {
      const header = parseGzipHeader(bytes);
      return {
        format: 'gzip',
        entries: [{
          name: header.originalName || 'data',
          directory: false,
          uncompressedSize: 0,
          lastMod: header.mtime,
        }],
        totalEntries: 1,
      };
    }
    throw new Error('Unsupported archive format: ' + format);
  },

  async extractZip(data) {
    const { buffer, entryName } = data;
    const central = await listZipContents(buffer);
    if (entryName) {
      const entry = central.entries.find((e) => e.name === entryName);
      if (!entry) throw new Error('Entry not found: ' + entryName);
      const fileData = await extractZipEntry(buffer, entry);
      return { name: entry.name, data: fileData, size: fileData.byteLength };
    }
    const results = await extractAllZip(buffer, (p) => {
      self.postMessage({
        taskId: data.taskId,
        progress: true,
        value: p,
        stage: 'extract-zip',
      });
    });
    const transfers = [];
    for (const r of results) {
      if (r.data) transfers.push(r.data);
    }
    return { entries: results, total: results.length };
  },

  async extractTar(data) {
    const { buffer } = data;
    const entries = parseTar(buffer);
    const bytes = new Uint8Array(buffer);
    const results = [];
    for (const entry of entries) {
      if (entry.type === 'directory') {
        results.push({ name: entry.name, directory: true, size: 0 });
      } else if (entry.type === 'file') {
        const data = bytes.slice(entry.offset, entry.offset + entry.size).buffer;
        results.push({
          name: entry.name,
          directory: false,
          size: entry.size,
          data,
        });
      }
    }
    return { entries: results, total: results.length };
  },

  async extractGzip(data) {
    const { buffer } = data;
    const result = await decompressGzip(buffer);
    return {
      name: result.header.originalName || 'decompressed',
      data: result.data,
      originalSize: result.originalSize,
      mtime: result.header.mtime,
    };
  },

  async decompress(data) {
    const { buffer, algorithm } = data;
    const algo = algorithm || 'gzip';
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream unavailable');
    }
    const ds = new DecompressionStream(algo === 'gzip' ? 'gzip' : algo === 'deflate' ? 'deflate' : 'deflate-raw');
    const stream = new Blob([buffer]).stream().pipeThrough(ds);
    const out = await new Response(stream).arrayBuffer();
    return { data: out, size: out.byteLength };
  },

  async compress(data) {
    const { buffer, algorithm } = data;
    const algo = algorithm || 'gzip';
    if (typeof CompressionStream === 'undefined') {
      throw new Error('CompressionStream unavailable');
    }
    const cs = new CompressionStream(algo === 'gzip' ? 'gzip' : algo === 'deflate' ? 'deflate' : 'deflate-raw');
    const stream = new Blob([buffer]).stream().pipeThrough(cs);
    const out = await new Response(stream).arrayBuffer();
    return { data: out, size: out.byteLength };
  },

  async zipChunks(data) {
    const zip = ensureZipLib();
    const { chunks, filename } = data;
    const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'), {
      bufferedWrite: true,
      level: 6,
    });
    for (const chunk of chunks) {
      await writer.add(chunk.name, new zip.BlobReader(new Blob([chunk.data])), {
        onprogress: (p) => {
          self.postMessage({
            taskId: data.taskId,
            progress: true,
            value: p.percent / 100,
            stage: 'zip-add',
            detail: chunk.name,
          });
        },
      });
    }
    const blob = await writer.close();
    const buffer = await blob.arrayBuffer();
    return { data: buffer, size: buffer.byteLength, filename: filename || 'archive.zip' };
  },

  async createZip(data) {
    const zip = ensureZipLib();
    const { files, options } = data;
    const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'), {
      bufferedWrite: true,
      level: (options && options.level) || 6,
    });
    for (const file of files) {
      await writer.add(file.name, new zip.BlobReader(file.blob || new Blob([file.data])), {
        onprogress: (p) => {
          self.postMessage({
            taskId: data.taskId,
            progress: true,
            value: p.percent / 100,
            stage: 'zip-add',
            detail: file.name,
          });
        },
      });
    }
    const blob = await writer.close();
    return { blob };
  },

  async createTar(data) {
    const { files } = data;
    const blocks = [];
    for (const file of files) {
      const name = file.name;
      const data = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : new Uint8Array(file.data);
      const header = new Uint8Array(512);
      const nameBytes = new TextEncoder().encode(name);
      header.set(nameBytes.slice(0, 100), 0);

      const mode = '0000644\0';
      header.set(new TextEncoder().encode(mode), 100);

      const uid = '0000000\0';
      header.set(new TextEncoder().encode(uid), 108);
      header.set(new TextEncoder().encode(uid), 116);

      const sizeOctal = data.length.toString(8).padStart(11, '0') + '\0';
      header.set(new TextEncoder().encode(sizeOctal), 124);

      const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
      header.set(new TextEncoder().encode(mtime), 136);

      header[156] = 0x30;

      let checksum = 0;
      for (let i = 0; i < 512; i++) checksum += header[i];
      const ckStr = checksum.toString(8).padStart(6, '0') + '\0 ';
      header.set(new TextEncoder().encode(ckStr), 148);

      blocks.push(header);
      blocks.push(data);

      const padding = (512 - (data.length % 512)) % 512;
      if (padding > 0) blocks.push(new Uint8Array(padding));
    }
    blocks.push(new Uint8Array(1024));

    let total = 0;
    for (const b of blocks) total += b.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const b of blocks) {
      out.set(b, off);
      off += b.length;
    }
    return { data: out.buffer, size: out.length };
  },

  async inspect(data) {
    const { buffer } = data;
    const bytes = new Uint8Array(buffer);
    const format = detectFormat(bytes);
    let info = { format, size: bytes.length };
    try {
      if (format === 'zip' || format === 'zip-empty') {
        const central = await listZipContents(buffer);
        info.entryCount = central.totalEntries;
        info.comment = central.comment;
        info.entries = central.entries.slice(0, 100).map((e) => ({
          name: e.name,
          size: e.uncompressedSize,
          compressed: e.compressedSize,
          directory: e.directory,
        }));
      } else if (format === 'tar') {
        const entries = parseTar(buffer);
        info.entryCount = entries.length;
        info.entries = entries.slice(0, 100).map((e) => ({
          name: e.name,
          size: e.size,
          type: e.type,
        }));
      } else if (format === 'gzip') {
        const header = parseGzipHeader(bytes);
        info.originalName = header.originalName;
        info.mtime = header.mtime;
      }
    } catch (e) {
      info.error = e.message;
    }
    return info;
  },
};

self.onmessage = async function (e) {
  const { taskId, operation, data } = e.data;
  try {
    const handler = handlers[operation];
    if (!handler) throw new Error('Unknown operation: ' + operation);
    if (data && !data.taskId) data.taskId = taskId;
    const result = await handler(data || {});
    const transfers = [];
    if (result && typeof result === 'object') {
      for (const key of Object.keys(result)) {
        const v = result[key];
        if (v instanceof ArrayBuffer) transfers.push(v);
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && item.data instanceof ArrayBuffer) transfers.push(item.data);
          }
        }
      }
    }
    self.postMessage({ taskId, result }, transfers);
  } catch (err) {
    self.postMessage({ taskId, error: err.message || String(err) });
  }
};

self.postMessage({ type: 'ready', worker: 'archive' });
