import { normalizeDate } from './normalize-date';

/** Date-only values retain the camera's calendar day, not a timezone-shifted instant. */
export function resolveReceiptDate(printed: string | undefined, metadata: unknown, uploadedAt: Date) {
  const stored = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const valid = (value: unknown) => (typeof value === 'string' ? normalizeDate(value) : undefined);
  const manual = stored.dateSource === 'manual' ? valid(stored.date) : undefined;
  const receiptDate = valid(printed);
  const captureDate = valid(stored.photoCapturedDate);
  return {
    date: manual ?? receiptDate ?? captureDate ?? uploadedAt.toISOString().slice(0, 10),
    dateSource: manual ? 'manual' : receiptDate ? 'printed' : captureDate ? 'exif' : 'upload',
    ...(captureDate ? { photoCapturedDate: captureDate } : {}),
  };
}

/**
 * Bounded EXIF DateTimeOriginal reader for JPEG APP1, PNG eXIf and WebP EXIF.
 * Ignores modification/digitization dates and File.lastModified. HEIC/XMP are
 * deliberately unsupported: absent/invalid metadata honestly means upload date.
 * TIFF/Exif tags: CIPA DC-008 (ExifIFDPointer 0x8769, DateTimeOriginal 0x9003).
 */
export function readPhotoCapturedDate(buffer: Buffer): string | undefined {
  function tiff(payload: Buffer): string | undefined {
    const b = payload.subarray(payload.toString('ascii', 0, 6) === 'Exif\0\0' ? 6 : 0);
    if (b.length < 8) return;
    const endian = b.toString('ascii', 0, 2);
    if (endian !== 'II' && endian !== 'MM') return;
    const u16 = (p: number) => (endian === 'II' ? b.readUInt16LE(p) : b.readUInt16BE(p));
    const u32 = (p: number) => (endian === 'II' ? b.readUInt32LE(p) : b.readUInt32BE(p));
    if (u16(2) !== 42) return;
    function entries(offset: number) {
      if (offset < 8 || offset + 2 > b.length) return [];
      const count = u16(offset);
      if (count > 1024 || offset + 2 + count * 12 + 4 > b.length) return [];
      return Array.from({ length: count }, (_, i) => offset + 2 + i * 12);
    }
    const pointer = entries(u32(4)).find((p) => u16(p) === 0x8769 && u16(p + 2) === 4 && u32(p + 4) === 1);
    if (pointer === undefined) return;
    const entry = entries(u32(pointer + 8)).find((p) => u16(p) === 0x9003 && u16(p + 2) === 2 && u32(p + 4) === 20);
    if (entry === undefined) return;
    const offset = u32(entry + 8);
    if (offset < 8 || offset + 20 > b.length) return;
    const text = b.toString('ascii', offset, offset + 20);
    const match = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})\0$/);
    if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return;
    return normalizeDate(`${match[1]}-${match[2]}-${match[3]}`);
  }
  try {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let p = 2;
      while (p + 4 <= buffer.length) {
        if (buffer[p++] !== 0xff) return;
        while (buffer[p] === 0xff) p++;
        const marker = buffer[p++];
        if (marker === 0xda || marker === 0xd9) return;
        if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
        const size = buffer.readUInt16BE(p);
        if (size < 2 || p + size > buffer.length) return;
        if (marker === 0xe1 && buffer.toString('ascii', p + 2, p + 8) === 'Exif\0\0') {
          const date = tiff(buffer.subarray(p + 2, p + size));
          if (date) return date;
        }
        p += size;
      }
    } else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      let p = 8;
      while (p + 12 <= buffer.length) {
        const size = buffer.readUInt32BE(p);
        if (p + 12 + size > buffer.length) return;
        if (buffer.toString('ascii', p + 4, p + 8) === 'eXIf') return tiff(buffer.subarray(p + 8, p + 8 + size));
        p += 12 + size;
      }
    } else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      let p = 12;
      const end = Math.min(buffer.length, buffer.readUInt32LE(4) + 8);
      while (p + 8 <= end) {
        const size = buffer.readUInt32LE(p + 4);
        if (p + 8 + size > end) return;
        if (buffer.toString('ascii', p, p + 4) === 'EXIF') return tiff(buffer.subarray(p + 8, p + 8 + size));
        p += 8 + size + (size % 2);
      }
    }
  } catch {
    // Malformed metadata must not reject an otherwise accepted upload.
  }
  return undefined;
}
