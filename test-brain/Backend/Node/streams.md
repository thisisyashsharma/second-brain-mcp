# Node.js Streams

## What Are Streams?

Streams are one of the fundamental concepts in Node.js. They allow reading or writing data piece by piece (chunk by chunk) without loading the entire content into memory.

## Four Types

1. **Readable** — source of data (e.g., `fs.createReadStream`)
2. **Writable** — destination for data (e.g., `fs.createWriteStream`)
3. **Duplex** — both readable and writable (e.g., TCP socket)
4. **Transform** — duplex stream that modifies data (e.g., `zlib.createGzip`)

## Piping

The `.pipe()` method connects a readable stream to a writable stream:

```js
fs.createReadStream('input.txt')
  .pipe(zlib.createGzip())
  .pipe(fs.createWriteStream('input.txt.gz'));
```

## Backpressure

When the writable stream cannot consume data as fast as the readable produces it, Node.js applies **backpressure** — it pauses the readable stream until the writable stream catches up.

## Why Streams Matter

- Memory efficient: process large files without loading them entirely
- Time efficient: start processing data before the entire input is available
- Composable: chain transforms via `.pipe()`
