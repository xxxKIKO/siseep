import type { StoredImage } from '../files/files.service';

/** Everything printed on the report cards of one group (HTML/PDF and Word use the same data). */
export interface ReportCardData {
  /** Not closed yet: the preview shows a "BORRADOR" watermark. */
  draft: boolean;
  schoolName: string;
  schoolLogo: StoredImage | null;
  teacherLogo: StoredImage | null;
  periodName: string;
  schoolYear: string;
  groupName: string;
  teacherName: string;
  /** "Colima, Colima · miércoles 18 de noviembre de 2026". */
  placeDate: string;
  cards: ReportCard[];
}

export interface ReportCard {
  name: string;
  listNumber: number;
  fields: ReportCardField[];
  anyAdjusted: boolean;
  generalAverage: string;
  observations: { label: string; text: string }[];
  legend: string | null;
}

/** Values already formatted for printing ("8.5", "—"). */
export interface ReportCardField {
  name: string;
  color: string;
  desempeno: string;
  proyecto: string;
  examen: string;
  base: string;
  complementary: string;
  calculated: string;
  final: string;
  adjusted: boolean;
}

export function dataUri(image: StoredImage | null): string {
  return image ? `data:${image.contentType};base64,${image.buffer.toString('base64')}` : '';
}

/** Pixel size of a PNG or JPEG (to keep the logo's proportions in Word). */
export function imageSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1]!;
      const length = buffer.readUInt16BE(offset + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}
