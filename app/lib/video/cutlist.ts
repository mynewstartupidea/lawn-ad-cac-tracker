export interface Word {
  text: string;
  start: number; // ms
  end: number; // ms
}

export interface CutOptions {
  openingTrim: boolean;
  removeSilence: boolean;
  removeFillers: boolean;
  silenceThresholdMs?: number;
  paddingMs?: number;
}

export interface CutSegment {
  startMs: number;
  endMs: number;
  reason: "kept";
}

export interface CutList {
  openingTrimMs: number;
  segments: CutSegment[];
  totalOriginalMs: number;
  totalOutputMs: number;
}

const OPENING_MIN_START_MS = 300;
const OPENING_PADDING_MS = 250;
const OPENING_MAX_GAP_MS = 500; // gap allowed between first two words to trust the first word as true speech onset
const DEFAULT_SILENCE_THRESHOLD_MS = 950;
const DEFAULT_PADDING_MS = 250;
const MIN_SEGMENT_MS = 175;

const FILLER_WORDS = new Set(["um", "umm", "uh", "uhh", "erm", "mm", "huh"]);

export function computeCutList(words: Word[], durationMs: number, options: CutOptions): CutList {
  if (!words.length || durationMs <= 0) {
    return {
      openingTrimMs: 0,
      segments: [{ startMs: 0, endMs: Math.max(durationMs, 0), reason: "kept" }],
      totalOriginalMs: Math.max(durationMs, 0),
      totalOutputMs: Math.max(durationMs, 0),
    };
  }

  const paddingMs = options.paddingMs ?? DEFAULT_PADDING_MS;
  const silenceThresholdMs = options.silenceThresholdMs ?? DEFAULT_SILENCE_THRESHOLD_MS;

  // Spans to REMOVE from the original timeline.
  const cutSpans: { start: number; end: number }[] = [];

  let openingTrimMs = 0;
  if (options.openingTrim) {
    const first = words[0];
    const second = words[1];
    const trustFirstWord =
      first.start >= OPENING_MIN_START_MS &&
      (!second || second.start - first.end < OPENING_MAX_GAP_MS);
    if (trustFirstWord) {
      openingTrimMs = Math.max(0, first.start - OPENING_PADDING_MS);
      if (openingTrimMs > 0) cutSpans.push({ start: 0, end: openingTrimMs });
    }
  }

  if (options.removeSilence) {
    for (let i = 0; i < words.length - 1; i++) {
      const gap = words[i + 1].start - words[i].end;
      if (gap >= silenceThresholdMs) {
        cutSpans.push({ start: words[i].end + paddingMs, end: words[i + 1].start - paddingMs });
      }
    }
  }

  if (options.removeFillers) {
    for (const w of words) {
      const clean = w.text.toLowerCase().replace(/[^a-z]/g, "");
      if (FILLER_WORDS.has(clean)) {
        cutSpans.push({ start: w.start - paddingMs / 2, end: w.end + paddingMs / 2 });
      }
    }
  }

  cutSpans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of cutSpans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const segments: CutSegment[] = [];
  let cursor = 0;
  for (const span of merged) {
    const start = Math.max(0, Math.min(span.start, durationMs));
    const end = Math.max(0, Math.min(span.end, durationMs));
    if (start > cursor && start - cursor >= MIN_SEGMENT_MS) {
      segments.push({ startMs: cursor, endMs: start, reason: "kept" });
    }
    cursor = Math.max(cursor, end);
  }
  if (durationMs - cursor >= MIN_SEGMENT_MS) {
    segments.push({ startMs: cursor, endMs: durationMs, reason: "kept" });
  }

  if (!segments.length) {
    segments.push({ startMs: 0, endMs: durationMs, reason: "kept" });
  }

  const totalOutputMs = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

  return { openingTrimMs, segments, totalOriginalMs: durationMs, totalOutputMs };
}
