import { getFileTypeInfo } from "./fileType.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runFileTypeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  // 1. PDF
  runTest("PDF file extension", () => {
    const info = getFileTypeInfo("document.pdf");
    assert(info.category === "PDF", "Category should be PDF");
    assert(info.label === "PDF", "Label should be PDF");
  });

  runTest("PDF content type", () => {
    const info = getFileTypeInfo(undefined, "application/pdf");
    assert(info.category === "PDF", "Category should be PDF");
  });

  runTest("PDF uppercase extension", () => {
    const info = getFileTypeInfo("DOCUMENT.PDF");
    assert(info.category === "PDF", "Category should be PDF");
  });

  // 2. Image
  runTest("Image extensions and content type", () => {
    assert(getFileTypeInfo("image.png").category === "IMG", "png should be IMG");
    assert(getFileTypeInfo("image.jpeg").category === "IMG", "jpeg should be IMG");
    assert(getFileTypeInfo("image.webp").category === "IMG", "webp should be IMG");
    assert(getFileTypeInfo(undefined, "image/svg+xml").category === "IMG", "image/svg+xml should be IMG");
  });

  // 3. Spreadsheet
  runTest("Spreadsheet extensions and content type", () => {
    assert(getFileTypeInfo("data.csv").category === "SHEET", "csv should be SHEET");
    assert(getFileTypeInfo("data.xlsx").category === "SHEET", "xlsx should be SHEET");
    assert(getFileTypeInfo(undefined, "text/csv").category === "SHEET", "text/csv should be SHEET");
    assert(getFileTypeInfo(undefined, "application/vnd.ms-excel").category === "SHEET", "excel content type should be SHEET");
  });

  // 4. Document
  runTest("Document extensions and content type", () => {
    assert(getFileTypeInfo("notes.txt").category === "DOC", "txt should be DOC");
    assert(getFileTypeInfo("notes.md").category === "DOC", "md should be DOC");
    assert(getFileTypeInfo("notes.docx").category === "DOC", "docx should be DOC");
    assert(getFileTypeInfo(undefined, "text/plain").category === "DOC", "text/plain should be DOC");
    assert(getFileTypeInfo(undefined, "application/msword").category === "DOC", "msword content type should be DOC");
  });

  // 5. Archive
  runTest("Archive extensions and content type", () => {
    assert(getFileTypeInfo("archive.zip").category === "ZIP", "zip should be ZIP");
    assert(getFileTypeInfo("archive.tar.gz").category === "ZIP", "gz should be ZIP");
    assert(getFileTypeInfo(undefined, "application/zip").category === "ZIP", "application/zip should be ZIP");
  });

  // 6. Generic / Other
  runTest("Generic / Other extensions and unknown types", () => {
    const binInfo = getFileTypeInfo("app.bin");
    assert(binInfo.category === "FILE", "bin should be FILE");
    assert(binInfo.label === "BIN", "label should be BIN");

    const exeInfo = getFileTypeInfo("app.exe");
    assert(exeInfo.category === "FILE", "exe should be FILE");
    assert(exeInfo.label === "EXE", "label should be EXE");

    const noExtInfo = getFileTypeInfo("Makefile");
    assert(noExtInfo.category === "FILE", "Makefile should be FILE");
    assert(noExtInfo.label === "MAKE", "label should use full string limited to 4 chars");
  });

  runTest("Empty arguments", () => {
    const info = getFileTypeInfo();
    assert(info.category === "FILE", "Empty args should return FILE");
    assert(info.label === "FILE", "Empty args label should be FILE");
  });

  runTest("Long extension truncation", () => {
    const info = getFileTypeInfo("file.reallylongextension");
    assert(info.category === "FILE", "Long extension should be FILE");
    assert(info.label === "REAL", "Label should be truncated to 4 characters");
  });

  return { passed, failed };
}
