import { describe, it, expect } from "vitest";
import {
  buildZipArchive,
  dataUrlToBytes,
  parseImageDimensions,
  parseNoteToDocumentBlocks,
  generatePdfFromNote,
  generateDocxFromNote,
  getSafeExportFilename,
  createDocumentExportFile,
} from "./documentExport";
import { NoteItem } from "../components/notes/notesStore";

describe("documentExport", () => {
  describe("buildZipArchive", () => {
    it("creates a valid uncompressed PKZIP container with CRC-32", () => {
      const files = [
        { name: "hello.txt", data: "Hello World" },
        { name: "data.bin", data: new Uint8Array([1, 2, 3, 4, 5]) },
      ];
      const zipBytes = buildZipArchive(files);
      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.length).toBeGreaterThan(100);

      // Verify PKZIP magic bytes (0x50 0x4B 0x03 0x04)
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);
      expect(zipBytes[2]).toBe(0x03);
      expect(zipBytes[3]).toBe(0x04);
    });
  });

  describe("dataUrlToBytes and parseImageDimensions", () => {
    it("decodes base64 data URLs accurately", () => {
      // 1x1 transparent PNG data URL
      const pngDataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const res = dataUrlToBytes(pngDataUrl);
      expect(res).not.toBeNull();
      expect(res!.mime).toBe("image/png");
      expect(res!.bytes.length).toBeGreaterThan(20);

      const dims = parseImageDimensions(res!.bytes);
      expect(dims.width).toBe(1);
      expect(dims.height).toBe(1);
    });
  });

  describe("parseNoteToDocumentBlocks", () => {
    it("extracts headings, paragraphs, and list blocks", () => {
      const sampleHtml = `
        <h1>Document Title</h1>
        <p style="text-align: center;">Centered Introduction</p>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <blockquote style="text-align: right;">Famous quotation</blockquote>
      `;
      const blocks = parseNoteToDocumentBlocks(sampleHtml);
      expect(blocks.length).toBeGreaterThanOrEqual(4);

      const h1 = blocks.find((b) => b.type === "heading" && b.level === 1);
      expect(h1).toBeDefined();
      expect(h1?.runs[0]?.text).toContain("Document Title");

      const pCenter = blocks.find((b) => b.type === "paragraph" && b.align === "center");
      expect(pCenter).toBeDefined();

      const items = blocks.filter((b) => b.type === "list-item");
      expect(items.length).toBe(2);
    });
  });

  describe("generatePdfFromNote", () => {
    it("generates a valid %PDF-1.4 binary document", async () => {
      const note: NoteItem = {
        id: "note-1",
        title: "Architecture Blueprint",
        content: `
          <h1>System Overview</h1>
          <p>Zero-knowledge encrypted note with document formatting.</p>
          <ul>
            <li>Client-side encryption</li>
            <li>MinIO S3 compatibility</li>
          </ul>
        `,
        color: "default",
        isPinned: false,
        isArchived: false,
        isInBin: false,
        labels: ["Architecture"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const pdfBlob = await generatePdfFromNote(note, (uri) => uri);
      expect(pdfBlob).toBeInstanceOf(Blob);
      expect(pdfBlob.type).toBe("application/pdf");

      const arrayBuf = await pdfBlob.arrayBuffer();
      const text = new TextDecoder().decode(arrayBuf);

      expect(text.startsWith("%PDF-1.4")).toBe(true);
      expect(text).toContain("/Type /Catalog");
      expect(text).toContain("/Type /Pages");
      expect(text).toContain("Architecture Blueprint");
      expect(text).toContain("System Overview");
      expect(text).toContain("%%EOF");
    });
  });

  describe("generateDocxFromNote", () => {
    it("generates an OpenXML .docx ZIP container with document.xml and styles.xml", async () => {
      const note: NoteItem = {
        id: "note-2",
        title: "Executive Summary",
        content: `
          <h2>Strategic Initiatives</h2>
          <p style="text-align: center;"><span style="color: #9E725F; font-size: 16px;"><b>Priorities for 2026:</b></span></p>
          <ol>
            <li>Zero-knowledge enterprise security</li>
            <li>Document-oriented notes editing</li>
          </ol>
        `,
        color: "default",
        isPinned: false,
        isArchived: false,
        isInBin: false,
        labels: ["Executive"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const docxBlob = await generateDocxFromNote(note, (uri) => uri);
      expect(docxBlob).toBeInstanceOf(Blob);
      expect(docxBlob.type).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );

      const arrayBuf = await docxBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);

      // Verify ZIP magic signature
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);

      const text = new TextDecoder().decode(bytes);
      expect(text).toContain("[Content_Types].xml");
      expect(text).toContain("word/document.xml");
      expect(text).toContain("word/styles.xml");
      expect(text).toContain("Strategic Initiatives");
      expect(text).toContain("9E725F");
    });
  });

  describe("getSafeExportFilename and createDocumentExportFile", () => {
    it("produces safe sanitized filenames for both formats", () => {
      const pdfName = getSafeExportFilename("Meeting Notes: 2026/11/09 *Confidential*", "pdf");
      expect(pdfName).toBe("Meeting_Notes_20261109_Confidential.pdf");

      const docxName = getSafeExportFilename("My Project Plan", "docx");
      expect(docxName).toBe("My_Project_Plan.docx");

      const emptyName = getSafeExportFilename("", "pdf");
      expect(emptyName).toBe("untitled.pdf");
    });

    it("wraps Blob into standard File object for Mail compose sharing", () => {
      const blob = new Blob(["test"], { type: "application/pdf" });
      const file = createDocumentExportFile(blob, "test.pdf");
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe("test.pdf");
      expect(file.type).toBe("application/pdf");
    });
  });
});
