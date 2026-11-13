/**
 * Document Export Utility for BYOS Notes
 *
 * Generates client-side, zero-dependency:
 * 1. Read-only PDF documents (%PDF-1.4)
 * 2. Editable Word documents (OpenXML .docx ZIP package)
 * 3. File helpers for browser download and BYOS Mail sharing
 */

import { NoteItem } from "../components/notes/notesStore";

// ============================================================================
// 1. In-Memory ZIP Archive Generator (Zero External Dependencies)
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

/**
 * Packs multiple files into an uncompressed (Store mode 0) valid PKZIP archive.
 */
export function buildZipArchive(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    offset: number;
  }> = [];

  let currentOffset = 0;
  const localHeaderChunks: Uint8Array[] = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = calculateCrc32(dataBytes);

    const recordOffset = currentOffset;

    // Local file header (30 bytes + name length)
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed to extract (2.0)
    view.setUint16(6, 0, true); // General purpose bit flag
    view.setUint16(8, 0, true); // Compression method (0 = uncompressed / store)
    view.setUint16(10, 0, true); // Last mod file time
    view.setUint16(12, 0, true); // Last mod file date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, dataBytes.length, true); // Compressed size
    view.setUint32(22, dataBytes.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length
    header.set(nameBytes, 30);

    localHeaderChunks.push(header);
    localHeaderChunks.push(dataBytes);

    fileRecords.push({
      nameBytes,
      dataBytes,
      crc,
      offset: recordOffset,
    });

    currentOffset += header.length + dataBytes.length;
  }

  const centralDirectoryOffset = currentOffset;
  const centralDirChunks: Uint8Array[] = [];

  for (const rec of fileRecords) {
    // Central directory file header (46 bytes + name length)
    const cd = new Uint8Array(46 + rec.nameBytes.length);
    const view = new DataView(cd.buffer);
    view.setUint32(0, 0x02014b50, true); // Central file header signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed to extract
    view.setUint16(8, 0, true); // General purpose bit flag
    view.setUint16(10, 0, true); // Compression method (0 = store)
    view.setUint16(12, 0, true); // Last mod time
    view.setUint16(14, 0, true); // Last mod date
    view.setUint32(16, rec.crc, true); // CRC-32
    view.setUint32(20, rec.dataBytes.length, true); // Compressed size
    view.setUint32(24, rec.dataBytes.length, true); // Uncompressed size
    view.setUint16(28, rec.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // File comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0, true); // External file attributes
    view.setUint32(42, rec.offset, true); // Relative offset of local header
    cd.set(rec.nameBytes, 46);

    centralDirChunks.push(cd);
    currentOffset += cd.length;
  }

  const centralDirectorySize = currentOffset - centralDirectoryOffset;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // End of central dir signature
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, fileRecords.length, true); // Number of central directory records on this disk
  eocdView.setUint16(10, fileRecords.length, true); // Total number of central directory records
  eocdView.setUint32(12, centralDirectorySize, true); // Size of central directory
  eocdView.setUint32(16, centralDirectoryOffset, true); // Offset of start of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  // Total zip length
  const totalLength = currentOffset + eocd.length;
  const zipBuffer = new Uint8Array(totalLength);
  let pos = 0;

  for (const chunk of localHeaderChunks) {
    zipBuffer.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralDirChunks) {
    zipBuffer.set(chunk, pos);
    pos += chunk.length;
  }
  zipBuffer.set(eocd, pos);

  return zipBuffer;
}

// ============================================================================
// 2. Data URL & Image Parsers & PNG/Deflate Codecs
// ============================================================================

export interface ParsedImageInfo {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

/**
 * Decodes base64 data URL into binary bytes.
 */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return null;
  const meta = dataUrl.substring(5, commaIdx);
  const mime = meta.split(";")[0] || "image/png";
  const base64 = dataUrl.substring(commaIdx + 1);

  try {
    if (typeof atob !== "undefined") {
      const binStr = atob(base64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      return { bytes, mime };
    } else if (typeof Buffer !== "undefined") {
      const buf = Buffer.from(base64, "base64");
      return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), mime };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Extracts width and height dimensions from PNG or JPEG headers.
 */
export function parseImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { width: width || 400, height: height || 300 };
  }

  // Check JPEG signature: FF D8
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0, SOF1, SOF2 markers contain image dimensions
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width: width || 400, height: height || 300 };
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + length;
    }
  }

  return { width: 400, height: 300 };
}

/**
 * Decompresses RFC 1950 zlib/deflate stream using Web Standard DecompressionStream.
 */
export async function decompressDeflateStream(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(bytes as unknown as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.length;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

/**
 * Compresses data into RFC 1950 zlib/deflate stream using Web Standard CompressionStream.
 */
export async function compressDeflateStream(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(bytes as unknown as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.length;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

export interface DecodedPngData {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha?: Uint8Array;
}

/**
 * Pure TypeScript PNG decoder extracting RGB and Alpha channels.
 * Supports truecolor RGB (type 2), truecolor RGBA (type 6), grayscale (0), and grayscale+alpha (4).
 */
export async function decodePngImage(bytes: Uint8Array): Promise<DecodedPngData> {
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    throw new Error("Invalid PNG signature");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataOffset = offset + 8;

    if (type === "IHDR") {
      width =
        (bytes[dataOffset] << 24) |
        (bytes[dataOffset + 1] << 16) |
        (bytes[dataOffset + 2] << 8) |
        bytes[dataOffset + 3];
      height =
        (bytes[dataOffset + 4] << 24) |
        (bytes[dataOffset + 5] << 16) |
        (bytes[dataOffset + 6] << 8) |
        bytes[dataOffset + 7];
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataOffset, dataOffset + length));
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  }

  let totalIdat = 0;
  for (const c of idatChunks) totalIdat += c.length;
  const idatBuffer = new Uint8Array(totalIdat);
  let idatPos = 0;
  for (const c of idatChunks) {
    idatBuffer.set(c, idatPos);
    idatPos += c.length;
  }

  const decompressed = await decompressDeflateStream(idatBuffer);

  let channels = 3;
  let hasAlphaChannel = false;
  if (colorType === 6) {
    channels = 4;
    hasAlphaChannel = true;
  } else if (colorType === 2) {
    channels = 3;
    hasAlphaChannel = false;
  } else if (colorType === 0) {
    channels = 1;
    hasAlphaChannel = false;
  } else if (colorType === 4) {
    channels = 2;
    hasAlphaChannel = true;
  } else {
    throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  const bytesPerPixel = channels * (bitDepth === 16 ? 2 : 1);
  const stride = width * bytesPerPixel;
  const scanlineLength = 1 + stride;

  const rawPixels = new Uint8Array(height * stride);
  const prevLine = new Uint8Array(stride);
  const currLine = new Uint8Array(stride);

  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y++) {
    const lineStart = y * scanlineLength;
    const filterType = decompressed[lineStart];

    for (let x = 0; x < stride; x++) {
      const raw = decompressed[lineStart + 1 + x];
      const left = x >= bytesPerPixel ? currLine[x - bytesPerPixel] : 0;
      const above = prevLine[x];
      const aboveLeft = x >= bytesPerPixel ? prevLine[x - bytesPerPixel] : 0;

      let val = 0;
      if (filterType === 0) {
        val = raw;
      } else if (filterType === 1) {
        val = (raw + left) & 0xff;
      } else if (filterType === 2) {
        val = (raw + above) & 0xff;
      } else if (filterType === 3) {
        val = (raw + Math.floor((left + above) / 2)) & 0xff;
      } else if (filterType === 4) {
        val = (raw + paeth(left, above, aboveLeft)) & 0xff;
      } else {
        val = raw;
      }

      currLine[x] = val;
      rawPixels[y * stride + x] = val;
    }

    prevLine.set(currLine);
  }

  const rgb = new Uint8Array(width * height * 3);
  const alpha = hasAlphaChannel ? new Uint8Array(width * height) : undefined;
  let hasTrueAlpha = false;
  const step = bitDepth === 16 ? 2 : 1;

  for (let i = 0; i < width * height; i++) {
    const pxOffset = i * channels * step;
    if (colorType === 6) {
      rgb[i * 3] = rawPixels[pxOffset];
      rgb[i * 3 + 1] = rawPixels[pxOffset + step];
      rgb[i * 3 + 2] = rawPixels[pxOffset + step * 2];
      const a = rawPixels[pxOffset + step * 3];
      if (alpha) alpha[i] = a;
      if (a < 255) hasTrueAlpha = true;
    } else if (colorType === 2) {
      rgb[i * 3] = rawPixels[pxOffset];
      rgb[i * 3 + 1] = rawPixels[pxOffset + step];
      rgb[i * 3 + 2] = rawPixels[pxOffset + step * 2];
    } else if (colorType === 0) {
      const g = rawPixels[pxOffset];
      rgb[i * 3] = g;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = g;
    } else if (colorType === 4) {
      const g = rawPixels[pxOffset];
      rgb[i * 3] = g;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = g;
      const a = rawPixels[pxOffset + step];
      if (alpha) alpha[i] = a;
      if (a < 255) hasTrueAlpha = true;
    }
  }

  return {
    width,
    height,
    rgb,
    alpha: hasTrueAlpha ? alpha : undefined,
  };
}

// ============================================================================
// 3. Document Structured Model & HTML Parser
// ============================================================================

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string; // hex, e.g. "9E725F" or "#9E725F"
  fontSize?: number; // pt or px
  fontFamily?: "sans" | "serif" | "mono";
  href?: string;
}

export interface DocBlock {
  type: "heading" | "paragraph" | "list-item" | "quote" | "code" | "image";
  level?: 1 | 2 | 3;
  listType?: "bullet" | "number" | "checklist";
  checked?: boolean;
  align?: "left" | "center" | "right";
  runs: DocRun[];
  imageSrc?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageHref?: string;
  imageAlt?: string;
  imageWrap?: "inline" | "square" | "top-bottom";
  imageRotate?: number;
  imageCrop?: string;
}

/**
 * Extracts structured document blocks from HTML / Markdown note content.
 */
export function parseNoteToDocumentBlocks(content: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  if (!content) return blocks;

  // Use DOM parser when available in browser or JSDOM in Node test runner
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const bodyChildren = Array.from(doc.body.childNodes);

    for (const child of bodyChildren) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim();
        if (text) {
          blocks.push({
            type: "paragraph",
            align: "left",
            runs: [{ text }],
          });
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      // Check alignment from CSS or data-align
      const styleAlign = el.style.textAlign?.toLowerCase();
      const dataAlign = el.getAttribute("data-align")?.toLowerCase();
      const align = (styleAlign === "center" || dataAlign === "center"
        ? "center"
        : styleAlign === "right" || dataAlign === "right"
        ? "right"
        : "left") as "left" | "center" | "right";

      if (tagName === "h1") {
        blocks.push({ type: "heading", level: 1, align, runs: parseRunsFromElement(el) });
      } else if (tagName === "h2") {
        blocks.push({ type: "heading", level: 2, align, runs: parseRunsFromElement(el) });
      } else if (tagName === "h3") {
        blocks.push({ type: "heading", level: 3, align, runs: parseRunsFromElement(el) });
      } else if (tagName === "blockquote") {
        blocks.push({ type: "quote", align, runs: parseRunsFromElement(el) });
      } else if (tagName === "pre") {
        blocks.push({ type: "code", align: "left", runs: [{ text: el.textContent || "", fontFamily: "mono" }] });
      } else if (tagName === "ul" || tagName === "ol") {
        const isBullet = tagName === "ul";
        const lis = Array.from(el.querySelectorAll("li"));
        for (const li of lis) {
          blocks.push({
            type: "list-item",
            listType: isBullet ? "bullet" : "number",
            align,
            runs: parseRunsFromElement(li),
          });
        }
      } else if (tagName === "img") {
        const img = el as HTMLImageElement;
        const styleW = parseInt(img.style.width, 10);
        const attrW = parseInt(img.getAttribute("width") || "", 10);
        const dataW = parseInt(img.getAttribute("data-width") || "", 10);
        const imageWidth = !isNaN(styleW) ? styleW : !isNaN(dataW) ? dataW : !isNaN(attrW) ? attrW : undefined;

        const styleH = parseInt(img.style.height, 10);
        const attrH = parseInt(img.getAttribute("height") || "", 10);
        const dataH = parseInt(img.getAttribute("data-height") || "", 10);
        const imageHeight = !isNaN(styleH) ? styleH : !isNaN(dataH) ? dataH : !isNaN(attrH) ? attrH : undefined;

        const parentA = img.closest("a");
        const imageHref = img.getAttribute("data-href") || parentA?.getAttribute("href") || undefined;
        const imageAlt = img.getAttribute("alt") || undefined;
        const imageWrap = (img.getAttribute("data-wrap") || (img.style.float ? "square" : "inline")) as any;
        const imageCrop = img.getAttribute("data-crop") || undefined;
        const rotVal = parseInt(img.getAttribute("data-rotate") || "", 10);
        const imageRotate = !isNaN(rotVal) ? rotVal : undefined;

        blocks.push({
          type: "image",
          imageSrc: img.getAttribute("src") || "",
          imageWidth,
          imageHeight,
          imageHref,
          imageAlt,
          imageWrap,
          imageCrop,
          imageRotate,
          align,
          runs: [],
        });
      } else {
        // Look for nested images inside paragraphs, links or divs
        const nestedImgs = el.querySelectorAll("img");
        if (nestedImgs.length > 0) {
          for (const img of Array.from(nestedImgs)) {
            const styleW = parseInt(img.style.width, 10);
            const dataW = parseInt(img.getAttribute("data-width") || "", 10);
            const attrW = parseInt(img.getAttribute("width") || "", 10);
            const imageWidth = !isNaN(styleW) ? styleW : !isNaN(dataW) ? dataW : !isNaN(attrW) ? attrW : undefined;

            const styleH = parseInt(img.style.height, 10);
            const dataH = parseInt(img.getAttribute("data-height") || "", 10);
            const attrH = parseInt(img.getAttribute("height") || "", 10);
            const imageHeight = !isNaN(styleH) ? styleH : !isNaN(dataH) ? dataH : !isNaN(attrH) ? attrH : undefined;

            const parentA = img.closest("a") || (tagName === "a" ? el : null);
            const imageHref = img.getAttribute("data-href") || parentA?.getAttribute("href") || undefined;
            const imageAlt = img.getAttribute("alt") || undefined;
            const imageWrap = (img.getAttribute("data-wrap") || (img.style.float ? "square" : "inline")) as any;
            const imgAlign = ((img.getAttribute("data-align") || align) as "left" | "center" | "right") || "left";
            const imageCrop = img.getAttribute("data-crop") || undefined;
            const rotVal = parseInt(img.getAttribute("data-rotate") || "", 10);
            const imageRotate = !isNaN(rotVal) ? rotVal : undefined;

            blocks.push({
              type: "image",
              imageSrc: img.getAttribute("src") || "",
              imageWidth,
              imageHeight,
              imageHref,
              imageAlt,
              imageWrap,
              imageCrop,
              imageRotate,
              align: imgAlign,
              runs: [],
            });
          }
          if (el.textContent?.trim()) {
            blocks.push({
              type: "paragraph",
              align,
              runs: parseRunsFromElement(el),
            });
          }
        } else {
          blocks.push({
            type: "paragraph",
            align,
            runs: parseRunsFromElement(el),
          });
        }
      }
    }
  } else {
    // Robust HTML & Markdown fallback parser for non-DOM environments
    const blockRegex =
      /<(h[1-3]|blockquote|pre|ul|ol|img|p|div)([^>]*)>([\s\S]*?)<\/\1>|<img([^>]*)\/?>|([^\n<]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(content)) !== null) {
      const tag = (match[1] || (match[4] !== undefined ? "img" : "")).toLowerCase();
      const attrs = match[2] || match[4] || "";
      const inner = match[3] || match[5] || "";

      const alignMatch =
        attrs.match(/text-align:\s*(center|right|left)/i) ||
        attrs.match(/data-align="([^"]+)"/i);
      const align = (alignMatch ? alignMatch[1].toLowerCase() : "left") as
        | "left"
        | "center"
        | "right";

      if (tag === "h1" || tag === "h2" || tag === "h3") {
        const level = parseInt(tag[1], 10) as 1 | 2 | 3;
        blocks.push({
          type: "heading",
          level,
          align,
          runs: parseRunsFromHtmlString(inner),
        });
      } else if (tag === "blockquote") {
        blocks.push({
          type: "quote",
          align,
          runs: parseRunsFromHtmlString(inner),
        });
      } else if (tag === "pre") {
        blocks.push({
          type: "code",
          align: "left",
          runs: [{ text: stripHtml(inner), fontFamily: "mono" }],
        });
      } else if (tag === "ul" || tag === "ol") {
        const isBullet = tag === "ul";
        const liMatches = Array.from(inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
        for (const li of liMatches) {
          blocks.push({
            type: "list-item",
            listType: isBullet ? "bullet" : "number",
            align,
            runs: parseRunsFromHtmlString(li[1]),
          });
        }
      } else if (tag === "img") {
        const srcMatch = attrs.match(/src="([^"]+)"/i);
        if (srcMatch) {
          const wMatch =
            attrs.match(/width:\s*(\d+)px/i) ||
            attrs.match(/data-width="(\d+)/i) ||
            attrs.match(/width="(\d+)"/i);
          const hMatch =
            attrs.match(/height:\s*(\d+)px/i) ||
            attrs.match(/data-height="(\d+)/i) ||
            attrs.match(/height="(\d+)"/i);
          const hrefMatch = attrs.match(/data-href="([^"]+)"/i);
          const altMatch = attrs.match(/alt="([^"]+)"/i);
          const wrapMatch = attrs.match(/data-wrap="([^"]+)"/i);
          blocks.push({
            type: "image",
            imageSrc: srcMatch[1],
            imageWidth: wMatch ? parseInt(wMatch[1], 10) : undefined,
            imageHeight: hMatch ? parseInt(hMatch[1], 10) : undefined,
            imageHref: hrefMatch ? hrefMatch[1] : undefined,
            imageAlt: altMatch ? altMatch[1] : undefined,
            imageWrap: wrapMatch ? (wrapMatch[1] as any) : undefined,
            align,
            runs: [],
          });
        }
      } else if (/<img[^>]*\/?>/i.test(inner)) {
        const imgRegex = /<img([^>]*)\/?>/gi;
        let imgMatch: RegExpExecArray | null;
        while ((imgMatch = imgRegex.exec(inner)) !== null) {
          const imgAttrs = imgMatch[1] || "";
          const srcMatch = imgAttrs.match(/src="([^"]+)"/i);
          if (srcMatch) {
            const wMatch =
              imgAttrs.match(/width:\s*(\d+)px/i) ||
              imgAttrs.match(/data-width="(\d+)/i) ||
              imgAttrs.match(/width="(\d+)"/i);
            const hMatch =
              imgAttrs.match(/height:\s*(\d+)px/i) ||
              imgAttrs.match(/data-height="(\d+)/i) ||
              imgAttrs.match(/height="(\d+)"/i);
            const hrefMatch =
              imgAttrs.match(/data-href="([^"]+)"/i) ||
              inner.match(/<a[^>]*href="([^"]+)"/i);
            const altMatch = imgAttrs.match(/alt="([^"]+)"/i);
            const wrapMatch = imgAttrs.match(/data-wrap="([^"]+)"/i);
            const cropMatch = imgAttrs.match(/data-crop="([^"]+)"/i);
            const rotMatch = imgAttrs.match(/data-rotate="(\d+)"/i);
            const alignMatchImg = imgAttrs.match(/data-align="([^"]+)"/i);
            blocks.push({
              type: "image",
              imageSrc: srcMatch[1],
              imageWidth: wMatch ? parseInt(wMatch[1], 10) : undefined,
              imageHeight: hMatch ? parseInt(hMatch[1], 10) : undefined,
              imageHref: hrefMatch ? hrefMatch[1] : undefined,
              imageAlt: altMatch ? altMatch[1] : undefined,
              imageWrap: wrapMatch ? (wrapMatch[1] as any) : undefined,
              imageCrop: cropMatch ? cropMatch[1] : undefined,
              imageRotate: rotMatch ? parseInt(rotMatch[1], 10) : undefined,
              align: (alignMatchImg ? alignMatchImg[1].toLowerCase() : align) as any,
              runs: [],
            });
          }
        }
      } else if (inner.trim()) {
        const text = inner.trim();
        if (text.startsWith("### ")) {
          blocks.push({ type: "heading", level: 3, runs: [{ text: text.substring(4) }] });
        } else if (text.startsWith("## ")) {
          blocks.push({ type: "heading", level: 2, runs: [{ text: text.substring(3) }] });
        } else if (text.startsWith("# ")) {
          blocks.push({ type: "heading", level: 1, runs: [{ text: text.substring(2) }] });
        } else if (text.startsWith("* ") || text.startsWith("- ")) {
          blocks.push({ type: "list-item", listType: "bullet", runs: [{ text: text.substring(2) }] });
        } else if (/^\d+\.\s/.test(text)) {
          blocks.push({ type: "list-item", listType: "number", runs: [{ text: text.replace(/^\d+\.\s*/, "") }] });
        } else {
          blocks.push({
            type: "paragraph",
            align,
            runs: parseRunsFromHtmlString(inner),
          });
        }
      }
    }
  }

  return blocks;
}

function parseRunsFromHtmlString(html: string): DocRun[] {
  const runs: DocRun[] = [];
  const tagRegex = /<([a-z0-9]+)([^>]*)>([\s\S]*?)<\/\1>|([^<]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[4]) {
      const text = decodeHtmlEntities(match[4]);
      if (text) runs.push({ text });
    } else {
      const tag = match[1].toLowerCase();
      const attrs = match[2];
      const inner = decodeHtmlEntities(stripHtml(match[3]));
      const run: DocRun = { text: inner };
      if (tag === "b" || tag === "strong") run.bold = true;
      if (tag === "i" || tag === "em") run.italic = true;
      if (tag === "u") run.underline = true;
      if (tag === "s" || tag === "strike" || tag === "del") run.strikethrough = true;
      if (tag === "code") run.fontFamily = "mono";
      if (tag === "a") {
        const hrefMatch = attrs.match(/href="([^"]+)"/i);
        if (hrefMatch) run.href = hrefMatch[1];
      }
      const colorMatch = attrs.match(/color:\s*(#[0-9a-f]{3,6}|rgb\([^)]+\))/i);
      if (colorMatch) run.color = normalizeColorHex(colorMatch[1]);
      const fontMatch = attrs.match(/font-family:\s*([^;"]+)/i);
      if (fontMatch) {
        const fam = fontMatch[1].toLowerCase();
        if (fam.includes("serif") && !fam.includes("sans")) run.fontFamily = "serif";
        else if (fam.includes("mono")) run.fontFamily = "mono";
        else run.fontFamily = "sans";
      }
      const sizeMatch = attrs.match(/font-size:\s*(\d+)px/i);
      if (sizeMatch) run.fontSize = parseInt(sizeMatch[1], 10);
      if (run.text) runs.push(run);
    }
  }
  return runs.length > 0 ? runs : [{ text: decodeHtmlEntities(stripHtml(html)) }];
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseRunsFromElement(parent: HTMLElement): DocRun[] {
  const runs: DocRun[] = [];

  function traverse(node: Node, context: Partial<DocRun>) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        runs.push({ ...context, text });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    const currentContext: Partial<DocRun> = { ...context };

    if (tag === "b" || tag === "strong") currentContext.bold = true;
    if (tag === "i" || tag === "em") currentContext.italic = true;
    if (tag === "u") currentContext.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") currentContext.strikethrough = true;
    if (tag === "code") currentContext.fontFamily = "mono";
    if (tag === "a") currentContext.href = el.getAttribute("href") || undefined;

    // CSS styling inspection
    const styleColor = el.style.color;
    if (styleColor) {
      currentContext.color = normalizeColorHex(styleColor);
    }
    const styleFontFamily = el.style.fontFamily?.toLowerCase();
    if (styleFontFamily) {
      if (styleFontFamily.includes("serif") && !styleFontFamily.includes("sans")) {
        currentContext.fontFamily = "serif";
      } else if (styleFontFamily.includes("mono") || styleFontFamily.includes("courier")) {
        currentContext.fontFamily = "mono";
      } else {
        currentContext.fontFamily = "sans";
      }
    }
    const styleFontSize = el.style.fontSize;
    if (styleFontSize) {
      const num = parseInt(styleFontSize, 10);
      if (!isNaN(num) && num > 0) currentContext.fontSize = num;
    }

    for (const child of Array.from(el.childNodes)) {
      traverse(child, currentContext);
    }
  }

  traverse(parent, {});
  return runs;
}

function normalizeColorHex(cssColor: string): string {
  if (cssColor.startsWith("#")) {
    return cssColor.replace("#", "").toUpperCase();
  }
  // RGB: rgb(158, 114, 95)
  const match = cssColor.match(/\d+/g);
  if (match && match.length >= 3) {
    const r = parseInt(match[0], 10).toString(16).padStart(2, "0");
    const g = parseInt(match[1], 10).toString(16).padStart(2, "0");
    const b = parseInt(match[2], 10).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }
  return "000000";
}

// ============================================================================
// 4. PDF Generation (%PDF-1.4 Standard Format with Image XObjects)
// ============================================================================

interface PdfObjectRecord {
  dict: string;
  stream?: Uint8Array;
}

export async function generatePdfFromNote(
  note: NoteItem,
  resolveMediaUri: (uri: string) => string
): Promise<Blob> {
  const blocks = parseNoteToDocumentBlocks(note.content || "");
  const objects: PdfObjectRecord[] = [];

  function addObject(dict: string, stream?: Uint8Array): number {
    objects.push({ dict, stream });
    return objects.length;
  }

  // Obj 1: Catalog
  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  // Obj 2: Pages (placeholder, updated at end)
  addObject("");

  // Fonts (Type 1 standard fonts)
  // Obj 3: Font Helvetica (Normal)
  const fHelvetica = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  // Obj 4: Font Helvetica-Bold
  const fHelveticaBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  // Obj 5: Font Helvetica-Oblique
  const fHelveticaOblique = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>");
  // Obj 6: Font Times-Roman (Serif)
  const fTimes = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
  // Obj 7: Font Courier (Mono)
  const fCourier = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  // Pre-process and embed all image assets as PDF Image XObjects
  interface PdfImageResource {
    resName: string;
    objIdx: number;
    smaskObjIdx?: number;
    width: number;
    height: number;
    uri: string;
  }
  const registeredImages = new Map<string, PdfImageResource>();
  let imageCounter = 0;

  const allUris: string[] = [];
  for (const b of blocks) {
    if (b.type === "image" && b.imageSrc && !allUris.includes(b.imageSrc)) {
      allUris.push(b.imageSrc);
    }
  }
  for (const uri of note.images || []) {
    if (!allUris.includes(uri)) {
      allUris.push(uri);
    }
  }

  for (const uri of allUris) {
    const resolved = resolveMediaUri(uri);
    const parsed = dataUrlToBytes(resolved);
    if (!parsed) continue;

    imageCounter++;
    const resName = `Im${imageCounter}`;
    const isJpeg =
      parsed.bytes.length > 3 &&
      parsed.bytes[0] === 0xff &&
      parsed.bytes[1] === 0xd8;

    if (isJpeg) {
      const dims = parseImageDimensions(parsed.bytes);
      const objIdx = addObject(
        `<< /Type /XObject /Subtype /Image /Width ${dims.width} /Height ${dims.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${parsed.bytes.length} >>`,
        parsed.bytes
      );
      registeredImages.set(uri, {
        resName,
        objIdx,
        width: dims.width,
        height: dims.height,
        uri,
      });
    } else {
      // PNG / Raster image
      try {
        const decoded = await decodePngImage(parsed.bytes);
        const compressedRgb = await compressDeflateStream(decoded.rgb);

        let smaskIdx: number | undefined;
        if (decoded.alpha) {
          const compressedAlpha = await compressDeflateStream(decoded.alpha);
          smaskIdx = addObject(
            `<< /Type /XObject /Subtype /Image /Width ${decoded.width} /Height ${decoded.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressedAlpha.length} >>`,
            compressedAlpha
          );
        }

        const dict = smaskIdx
          ? `<< /Type /XObject /Subtype /Image /Width ${decoded.width} /Height ${decoded.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${smaskIdx} 0 R /Filter /FlateDecode /Length ${compressedRgb.length} >>`
          : `<< /Type /XObject /Subtype /Image /Width ${decoded.width} /Height ${decoded.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressedRgb.length} >>`;

        const objIdx = addObject(dict, compressedRgb);
        registeredImages.set(uri, {
          resName,
          objIdx,
          smaskObjIdx: smaskIdx,
          width: decoded.width,
          height: decoded.height,
          uri,
        });
      } catch {
        // Fallback for malformed or truncated mock images: generate safe 1x1 Image XObject
        try {
          const dims = parseImageDimensions(parsed.bytes);
          const fallbackRgb = new Uint8Array([200, 200, 200]);
          const compressedFallback = await compressDeflateStream(fallbackRgb);
          const objIdx = addObject(
            `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressedFallback.length} >>`,
            compressedFallback
          );
          registeredImages.set(uri, {
            resName,
            objIdx,
            width: dims.width,
            height: dims.height,
            uri,
          });
        } catch {
          // Ignore fallback error
        }
      }
    }
  }

  // Construct page resource string with all image XObjects
  let xObjectResStr = "";
  for (const img of registeredImages.values()) {
    xObjectResStr += `/${img.resName} ${img.objIdx} 0 R `;
  }
  const xObjectResDict = xObjectResStr.trim()
    ? `/XObject << ${xObjectResStr.trim()} >>`
    : "";

  const pageIds: number[] = [];
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 54;
  const printableWidth = pageWidth - marginX * 2; // ~487.28 pt

  let currentPageStream = "";
  let currentPageAnnots: string[] = [];
  let y = pageHeight - 60; // 781.89
  let pageNum = 0;

  function flushCurrentPage() {
    if (!currentPageStream) return;
    pageNum++;
    const streamBytes = new TextEncoder().encode(currentPageStream);
    const contentObjIdx = addObject(
      `<< /Length ${streamBytes.length} >>`,
      streamBytes
    );
    const annotsStr =
      currentPageAnnots.length > 0 ? `/Annots [ ${currentPageAnnots.join(" ")} ]` : "";
    const pageObjIdx = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjIdx} 0 R /Resources << /Font << /F1 ${fHelvetica} 0 R /F2 ${fHelveticaBold} 0 R /F3 ${fHelveticaOblique} 0 R /F4 ${fTimes} 0 R /F5 ${fCourier} 0 R >> ${xObjectResDict} >> ${annotsStr} >>`
    );
    pageIds.push(pageObjIdx);
    currentPageStream = "";
    currentPageAnnots = [];
    y = pageHeight - 60;
  }

  function checkPageBreak(neededHeight: number) {
    if (y - neededHeight < 60) {
      flushCurrentPage();
    }
  }

  function escapePdfString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  // --- Document Header ---
  const docTitle = note.title || "Untitled Document";
  checkPageBreak(50);

  // Brand Header Pill / Banner
  currentPageStream += `0.62 0.447 0.373 rg\n`; // #9E725F BYOS brand color
  currentPageStream += `BT /F2 22 Tf ${marginX} ${y} Td (${escapePdfString(docTitle)}) Tj ET\n`;
  y -= 26;

  // Metadata line (Date + BYOS Encrypted Document watermark)
  currentPageStream += `0.435 0.443 0.451 rg\n`; // #6F7173
  const dateStr = new Date(note.updatedAt || Date.now()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  currentPageStream += `BT /F1 9 Tf ${marginX} ${y} Td (${escapePdfString(`BYOS Verified Document • ${dateStr}`)}) Tj ET\n`;
  y -= 12;

  // Thin separator rule
  currentPageStream += `0.886 0.875 0.847 RG\n`; // #E2DFD8
  currentPageStream += `1 w ${marginX} ${y} m ${pageWidth - marginX} ${y} l S\n`;
  y -= 24;

  const renderedInlineImages = new Set<string>();

  // --- Process Document Content Blocks ---
  for (const block of blocks) {
    if (block.type === "heading") {
      const fontSize = block.level === 1 ? 18 : block.level === 2 ? 14 : 12;
      const spacingBefore = block.level === 1 ? 20 : 14;
      const spacingAfter = block.level === 1 ? 10 : 8;

      checkPageBreak(spacingBefore + fontSize + spacingAfter);
      y -= spacingBefore;

      const headingText = block.runs.map((r) => r.text).join("");
      currentPageStream += `0.102 0.106 0.118 rg\n`; // #1A1B1E

      let xPos = marginX;
      if (block.align === "center") {
        const textWidth = headingText.length * fontSize * 0.55;
        xPos = Math.max(marginX, marginX + (printableWidth - textWidth) / 2);
      } else if (block.align === "right") {
        const textWidth = headingText.length * fontSize * 0.55;
        xPos = Math.max(marginX, pageWidth - marginX - textWidth);
      }

      currentPageStream += `BT /F2 ${fontSize} Tf ${xPos.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(headingText)}) Tj ET\n`;
      y -= spacingAfter;
    } else if (block.type === "quote") {
      checkPageBreak(30);
      y -= 8;
      currentPageStream += `0.62 0.447 0.373 RG\n`; // #9E725F
      currentPageStream += `3 w ${marginX} ${y + 10} m ${marginX} ${y - 14} l S\n`;

      const quoteText = block.runs.map((r) => r.text).join("");
      currentPageStream += `0.435 0.443 0.451 rg\n`;
      currentPageStream += `BT /F3 11 Tf ${(marginX + 12).toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(quoteText)}) Tj ET\n`;
      y -= 22;
    } else if (block.type === "code") {
      checkPageBreak(30);
      y -= 8;
      const codeText = block.runs.map((r) => r.text).join("");
      currentPageStream += `0.2 0.2 0.2 rg\n`;
      currentPageStream += `BT /F5 10 Tf ${marginX} ${y.toFixed(2)} Td (${escapePdfString(codeText)}) Tj ET\n`;
      y -= 18;
    } else if (block.type === "list-item") {
      checkPageBreak(18);
      y -= 4;
      const bullet = block.listType === "number" ? "1." : "•";
      currentPageStream += `0.102 0.106 0.118 rg\n`;
      currentPageStream += `BT /F2 11 Tf ${(marginX + 6).toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(bullet)}) Tj ET\n`;

      let currentX = marginX + 22;
      for (const run of block.runs) {
        const font =
          run.bold
            ? "/F2"
            : run.italic
            ? "/F3"
            : run.fontFamily === "serif"
            ? "/F4"
            : run.fontFamily === "mono"
            ? "/F5"
            : "/F1";
        const fontSize = run.fontSize || 11;
        if (run.color) {
          const rgb = hexToRgb(run.color);
          currentPageStream += `${rgb.r} ${rgb.g} ${rgb.b} rg\n`;
        } else {
          currentPageStream += `0.102 0.106 0.118 rg\n`;
        }
        currentPageStream += `BT ${font} ${fontSize} Tf ${currentX.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(run.text)}) Tj ET\n`;
        currentX += run.text.length * fontSize * 0.52;
      }
      y -= 16;
    } else if (block.type === "paragraph") {
      checkPageBreak(22);
      y -= 6;

      const fullText = block.runs.map((r) => r.text).join("");
      let xPos = marginX;
      const approxWidth = fullText.length * 11 * 0.52;

      if (block.align === "center") {
        xPos = Math.max(marginX, marginX + (printableWidth - approxWidth) / 2);
      } else if (block.align === "right") {
        xPos = Math.max(marginX, pageWidth - marginX - approxWidth);
      }

      let currentX = xPos;
      for (const run of block.runs) {
        const font =
          run.bold
            ? "/F2"
            : run.italic
            ? "/F3"
            : run.fontFamily === "serif"
            ? "/F4"
            : run.fontFamily === "mono"
            ? "/F5"
            : "/F1";
        const fontSize = run.fontSize || 11;
        if (run.color) {
          const rgb = hexToRgb(run.color);
          currentPageStream += `${rgb.r} ${rgb.g} ${rgb.b} rg\n`;
        } else {
          currentPageStream += `0.102 0.106 0.118 rg\n`;
        }
        currentPageStream += `BT ${font} ${fontSize} Tf ${currentX.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(run.text)}) Tj ET\n`;
        currentX += run.text.length * fontSize * 0.52;
      }
      y -= 18;
    } else if (block.type === "image" && block.imageSrc) {
      const img = registeredImages.get(block.imageSrc);
      if (img) {
        renderedInlineImages.add(block.imageSrc);
        const maxW = printableWidth;
        const targetW = block.imageWidth ? Math.min(block.imageWidth, maxW) : Math.min(img.width, maxW);
        let dispW = targetW;
        let dispH = block.imageHeight ? Math.min(block.imageHeight, 420) : Math.round(dispW * (img.height / img.width));

        if (dispH > 420) {
          dispW = Math.round(dispW * (420 / dispH));
          dispH = 420;
        }

        checkPageBreak(dispH + 24);
        y -= 10;

        let xPos = marginX;
        if (block.align === "center") {
          xPos = Math.max(marginX, marginX + (printableWidth - dispW) / 2);
        } else if (block.align === "right") {
          xPos = Math.max(marginX, pageWidth - marginX - dispW);
        }

        const yBottom = y - dispH;

        let hasCrop = false;
        let cropLeft = 0;
        let cropRight = 0;
        let cropTop = 0;
        let cropBottom = 0;
        if (block.imageCrop) {
          const parts = block.imageCrop
            .split(",")
            .map((p) => parseFloat(p.trim()) || 0);
          if (parts.length === 4) {
            hasCrop = true;
            cropTop = (parts[0] / 100) * dispH;
            cropRight = (parts[1] / 100) * dispW;
            cropBottom = (parts[2] / 100) * dispH;
            cropLeft = (parts[3] / 100) * dispW;
          }
        }

        const hasRotate =
          typeof block.imageRotate === "number" && block.imageRotate !== 0;
        const rad = hasRotate
          ? -((block.imageRotate! % 360) * Math.PI) / 180
          : 0;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const cx = xPos + dispW / 2;
        const cy = yBottom + dispH / 2;

        currentPageStream += `q\n`;
        if (hasCrop) {
          const clipX = xPos + cropLeft;
          const clipY = yBottom + cropBottom;
          const clipW = dispW - cropLeft - cropRight;
          const clipH = dispH - cropTop - cropBottom;
          currentPageStream += `${clipX.toFixed(2)} ${clipY.toFixed(2)} ${clipW.toFixed(2)} ${clipH.toFixed(2)} re W n\n`;
        }
        if (hasRotate) {
          currentPageStream += `1 0 0 1 ${cx.toFixed(2)} ${cy.toFixed(2)} cm ${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} cm 1 0 0 1 ${(-cx).toFixed(2)} ${(-cy).toFixed(2)} cm\n`;
        }
        currentPageStream += `${dispW.toFixed(2)} 0 0 ${dispH.toFixed(2)} ${xPos.toFixed(2)} ${yBottom.toFixed(2)} cm /${img.resName} Do\n`;
        currentPageStream += `Q\n`;

        if (block.imageHref) {
          currentPageAnnots.push(
            `<< /Type /Annot /Subtype /Link /Rect [${xPos.toFixed(2)} ${yBottom.toFixed(2)} ${(xPos + dispW).toFixed(2)} ${(yBottom + dispH).toFixed(2)}] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${escapePdfString(block.imageHref)}) >> >>`
          );
          currentPageStream += `0.62 0.447 0.373 rg\n`;
          currentPageStream += `BT /F1 8 Tf ${xPos.toFixed(2)} ${(yBottom - 10).toFixed(2)} Td (${escapePdfString(`Link: ${block.imageHref}`)}) Tj ET\n`;
          y = yBottom - 24;
        } else {
          y = yBottom - 18;
        }
      }
    }
  }

  // Also render any attached figures that were not embedded inline
  let figureCounter = 0;
  if ((note.images || []).length > 0) {
    for (const uri of note.images!) {
      if (renderedInlineImages.has(uri)) continue;
      const img = registeredImages.get(uri);
      if (!img) continue;

      figureCounter++;
      let dispW = Math.min(img.width, printableWidth);
      let dispH = Math.round(dispW * (img.height / img.width));
      if (dispH > 380) {
        dispW = Math.round(dispW * (380 / dispH));
        dispH = 380;
      }

      checkPageBreak(dispH + 40);
      y -= 14;

      currentPageStream += `0.62 0.447 0.373 rg\n`;
      currentPageStream += `BT /F2 11 Tf ${marginX} ${y.toFixed(2)} Td (Figure ${figureCounter}: Verified Encrypted Visual Attachment) Tj ET\n`;
      y -= 16;

      const xPos = marginX + (printableWidth - dispW) / 2;
      const yBottom = y - dispH;
      currentPageStream += `q ${dispW.toFixed(2)} 0 0 ${dispH.toFixed(2)} ${xPos.toFixed(2)} ${yBottom.toFixed(2)} cm /${img.resName} Do Q\n`;
      y = yBottom - 20;
    }
  }

  // Running footer on final page
  currentPageStream += `0.6 0.6 0.6 rg\n`;
  currentPageStream += `BT /F1 8 Tf ${marginX} 40 Td (Exported with BYOS Notes • End-to-End Encrypted Document) Tj ET\n`;

  flushCurrentPage();

  // Obj 2 update: Pages dictionary
  const kidsStr = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[1] = {
    dict: `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageIds.length} >>`,
  };

  // Build binary PDF with byte-for-byte exact offsets
  const chunks: Uint8Array[] = [];
  let currentByteOffset = 0;
  function appendBytes(b: Uint8Array) {
    chunks.push(b);
    currentByteOffset += b.length;
  }

  appendBytes(new TextEncoder().encode("%PDF-1.4\n"));
  const xrefOffsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    xrefOffsets.push(currentByteOffset);
    const obj = objects[i];
    appendBytes(new TextEncoder().encode(`${i + 1} 0 obj\n${obj.dict}\n`));
    if (obj.stream) {
      appendBytes(new TextEncoder().encode("stream\n"));
      appendBytes(obj.stream);
      appendBytes(new TextEncoder().encode("\nendstream\n"));
    }
    appendBytes(new TextEncoder().encode("endobj\n"));
  }

  const xrefStartOffset = currentByteOffset;
  let xrefStr = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xrefStr += `${String(xrefOffsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xrefStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStartOffset}\n%%EOF\n`;
  appendBytes(new TextEncoder().encode(xrefStr));

  const totalLength = currentByteOffset;
  const pdfBytes = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    pdfBytes.set(c, pos);
    pos += c.length;
  }

  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

function hexToRgb(hex: string): { r: string; g: string; b: string } {
  const clean = hex.replace("#", "").padEnd(6, "0");
  const r = (parseInt(clean.substring(0, 2), 16) / 255).toFixed(3);
  const g = (parseInt(clean.substring(2, 4), 16) / 255).toFixed(3);
  const b = (parseInt(clean.substring(4, 6), 16) / 255).toFixed(3);
  return { r, g, b };
}

// ============================================================================
// 5. DOCX Generation (Real OpenXML Format for Word Compatibility)
// ============================================================================

export async function generateDocxFromNote(
  note: NoteItem,
  resolveMediaUri: (uri: string) => string
): Promise<Blob> {
  const blocks = parseNoteToDocumentBlocks(note.content || "");
  const zipEntries: ZipEntry[] = [];

  // Content Types XML
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  zipEntries.push({ name: "[Content_Types].xml", data: contentTypes });

  // Root Relationships XML
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  zipEntries.push({ name: "_rels/.rels", data: rels });

  // Word Styles XML
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Inter" w:hAnsi="Inter" w:cs="Inter"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:color w:val="1A1B1E"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
      <w:color w:val="1A1B1E"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:color w:val="1A1B1E"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="24"/>
      <w:color w:val="1A1B1E"/>
    </w:rPr>
  </w:style>
</w:styles>`;
  zipEntries.push({ name: "word/styles.xml", data: stylesXml });

  // Embedded images collection
  interface DocxRel {
    id: string;
    target: string;
    type: string;
    targetMode?: "External";
  }
  const documentRels: DocxRel[] = [
    {
      id: "rIdStyles",
      target: "styles.xml",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    },
  ];

  interface DocxImageEntry {
    relId: string;
    fileName: string;
    dims: { width: number; height: number };
    defaultDrawingXml: string;
  }
  const imageMediaMap = new Map<string, DocxImageEntry>();
  let imageCounter = 0;
  let linkCounter = 0;

  // Process note attached images and any inline images
  const allImageUris: string[] = [];
  for (const block of blocks) {
    if (block.type === "image" && block.imageSrc && !allImageUris.includes(block.imageSrc)) {
      allImageUris.push(block.imageSrc);
    }
  }
  for (const uri of note.images || []) {
    if (!allImageUris.includes(uri)) {
      allImageUris.push(uri);
    }
  }

  for (const uri of allImageUris) {
    const resolved = resolveMediaUri(uri);
    const parsed = dataUrlToBytes(resolved);
    if (parsed) {
      imageCounter++;
      const ext = parsed.mime.includes("jpeg") || parsed.mime.includes("jpg") ? "jpg" : "png";
      const fileName = `image${imageCounter}.${ext}`;
      const relId = `rIdImg${imageCounter}`;

      zipEntries.push({
        name: `word/media/${fileName}`,
        data: parsed.bytes,
      });

      documentRels.push({
        id: relId,
        target: `media/${fileName}`,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      });

      const dims = parseImageDimensions(parsed.bytes);
      // EMUs (English Metric Units): 1 pixel ~= 9525 EMUs
      const emuWidth = Math.min(dims.width * 9525, 5400000); // Clamp to ~5.6 inches max
      const emuHeight = Math.round(emuWidth * (dims.height / dims.width));

      const defaultDrawingXml = `
      <w:drawing>
        <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${emuWidth}" cy="${emuHeight}"/>
          <wp:docPr id="${imageCounter}" name="Figure ${imageCounter}"/>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:nvPicPr>
                  <pic:cNvPr id="${imageCounter}" name="Figure ${imageCounter}"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>
                  <a:stretch>
                    <a:fillRect/>
                  </a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm>
                    <a:off x="0" y="0"/>
                    <a:ext cx="${emuWidth}" cy="${emuHeight}"/>
                  </a:xfrm>
                  <a:prstGeom prst="rect">
                    <a:avLst/>
                  </a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>`;

      imageMediaMap.set(uri, {
        relId,
        fileName,
        dims,
        defaultDrawingXml,
      });
    }
  }

  // Helper to generate customized drawing XML for an image block
  function buildDocxDrawingXml(block: DocBlock): string {
    if (!block.imageSrc) return "";
    const entry = imageMediaMap.get(block.imageSrc);
    if (!entry) return "";

    const aspect = entry.dims.width / (entry.dims.height || 1);
    let targetPixelW = block.imageWidth || entry.dims.width;
    let targetPixelH = block.imageHeight || Math.round(targetPixelW / aspect);

    // Clamp width to max 560px (~5.6 in / 5,334,000 EMUs)
    if (targetPixelW > 560) {
      targetPixelW = 560;
      targetPixelH = Math.round(targetPixelW / aspect);
    }
    const emuWidth = Math.round(targetPixelW * 9525);
    const emuHeight = Math.round(targetPixelH * 9525);

    let docPrHlink = "";
    if (block.imageHref) {
      linkCounter++;
      const linkRelId = `rIdLink${linkCounter}`;
      documentRels.push({
        id: linkRelId,
        target: block.imageHref,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        targetMode: "External",
      });
      docPrHlink = `<a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:id="${linkRelId}"/>`;
    }

    let srcRectXml = "";
    if (block.imageCrop) {
      const parts = block.imageCrop.split(",").map((p) => Math.round(parseFloat(p.trim()) * 1000) || 0);
      if (parts.length === 4) {
        const [top, right, bottom, left] = parts;
        srcRectXml = `<a:srcRect t="${top}" r="${right}" b="${bottom}" l="${left}"/>`;
      }
    }

    const rotAttr = block.imageRotate ? ` rot="${block.imageRotate * 60000}"` : "";
    const docPrDescr = block.imageAlt ? ` descr="${escapeXml(block.imageAlt)}"` : "";
    const docPrContent = docPrHlink ? `>${docPrHlink}</wp:docPr>` : "/>";
    const cNvPrContent = docPrHlink ? `>${docPrHlink}</pic:cNvPr>` : "/>";
    imageCounter++;
    const figureId = imageCounter;

    return `
      <w:drawing>
        <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${emuWidth}" cy="${emuHeight}"/>
          <wp:docPr id="${figureId}" name="Figure ${figureId}"${docPrDescr}${docPrContent}
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:nvPicPr>
                  <pic:cNvPr id="${figureId}" name="Figure ${figureId}"${docPrDescr}${cNvPrContent}
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${entry.relId}"/>
                  ${srcRectXml}
                  <a:stretch>
                    <a:fillRect/>
                  </a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm${rotAttr}>
                    <a:off x="0" y="0"/>
                    <a:ext cx="${emuWidth}" cy="${emuHeight}"/>
                  </a:xfrm>
                  <a:prstGeom prst="rect">
                    <a:avLst/>
                  </a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>`;
  }

  // Generate word/document.xml content
  let bodyXml = "";

  // Title Paragraph
  const title = escapeXml(note.title || "Untitled Document");
  bodyXml += `
    <w:p>
      <w:pPr>
        <w:jc w:val="left"/>
        <w:spacing w:after="160"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:sz w:val="48"/>
          <w:color w:val="9E725F"/>
        </w:rPr>
        <w:t>${title}</w:t>
      </w:r>
    </w:p>`;

  const renderedDocxInlineImages = new Set<string>();

  // Process Document Blocks
  for (const block of blocks) {
    const alignVal = block.align === "center" ? "center" : block.align === "right" ? "right" : "left";

    if (block.type === "heading") {
      const headingStyle = block.level === 1 ? "Heading1" : block.level === 2 ? "Heading2" : "Heading3";
      bodyXml += `
    <w:p>
      <w:pPr>
        <w:pStyle w:val="${headingStyle}"/>
        <w:jc w:val="${alignVal}"/>
        <w:spacing w:before="240" w:after="120"/>
      </w:pPr>
      ${renderRunsToDocx(block.runs)}
    </w:p>`;
    } else if (block.type === "quote") {
      bodyXml += `
    <w:p>
      <w:pPr>
        <w:pBdr>
          <w:left w:val="single" w:sz="24" w:space="12" w:color="9E725F"/>
        </w:pBdr>
        <w:ind w:left="400"/>
        <w:spacing w:before="120" w:after="120"/>
      </w:pPr>
      ${renderRunsToDocx(block.runs, { italic: true, color: "6F7173" })}
    </w:p>`;
    } else if (block.type === "code") {
      bodyXml += `
    <w:p>
      <w:pPr>
        <w:shd w:val="clear" w:color="auto" w:fill="F4F4F5"/>
        <w:ind w:left="240" w:right="240"/>
        <w:spacing w:before="120" w:after="120"/>
      </w:pPr>
      ${renderRunsToDocx(block.runs, { font: "Courier New" })}
    </w:p>`;
    } else if (block.type === "list-item") {
      const prefix = block.listType === "number" ? "1.  " : "•   ";
      bodyXml += `
    <w:p>
      <w:pPr>
        <w:ind w:left="480" w:hanging="240"/>
        <w:jc w:val="${alignVal}"/>
        <w:spacing w:after="60"/>
      </w:pPr>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>${prefix}</w:t>
      </w:r>
      ${renderRunsToDocx(block.runs)}
    </w:p>`;
    } else if (block.type === "image" && block.imageSrc) {
      const drawing = buildDocxDrawingXml(block);
      if (drawing) {
        renderedDocxInlineImages.add(block.imageSrc);
        bodyXml += `
    <w:p>
      <w:pPr>
        <w:jc w:val="${alignVal}"/>
        <w:spacing w:before="160" w:after="160"/>
      </w:pPr>
      <w:r>${drawing}</w:r>
    </w:p>`;
      }
    } else {
      // Paragraph
      bodyXml += `
    <w:p>
      <w:pPr>
        <w:jc w:val="${alignVal}"/>
        <w:spacing w:after="120"/>
      </w:pPr>
      ${renderRunsToDocx(block.runs)}
    </w:p>`;
    }
  }

  // Also append any note images that weren't embedded inline
  if ((note.images || []).length > 0) {
    for (const uri of note.images!) {
      if (renderedDocxInlineImages.has(uri)) continue;
      const entry = imageMediaMap.get(uri);
      if (entry) {
        bodyXml += `
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:before="240" w:after="240"/>
      </w:pPr>
      <w:r>${entry.defaultDrawingXml}</w:r>
    </w:p>`;
      }
    }
  }

  // Word Document Relationships XML (built after processing all blocks and inline links)
  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${documentRels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${
          r.targetMode ? ` TargetMode="${r.targetMode}"` : ""
        }/>`
    )
    .join("\n  ")}
</Relationships>`;
  zipEntries.push({ name: "word/_rels/document.xml.rels", data: docRelsXml });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  zipEntries.push({ name: "word/document.xml", data: documentXml });

  const zipBytes = buildZipArchive(zipEntries);
  return new Blob([zipBytes.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function renderRunsToDocx(
  runs: DocRun[],
  overrides?: { italic?: boolean; color?: string; font?: string }
): string {
  if (!runs || runs.length === 0) return "";
  let out = "";

  for (const run of runs) {
    const isBold = Boolean(run.bold);
    const isItalic = Boolean(run.italic || overrides?.italic);
    const isUnderline = Boolean(run.underline);
    const isStrike = Boolean(run.strikethrough);

    const fontVal =
      overrides?.font ||
      (run.fontFamily === "serif"
        ? "Georgia"
        : run.fontFamily === "mono"
        ? "Courier New"
        : "Inter");

    // Word sz is in half-points: 11pt = 22, 14pt = 28, 24pt = 48
    const fontSizeVal = run.fontSize ? run.fontSize * 2 : 22;
    const colorVal = overrides?.color || run.color || "1A1B1E";

    out += `
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="${fontVal}" w:hAnsi="${fontVal}"/>
          ${isBold ? "<w:b/>" : ""}
          ${isItalic ? "<w:i/>" : ""}
          ${isUnderline ? '<w:u w:val="single"/>' : ""}
          ${isStrike ? "<w:strike/>" : ""}
          <w:sz w:val="${fontSizeVal}"/>
          <w:szCs w:val="${fontSizeVal}"/>
          <w:color w:val="${colorVal}"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(run.text)}</w:t>
      </w:r>`;
  }

  return out;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================================
// 6. Browser Download and File Helpers
// ============================================================================

/**
 * Triggers a browser file download for an exported document.
 */
export function downloadDocumentFile(blob: Blob, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Converts an exported document Blob into a standard File object for Mail Compose sharing.
 */
export function createDocumentExportFile(blob: Blob, filename: string): File {
  return new File([blob], filename, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

/**
 * Sanitizes note title into a safe filename with appropriate extension.
 */
export function getSafeExportFilename(noteTitle: string, ext: "pdf" | "docx"): string {
  const safe = (noteTitle || "untitled")
    .trim()
    .replace(/[^\w\s\-\.]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 60);
  return `${safe || "document"}.${ext}`;
}
