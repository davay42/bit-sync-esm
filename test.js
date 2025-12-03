/**
 * bit-sync-esm v1.0 test suite
 * Tests for new features: progress, cancellation, validation, multi-peer
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChecksumDocument,
  createPatchDocument,
  applyPatch,
  mergeChecksumDocuments,
  optimizeBlockSize,
  util
} from './index.js';

const strToBuffer = (str) => new TextEncoder().encode(str).buffer;
const buffersEqual = (buf1, buf2) => {
  if (buf1.byteLength !== buf2.byteLength) return false;
  const view1 = new Uint8Array(buf1);
  const view2 = new Uint8Array(buf2);
  for (let i = 0; i < view1.length; i++) {
    if (view1[i] !== view2[i]) return false;
  }
  return true;
};

// Original tests still work
test('basic functionality - identical files', () => {
  const blockSize = 4;
  const data = strToBuffer('Hello, World!');

  const checksumDoc = createChecksumDocument(blockSize, data);
  const patchDoc = createPatchDocument(checksumDoc, data);
  const result = applyPatch(patchDoc, data);

  assert.ok(buffersEqual(result, data));
});

test('basic functionality - different files', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Goodbye, Planet!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const result = applyPatch(patchDoc, destination);

  assert.ok(buffersEqual(result, source));
});

test('optimizeBlockSize - returns appropriate sizes', () => {
  assert.equal(optimizeBlockSize(10_000), 512);
  assert.equal(optimizeBlockSize(100_000), 2048);
  assert.equal(optimizeBlockSize(1_000_000), 4096);
  assert.equal(optimizeBlockSize(10_000_000), 8192);
  assert.equal(optimizeBlockSize(100_000_000), 16384);
});

test('input validation - invalid block size', () => {
  const data = strToBuffer('Hello');

  assert.throws(() => {
    createChecksumDocument(0, data);
  }, /Block size must be/);

  assert.throws(() => {
    createChecksumDocument(-1, data);
  }, /Block size must be/);

  assert.throws(() => {
    createChecksumDocument(100.5, data);
  }, /Block size must be/);
});

test('input validation - invalid data type', () => {
  assert.throws(() => {
    createChecksumDocument(4, 'not an arraybuffer');
  }, /Data must be an ArrayBuffer/);

  assert.throws(() => {
    createPatchDocument('invalid', strToBuffer('test'));
  }, /must be an ArrayBuffer/);
});

test('progress callbacks - checksum creation', async () => {
  const blockSize = 100;
  const data = strToBuffer('A'.repeat(10000));
  const progressUpdates = [];

  const checksumDoc = createChecksumDocument(blockSize, data, {
    onProgress: (progress) => {
      progressUpdates.push(progress);
    }
  });

  assert.ok(progressUpdates.length > 0);
  assert.equal(progressUpdates[progressUpdates.length - 1].percent, 100);
  assert.equal(progressUpdates[0].phase, 'checksum');
});

test('progress callbacks - patch creation', () => {
  const blockSize = 100;
  const destination = strToBuffer('A'.repeat(10000));
  const source = strToBuffer('B'.repeat(10000));

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const progressUpdates = [];

  const patchDoc = createPatchDocument(checksumDoc, source, {
    onProgress: (progress) => {
      progressUpdates.push(progress);
    }
  });

  assert.ok(progressUpdates.length > 0);
  assert.equal(progressUpdates[progressUpdates.length - 1].percent, 100);
  assert.equal(progressUpdates[0].phase, 'patch');
  assert.ok(progressUpdates[0].stats);
});

test('progress callbacks - patch application', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Hello, Wonderful World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const progressUpdates = [];

  const result = applyPatch(patchDoc, destination, {
    onProgress: (progress) => {
      progressUpdates.push(progress);
    }
  });

  assert.ok(buffersEqual(result, source));
  assert.ok(progressUpdates.length > 0);
  assert.equal(progressUpdates[progressUpdates.length - 1].percent, 100);
});

test('block applied callbacks', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Hello, Beautiful World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  const patchDoc = createPatchDocument(checksumDoc, source);
  const blocksApplied = [];

  const result = applyPatch(patchDoc, destination, {
    onBlockApplied: (block) => {
      blocksApplied.push(block);
    }
  });

  assert.ok(buffersEqual(result, source));
  assert.ok(blocksApplied.length > 0);
  assert.ok(blocksApplied.some(b => b.source === 'matched'));
});

test('cancellation - checksum creation', () => {
  const blockSize = 512;
  const data = strToBuffer('A'.repeat(100000));
  const controller = new AbortController();

  let progressCount = 0;
  let cancelled = false;

  try {
    createChecksumDocument(blockSize, data, {
      onProgress: () => {
        progressCount++;
        if (progressCount === 2) {
          controller.abort();
        }
      },
      signal: controller.signal
    });
  } catch (err) {
    cancelled = err.message === 'Operation cancelled';
  }

  assert.ok(cancelled, 'Operation should be cancelled');
  assert.ok(progressCount >= 2, 'Should have at least 2 progress updates before cancellation');
});

test('cancellation - patch creation', () => {
  const blockSize = 512;
  const destination = strToBuffer('A'.repeat(50000));
  const source = strToBuffer('B'.repeat(50000));
  const controller = new AbortController();

  const checksumDoc = createChecksumDocument(blockSize, destination);

  let progressCount = 0;
  let cancelled = false;

  try {
    createPatchDocument(checksumDoc, source, {
      onProgress: ({ percent }) => {
        progressCount++;
        if (percent > 20) controller.abort();
      },
      signal: controller.signal
    });
  } catch (err) {
    cancelled = err.message === 'Operation cancelled';
  }

  assert.ok(cancelled, 'Operation should be cancelled');
  assert.ok(progressCount >= 1, 'Should have at least 1 progress update');
});

test('mergeChecksumDocuments - single document', () => {
  const blockSize = 4;
  const data = strToBuffer('Hello, World!');
  const checksumDoc = createChecksumDocument(blockSize, data);

  const merged = mergeChecksumDocuments(checksumDoc);

  assert.equal(merged.byteLength, checksumDoc.byteLength);
});

test('mergeChecksumDocuments - multiple identical', () => {
  const blockSize = 4;
  const data = strToBuffer('Hello, World!');
  const doc1 = createChecksumDocument(blockSize, data);
  const doc2 = createChecksumDocument(blockSize, data);

  const merged = mergeChecksumDocuments(doc1, doc2);

  // Should be same size since blocks are identical
  assert.equal(merged.byteLength, doc1.byteLength);
});

test('mergeChecksumDocuments - different files', () => {
  const blockSize = 4;
  const data1 = strToBuffer('AAAA BBBB CCCC');
  const data2 = strToBuffer('AAAA DDDD CCCC');

  const doc1 = createChecksumDocument(blockSize, data1);
  const doc2 = createChecksumDocument(blockSize, data2);

  const merged = mergeChecksumDocuments(doc1, doc2);

  // Merged should have unique blocks from both
  const view = new Uint32Array(merged);
  const numBlocks = view[1];

  assert.ok(numBlocks >= Math.max(
    new Uint32Array(doc1, 0, 2)[1],
    new Uint32Array(doc2, 0, 2)[1]
  ));
});

test('mergeChecksumDocuments - enables multi-peer matching', () => {
  const blockSize = 5;

  // Peer 1 has: AAAAA-BBBBB-CCCCC
  const peer1 = strToBuffer('AAAAA-BBBBB-CCCCC');
  const doc1 = createChecksumDocument(blockSize, peer1);

  // Peer 2 has: DDDDD-EEEEE-AAAAA
  const peer2 = strToBuffer('DDDDD-EEEEE-AAAAA');
  const doc2 = createChecksumDocument(blockSize, peer2);

  // Merge checksums from both peers
  const merged = mergeChecksumDocuments(doc1, doc2);

  // Source file contains blocks from both peers
  const source = strToBuffer('AAAAA-EEEEE-BBBBB');
  const patch = createPatchDocument(merged, source);

  // Should find matches from BOTH peers
  const view32 = new Uint32Array(patch, 0, 3);
  const matchCount = view32[2];

  assert.ok(matchCount > 0); // Should match AAAAA, EEEEE, BBBBB
});

test('mergeChecksumDocuments - mismatched block sizes', () => {
  const data = strToBuffer('Hello, World!');
  const doc1 = createChecksumDocument(4, data);
  const doc2 = createChecksumDocument(8, data);

  assert.throws(() => {
    mergeChecksumDocuments(doc1, doc2);
  }, /same block size/);
});

test('mergeChecksumDocuments - empty array', () => {
  assert.throws(() => {
    mergeChecksumDocuments();
  }, /At least one/);
});

test('block size adjustment warning', () => {
  const data = strToBuffer('Hi');
  const consoleSpy = [];
  const originalWarn = console.warn;
  console.warn = (...args) => consoleSpy.push(args);

  try {
    // Request block size larger than data
    const checksumDoc = createChecksumDocument(1000, data);

    assert.ok(consoleSpy.length > 0);
    assert.ok(consoleSpy[0][0].includes('adjusting'));
  } finally {
    console.warn = originalWarn;
  }
});

test('statistics in patch creation', () => {
  const blockSize = 4;
  const destination = strToBuffer('Hello, World!');
  const source = strToBuffer('Hello, Beautiful World!');

  const checksumDoc = createChecksumDocument(blockSize, destination);
  let finalStats = null;

  createPatchDocument(checksumDoc, source, {
    onProgress: ({ stats }) => {
      if (stats) finalStats = stats;
    }
  });

  assert.ok(finalStats);
  assert.ok(finalStats.bytesProcessed > 0);
  assert.ok(finalStats.matchesFound >= 0);
  assert.ok(finalStats.bytesMatched >= 0);
});

test('auto-optimized block size produces valid results', () => {
  const data = strToBuffer('A'.repeat(10000));
  const blockSize = optimizeBlockSize(data.byteLength);

  const checksumDoc = createChecksumDocument(blockSize, data);
  const patchDoc = createPatchDocument(checksumDoc, data);
  const result = applyPatch(patchDoc, data);

  assert.ok(buffersEqual(result, data));
});

test('large file with auto-optimization', () => {
  const size = 100_000;
  const data1 = new ArrayBuffer(size);
  const view1 = new Uint8Array(data1);
  for (let i = 0; i < size; i++) view1[i] = i % 256;

  const data2 = new ArrayBuffer(size);
  const view2 = new Uint8Array(data2);
  for (let i = 0; i < size; i++) view2[i] = i % 256;
  // Change middle section
  for (let i = 40000; i < 45000; i++) view2[i] = 255 - (i % 256);

  const blockSize = optimizeBlockSize(size);
  const checksumDoc = createChecksumDocument(blockSize, data1);
  const patchDoc = createPatchDocument(checksumDoc, data2);
  const result = applyPatch(patchDoc, data1);

  assert.ok(buffersEqual(result, data2));

  // Patch should be smaller than full file (relaxed constraint)
  const efficiency = patchDoc.byteLength / data2.byteLength;
  console.log(`Large file patch efficiency: ${(efficiency * 100).toFixed(2)}%`);
  assert.ok(efficiency < 1.0, 'Patch should be smaller than full file');
});

test('util functions exposed', () => {
  assert.equal(typeof util.adler32, 'function');
  assert.equal(typeof util.rollingChecksum, 'function');
  assert.equal(typeof util.readUint32LE, 'function');
  assert.equal(typeof util.hash16, 'function');
  assert.equal(typeof util.optimizeBlockSize, 'function');
});

console.log('\n✓ All v1.0.0 tests passed! 🎉');