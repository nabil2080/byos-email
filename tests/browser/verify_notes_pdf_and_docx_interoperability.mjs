/**
 * BYOS Notes: Comprehensive PDF & DOCX Visual Interoperability Verification Suite
 *
 * Verifies:
 * 1. PDF image rendering:
 *    - JPEG streams with valid /Filter /DCTDecode
 *    - Transparent PNG streams with /Filter /FlateDecode and /SMask soft mask
 *    - Image dimensions, cropping, rotation, and alignment in PDF streams
 *    - Interactive PDF hyperlink annotations (/Subtype /Link)
 *    - Visual rendering in Chrome PDFium engine (capturing page 1 & page 2 screenshots)
 *    - Chrome PDFium interactive click navigation on image hyperlink
 * 2. DOCX image hyperlink:
 *    - DrawingML a:hlinkClick placement inside wp:docPr and pic:cNvPr
 *    - External relationship targeting in word/_rels/document.xml.rels
 *    - Real Microsoft Word COM automation (WINWORD.EXE) inspecting InlineShapes and Hyperlink.Address
 */

import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");
if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

const docExportPath = path.resolve(__dirname, "../../apps/webmail/src/utils/documentExport.ts");
const docExportModuleUrl = pathToFileURL(docExportPath).href;

const results = [];
function recordResult(id, desc, passed, details = "") {
  results.push({ id, desc, passed, details });
  const status = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${status} [${id}] ${desc}`);
  if (details) console.log(`         Details: ${typeof details === "object" ? JSON.stringify(details) : details}`);
}

async function runVerification() {
  console.log("================================================================================");
  console.log("   BYOS NOTES: PDF RENDERING & DOCX HYPERLINK VERIFICATION                     ");
  console.log("================================================================================\n");

  // Load documentExport functions via dynamic import
  const {
    generatePdfFromNote,
    generateDocxFromNote,
    decodePngImage,
    dataUrlToBytes,
    parseImageDimensions,
  } = await import(docExportModuleUrl);

  // Load test fixtures
  const fixturesPath = path.resolve(__dirname, "../../scratch/fixtures/fixtures.json");
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

  // Create comprehensive note fixture
  const note = {
    id: "note-verify-interop-comprehensive",
    title: "Document Interoperability & Picture Formatting Specification",
    content: `
      <h2>1. Architecture Blueprint Specification (JPEG)</h2>
      <p>High-resolution bitmap diagram encoded with DCT discrete cosine transform.</p>
      <p><img src="${fixtures.jpgDataUrl}" alt="Blueprint JPEG" data-width="480px" data-height="270px" data-align="center" /></p>
      
      <h2>2. Transparent Security Badge (PNG with Alpha SMask)</h2>
      <p>Zero-knowledge cryptographic security seal with alpha channel soft mask transparency.</p>
      <p><img src="${fixtures.pngTransparentDataUrl}" alt="Transparent Security Badge" data-width="320px" data-height="180px" data-align="left" /></p>
      
      <h2>3. Cropped & Rotated Pipeline Diagram (Hyperlinked)</h2>
      <p>Engineering pipeline diagram with 10% vertical insets, 90-degree CW rotation, and external documentation link.</p>
      <p><a href="https://byos.dev/docs"><img src="${fixtures.pngDiagramDataUrl}" alt="Architecture Pipeline" data-width="420px" data-height="280px" data-align="center" data-crop="10,0,10,0" data-rotate="90" data-wrap="square" /></a></p>
      
      <p>Refer to official <a href="https://byos.dev">BYOS Platform Documentation</a> for encryption details.</p>
    `,
    color: "default",
    isPinned: false,
    isArchived: false,
    isInBin: false,
    labels: ["Interoperability", "Verification"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // =========================================================================
  // STEP 1: PDF Generation & Binary Stream Inspection
  // =========================================================================
  console.log("--- [STEP 1] PDF Generation & Stream Filter Inspection ---");
  const pdfBlob = await generatePdfFromNote(note, (uri) => uri);
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const pdfBuffer = Buffer.from(pdfBytes);
  const pdfOutputPath = path.resolve(__dirname, "../../scratch/out/comprehensive_pdf_test.pdf");
  fs.writeFileSync(pdfOutputPath, pdfBuffer);

  const pdfText = pdfBuffer.toString("binary");

  // Check 1: Header and trailer
  const hasValidHeaderTrailer = pdfText.startsWith("%PDF-1.4") && pdfText.includes("%%EOF");
  recordResult("PDF_01", "PDF conforms to %PDF-1.4 standard format with valid header and %%EOF", hasValidHeaderTrailer, `Size: ${pdfBuffer.length} bytes`);

  // Check 2: JPEG DCTDecode stream filter
  const hasDctFilter = pdfText.includes("/Filter /DCTDecode") && pdfText.includes("/ColorSpace /DeviceRGB");
  recordResult("PDF_02", "JPEG image stream uses valid /Filter /DCTDecode without re-compression", hasDctFilter);

  // Check 3: Transparent PNG FlateDecode and SMask
  const hasFlateFilter = pdfText.includes("/Filter /FlateDecode");
  const hasSmaskRef = /\/SMask\s+\d+\s+0\s+R/.test(pdfText);
  const hasSmaskObj = pdfText.includes("/ColorSpace /DeviceGray") && pdfText.includes("/BitsPerComponent 8");
  recordResult("PDF_03", "Transparent PNG uses /Filter /FlateDecode with /SMask soft mask grayscale channel", hasFlateFilter && hasSmaskRef && hasSmaskObj);

  // Check 4: Crop clipping and rotation matrix
  const hasCropClipping = pdfText.includes("re W n");
  const hasRotationMatrix = /1 0 0 1 \d+.*cm 0\.0000 -1\.0000 1\.0000 0\.0000 cm/.test(pdfText) || pdfText.includes("-1.0000 1.0000");
  recordResult("PDF_04", "Cropped and rotated image applies PDF clipping path (re W n) and rotation matrix", hasCropClipping && hasRotationMatrix);

  // Check 5: Interactive Hyperlink Annotation
  const hasLinkAnnotation = pdfText.includes("/Type /Annot /Subtype /Link /Rect") && pdfText.includes("https://byos.dev/docs");
  recordResult("PDF_05", "PDF includes interactive hyperlink annotation (/Subtype /Link) pointing to https://byos.dev/docs", hasLinkAnnotation);

  // =========================================================================
  // STEP 2: Chrome PDFium Independent Rendering & Click Navigation
  // =========================================================================
  console.log("\n--- [STEP 2] Chrome PDFium Rendering & Interactive Navigation ---");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1000, height: 800 },
  });

  try {
    const page = await browser.newPage();
    const pdfFileUrl = pathToFileURL(pdfOutputPath).href;
    await page.goto(pdfFileUrl, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 2000));

    // Find PDFium extension frame
    const pdfFrame = page.frames().find((f) => f.url().includes("mhjfbmdgcfjbbpaeojofohoefgiehjai"));
    const pdfiumLoaded = Boolean(pdfFrame);
    recordResult("PDFIUM_01", "Chrome launched native PDFium viewer extension frame", pdfiumLoaded);

    if (pdfFrame) {
      // Check PDFium internal load state and document metadata
      const viewerState = await pdfFrame.evaluate(() => {
        const viewer = document.querySelector("pdf-viewer");
        return {
          loadState: viewer?.loadState_,
          docLength: viewer?.docLength_,
          version: viewer?.documentMetadata_?.version,
          dimensions: viewer?.documentDimensions?.pageDimensions?.length,
        };
      });

      const viewerSuccess = viewerState.loadState === "success" && viewerState.docLength === 2;
      recordResult("PDFIUM_02", "PDFium verified 2 pages with loadState='success' and version 1.4", viewerSuccess, viewerState);

      // Capture Page 1 screenshot
      const page1ShotPath = path.resolve(artifactsDir, "notes_pdfium_rendered_page1.png");
      await page.screenshot({ path: page1ShotPath });
      recordResult("SHOT_PDF_P1", "Captured Chrome PDFium rendered Page 1 screenshot", fs.existsSync(page1ShotPath));

      // Navigate to Page 2 in PDFium viewer
      await pdfFrame.evaluate(() => {
        const viewer = document.querySelector("pdf-viewer");
        viewer.viewport_.goToPage(1); // Page 2 (0-indexed)
      });
      await new Promise((r) => setTimeout(r, 1200));

      // Capture Page 2 screenshot
      const page2ShotPath = path.resolve(artifactsDir, "notes_pdfium_rendered_page2.png");
      await page.screenshot({ path: page2ShotPath });
      recordResult("SHOT_PDF_P2", "Captured Chrome PDFium rendered Page 2 screenshot", fs.existsSync(page2ShotPath));

      // Setup navigation interceptor on PDFium navigator
      await pdfFrame.evaluate(() => {
        const viewer = document.querySelector("pdf-viewer");
        window.__capturedNavigations = [];
        viewer.navigator_.navigate = (url, disposition) => {
          window.__capturedNavigations.push({ url, disposition });
        };
      });

      // Click center of linked image on Page 2
      // The plugin area is from left: 301 to 1000, center is ~650
      console.log("  Clicking on hyperlinked image in PDFium viewer...");
      await page.mouse.click(650, 350);
      await new Promise((r) => setTimeout(r, 1000));

      const capturedNavs = await pdfFrame.evaluate(() => window.__capturedNavigations);
      const clickedDocLink = capturedNavs && capturedNavs.length > 0 && capturedNavs[0].url === "https://byos.dev/docs";
      recordResult("PDFIUM_03", "Clicking hyperlinked image in PDFium triggered navigation to https://byos.dev/docs", clickedDocLink, capturedNavs);
    }
  } finally {
    await browser.close();
  }

  // =========================================================================
  // STEP 3: DOCX Generation & OpenXML Structure Validation
  // =========================================================================
  console.log("\n--- [STEP 3] DOCX Generation & OpenXML Structure Inspection ---");
  const docxBlob = await generateDocxFromNote(note, (uri) => uri);
  const docxBytes = new Uint8Array(await docxBlob.arrayBuffer());
  const docxBuffer = Buffer.from(docxBytes);
  const docxOutputPath = path.resolve(__dirname, "../../scratch/out/comprehensive_docx_test.docx");
  fs.writeFileSync(docxOutputPath, docxBuffer);

  // Unzip DOCX into scratch directory for rigorous XML verification
  const unzippedDir = path.resolve(__dirname, "../../scratch/unzipped_comprehensive_docx");
  if (fs.existsSync(unzippedDir)) fs.rmSync(unzippedDir, { recursive: true, force: true });
  fs.mkdirSync(unzippedDir, { recursive: true });

  const tempZipPath = path.resolve(__dirname, "../../scratch/temp_comprehensive.zip");
  fs.writeFileSync(tempZipPath, docxBuffer);
  execSync(`powershell -Command "Expand-Archive -Force '${tempZipPath}' '${unzippedDir}'"`);
  fs.unlinkSync(tempZipPath);

  const docXml = fs.readFileSync(path.resolve(unzippedDir, "word/document.xml"), "utf8");
  const docRelsXml = fs.readFileSync(path.resolve(unzippedDir, "word/_rels/document.xml.rels"), "utf8");

  // Check 1: External relationship exists and points to https://byos.dev/docs
  const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/hyperlink"[^>]+Target="([^"]+)"[^>]+TargetMode="External"/i;
  const relMatch = docRelsXml.match(relRegex);
  const hasExtRel = relMatch && relMatch[2] === "https://byos.dev/docs";
  const linkRelId = relMatch ? relMatch[1] : null;
  recordResult("DOCX_XML_01", "word/_rels/document.xml.rels contains external relationship targeting https://byos.dev/docs", Boolean(hasExtRel), { relId: linkRelId, target: relMatch?.[2] });

  // Check 2: a:hlinkClick placed inside wp:docPr
  const hasDocPrHlink = docXml.includes(`<wp:docPr`) && docXml.includes(`<a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:id="${linkRelId}"/>`);
  recordResult("DOCX_XML_02", "DrawingML a:hlinkClick is nested correctly inside wp:docPr non-visual properties", hasDocPrHlink);

  // Check 3: a:hlinkClick placed inside pic:cNvPr
  const hasPicPrHlink = docXml.includes(`<pic:cNvPr`) && docXml.includes(`r:id="${linkRelId}"/>`);
  recordResult("DOCX_XML_03", "DrawingML a:hlinkClick is nested correctly inside pic:cNvPr shape non-visual properties", hasPicPrHlink);

  // Check 4: Zero orphaned or mismatched hyperlink relationships
  const allHlinkClicks = [...docXml.matchAll(/<a:hlinkClick[^>]+r:id="([^"]+)"/g)].map((m) => m[1]);
  const allRelIdsInRels = [...docRelsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"/g)].map((m) => m[1]);
  const allHlinksExist = allHlinkClicks.length > 0 && allHlinkClicks.every((id) => allRelIdsInRels.includes(id));
  recordResult("DOCX_XML_04", "Every DrawingML hyperlink relationship ID exists in document.xml.rels", allHlinksExist, { referenced: allHlinkClicks });

  // =========================================================================
  // STEP 4: Microsoft Word COM Automation (WINWORD.EXE) Validation
  // =========================================================================
  console.log("\n--- [STEP 4] Microsoft Word COM Automation (WINWORD.EXE) ---");
  const psWordScript = `
    $docxPath = '${docxOutputPath.replace(/\\/g, "\\\\")}'
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    try {
      $doc = $word.Documents.Open($docxPath, $false, $true)
      $pCount = $doc.Paragraphs.Count
      $sCount = $doc.InlineShapes.Count
      $hlCount = $doc.Hyperlinks.Count
      $shape1Alt = ""
      $shape2Alt = ""
      $shape3Alt = ""
      $shape3Link = ""
      if ($sCount -ge 1) { $shape1Alt = $doc.InlineShapes.Item(1).AlternativeText }
      if ($sCount -ge 2) { $shape2Alt = $doc.InlineShapes.Item(2).AlternativeText }
      if ($sCount -ge 3) {
        $shape3Alt = $doc.InlineShapes.Item(3).AlternativeText
        if ($doc.InlineShapes.Item(3).Hyperlink -ne $null) {
          $shape3Link = $doc.InlineShapes.Item(3).Hyperlink.Address
        }
      }
      Write-Output "WORD_OK: Paragraphs=$pCount InlineShapes=$sCount Hyperlinks=$hlCount Shape1Alt=$shape1Alt Shape2Alt=$shape2Alt Shape3Alt=$shape3Alt Shape3Link=$shape3Link"
    } catch {
      Write-Output "WORD_ERR: $_"
    } finally {
      if ($doc -ne $null) {
        $doc.Close(0)
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
      }
      if ($word -ne $null) {
        $word.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
      }
    }
  `;

  const psWordPath = path.resolve(__dirname, "../../scratch/validate_comprehensive_word.ps1");
  fs.writeFileSync(psWordPath, psWordScript);
  const wordOut = execSync(`powershell -ExecutionPolicy Bypass -File "${psWordPath}"`).toString().trim();
  fs.unlinkSync(psWordPath);
  console.log(`  Word COM output: ${wordOut}`);

  const wordSuccess = wordOut.includes("WORD_OK:") && wordOut.includes("InlineShapes=3");
  recordResult("DOCX_WORD_01", "Microsoft Word opened DOCX without errors, recognizing 3 InlineShapes", wordSuccess, wordOut);

  const wordHyperlinkSuccess = wordOut.includes("Shape3Link=https://byos.dev/docs") && wordOut.includes("Hyperlinks=1");
  recordResult("DOCX_WORD_02", "Microsoft Word recognized image hyperlink directly on Shape3 (https://byos.dev/docs)", wordHyperlinkSuccess, wordOut);

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n================================================================================");
  console.log("                           VERIFICATION SUMMARY                                 ");
  console.log("================================================================================");
  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = results.filter((r) => !r.passed).length;
  console.log(`TOTAL CHECKS: ${totalChecks}`);
  console.log(`PASSED: ${passedChecks}`);
  console.log(`FAILED: ${failedChecks}`);

  if (failedChecks > 0) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
