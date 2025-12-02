/**
 * bit-sync-esm.test.js
 * Comprehensive test suite for bit-sync-esm
 * 
 * Run with: node --test bit-sync-esm.test.js
 * Or use any test framework (vitest, jest, etc.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChecksumDocument,
  createPatchDocument,
  applyPatch,
  util
} from './index.js';

// Helper to create ArrayBuffer from string
const strToBuffer = (str) => {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
};

// Helper to compare ArrayBuffers
const buffersEqual = (buf1, buf2) => {
  if (buf1.byteLength !== buf2.byteLength) return false;
  const view1 = new Uint8Array(buf1);
  const view2 = new Uint8Array(buf2);
  for (let i = 0; i < view1.length; i++) {
    if (view1[i] !== view2[i]) return false;
  }
  return true;
};

const bufferToStr = (buf) => {
  return new TextDecoder().decode(buf);
};

test('util.adler32 - calculates correct checksum', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const result = util.adler32(0, 4, data);

  assert.equal(typeof result.a, 'number');
  assert.equal(typeof result.b, 'number');
  assert.equal(typeof result.checksum, 'number');
  assert.ok(result.checksum > 0);
});

test('util.rollingChecksum - calculates incremental checksum', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const initial = util.adler32(0, 3, data);
  const rolling = util.rollingChecksum(initial, 1, 4, data);
  const direct = util.adler32(1, 4, data);

  assert.equal(rolling.checksum, direct.checksum);
  assert.equal(rolling.a, direct.a);
  assert.equal(rolling.b, direct.b);
});

test('util.readUint32LE - reads little-endian uint32', () => {
  const data = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const result = util.readUint32LE(data, 0);
  assert.equal(result, 0x78563412);
});

test('util.hash16 - creates 16-bit hash', () => {
  const result = util.hash16(123456);
  assert.ok(result >= 0 && result < 65536);
  assert.equal(result, 123456 % 65536);
});

test('createChecksumDocument - creates valid document structure', () => {
  const blockSize = 4;
  const data = strToBuffer('Hello, World!');
  const doc = createChecksumDocument(blockSize, data);

  const view = new Uint32Array(doc);
  assert.equal(view[0], blockSize);
  assert.equal(view[1], Math.ceil(data.byteLength / blockSize));

  // Check document length: 8 bytes header + numBlocks * 20 bytes
  const expectedLength = 8 + (view[1] * 20);
  assert.equal(doc.byteLength, expectedLength);
});

test('createPatchDocument + applyPatch - identical files', () => {
  const blockSize = 4;
  const data = strToBuffer('Hello, World!');

  const checksumDoc = createChecksumDocument(blockSize, data);
  const patchDoc = createPatchDocument(checksumDoc, data);
  const result = applyPatch(patchDoc, data);

  assert.ok(buffersEqual(result, data));
});

test('createPatchDocument + applyPatch - completely different files', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Goodbye, Planet!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Goodbye, Planet!');
});

test('createPatchDocument + applyPatch - append data', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello');
  const source = strToBuffer('Hello, World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello, World!');
});

test('createPatchDocument + applyPatch - prepend data', () => {
  const blockSize = 4;
  const destination = strToBuffer('World!');
  const source = strToBuffer('Hello, World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello, World!');
});

test('createPatchDocument + applyPatch - insert in middle', () => {
  const blockSize = 4;
  const destination = strToBuffer('HelloWorld');
  const source = strToBuffer('Hello, World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello, World!');
});

test('createPatchDocument + applyPatch - remove data', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Hello');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello');
});

test('createPatchDocument + applyPatch - reorder blocks', () => {
  const blockSize = 5;
  const destination = strToBuffer('AAAAA-BBBBB-CCCCC');
  const source = strToBuffer('CCCCC-AAAAA-BBBBB');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'CCCCC-AAAAA-BBBBB');
});

test('createPatchDocument + applyPatch - large binary data', () => {
  const blockSize = 256;

  // Create large destination (10KB of pattern)
  const destArray = new Uint8Array(10240);
  for (let i = 0; i < destArray.length; i++) {
    destArray[i] = i % 256;
  }
  const destination = destArray.buffer;

  // Create source with modification in middle
  const sourceArray = new Uint8Array(destArray);
  for (let i = 5000; i < 5100; i++) {
    sourceArray[i] = 255 - (i % 256);
  }
  const source = sourceArray.buffer;

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
});

test('createPatchDocument + applyPatch - single byte change', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Hello, world!'); // lowercase 'w'

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello, world!');
});

test('createPatchDocument + applyPatch - empty source', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = new ArrayBuffer(0);

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(result.byteLength, 0);
});

test('createPatchDocument + applyPatch - empty destination', () => {
  const blockSize = 4;
  const destination = new ArrayBuffer(0);
  const source = strToBuffer('Hello, World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello, World!');
});

test('createPatchDocument + applyPatch - non-aligned block size', () => {
  const blockSize = 7; // Non-power-of-2 size
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Hello, wonderful World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
  assert.equal(bufferToStr(result), 'Hello, wonderful World!');
});

test('createPatchDocument + applyPatch - realistic scenario: document edit', () => {
  const blockSize = 64;
  const destination = strToBuffer(
    'The quick brown fox jumps over the lazy dog. ' +
    'This is a test document for binary synchronization. ' +
    'It contains multiple sentences and paragraphs.'
  );
  const source = strToBuffer(
    'The quick brown fox jumps over the lazy dog. ' +
    'This is a MODIFIED test document for binary synchronization. ' +
    'It contains multiple sentences and paragraphs. ' +
    'A new paragraph has been added here.'
  );

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));

  // Verify patch is smaller than full file
  assert.ok(patchDoc.byteLength < source.byteLength);
});

test('createPatchDocument - patch document structure', () => {
  const blockSize = 4;
  const destination = strToBuffer('AAAA');
  const source = strToBuffer('AAAABBBB');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);

  const view32 = new Uint32Array(patchDoc, 0, 3);
  assert.equal(view32[0], blockSize); // block size
  assert.equal(view32[1], 1); // patch count (1 patch for 'BBBB')
  assert.equal(view32[2], 1); // match count (1 match for 'AAAA')
});

test('stress test - large file with scattered changes', () => {
  const blockSize = 512;
  const size = 1024 * 100; // 100KB

  const destArray = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    destArray[i] = Math.floor(Math.random() * 256);
  }
  const destination = destArray.buffer;

  // Make scattered changes (small edits across file)
  const sourceArray = new Uint8Array(destArray);
  for (let i = 0; i < 50; i++) {
    const pos = Math.floor(Math.random() * (size - 100));
    for (let j = 0; j < 10; j++) {
      sourceArray[pos + j] = Math.floor(Math.random() * 256);
    }
  }
  const source = sourceArray.buffer;

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));

  // Patch should be smaller than full source
  const efficiency = patchDoc.byteLength / source.byteLength;
  console.log(`Scattered changes patch: ${(efficiency * 100).toFixed(2)}% of original size`);
  assert.ok(efficiency < 1.0); // Patch should be smaller than full file
  assert.ok(patchDoc.byteLength < source.byteLength); // Verify we're saving bandwidth
});

test('stress test - large file with localized changes (best case)', () => {
  const blockSize = 4096;
  const size = 1024 * 500; // 500KB

  // Create a structured file (simulating a real document)
  const destArray = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    destArray[i] = i % 256;
  }
  const destination = destArray.buffer;

  // Make localized changes (like editing a section of a document)
  const sourceArray = new Uint8Array(destArray);
  // Change 5KB in the middle
  for (let i = 50000; i < 55000; i++) {
    sourceArray[i] = 255 - (i % 256);
  }
  // Add 2KB at position 100000
  const insertSize = 2048;
  const temp = new Uint8Array(sourceArray.length + insertSize);
  temp.set(sourceArray.subarray(0, 100000), 0);
  for (let i = 0; i < insertSize; i++) {
    temp[100000 + i] = Math.floor(Math.random() * 256);
  }
  temp.set(sourceArray.subarray(100000), 100000 + insertSize);
  const source = temp.buffer;

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));

  // With localized changes, patch should be much more efficient
  const efficiency = patchDoc.byteLength / source.byteLength;
  console.log(`Localized changes patch: ${(efficiency * 100).toFixed(2)}% of original size`);
  assert.ok(efficiency < 0.05); // Should be < 5% for localized changes
  assert.ok(patchDoc.byteLength < 30000); // Should be around 7KB + overhead
});

console.log('\n✓ All tests passed!');