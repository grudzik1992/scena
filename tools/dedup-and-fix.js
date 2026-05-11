#!/usr/bin/env node
// One-shot cleanup script:
//  - remove case-only title duplicates (keep the version with proper capitalization, i.e. the LATER occurrence)
//  - transpose "Turn Me On" from Eb to Bb
//  - regenerate spis-tresci.txt from the deduplicated list

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SONGS = path.join(ROOT, 'songs.json');
const TOC = path.join(ROOT, 'spis-tresci.txt');

const data = JSON.parse(fs.readFileSync(SONGS, 'utf8'));

// Map titles that are near-duplicates (typos, missing diacritics, the/a etc.) to the canonical title
const aliasToCanonical = {
  'chandalier': 'chandelier',
  'message in the bottle': 'message in a bottle',
  'trudno mi sie przyznac': 'trudno mi sie przyznac',
};

function normalizeTitle(title) {
  let k = title.toLowerCase().trim();
  // strip Polish diacritics for matching only
  const stripped = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'l');
  if (aliasToCanonical[k]) return aliasToCanonical[k];
  if (aliasToCanonical[stripped]) return aliasToCanonical[stripped];
  return stripped;
}

// Step 1: detect duplicates by normalized title
const seenLast = new Map(); // key -> last index
data.songs.forEach((s, i) => {
  const k = normalizeTitle(s.title);
  seenLast.set(k, i);
});

const beforeCount = data.songs.length;
const kept = data.songs.filter((s, i) => {
  const k = normalizeTitle(s.title);
  return seenLast.get(k) === i;
});
const removed = beforeCount - kept.length;
console.log(`Removed ${removed} duplicate songs (${beforeCount} -> ${kept.length})`);

// Step 2: transpose Turn Me On from Eb to Bb
// Map: Eb -> Bb, Cm7 -> Gm7, Fm7 -> Cm7, Bb7 -> F7, Ab -> Eb
// Use word-boundary-safe replacement preserving spacing.
const transposeMap = [
  // longest first to avoid partial replacements
  ['Bb7', 'F7'],
  ['Cm7', 'Gm7'],
  ['Fm7', 'Cm7'],
  ['Ab',  'Eb'],
  ['Eb',  'Bb'],
];

function transposeChordLine(line) {
  if (!line) return line;
  // Use placeholders to avoid double-replacements (e.g. Eb -> Bb then Bb -> ?)
  let out = line;
  // Substitute with placeholders first
  const placeholders = transposeMap.map((_, i) => `\u0001${i}\u0001`);
  transposeMap.forEach(([from], i) => {
    out = out.split(from).join(placeholders[i]);
  });
  transposeMap.forEach(([, to], i) => {
    out = out.split(placeholders[i]).join(to);
  });
  return out;
}

const turnMeOn = kept.find(s => s.title === 'Turn Me On');
if (turnMeOn) {
  turnMeOn.key = 'Bb';
  turnMeOn.lines = turnMeOn.lines.map(l => ({
    ...l,
    chord: transposeChordLine(l.chord || '')
  }));
  console.log('Transposed "Turn Me On" from Eb -> Bb');
} else {
  console.warn('WARN: Turn Me On not found');
}

data.songs = kept;
fs.writeFileSync(SONGS, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Wrote ${SONGS}`);

// Step 3: regenerate spis-tresci.txt
const lines = data.songs.map((s, i) => `${i + 1}.\t${s.title}`);
fs.writeFileSync(TOC, lines.join('\r\n') + '\r\n', 'utf8');
console.log(`Wrote ${TOC} with ${lines.length} entries`);
