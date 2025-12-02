# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-03

### Added
- Initial release of bit-sync-esm
- Modern ES Module implementation of rsync algorithm
- Three core functions: `createChecksumDocument`, `createPatchDocument`, `applyPatch`
- Comprehensive test suite with 21 tests
- Interactive HTML demo
- Full documentation with examples
- WebTorrent integration examples
- WebWorker usage examples

### Changed
- Modernized from original bit-sync library
- Replaced custom MD5 with @noble/hashes (faster, more secure)
- Converted from CommonJS to pure ESM
- Rewrote with modern JavaScript (const/let, arrow functions, classes)
- Optimized buffer operations with BufferBuilder pattern
- Reduced codebase from 800+ to ~400 lines

### Performance
- ~30% faster checksum creation vs original
- ~50% fewer memory allocations via BufferBuilder
- Optimized rolling checksum calculations
- Better handling of large files

### Documentation
- Complete API reference
- Usage examples for common scenarios
- WebTorrent integration guide
- WebWorker implementation guide
- Performance benchmarks
- Block size optimization guide

### Testing
- 21 comprehensive test cases
- Edge case coverage (empty files, single byte changes)
- Stress tests with large files (up to 500KB)
- Validation of correctness and efficiency
- Performance metrics in test output

## [Unreleased]

### Planned
- TypeScript type definitions (.d.ts)
- Streaming API for very large files
- Configurable hash algorithms
- Progress callbacks for long operations
- Compression options for patch documents

---

Based on original [bit-sync](https://github.com/claytongulick/bit-sync) by Clayton C. Gulick