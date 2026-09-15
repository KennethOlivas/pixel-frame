import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { captureFilename, captureTimecode, CaptureStore, createCaptureZip, MAX_ZIP_BYTES, sanitizeVideoName, type Capture } from '../src/lib/captures';

test('capture names preserve a readable source name without path or archive traversal', () => {
  assert.equal(captureFilename('My film.v2.mp4', '01:02:03:04', 'png'), 'My film.v2_01-02-03-04.png');
  assert.equal(captureFilename('My film.v2.mp4', '01:02:03:04', 'jpeg', 2), 'My film.v2_01-02-03-04_02.jpg');
  assert.equal(captureFilename('Film.mov', '00:00:00:00', 'webp'), 'Film_00-00-00-00.webp');
  assert.equal(sanitizeVideoName('../../frame.mp4').includes('/'), false);
  assert.equal(sanitizeVideoName('C:\\videos\\frame.mov').includes('\\'), false);
  assert.equal(sanitizeVideoName('.mp4'), 'video');
  assert.equal(sanitizeVideoName('x'.repeat(400) + '.mp4').length, 120);
  assert.throws(() => captureFilename('video.mp4', '../frame', 'png'));
});

test('unknown frame rates use explicit millisecond timestamps with correct second rollover', () => {
  assert.equal(captureTimecode(1.1234, null), '00:00:01.123');
  assert.equal(captureTimecode(59.9999, null), '00:01:00.000');
  assert.equal(captureFilename('Film.mp4', captureTimecode(1.1234, null), 'png'), 'Film_00-00-01-123.png');
});

function capture(id: string, filename: string, size: number): Capture {
  return { id, filename, size, thumbnailUrl: '', time: 0, timecode: '00:00:00:00', width: 1920, height: 1080, format: 'png' };
}

test('worker ZIP export produces all original bytes and reports completed progress', async () => {
  const originals = new Map([
    ['one', new Blob(['first original frame'])],
    ['two', new Blob([new Uint8Array([0, 255, 128, 33, 64])])],
    ['three', new Blob(['third original frame'])],
  ]);
  const captures = [...originals].map(([id, blob], index) => capture(id, `film_00-00-00-0${index}.png`, blob.size));
  const progress: number[] = [];
  const blob = await createCaptureZip({ getBlob: async (id) => originals.get(id)! }, captures, (value) => progress.push(value));
  assert.equal(blob.type, 'application/zip');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), captures.map(({ filename }) => filename).sort());
  for (const item of captures) {
    assert.deepEqual(files[item.filename], new Uint8Array(await originals.get(item.id)!.arrayBuffer()));
  }
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
});

test('oversized or empty ZIPs are rejected before originals are read into memory', async () => {
  let reads = 0;
  const store = { getBlob: async () => { reads += 1; return new Blob(); } };
  await assert.rejects(createCaptureZip(store, []), /al menos una captura/);
  await assert.rejects(createCaptureZip(store, [capture('large', 'large.png', MAX_ZIP_BYTES + 1)]), /256 MiB/);
  assert.equal(reads, 0);
});

test('missing capture errors reject the ZIP instead of leaving export pending', async () => {
  await assert.rejects(createCaptureZip({ getBlob: async () => { throw new Error('Capture was removed'); } }, [capture('missing', 'missing.png', 10)]), /Capture was removed/);
});

test('capture storage keeps native dimensions, unique names, bounded memory, and explicit cleanup', async () => {
  const previousCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const draws: Array<{ width: number; height: number }> = [];
  class TestCanvas {
    constructor(public width: number, public height: number) {}
    getContext() {
      return { fillStyle: '', fillRect() {}, drawImage: () => draws.push({ width: this.width, height: this.height }) };
    }
    async convertToBlob(options: { type: string }) { return new Blob([new Uint8Array(16)], { type: options.type }); }
  }
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: TestCanvas });
  const store = new CaptureStore({ useOPFS: false, maxMemoryBytes: 32 });
  const options = { source: {} as CanvasImageSource, width: 3840, height: 2160, time: 1, fps: 24, videoName: 'Master.mp4', format: 'png' as const };
  try {
    const first = await store.capture(options);
    const second = await store.capture(options);
    assert.equal(first.filename, 'Master_00-00-01-00.png');
    assert.equal(second.filename, 'Master_00-00-01-00_02.png');
    assert.deepEqual(draws.slice(0, 2), [{ width: 3840, height: 2160 }, { width: 256, height: 144 }]);
    assert.equal(first.width, 3840);
    assert.equal(first.height, 2160);
    assert.equal((await store.getBlob(first.id)).type, 'image/png');
    assert.equal(store.count, 2);
    assert.equal(store.sizeBytes, 32);
    await assert.rejects(store.capture(options), /memoria está llena/);
    assert.equal(store.count, 2);
    await store.remove(first.id);
    assert.equal(store.sizeBytes, 16);
    await assert.rejects(store.getBlob(first.id), /ya no está en la bandeja/);
    await store.clear();
    assert.equal(store.count, 0);
    assert.equal(store.sizeBytes, 0);
    const pendingCapture = store.capture(options);
    await store.clear();
    await assert.rejects(pendingCapture, /cancelada/);
    assert.equal(store.count, 0);
    await store.dispose();
    await assert.rejects(store.capture(options), /cerrado/);
  } finally {
    await store.dispose();
    if (previousCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', previousCanvas);
    else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  }
});

test('OPFS removes stale session directories while preserving another active tab and disk originals', async () => {
  const previousCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  class TestCanvas {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage() {} }; }
    async convertToBlob(options: { type: string }) { return new Blob(['original pixels'], { type: options.type }); }
  }
  type StoredFile = { kind: 'file'; blob: Blob };
  class Directory {
    readonly kind = 'directory';
    readonly children = new Map<string, Directory | StoredFile>();
    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Directory> {
      if (!this.children.has(name) && options?.create) this.children.set(name, new Directory());
      const child = this.children.get(name);
      if (!(child instanceof Directory)) throw new DOMException('Missing directory', 'NotFoundError');
      return child;
    }
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!this.children.has(name) && options?.create) this.children.set(name, { kind: 'file', blob: new Blob() });
      const file = this.children.get(name) as StoredFile | undefined;
      if (!file) throw new DOMException('Missing file', 'NotFoundError');
      return {
        getFile: async () => file.blob,
        createWritable: async () => ({ write: async (blob: Blob) => { file.blob = blob; }, close: async () => {}, abort: async () => {} }),
      };
    }
    async removeEntry(name: string) {
      if (!this.children.delete(name)) throw new DOMException('Missing entry', 'NotFoundError');
    }
    async *entries() { yield* this.children; }
  }
  const root = new Directory();
  const parent = await root.getDirectoryHandle('pixelframe-captures', { create: true });
  const staleName = 'session-v1-00000000-0000-0000-0000-000000000001';
  const activeName = 'session-v1-00000000-0000-0000-0000-000000000002';
  const unlockedName = 'session-unlocked-00000000-0000-0000-0000-000000000003';
  for (const name of [staleName, activeName, unlockedName]) await parent.getDirectoryHandle(name, { create: true });
  const heldLocks = new Set([`pixelframe-${activeName}`]);
  type LockCallback = (lock: { name: string } | null) => Promise<void>;
  const locks = {
    async request(name: string, options: { ifAvailable?: boolean } | LockCallback, callback?: LockCallback) {
      const run = typeof options === 'function' ? options : callback!;
      if (heldLocks.has(name)) return run(null);
      heldLocks.add(name);
      try { return await run({ name }); } finally { heldLocks.delete(name); }
    },
  };
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: TestCanvas });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks, storage: { getDirectory: async () => root } } });
  const firstStore = new CaptureStore();
  const secondStore = new CaptureStore();
  const options = { source: {} as CanvasImageSource, width: 1920, height: 1080, time: 0, fps: 24, videoName: 'Film.mp4' };
  try {
    const first = await firstStore.capture(options);
    assert.equal(parent.children.has(staleName), false);
    assert.equal(parent.children.has(activeName), true);
    assert.equal(parent.children.has(unlockedName), true);
    assert.equal(await (await firstStore.getBlob(first.id)).text(), 'original pixels');
    const second = await secondStore.capture(options);
    assert.equal(await (await firstStore.getBlob(first.id)).text(), 'original pixels');
    await firstStore.remove(first.id);
    await assert.rejects(firstStore.getBlob(first.id), /ya no está/);
    await firstStore.dispose();
    assert.equal(await (await secondStore.getBlob(second.id)).text(), 'original pixels');
    await secondStore.dispose();
    assert.deepEqual([...parent.children.keys()].sort(), [activeName, unlockedName].sort());
  } finally {
    await firstStore.dispose();
    await secondStore.dispose();
    if (previousCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', previousCanvas);
    else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
