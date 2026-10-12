import { expect, test } from 'vitest';
import { readPhotoCapturedDate, resolveReceiptDate } from './receipt-date';
import { normalizeDate } from './normalize-date';

// Real binary TIFF directories embedded in minimal image containers; no parser mocks.
function exif(little = true, date = '2024:02:29 23:59:59', tag = 0x9003) {
  const b = Buffer.alloc(64);
  b.write(little ? 'II' : 'MM');
  const u16 = (v: number, p: number) => (little ? b.writeUInt16LE(v, p) : b.writeUInt16BE(v, p));
  const u32 = (v: number, p: number) => (little ? b.writeUInt32LE(v, p) : b.writeUInt32BE(v, p));
  u16(42, 2);
  u32(8, 4);
  u16(1, 8);
  u16(0x8769, 10);
  u16(4, 12);
  u32(1, 14);
  u32(26, 18);
  u16(1, 26);
  u16(tag, 28);
  u16(2, 30);
  u32(20, 32);
  u32(44, 36);
  b.write(date + '\0', 44);
  return b;
}
function jpeg(tiff: Buffer) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 4);
  return Buffer.concat([header, payload, Buffer.from([0xff, 0xd9])]);
}
test.each([true, false])('JPEG EXIF reads capture date in endian %s', (little) => {
  expect(readPhotoCapturedDate(jpeg(exif(little)))).toBe('2024-02-29');
});
test('PNG and WebP EXIF chunks read actual capture metadata', () => {
  const tiff = exif();
  const pngHeader = Buffer.alloc(8);
  pngHeader.writeUInt32BE(tiff.length);
  pngHeader.write('eXIf', 4);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngHeader, tiff, Buffer.alloc(4)]);
  expect(readPhotoCapturedDate(png)).toBe('2024-02-29');
  const webpHeader = Buffer.alloc(20);
  webpHeader.write('RIFF');
  webpHeader.writeUInt32LE(tiff.length + 12, 4);
  webpHeader.write('WEBPEXIF', 8);
  webpHeader.writeUInt32LE(tiff.length, 16);
  expect(readPhotoCapturedDate(Buffer.concat([webpHeader, tiff]))).toBe('2024-02-29');
});
test('invalid, truncated and modification-only metadata are ignored', () => {
  expect(readPhotoCapturedDate(jpeg(exif(true, '2023:02:29 12:00:00')))).toBeUndefined();
  expect(readPhotoCapturedDate(jpeg(exif(true, '2024:02:29 24:00:00')))).toBeUndefined();
  expect(readPhotoCapturedDate(jpeg(exif(true, '2024:02:29 12:00:00', 0x0132)))).toBeUndefined();
  const image = jpeg(exif());
  for (let i = 0; i < image.length - 2; i++) expect(readPhotoCapturedDate(image.subarray(0, i))).toBeUndefined();
  expect(readPhotoCapturedDate(Buffer.from('ftypheic'))).toBeUndefined();
  expect(readPhotoCapturedDate(Buffer.alloc(0))).toBeUndefined();
});
test('valid printed > valid capture > original upload date; manual corrections survive rescans', () => {
  const upload = new Date('2026-10-12T22:00:00Z');
  const metadata = { photoCapturedDate: '2024-02-29', lastModified: 0 };
  expect(resolveReceiptDate('01.03.2024', metadata, upload)).toMatchObject({
    date: '2024-03-01',
    dateSource: 'printed',
  });
  expect(resolveReceiptDate('2023-02-29', metadata, upload)).toMatchObject({ date: '2024-02-29', dateSource: 'exif' });
  expect(resolveReceiptDate(undefined, { photoCapturedDate: '2024-13-01', lastModified: 0 }, upload)).toEqual({
    date: '2026-10-12',
    dateSource: 'upload',
  });
  expect(
    resolveReceiptDate('2025-01-01', { ...metadata, date: '2024-03-05', dateSource: 'manual' }, upload),
  ).toMatchObject({ date: '2024-03-05', dateSource: 'manual', photoCapturedDate: '2024-02-29' });
});
test.each(['2023-02-29', '2024-04-31', '2024-00-01', '0000-01-01', '31.02.2024'])(
  'rejects impossible calendar date %s',
  (value) => {
    expect(normalizeDate(value)).toBeUndefined();
  },
);
