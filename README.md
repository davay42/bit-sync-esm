# bit-sync-esm

[NPM](https://www.npmjs.com/package/bit-sync-esm)
[GitHub](https://github.com/davay42/bit-sync-esm)
[Demo](https://davay42.github.io/bit-sync-esm/)

Modern ESM implementation of rsync-like binary delta synchronization for browsers. Perfect for WebTorrent, WebRTC, and other peer-to-peer applications.

## Features

- 🚀 **Pure ESM** - Modern JavaScript modules (Node.js 18+)
- 🌐 **Browser-first** - Designed for web environments  
- 🔧 **WebWorker-ready** - Run in background threads
- 📦 **Zero config** - Works out of the box
- 🔒 **Efficient** - Uses Adler-32 rolling checksums + BLAKE2s
- 🎯 **Small patches** - Only transmit what changed (59.49% efficiency in tests)
- ⚡ **Fast** - Optimized buffer operations (all tests pass in ~116ms)
- 🎛️ **Enhanced** - Progress callbacks, cancellation, multi-peer support

## Installation

```bash
npm install bit-sync-esm
```

## Quick Start

```javascript
import {
  createChecksumDocument,
  createPatchDocument,
  applyPatch
} from 'bit-sync-esm';

// On the destination (receiver) side:
const destinationData = /* ... ArrayBuffer ... */;
const checksumDoc = createChecksumDocument(4096, destinationData);
// Send checksumDoc to source

// On the source (sender) side:
const sourceData = /* ... ArrayBuffer ... */;
const patchDoc = createPatchDocument(checksumDoc, sourceData);
// Send patchDoc to destination (much smaller!)

// Back on destination side:
const syncedData = applyPatch(patchDoc, destinationData);
// syncedData is now identical to sourceData!
```

## How It Works

bit-sync-esm implements the rsync algorithm:

1. **Checksum Phase**: Destination creates checksums of its data blocks
2. **Comparison Phase**: Source compares its data against these checksums
3. **Patch Phase**: Source creates a patch with only the differences
4. **Apply Phase**: Destination applies the patch to get the updated file

This is extremely efficient for files with small changes, as only the differences are transmitted.

## API

### Exports

```javascript
import {
  createChecksumDocument,  // Create checksums for existing data
  createPatchDocument,     // Generate patch from checksums and new data
  applyPatch,              // Apply patch to existing data
  mergeChecksumDocuments,  // Combine multiple checksum documents
  optimizeBlockSize,       // Get optimal block size for a file
  util                    // Advanced utilities (adler32, rollingChecksum, etc.)
} from 'bit-sync-esm';
```

### `createChecksumDocument(blockSize, data, options?)`

Creates a checksum document for the destination data.

- `blockSize` (number): Size of each block in bytes (e.g., 4096)
- `data` (ArrayBuffer): The destination data
- `options` (Object, optional):
  - `onProgress` (Function): Progress callback `({ percent, phase, blocksProcessed, totalBlocks }) => {}`
  - `signal` (AbortSignal): Cancellation signal
- Returns: `ArrayBuffer` - Checksum document containing block checksums

**Example:**
```javascript
// Basic
const checksums = createChecksumDocument(4096, myFileData);

// With progress
const checksums = createChecksumDocument(4096, myFileData, {
  onProgress: ({ percent }) => console.log(`${percent}%`)
});

// With cancellation
const controller = new AbortController();
const checksums = createChecksumDocument(4096, myFileData, {
  signal: controller.signal
});
```

### `createPatchDocument(checksumDocument, data, options?)`

Creates a patch document by comparing source data against destination checksums.

- `checksumDocument` (ArrayBuffer): Checksum document from destination
- `data` (ArrayBuffer): The source data
- `options` (Object, optional):
  - `onProgress` (Function): Progress callback `({ percent, phase, matchesFound, stats }) => {}`
  - `signal` (AbortSignal): Cancellation signal
- Returns: `ArrayBuffer` - Patch document

**Example:**
```javascript
// Basic
const patch = createPatchDocument(checksums, newFileData);

// With progress and stats
const patch = createPatchDocument(checksums, newFileData, {
  onProgress: ({ percent, stats }) => {
    console.log(`${percent}% - Matches: ${stats.matchesFound}`);
  }
});
```

### `applyPatch(patchDocument, data, options?)`

Applies a patch to destination data, producing the updated file.

- `patchDocument` (ArrayBuffer): Patch document from source
- `data` (ArrayBuffer): The destination data
- `options` (Object, optional):
  - `onProgress` (Function): Progress callback
  - `onBlockApplied` (Function): Called for each block applied
  - `signal` (AbortSignal): Cancellation signal
- Returns: `ArrayBuffer` - Synchronized data

**Example:**
```javascript
// Basic
const updatedFile = applyPatch(patch, oldFileData);

// With block tracking
const updatedFile = applyPatch(patch, oldFileData, {
  onBlockApplied: ({ blockIndex, source }) => {
    console.log(`Applied block ${blockIndex} from ${source}`);
  }
});
```

### `mergeChecksumDocuments(...checksumDocs)`

Merges multiple checksum documents for multi-peer scenarios.

- `checksumDocs` (ArrayBuffer[]): Multiple checksum documents
- Returns: `ArrayBuffer` - Merged checksum document

**Example:**
```javascript
const merged = mergeChecksumDocuments(
  peer1Checksums,
  peer2Checksums,
  peer3Checksums
);
```

### `optimizeBlockSize(fileSize)`

Automatically determines optimal block size based on file size.

- `fileSize` (number): Size of file in bytes
- Returns: `number` - Recommended block size

**Example:**
```javascript
const blockSize = optimizeBlockSize(file.size);
const checksums = createChecksumDocument(blockSize, file);
```

### Multi-Peer Synchronization

For scenarios with multiple peers, you can merge checksum documents:

```javascript
// Each peer generates their checksums
const peer1Checksums = createChecksumDocument(4096, peer1Data);
const peer2Checksums = createChecksumDocument(4096, peer2Data);

// Merge checksums to find the most complete version
const mergedChecksums = mergeChecksumDocuments(peer1Checksums, peer2Checksums);

// Use the merged checksums to create a patch
const patch = createPatchDocument(mergedChecksums, latestVersion);
```

### `util`

Advanced utilities for custom implementations:

```javascript
const {
  adler32,          // (offset, end, data) => { a, b, checksum }
  rollingChecksum,  // (adlerInfo, offset, end, data) => { a, b, checksum }
  readUint32LE,     // (uint8View, offset) => number
  hash16,           // (num) => number (16-bit hash)
  optimizeBlockSize, // (fileSize) => recommendedBlockSize
  validateBlockSize  // (blockSize, dataSize) => validatedBlockSize
} = util;
```

## Usage Examples

### With WebTorrent

```javascript
import { createChecksumDocument, createPatchDocument, applyPatch } from 'bit-sync-esm';
import WebTorrent from 'webtorrent';

const client = new WebTorrent();

// Receiver side
function requestUpdate(file, peer) {
  const checksums = createChecksumDocument(16384, file.arrayBuffer());
  peer.send(JSON.stringify({ type: 'checksums', data: checksums }));
}

// Sender side
peer.on('message', (msg) => {
  const { type, data } = JSON.parse(msg);
  if (type === 'checksums') {
    const patch = createPatchDocument(data, myUpdatedFile);
    peer.send(JSON.stringify({ type: 'patch', data: patch }));
  }
});

// Receiver applies patch
peer.on('message', (msg) => {
  const { type, data } = JSON.parse(msg);
  if (type === 'patch') {
    const synced = applyPatch(data, myOldFile);
    // synced is now up-to-date!
  }
});
```

### In a WebWorker

```javascript
// sync-worker.js
import { createChecksumDocument, createPatchDocument, applyPatch } from 'bit-sync-esm';

self.addEventListener('message', ({ data }) => {
  const { type, payload } = data;
  
  switch (type) {
    case 'CREATE_CHECKSUM':
      const checksums = createChecksumDocument(
        payload.blockSize,
        payload.data
      );
      self.postMessage({ type: 'CHECKSUM_READY', checksums });
      break;
      
    case 'CREATE_PATCH':
      const patch = createPatchDocument(
        payload.checksums,
        payload.data
      );
      self.postMessage({ type: 'PATCH_READY', patch });
      break;
      
    case 'APPLY_PATCH':
      const synced = applyPatch(payload.patch, payload.data);
      self.postMessage({ type: 'SYNC_COMPLETE', data: synced });
      break;
  }
});

// main.js
const worker = new Worker('sync-worker.js', { type: 'module' });

worker.postMessage({
  type: 'CREATE_CHECKSUM',
  payload: { blockSize: 4096, data: myFile }
});

worker.addEventListener('message', ({ data }) => {
  if (data.type === 'CHECKSUM_READY') {
    // Send checksums to peer...
  }
});
```

### Optimizing Block Size

The block size affects both efficiency and patch size:

- **Smaller blocks (512-2048 bytes)**: Better granularity, larger checksums
- **Medium blocks (4096-8192 bytes)**: Good balance for most files
- **Larger blocks (16384-32768 bytes)**: Faster processing, less granular

Match your block size to your use case:
```javascript
// For text files with small edits
const checksums = createChecksumDocument(1024, textFile);

// For general binary files
const checksums = createChecksumDocument(4096, binaryFile);

// For large media files
const checksums = createChecksumDocument(16384, videoFile);

// Match WebTorrent's default chunk size
const checksums = createChecksumDocument(16384, torrentFile);
```

## Performance

Test results from test suite (Node.js v18+):

### Core Operations
- ✅ Basic functionality (identical files): ~2.07ms
- ✅ Basic functionality (different files): ~0.27ms
- ✅ Checksum creation with progress: ~6.82ms
- ✅ Patch creation with progress: ~4.55ms
- ✅ Patch application: ~0.33ms
- ✅ Large file with auto-optimization: ~18.57ms

### Multi-Peer Performance
- ✅ Merge single document: ~0.22ms
- ✅ Merge multiple identical: ~0.09ms
- ✅ Merge different files: ~0.12ms
- ✅ Multi-peer matching: ~0.12ms

### Efficiency
- 🔄 Large file patch efficiency: 59.49%
- ⚡ All 22 tests completed in ~116.30ms

### Block Size Recommendations
- Small files (<50KB): 512 bytes
- Medium files (50KB-5MB): 2-4KB
- Large files (>5MB): 8-16KB

## Browser Compatibility

Works in all modern browsers with:
- ES Modules support
- ArrayBuffer / TypedArrays
- WebWorkers (optional)

Tested in:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Test coverage shows all core functionality
```

## Algorithm Details

bit-sync-esm implements a three-phase synchronization algorithm:

### Phase 1: Checksum Creation
The destination divides its file into fixed-size blocks and creates:
- **Weak checksum**: Adler-32 (fast, allows rolling calculation)
- **Strong checksum**: BLAKE2s (cryptographically secure, faster than MD5)

### Phase 2: Patch Creation
The source:
1. Slides a window across its file
2. Calculates rolling Adler-32 checksums
3. On weak matches, verifies with MD5
4. Creates a patch with matched blocks + new data

### Phase 3: Patch Application
The destination:
1. Reads matched block indices
2. Copies existing blocks from its file
3. Inserts new data from patches
4. Produces the synchronized file

## Credits

Created by Denis Starov aka davay42 in Dec 2025.

Based on the original [bit-sync](https://github.com/claytongulick/bit-sync) by Clayton C. Gulick, modernized for ESM with:
- Modern JavaScript (const/let, arrow functions)
- Replaced custom MD5 with [@noble/hashes](https://github.com/paulmillr/noble-hashes)
- Optimized buffer operations (BufferBuilder pattern)
- Comprehensive test suite
- Browser-first design

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Related Projects

- [bit-sync](https://github.com/claytongulick/bit-sync) - Original implementation
- [rsync](https://rsync.samba.org/) - The algorithm that inspired this
- [WebTorrent](https://webtorrent.io/) - Streaming torrent client for the browser
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) - Fast cryptographic hashing