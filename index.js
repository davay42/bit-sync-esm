/**
 * bit-sync-esm
 * Modern ESM implementation of rsync-like binary delta synchronization
 * 
 * @license MIT
 * @version 1.0.0
 */

import { md5 } from '@noble/hashes/legacy.js';

// Constants
const HASH_TABLE_SIZE = 65536; // 2^16
const DEFAULT_BLOCK_SIZE = 4096;
const MIN_BLOCK_SIZE = 1; // Allow any size (validation warns if < 256)
const MAX_BLOCK_SIZE = 1024 * 1024; // 1MB
const RECOMMENDED_MIN_BLOCK_SIZE = 256;

/**
 * Efficient buffer builder that reduces allocations
 */
class BufferBuilder {
  constructor(initialSize = 8192) {
    this.buffer = new Uint8Array(initialSize);
    this.length = 0;
  }

  append(data) {
    const dataArray = data instanceof Uint8Array ? data : new Uint8Array(data);
    const needed = this.length + dataArray.length;

    if (needed > this.buffer.length) {
      const newSize = Math.max(needed, this.buffer.length * 2);
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.buffer.subarray(0, this.length));
      this.buffer = newBuffer;
    }

    this.buffer.set(dataArray, this.length);
    this.length += dataArray.length;
  }

  appendUint32(value) {
    const needed = this.length + 4;
    if (needed > this.buffer.length) {
      const newBuffer = new Uint8Array(Math.max(needed, this.buffer.length * 2));
      newBuffer.set(this.buffer.subarray(0, this.length));
      this.buffer = newBuffer;
    }

    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
    view.setUint32(this.length, value, true);
    this.length += 4;
  }

  toArrayBuffer() {
    return this.buffer.slice(0, this.length).buffer;
  }
}

// Core checksum functions
const hash16 = (num) => num % HASH_TABLE_SIZE;

const adler32 = (offset, end, data) => {
  let a = 0;
  let b = 0;
  const clampedEnd = Math.min(end, data.length - 1);

  for (let i = offset; i <= clampedEnd; i++) {
    a += data[i];
    b += a;
  }

  a %= HASH_TABLE_SIZE;
  b %= HASH_TABLE_SIZE;

  return { a, b, checksum: ((b << 16) | a) >>> 0 };
};

const rollingChecksum = (adlerInfo, offset, end, data) => {
  const firstByte = data[offset - 1];
  const a = (adlerInfo.a - firstByte + data[end]) % HASH_TABLE_SIZE;
  const b = (adlerInfo.b - ((end - offset + 1) * firstByte) + a) % HASH_TABLE_SIZE;
  return { a, b, checksum: (b << 16) | a };
};

const readUint32LE = (uint8View, offset) => {
  return (
    uint8View[offset] |
    (uint8View[offset + 1] << 8) |
    (uint8View[offset + 2] << 16) |
    (uint8View[offset + 3] << 24)
  ) >>> 0;
};

/**
 * Optimize block size based on file size
 */
export const optimizeBlockSize = (fileSize) => {
  if (fileSize < 50_000) return 512;
  if (fileSize < 500_000) return 2048;
  if (fileSize < 5_000_000) return 4096;
  if (fileSize < 50_000_000) return 8192;
  return 16384;
};

/**
 * Validate block size with warnings for sub-optimal sizes
 */
const validateBlockSize = (blockSize, dataSize) => {
  if (!Number.isInteger(blockSize) || blockSize < MIN_BLOCK_SIZE) {
    throw new Error(`Block size must be an integer >= ${MIN_BLOCK_SIZE}`);
  }
  if (blockSize > MAX_BLOCK_SIZE) {
    throw new Error(`Block size must be <= ${MAX_BLOCK_SIZE}`);
  }
  if (blockSize < RECOMMENDED_MIN_BLOCK_SIZE && dataSize > 1000) {
    console.warn(
      `Block size ${blockSize} is below recommended minimum of ${RECOMMENDED_MIN_BLOCK_SIZE}. ` +
      `Performance may be degraded for production use.`
    );
  }
  if (blockSize > dataSize) {
    console.warn(`Block size (${blockSize}) exceeds data size (${dataSize}), adjusting`);
    return Math.max(MIN_BLOCK_SIZE, Math.floor(dataSize / 2));
  }
  return blockSize;
};

/**
 * Create checksum document with optional progress callback
 * 
 * @param {number} blockSize - Size of each block in bytes
 * @param {ArrayBuffer} data - Data to create checksums for
 * @param {Object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback
 * @param {AbortSignal} options.signal - Cancellation signal
 * @returns {ArrayBuffer} Checksum document
 */
export const createChecksumDocument = (blockSize, data, options = {}) => {
  const { onProgress, signal } = options;

  if (!(data instanceof ArrayBuffer)) {
    throw new Error('Data must be an ArrayBuffer');
  }

  blockSize = validateBlockSize(blockSize, data.byteLength);
  const numBlocks = Math.ceil(data.byteLength / blockSize);
  const docLength = 8 + (numBlocks * 20);

  const doc = new ArrayBuffer(docLength);
  const view32 = new Uint32Array(doc);
  const dataView = new Uint8Array(data);

  view32[0] = blockSize;
  view32[1] = numBlocks;

  let offset = 2;

  for (let i = 0; i < numBlocks; i++) {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    const start = i * blockSize;
    const chunkLength = Math.min(blockSize, data.byteLength - start);

    // Adler-32
    view32[offset++] = adler32(start, start + chunkLength - 1, dataView).checksum;

    // MD5
    const chunk = new Uint8Array(data, start, chunkLength);
    const hash = md5(chunk);
    const hashView = new Uint32Array(hash.buffer, hash.byteOffset, 4);

    view32[offset++] = hashView[0];
    view32[offset++] = hashView[1];
    view32[offset++] = hashView[2];
    view32[offset++] = hashView[3];

    if (onProgress && (i % 100 === 0 || i === numBlocks - 1)) {
      onProgress({
        phase: 'checksum',
        blocksProcessed: i + 1,
        totalBlocks: numBlocks,
        percent: ((i + 1) / numBlocks) * 100
      });
    }
  }

  return doc;
};

/**
 * Parse checksum document into hash table
 */
const parseChecksumDocument = (checksumDocument) => {
  const hashTable = [];
  const view = new Uint32Array(checksumDocument);
  const numBlocks = view[1];

  let blockIndex = 1;

  for (let i = 2; i < view.length; i += 5) {
    const checksumInfo = [
      blockIndex,
      view[i],
      [view[i + 1], view[i + 2], view[i + 3], view[i + 4]]
    ];

    const hash = hash16(checksumInfo[1]);
    if (!hashTable[hash]) hashTable[hash] = [];
    hashTable[hash].push(checksumInfo);
    blockIndex++;
  }

  if (numBlocks !== blockIndex - 1) {
    throw new Error(
      `Checksum document mismatch: expected ${numBlocks} blocks, found ${blockIndex - 1}`
    );
  }

  return hashTable;
};

/**
 * Check if block matches any in the hash table
 */
const checkMatch = (adlerInfo, hashTable, block) => {
  const hash = hash16(adlerInfo.checksum);
  if (!hashTable[hash]) return false;

  const row = hashTable[hash];

  for (const [blockIndex, adler32sum, md5sum] of row) {
    if (adler32sum !== adlerInfo.checksum) continue;

    const blockHash = md5(block);
    const blockHashView = new Uint32Array(
      blockHash.buffer,
      blockHash.byteOffset,
      4
    );

    if (
      blockHashView[0] === md5sum[0] &&
      blockHashView[1] === md5sum[1] &&
      blockHashView[2] === md5sum[2] &&
      blockHashView[3] === md5sum[3]
    ) {
      return blockIndex;
    }
  }

  return false;
};

/**
 * Create patch document with progress and cancellation support
 * 
 * @param {ArrayBuffer} checksumDocument - Checksum document from destination
 * @param {ArrayBuffer} data - Source data
 * @param {Object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback
 * @param {AbortSignal} options.signal - Cancellation signal
 * @returns {ArrayBuffer} Patch document
 */
export const createPatchDocument = (checksumDocument, data, options = {}) => {
  const { onProgress, signal } = options;

  if (!(checksumDocument instanceof ArrayBuffer)) {
    throw new Error('Checksum document must be an ArrayBuffer');
  }
  if (!(data instanceof ArrayBuffer)) {
    throw new Error('Data must be an ArrayBuffer');
  }

  const checksumView = new Uint32Array(checksumDocument);
  const blockSize = checksumView[0];
  const hashTable = parseChecksumDocument(checksumDocument);
  const dataView = new Uint8Array(data);

  const matchedBlocks = new BufferBuilder(4096);
  const patches = new BufferBuilder(8192);

  let matchCount = 0;
  let patchCount = 0;
  let lastMatchIndex = 0;
  let currentPatch = new BufferBuilder(blockSize * 2);
  let adlerInfo = null;
  let i = 0;
  let lastProgressUpdate = 0;

  const stats = {
    bytesProcessed: 0,
    matchesFound: 0,
    bytesMatched: 0,
    bytesSent: 0
  };

  while (i < dataView.length) {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    const chunkSize = Math.min(blockSize, dataView.length - i);

    if (adlerInfo && chunkSize === blockSize) {
      adlerInfo = rollingChecksum(adlerInfo, i, i + chunkSize - 1, dataView);
    } else {
      adlerInfo = adler32(i, i + chunkSize - 1, dataView);
    }

    const matchedBlock = checkMatch(
      adlerInfo,
      hashTable,
      dataView.subarray(i, i + chunkSize)
    );

    if (matchedBlock) {
      matchedBlocks.appendUint32(matchedBlock);
      matchCount++;
      stats.matchesFound++;
      stats.bytesMatched += blockSize;

      if (currentPatch.length > 0) {
        patches.appendUint32(lastMatchIndex);
        patches.appendUint32(currentPatch.length);
        patches.append(currentPatch.buffer.subarray(0, currentPatch.length));
        stats.bytesSent += currentPatch.length;
        currentPatch = new BufferBuilder(blockSize * 2);
        patchCount++;
      }

      lastMatchIndex = matchedBlock;
      i += blockSize;
      adlerInfo = null;
    } else {
      currentPatch.append(dataView.subarray(i, i + 1));
      i++;
    }

    stats.bytesProcessed = i;

    if (onProgress && (i - lastProgressUpdate) > blockSize * 10) {
      onProgress({
        phase: 'patch',
        bytesProcessed: i,
        totalBytes: dataView.length,
        percent: (i / dataView.length) * 100,
        matchesFound: matchCount,
        patchesCreated: patchCount,
        stats
      });
      lastProgressUpdate = i;
    }
  }

  if (currentPatch.length > 0) {
    patches.appendUint32(lastMatchIndex);
    patches.appendUint32(currentPatch.length);
    patches.append(currentPatch.buffer.subarray(0, currentPatch.length));
    stats.bytesSent += currentPatch.length;
    patchCount++;
  }

  const doc = new BufferBuilder(12 + matchCount * 4 + patches.length);
  doc.appendUint32(blockSize);
  doc.appendUint32(patchCount);
  doc.appendUint32(matchCount);
  doc.append(matchedBlocks.buffer.subarray(0, matchedBlocks.length));
  doc.append(patches.buffer.subarray(0, patches.length));

  if (onProgress) {
    onProgress({
      phase: 'patch',
      bytesProcessed: dataView.length,
      totalBytes: dataView.length,
      percent: 100,
      matchesFound: matchCount,
      patchesCreated: patchCount,
      stats
    });
  }

  return doc.toArrayBuffer();
};

/**
 * Apply patch with verification callbacks
 * 
 * @param {ArrayBuffer} patchDocument - Patch document
 * @param {ArrayBuffer} data - Destination data
 * @param {Object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback
 * @param {Function} options.onBlockApplied - Block applied callback
 * @param {AbortSignal} options.signal - Cancellation signal
 * @returns {ArrayBuffer} Patched data
 */
export const applyPatch = (patchDocument, data, options = {}) => {
  const { onProgress, onBlockApplied, signal } = options;

  if (!(patchDocument instanceof ArrayBuffer)) {
    throw new Error('Patch document must be an ArrayBuffer');
  }
  if (!(data instanceof ArrayBuffer)) {
    throw new Error('Data must be an ArrayBuffer');
  }

  const view32 = new Uint32Array(patchDocument, 0, 3);
  const blockSize = view32[0];
  const patchCount = view32[1];
  const matchCount = view32[2];

  // Quick path: exact match
  if (patchCount === 0) {
    const matchedBlocks = new Uint32Array(patchDocument, 12, matchCount);
    const expectedBlocks = Math.ceil(data.byteLength / blockSize);

    if (matchCount === expectedBlocks) {
      let isSequential = true;
      for (let i = 0; i < matchCount; i++) {
        if (matchedBlocks[i] !== i + 1) {
          isSequential = false;
          break;
        }
      }
      if (isSequential) return data;
    }
  }

  const result = new BufferBuilder(data.byteLength);
  const matchedBlocks = new Uint32Array(patchDocument, 12, matchCount);
  const view8 = new Uint8Array(patchDocument);

  let patchOffset = 12 + (matchCount * 4);
  let matchIndex = 0;
  let blocksApplied = 0;

  for (let i = 0; i < patchCount; i++) {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    const lastMatchingBlockIndex = readUint32LE(view8, patchOffset);
    const patchSize = readUint32LE(view8, patchOffset + 4);
    patchOffset += 8;

    while (matchIndex < matchCount) {
      const blockIndex = matchedBlocks[matchIndex];
      if (blockIndex > lastMatchingBlockIndex) break;

      const start = (blockIndex - 1) * blockSize;
      const chunkSize = Math.min(blockSize, data.byteLength - start);
      result.append(new Uint8Array(data, start, chunkSize));

      if (onBlockApplied) {
        onBlockApplied({
          blockIndex,
          source: 'matched',
          size: chunkSize
        });
      }

      matchIndex++;
      blocksApplied++;
    }

    result.append(view8.subarray(patchOffset, patchOffset + patchSize));

    if (onBlockApplied) {
      onBlockApplied({
        blockIndex: null,
        source: 'patch',
        size: patchSize
      });
    }

    patchOffset += patchSize;

    if (onProgress) {
      onProgress({
        phase: 'apply',
        patchesApplied: i + 1,
        totalPatches: patchCount,
        blocksApplied,
        percent: ((i + 1) / patchCount) * 100
      });
    }
  }

  while (matchIndex < matchCount) {
    const blockIndex = matchedBlocks[matchIndex];
    const start = (blockIndex - 1) * blockSize;
    const chunkSize = Math.min(blockSize, data.byteLength - start);
    result.append(new Uint8Array(data, start, chunkSize));

    if (onBlockApplied) {
      onBlockApplied({
        blockIndex,
        source: 'matched',
        size: chunkSize
      });
    }

    matchIndex++;
  }

  if (onProgress) {
    onProgress({
      phase: 'apply',
      patchesApplied: patchCount,
      totalPatches: patchCount,
      blocksApplied: matchCount,
      percent: 100
    });
  }

  return result.toArrayBuffer();
};

/**
 * Merge multiple checksum documents (for multi-peer scenarios)
 * 
 * @param {...ArrayBuffer} checksumDocs - Checksum documents to merge
 * @returns {ArrayBuffer} Merged checksum document
 */
export const mergeChecksumDocuments = (...checksumDocs) => {
  if (checksumDocs.length === 0) {
    throw new Error('At least one checksum document required');
  }

  const blockSizes = checksumDocs.map(doc => new Uint32Array(doc, 0, 1)[0]);
  const blockSize = blockSizes[0];

  if (!blockSizes.every(size => size === blockSize)) {
    throw new Error('All checksum documents must have the same block size');
  }

  const blockMap = new Map();

  for (const doc of checksumDocs) {
    const view = new Uint32Array(doc);
    const numBlocks = view[1];

    for (let i = 2; i < 2 + numBlocks * 5; i += 5) {
      const key = `${view[i]}-${view[i + 1]}-${view[i + 2]}-${view[i + 3]}-${view[i + 4]}`;
      if (!blockMap.has(key)) {
        blockMap.set(key, [view[i], view[i + 1], view[i + 2], view[i + 3], view[i + 4]]);
      }
    }
  }

  const numBlocks = blockMap.size;
  const docLength = 8 + (numBlocks * 20);
  const doc = new ArrayBuffer(docLength);
  const view32 = new Uint32Array(doc);

  view32[0] = blockSize;
  view32[1] = numBlocks;

  let offset = 2;
  for (const block of blockMap.values()) {
    view32[offset++] = block[0];
    view32[offset++] = block[1];
    view32[offset++] = block[2];
    view32[offset++] = block[3];
    view32[offset++] = block[4];
  }

  return doc;
};

/**
 * Utility functions exposed for testing and advanced use
 */
export const util = {
  adler32,
  rollingChecksum,
  readUint32LE,
  hash16,
  optimizeBlockSize,
  validateBlockSize
};