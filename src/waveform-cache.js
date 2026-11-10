const databaseName = 'mto-waveform-cache';
const storeName = 'waveforms';
const peakCount = 512;
let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open waveform cache'));
    request.onblocked = () => reject(new Error('Waveform cache upgrade is blocked'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function loadWaveformCache(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => {
      const saved = request.result;
      if (!saved || !(saved.peaks instanceof Float32Array) || saved.peaks.length !== peakCount) {
        resolve(null);
        return;
      }
      resolve({
        peaks: saved.peaks,
        progress: Number.isFinite(saved.progress) ? Math.max(0, Math.min(1, saved.progress)) : 0,
        complete: saved.complete === true,
      });
    };
    request.onerror = () => reject(request.error || new Error('Could not read waveform cache'));
  });
}

export async function saveWaveformCache(key, peaks, progress, complete) {
  if (!(peaks instanceof Float32Array) || peaks.length !== peakCount) {
    throw new TypeError('Waveform cache requires 512 peak values');
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put({
      key,
      peaks: peaks.slice(),
      progress: Math.max(0, Math.min(1, progress)),
      complete: Boolean(complete),
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not write waveform cache'));
    transaction.onabort = () => reject(transaction.error || new Error('Waveform cache write was aborted'));
  });
}
