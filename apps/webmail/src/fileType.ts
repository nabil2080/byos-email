export type AttachmentCategory = "PDF" | "IMG" | "SHEET" | "DOC" | "ZIP" | "FILE";

export interface FileTypeInfo {
  category: AttachmentCategory;
  label: string;
  badgeClass: string;
  borderClass: string;
  textClass: string;
  bgClass: string;
}

export function getFileTypeInfo(filename?: string, contentType?: string): FileTypeInfo {
  const name = (filename || "").trim().toLowerCase();
  const ext = name.split(".").pop() || "";
  const ct = (contentType || "").toLowerCase();

  // 1. PDF
  if (ext === "pdf" || ct.includes("pdf")) {
    return {
      category: "PDF",
      label: "PDF",
      badgeClass: "bg-[#F0EEE9] text-[#9E725F] border-[#E2DFD8] dark:bg-[#26282E] dark:text-[#D4A38F] dark:border-[#3A3D46]",
      borderClass: "border-[#E2DFD8] dark:border-[#3A3D46]",
      textClass: "text-[#9E725F] dark:text-[#D4A38F]",
      bgClass: "bg-[#F0EEE9] dark:bg-[#26282E]",
    };
  }

  // 2. Image
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff", "avif"].includes(ext) ||
    ct.startsWith("image/")
  ) {
    return {
      category: "IMG",
      label: "IMG",
      badgeClass: "bg-[#F0EEE9] text-[#9E725F] border-[#E2DFD8] dark:bg-[#26282E] dark:text-[#D4A38F] dark:border-[#3A3D46]",
      borderClass: "border-[#E2DFD8] dark:border-[#3A3D46]",
      textClass: "text-[#9E725F] dark:text-[#D4A38F]",
      bgClass: "bg-[#F0EEE9] dark:bg-[#26282E]",
    };
  }

  // 3. Spreadsheet / Sheet
  if (
    ["xlsx", "xls", "csv", "tsv", "ods"].includes(ext) ||
    ct.includes("spreadsheet") ||
    ct.includes("csv") ||
    ct.includes("excel")
  ) {
    return {
      category: "SHEET",
      label: "SHEET",
      badgeClass: "bg-[#F0EEE9] text-[#9E725F] border-[#E2DFD8] dark:bg-[#26282E] dark:text-[#D4A38F] dark:border-[#3A3D46]",
      borderClass: "border-[#E2DFD8] dark:border-[#3A3D46]",
      textClass: "text-[#9E725F] dark:text-[#D4A38F]",
      bgClass: "bg-[#F0EEE9] dark:bg-[#26282E]",
    };
  }

  // 4. Document / Word / Text
  if (
    ["doc", "docx", "txt", "rtf", "odt", "md", "json", "xml", "log"].includes(ext) ||
    ct.includes("word") ||
    ct.includes("document") ||
    ct.startsWith("text/")
  ) {
    return {
      category: "DOC",
      label: "DOC",
      badgeClass: "bg-[#F0EEE9] text-[#9E725F] border-[#E2DFD8] dark:bg-[#26282E] dark:text-[#D4A38F] dark:border-[#3A3D46]",
      borderClass: "border-[#E2DFD8] dark:border-[#3A3D46]",
      textClass: "text-[#9E725F] dark:text-[#D4A38F]",
      bgClass: "bg-[#F0EEE9] dark:bg-[#26282E]",
    };
  }

  // 5. Archive / Zip
  if (
    ["zip", "tar", "gz", "7z", "rar", "bz2", "xz", "iso"].includes(ext) ||
    ct.includes("zip") ||
    ct.includes("tar") ||
    ct.includes("compressed") ||
    ct.includes("archive")
  ) {
    return {
      category: "ZIP",
      label: "ZIP",
      badgeClass: "bg-[#F0EEE9] text-[#9E725F] border-[#E2DFD8] dark:bg-[#26282E] dark:text-[#D4A38F] dark:border-[#3A3D46]",
      borderClass: "border-[#E2DFD8] dark:border-[#3A3D46]",
      textClass: "text-[#9E725F] dark:text-[#D4A38F]",
      bgClass: "bg-[#F0EEE9] dark:bg-[#26282E]",
    };
  }

  // 6. Generic / Other (Mocha / Warm Sand)
  return {
    category: "FILE",
    label: ext ? ext.toUpperCase().slice(0, 4) : "FILE",
    badgeClass: "bg-[#F0EEE9] text-[#9E725F] border-[#E2DFD8] dark:bg-[#26282E] dark:text-[#D4A38F] dark:border-[#3A3D46]",
    borderClass: "border-[#E2DFD8] dark:border-[#3A3D46]",
    textClass: "text-[#9E725F] dark:text-[#D4A38F]",
    bgClass: "bg-[#F0EEE9] dark:bg-[#26282E]",
  };
}
