import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import yauzl from 'yauzl';
import { localDate } from '../time.js';
import { buildGtfsData } from './build.js';
import type { GtfsData, GtfsSource } from './types.js';

export const GTFS_URL =
  process.env.GTFS_URL ?? 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip';

/** Descarga el zip si no existe o tiene más de `maxAgeMs`. */
export async function downloadGtfs(dest: string, maxAgeMs: number): Promise<void> {
  if (existsSync(dest) && Date.now() - statSync(dest).mtimeMs < maxAgeMs) return;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(GTFS_URL);
  if (!res.ok || !res.body) throw new Error(`Descarga GTFS fallida: HTTP ${res.status}`);
  const tmp = `${dest}.tmp`;
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(tmp));
  renameSync(tmp, dest);
}

function openZip(path: string): Promise<{ zip: yauzl.ZipFile; entries: Map<string, yauzl.Entry> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err);
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (e: yauzl.Entry) => {
        entries.set(e.fileName.split('/').pop()!, e);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** Lee un CSV del zip en streaming. Renfe rellena los campos con espacios: se recortan. */
async function* csvRows(zip: yauzl.ZipFile, entry: yauzl.Entry): AsyncIterable<Record<string, string>> {
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
    zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s))),
  );
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    // El feed de Renfe no usa comillas; un split simple es suficiente.
    const cells = raw.split(',').map((c) => c.trim());
    if (!header) {
      header = cells.map((h) => h.replace(/^﻿/, ''));
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    yield row;
  }
}

export async function loadGtfs(zipPath: string, nowMs = Date.now()): Promise<GtfsData> {
  const { zip, entries } = await openZip(zipPath);
  try {
    const src: GtfsSource = {
      has: (f) => entries.has(f),
      rows: (f) => {
        const e = entries.get(f);
        if (!e) throw new Error(`Falta ${f} en el GTFS`);
        return csvRows(zip, e);
      },
    };
    return await buildGtfsData(src, localDate(nowMs));
  } finally {
    zip.close();
  }
}
