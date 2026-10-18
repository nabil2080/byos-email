import QRCode from "qrcode";

/**
 * Generates an ISO/IEC 18004 standard QR Code vector SVG.
 * Uses the standard qrcode generator to ensure 100% compliance with mobile camera scanners
 * and authenticator apps (Google Authenticator, Microsoft Authenticator, Authy, Apple Passwords).
 */
export function generateQRCodeSVG(text: string, size: number = 200): string {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const moduleCount = qr.modules.size;
    const margin = 4; // Mandatory 4-module quiet zone per QR standard
    const total = moduleCount + margin * 2;
    let rects = "";
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.modules.get(r, c)) {
          rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="#1A1B1E"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/>${rects}</svg>`;
  } catch (err) {
    console.error("Failed to generate QR code SVG:", err);
    return "";
  }
}
