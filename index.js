/**
 * bit-sync-esm.js
 * Modern ESM implementation of rsync-like binary delta synchronization
 * 
 * @license MIT
 * @author Based on original by Clayton C. Gulick, modernized for ESM
 */
import { md5 } from '@noble/hashes/legacy.js';

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
    view.setUint32(this.length, value, true); // little-endian
    this.length += 4;
  }

  toArrayBuffer() {
    return this.buffer.slice(0, this.length).buffer;
  }
}

/**
 * Create a 16-bit hash from a 32-bit checksum
 */
const hash16 = (num) => num % 65536;

/**
 * Calculate Adler-32 checksum for a block
 * 
 * @param {number} offset - Start offset in data
 * @param {number} end - End offset (inclusive)
 * @param {Uint8Array} data - Data to checksum
 * @returns {{a: number, b: number, checksum: number}}
 */
const adler32 = (offset, end, data) => {
  let a = 0;
  let b = 0;
  const clampedEnd = Math.min(end, data.length - 1);

  for (let i = offset; i <= clampedEnd; i++) {
    a += data[i];
    b += a;
  }

  a %= 65536;
  b %= 65536;

  return { a, b, checksum: ((b << 16) | a) >>> 0 };
};

/**
 * Calculate rolling checksum (incremental Adler-32)
 * 
 * @param {{a: number, b: number}} adlerInfo - Previous checksum info
 * @param {number} offset - Current offset
 * @param {number} end - Current end offset
 * @param {Uint8Array} data - Data array
 * @returns {{a: number, b: number, checksum: number}}
 */
const rollingChecksum = (adlerInfo, offset, end, data) => {
  const firstByte = data[offset - 1];
  const a = (adlerInfo.a - firstByte + data[end]) % 65536;
  const b = (adlerInfo.b - ((end - offset + 1) * firstByte) + a) % 65536;
  return { a, b, checksum: (b << 16) | a };
};

/**
 * Read a little-endian uint32 from arbitrary offset
 */
const readUint32LE = (uint8View, offset) => {
  return (
    uint8View[offset] |
    (uint8View[offset + 1] << 8) |
    (uint8View[offset + 2] << 16) |
    (uint8View[offset + 3] << 24)
  ) >>> 0;
};

/**
 * Create checksum document for destination data
 * 
 * Document structure (little-endian):
 * - 4 bytes: block size
 * - 4 bytes: number of blocks
 * - For each block:
 *   - 4 bytes: adler32 checksum
 *   - 16 bytes: md5 checksum (4x uint32)
 * 
 * @param {number} blockSize - Size of each block
 * @param {ArrayBuffer} data - Data to create checksums for
 * @returns {ArrayBuffer} Checksum document
 */
export const createChecksumDocument = (blockSize, data) => {
  const numBlocks = Math.ceil(data.byteLength / blockSize);
  const docLength = 8 + (numBlocks * 20); // header + (4 + 16) per block

  const doc = new ArrayBuffer(docLength);
  const view32 = new Uint32Array(doc);
  const dataView = new Uint8Array(data);

  view32[0] = blockSize;
  view32[1] = numBlocks;

  let offset = 2;

  for (let i = 0; i < numBlocks; i++) {
    const start = i * blockSize;
    const chunkLength = Math.min(blockSize, data.byteLength - start);

    // Adler-32 checksum
    view32[offset++] = adler32(start, start + chunkLength - 1, dataView).checksum;

    // MD5 checksum
    const chunk = new Uint8Array(data, start, chunkLength);
    const hash = md5(chunk);
    const hashView = new Uint32Array(hash.buffer, hash.byteOffset, 4);

    view32[offset++] = hashView[0];
    view32[offset++] = hashView[1];
    view32[offset++] = hashView[2];
    view32[offset++] = hashView[3];
  }

  return doc;
};

/**
 * Parse checksum document into hash table for fast lookup
 * 
 * @param {ArrayBuffer} checksumDocument
 * @returns {Array<Array<[blockIndex, adler32, md5hash]>>} Hash table
 */
const parseChecksumDocument = (checksumDocument) => {
  const hashTable = [];
  const view = new Uint32Array(checksumDocument);
  const numBlocks = view[1];

  let blockIndex = 1; // 1-based indexing

  for (let i = 2; i < view.length; i += 5) {
    const checksumInfo = [
      blockIndex,
      view[i], // adler32
      [view[i + 1], view[i + 2], view[i + 3], view[i + 4]] // md5
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
 * Check if a block matches any in the hash table
 * 
 * @param {{checksum: number}} adlerInfo - Adler checksum info
 * @param {Array} hashTable - Parsed checksum document
 * @param {Uint8Array} block - Block data to check
 * @returns {number|false} Matched block index or false
 */
const checkMatch = (adlerInfo, hashTable, block) => {
  const hash = hash16(adlerInfo.checksum);
  if (!hashTable[hash]) return false;

  const row = hashTable[hash];

  for (const [blockIndex, adler32sum, md5sum] of row) {
    // Quick adler32 comparison
    if (adler32sum !== adlerInfo.checksum) continue;

    // Strong MD5 comparison
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
 * Create patch document to sync source with destination
 * 
 * Document structure (little-endian):
 * - 4 bytes: block size
 * - 4 bytes: number of patches
 * - 4 bytes: number of matched blocks
 * - For each matched block:
 *   - 4 bytes: block index
 * - For each patch:
 *   - 4 bytes: last matching block index (0 = start of file)
 *   - 4 bytes: patch size
 *   - n bytes: patch data
 * 
 * @param {ArrayBuffer} checksumDocument - Checksum document from destination
 * @param {ArrayBuffer} data - Source data
 * @returns {ArrayBuffer} Patch document
 */
export const createPatchDocument = (checksumDocument, data) => {
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

  while (i < dataView.length) {
    const chunkSize = Math.min(blockSize, dataView.length - i);

    // Calculate checksum (rolling or fresh)
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
      // Found a match - save it and flush any pending patch
      matchedBlocks.appendUint32(matchedBlock);
      matchCount++;

      if (currentPatch.length > 0) {
        patches.appendUint32(lastMatchIndex);
        patches.appendUint32(currentPatch.length);
        patches.append(currentPatch.buffer.subarray(0, currentPatch.length));
        currentPatch = new BufferBuilder(blockSize * 2);
        patchCount++;
      }

      lastMatchIndex = matchedBlock;
      i += blockSize;
      adlerInfo = null; // Reset for next block
    } else {
      // No match - add byte to current patch
      currentPatch.append(dataView.subarray(i, i + 1));
      i++;
    }
  }

  // Flush final patch if exists
  if (currentPatch.length > 0) {
    patches.appendUint32(lastMatchIndex);
    patches.appendUint32(currentPatch.length);
    patches.append(currentPatch.buffer.subarray(0, currentPatch.length));
    patchCount++;
  }

  // Build final document
  const doc = new BufferBuilder(12 + matchCount * 4 + patches.length);
  doc.appendUint32(blockSize);
  doc.appendUint32(patchCount);
  doc.appendUint32(matchCount);
  doc.append(matchedBlocks.buffer.subarray(0, matchedBlocks.length));
  doc.append(patches.buffer.subarray(0, patches.length));

  return doc.toArrayBuffer();
};

/**
 * Apply patch document to destination data
 * 
 * @param {ArrayBuffer} patchDocument - Patch document from createPatchDocument
 * @param {ArrayBuffer} data - Destination data to patch
 * @returns {ArrayBuffer} Patched data
 */
export const applyPatch = (patchDocument, data) => {
  const view32 = new Uint32Array(patchDocument, 0, 3);
  const blockSize = view32[0];
  const patchCount = view32[1];
  const matchCount = view32[2];

  // Quick path: no changes (exact match)
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

  // Build patched document
  const result = new BufferBuilder(data.byteLength);
  const matchedBlocks = new Uint32Array(patchDocument, 12, matchCount);
  const view8 = new Uint8Array(patchDocument);

  let patchOffset = 12 + (matchCount * 4);
  let matchIndex = 0;

  for (let i = 0; i < patchCount; i++) {
    const lastMatchingBlockIndex = readUint32LE(view8, patchOffset);
    const patchSize = readUint32LE(view8, patchOffset + 4);
    patchOffset += 8;

    // Append matched blocks up to this patch
    while (matchIndex < matchCount) {
      const blockIndex = matchedBlocks[matchIndex];
      if (blockIndex > lastMatchingBlockIndex) break;

      const start = (blockIndex - 1) * blockSize;
      const chunkSize = Math.min(blockSize, data.byteLength - start);
      result.append(new Uint8Array(data, start, chunkSize));
      matchIndex++;
    }

    // Append patch data
    result.append(view8.subarray(patchOffset, patchOffset + patchSize));
    patchOffset += patchSize;
  }

  // Append remaining matched blocks
  while (matchIndex < matchCount) {
    const blockIndex = matchedBlocks[matchIndex];
    const start = (blockIndex - 1) * blockSize;
    const chunkSize = Math.min(blockSize, data.byteLength - start);
    result.append(new Uint8Array(data, start, chunkSize));
    matchIndex++;
  }

  return result.toArrayBuffer();
};

/**
 * Utility functions exposed for testing
 */
export const util = {
  adler32,
  rollingChecksum,
  readUint32LE,
  hash16
};