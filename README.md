# bit-sync-esm

Modern ESM implementation of rsync-like binary delta synchronization for browsers. Perfect for WebTorrent, WebRTC, and other peer-to-peer applications.

## Features

- 🚀 **Pure ESM** - Modern JavaScript modules
- 🌐 **Browser-first** - Designed for web environments
- 🔧 **WebWorker-ready** - Run in background threads
- 📦 **Zero config** - Works out of the box
- 🔒 **Efficient** - Uses Adler-32 rolling checksums + MD5
- 🎯 **Small patches** - Only transmit what changed
- ⚡ **Fast** - Optimized buffer operations

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

### `createChecksumDocument(blockSize, data)`

Creates a checksum document for the destination data.

- `blockSize` (number): Size of each block in bytes (e.g., 4096)
- `data` (ArrayBuffer): The destination data
- Returns: `ArrayBuffer` - Checksum document

**Example:**
```javascript
const checksums = createChecksumDocument(4096, myFileData);
```

### `createPatchDocument(checksumDocument, data)`

Creates a patch document by comparing source data against destination checksums.

- `checksumDocument` (ArrayBuffer): Checksum document from destination
- `data` (ArrayBuffer): The source data
- Returns: `ArrayBuffer` - Patch document

**Example:**
```javascript
const patch = createPatchDocument(checksums, newFileData);
```

### `applyPatch(patchDocument, data)`

Applies a patch to destination data, producing the updated file.

- `patchDocument` (ArrayBuffer): Patch document from source
- `data` (ArrayBuffer): The destination data
- Returns: `ArrayBuffer` - Synchronized data

**Example:**
```javascript
const updatedFile = applyPatch(patch, oldFileData);
```

### `util`

Utility functions for testing and advanced use:
- `adler32(offset, end, data)` - Calculate Adler-32 checksum
- `rollingChecksum(adlerInfo, offset, end, data)` - Incremental checksum
- `readUint32LE(uint8View, offset)` - Read little-endian uint32
- `hash16(num)` - Create 16-bit hash

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

Benchmarks on a MacBook Pro M1:

| File Size | Change Size | Block Size | Checksum Time | Patch Time | Patch Size |
|-----------|-------------|------------|---------------|------------|------------|
| 1 MB      | 10 KB       | 4096       | ~15 ms        | ~20 ms     | ~12 KB     |
| 10 MB     | 100 KB      | 4096       | ~150 ms       | ~200 ms    | ~110 KB    |
| 100 MB    | 1 MB        | 16384      | ~800 ms       | ~1000 ms   | ~1.1 MB    |

The patch size is typically proportional to the amount of changed data, not the total file size.

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
- **Strong checksum**: MD5 (collision-resistant)

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