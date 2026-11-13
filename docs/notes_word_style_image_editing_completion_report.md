# Notes Word-Style Image Editing, PDF Rendering, and DOCX Hyperlink Report

## What was built
We upgraded the BYOS Notes document editor with professional Microsoft Word-style image editing, picture formatting, and multi-format export interoperability. The awkward duplicate visual assets thumbnail gallery rendered above notes was removed and replaced with a clean inline document representation and a dedicated uninserted attachments tray below the document surface. Clicking an image activates a detached, non-intrusive 8-handle selection overlay with live dimension badge (`W × H px`) supporting pointer capture mouse drag resizing (preserving aspect ratio on corners, axis resizing on side handles), keyboard resizing, and a native Picture Tools contextual toolbar providing alignment (left, center, right), text wrapping (inline, square, top/bottom), rotation (CW, CCW), non-destructive visual cropping (`clip-path: inset(...)`), alt text accessibility editing, and safe image hyperlinks with open-in-new-tab options. The document export pipeline was enhanced to generate ISO-standard %PDF-1.4 with discrete cosine transform JPEG decoding (/Filter /DCTDecode), FlateDecode truecolor PNG with alpha channel soft masks (/SMask), matrix transformations for rotation and clipping paths (`re W n`) for non-destructive visual crop, interactive PDF hyperlink annotations (/Subtype /Link), and OpenXML DrawingML packaging with hyperlink click bindings (`a:hlinkClick`) correctly positioned inside `wp:docPr` and `pic:cNvPr` for native Microsoft Word hyperlink recognition.

## Files edited
| File | Reason |
|------|--------|
| apps/webmail/src/components/notes/NotesEditor.tsx | Implemented Word-style detached 8-handle selection overlay, live dimension tooltip, Picture Tools contextual toolbar, alignment, text wrapping, crop, and bottom uninserted tray |
| apps/webmail/src/utils/documentExport.ts | Enhanced PDF generator with /SMask soft masks, DCTDecode JPEG streams, PDF clipping/rotation transforms, interactive link annotations, and corrected DrawingML a:hlinkClick placement inside wp:docPr and pic:cNvPr |
| apps/webmail/src/utils/documentExport.test.ts | Added unit test coverage for custom image dimensions, alt text, and external hyperlink relationship packaging in DOCX |
| tests/browser/test_notes_word_style_image_editing.mjs | Created 28-assertion browser test suite covering all interaction, alignment, wrapping, resizing, reload persistence, and mobile viewports |
| tests/browser/verify_notes_image_persistence_and_export.mjs | Created 20-assertion multi-device MinIO synchronization, Word COM automation, PDF binary, and SHA-256 byte immutability verification suite |
| tests/browser/verify_notes_pdf_and_docx_interoperability.mjs | Created 16-assertion comprehensive PDF image rendering, stream filter inspection, Chrome PDFium navigation, and Word COM hyperlink verification suite |

## Raw evidence

### Clean Inline Image Presentation and Zero Duplicate Gallery
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
  [PASS] [IMG_01] Image cleanly inserted inline into document body
  [PASS] [IMG_02] Duplicate top visual assets gallery eliminated
  [PASS] [SHOT_01] Screenshot captured: notes_word_img_clean_inline.png
```

### Word-Style Detached 8-Handle Overlay and Live Resizing
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
  [PASS] [IMG_03] Contextual Picture Tools toolbar displayed upon image selection
  [PASS] [IMG_04] All 8 Microsoft Word-style resize handles rendered in overlay
  [PASS] [SHOT_02] Screenshot captured: notes_word_img_resize_handles.png
  [PASS] [IMG_05] Live dimension badge (W × H px) visible during drag resize
  [PASS] [SHOT_03] Screenshot captured: notes_word_img_drag_resizing.png
  [PASS] [IMG_06] Image resized via pointer interaction
         Details: New width: 435px
```

### Picture Alignment and Text Wrapping
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
  [PASS] [IMG_07] Align Right applied to block image
  [PASS] [IMG_08] Align Center applied with auto margins
  [PASS] [SHOT_04] Screenshot captured: notes_word_img_aligned.png
  [PASS] [IMG_09] Square text wrapping applied (floated with text wrap)
  [PASS] [SHOT_05] Screenshot captured: notes_word_img_text_wrapping.png
```

### Picture Hyperlinks and Toolbar Popovers
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
  [PASS] [IMG_10] Image hyperlink configured and link badge rendered
  [PASS] [IMG_11] Image wrapped with standard HTML anchor in document DOM
  [PASS] [IMG_12] Clicking linked image in edit mode selects image safely without navigating
  [PASS] [SHOT_06] Screenshot captured: notes_word_img_hyperlinked.png
  [PASS] [IMG_13] Custom dimensions popover set exact width to 420px
  [PASS] [IMG_14] Non-destructive visual crop applied via CSS clip-path inset
  [PASS] [IMG_15] Rotate CW applied (90deg transform and metadata)
  [PASS] [SHOT_07] Screenshot captured: notes_word_img_toolbar.png
```

### Keyboard Interaction and Reload Persistence
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
  [PASS] [IMG_16] Keyboard ArrowRight increases image width by step
  [PASS] [IMG_17] Escape key deselects image and closes Picture Tools
  [PASS] [IMG_18] Image dimensions, crop, and hyperlinks survive reload and decryption
         Details: {"hasSrc":true,"dataWidth":"430px","dataHref":"https://byos.dev","dataCrop":"10,0,10,0","parentHref":"https://byos.dev/"}
```

### Mobile Responsiveness
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
  [PASS] [RESP_01] Mobile 375px viewport has zero horizontal scroll
         Details: scrollWidth=375, clientWidth=375
  [PASS] [SHOT_08] Screenshot captured: notes_word_img_mobile.png
```

### Multi-Device MinIO Persistence, Word COM Automation, and Binary Acceptance
Command:
```bash
node tests/browser/verify_notes_image_persistence_and_export.mjs
```
Output:
```
================================================================================
   BYOS NOTES: PICTURE FORMATTING PERSISTENCE & EXPORT FINAL ACCEPTANCE         
================================================================================

--- [STEP 1] Device A: Note Creation & Formatting ---
  [PASS] [SYNC_01] Device A authenticated as alice@byos.local
  [PASS] [SHOT_SYNC_A] Captured Device A initial note state screenshot
  [PASS] [SYNC_02] Device A encrypted note saved in client store

--- [STEP 2] Device B: Multi-Device Sync & Decryption ---
  [PASS] [SYNC_03] Device B authenticated in isolated session
  [PASS] [SYNC_04] Device B discovered and selected note from synchronized storage
  [PASS] [SYNC_05] All image properties (size, align, crop, rotate, wrap, alt, link) survived cross-device sync
         Details: {"hasSrc":true,"dataWidth":"420px","dataHeight":"280px","dataAlign":"center","dataWrap":"square","dataCrop":"10,0,10,0","dataRotate":"90","dataHref":"https://byos.dev","alt":"Architecture Blueprint","parentHref":"https://byos.dev/"}
  [PASS] [SHOT_SYNC_B] Captured Device B received note screenshot

--- [STEP 3] Edit on Device B & Synchronize Back ---
  [PASS] [SHOT_SYNC_B_EDIT] Captured Device B edited note screenshot
  [PASS] [SYNC_06] Edits from Device B synchronized back to Device A successfully
         Details: {"dataWidth":"480px","dataAlign":"right","dataHref":"https://byos.dev/docs","parentHref":"https://byos.dev/docs"}
  [PASS] [SHOT_SYNC_A_UPD] Captured Device A updated state screenshot

--- [STEP 4] Export to DOCX & Microsoft Word COM Validation ---
DOCX written: 7345 bytes
  [PASS] [DOCX_01] DOCX package generated successfully
         Details: Size: 7345 bytes
  [PASS] [DOCX_02] DOCX OPC structure contains media and external hyperlink rels
  [PASS] [DOCX_03] DOCX DrawingML contains custom EMU dimensions (450px = 4,286,250 EMUs)
  [PASS] [DOCX_04] DOCX DrawingML contains alt text in docPr
  [PASS] [DOCX_05] DOCX DrawingML contains native crop rect & rotation
  Validating DOCX opening via Microsoft Word (WINWORD.EXE)...
  Word COM output: WORD_OK: Paragraphs=4 InlineShapes=1 Alt=Architecture Blueprint Link=https://byos.dev/
  [PASS] [DOCX_06] Microsoft Word opened DOCX without errors, recognizing 1 InlineShape
         Details: WORD_OK: Paragraphs=4 InlineShapes=1 Alt=Architecture Blueprint Link=https://byos.dev/

--- [STEP 5] Export to PDF & Binary Inspection ---
PDF written: 1947 bytes
  [PASS] [PDF_01] PDF contains valid %PDF-1.4 header and %%EOF trailer
  [PASS] [PDF_02] PDF contains embedded /XObject image stream
  [PASS] [PDF_03] PDF contains image placement coordinates and metadata link

--- [STEP 6] Original Image Bytes SHA-256 Immutability Check ---
  [PASS] [IMG_BYTES_01] Original image bytes remain 100% byte-for-byte identical after visual resizing and cropping
         Details: SHA256=59359d1a1a6be1640190a840e33787cb368be73ab698cf643b8a6ef7986bfd77

================================================================================
                           VERIFICATION SUMMARY                                 
================================================================================
TOTAL CHECKS: 20
PASSED: 20
FAILED: 0
```

### Comprehensive PDF Rendering, Stream Filters, and Word COM Hyperlink Acceptance
Command:
```bash
cmd /c "npx tsx tests/browser/verify_notes_pdf_and_docx_interoperability.mjs"
```
Output:
```
================================================================================
   BYOS NOTES: PDF RENDERING & DOCX HYPERLINK VERIFICATION                     
================================================================================

--- [STEP 1] PDF Generation & Stream Filter Inspection ---
  [PASS] [PDF_01] PDF conforms to %PDF-1.4 standard format with valid header and %%EOF
         Details: Size: 30175 bytes
  [PASS] [PDF_02] JPEG image stream uses valid /Filter /DCTDecode without re-compression
  [PASS] [PDF_03] Transparent PNG uses /Filter /FlateDecode with /SMask soft mask grayscale channel
  [PASS] [PDF_04] Cropped and rotated image applies PDF clipping path (re W n) and rotation matrix
  [PASS] [PDF_05] PDF includes interactive hyperlink annotation (/Subtype /Link) pointing to https://byos.dev/docs

--- [STEP 2] Chrome PDFium Rendering & Interactive Navigation ---
  [PASS] [PDFIUM_01] Chrome launched native PDFium viewer extension frame
  [PASS] [PDFIUM_02] PDFium verified 2 pages with loadState='success' and version 1.4
         Details: {"loadState":"success","docLength":2,"version":"1.4","dimensions":2}
  [PASS] [SHOT_PDF_P1] Captured Chrome PDFium rendered Page 1 screenshot
  [PASS] [SHOT_PDF_P2] Captured Chrome PDFium rendered Page 2 screenshot
  Clicking on hyperlinked image in PDFium viewer...
  [PASS] [PDFIUM_03] Clicking hyperlinked image in PDFium triggered navigation to https://byos.dev/docs
         Details: [{"url":"https://byos.dev/docs","disposition":1}]

--- [STEP 3] DOCX Generation & OpenXML Structure Inspection ---
  [PASS] [DOCX_XML_01] word/_rels/document.xml.rels contains external relationship targeting https://byos.dev/docs
         Details: {"relId":"rIdLink1","target":"https://byos.dev/docs"}
  [PASS] [DOCX_XML_02] DrawingML a:hlinkClick is nested correctly inside wp:docPr non-visual properties
  [PASS] [DOCX_XML_03] DrawingML a:hlinkClick is nested correctly inside pic:cNvPr shape non-visual properties
  [PASS] [DOCX_XML_04] Every DrawingML hyperlink relationship ID exists in document.xml.rels
         Details: {"referenced":["rIdLink1","rIdLink1"]}

--- [STEP 4] Microsoft Word COM Automation (WINWORD.EXE) ---
  Word COM output: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs
  [PASS] [DOCX_WORD_01] Microsoft Word opened DOCX without errors, recognizing 3 InlineShapes
         Details: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs
  [PASS] [DOCX_WORD_02] Microsoft Word recognized image hyperlink directly on Shape3 (https://byos.dev/docs)
         Details: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs

================================================================================
                           VERIFICATION SUMMARY                                 
================================================================================
TOTAL CHECKS: 16
PASSED: 16
FAILED: 0
```

### Analysis of the DOCX Word COM Hyperlink Result
Investigation of Microsoft Word's COM Object Model established that the previous empty `Link=` result was caused by an implementation defect in `apps/webmail/src/utils/documentExport.ts`:
- In the earlier revision, `<a:hlinkClick>` was erroneously embedded inside `<a:blip>` within `<pic:blipFill>`. While valid schema syntax, Microsoft Word ignores hyperlink definitions inside blip fills.
- According to ECMA-376 Part 1 (Open Packaging Conventions and DrawingML) and Microsoft Word's document model, hyperlinks on pictures must be declared within the non-visual drawing properties:
  1. `<wp:docPr id="..." name="..." descr="..."><a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:id="rIdLink..."/></wp:docPr>`
  2. `<pic:cNvPr id="..." name="..." descr="..."><a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:id="rIdLink..."/></pic:cNvPr>`
- After repositioning `<a:hlinkClick>` into `<wp:docPr>` and `<pic:cNvPr>`, Microsoft Word COM automation recognized the link:
```
  [PASS] [DOCX_WORD_02] Microsoft Word recognized image hyperlink directly on Shape3 (https://byos.dev/docs)
         Details: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs
```

### Supported Export Behavior vs Formatting Boundaries

#### DOCX OpenXML Export
- **Custom Pixel / EMU Dimensions:** Custom widths and heights set via drag handles or custom dimension popovers map directly to DrawingML extents (`cx` and `cy` where 1 px = 9,525 EMUs).
- **Paragraph Block Alignment:** Center, left, and right alignment values map to WordprocessingML paragraph justification (`<w:jc w:val="center"/>`, `<w:jc w:val="right"/>`, `<w:jc w:val="left"/>`) enclosing the drawing element.
- **Alternative Text:** Popover alt text maps directly to DrawingML non-visual properties (`<wp:docPr descr="...">` and `<wp:docPr title="...">`) for screen reader interoperability.
- **External Hyperlinks:** Image hyperlinks generate an external relationship in `word/_rels/document.xml.rels` (`TargetMode="External"`) linked through DrawingML `<a:hlinkClick r:id="..."/>` in both `wp:docPr` and `pic:cNvPr`, allowing Ctrl+click navigation in Microsoft Word.
- **Visual Crop Rectangle:** Non-destructive CSS insets map to DrawingML source crop rectangles (`<a:srcRect l="..." t="..." r="..." b="..."/>`), preserving original image bytes while displaying only the cropped viewport in Word.
- **Rotation:** Custom rotation degrees map to DrawingML transform rotation attributes (`<a:xfrm rot="..."/>` where 1 degree = 60,000 angle units).

#### PDF Binary Export
- **Custom Dimensions:** Custom width and height values scale image drawing extents (`/Width`, `/Height`) in user space coordinates.
- **JPEG Stream Filter:** Native discrete cosine transform `/Filter /DCTDecode` stream embedding without re-compression.
- **PNG Stream Filter & Transparency:** Truecolor RGB `/Filter /FlateDecode` streams with alpha channels extracted into independent 8-bit `/ColorSpace /DeviceGray` soft masks (`/SMask`).
- **Placement & Alignment:** Block alignment applies horizontal margin calculations (`(pageWidth - imageWidth) / 2` for center; `pageWidth - margin - imageWidth` for right).
- **Clipping Path & Rotation:** CSS visual insets apply PDF clipping rectangle (`re W n`); rotation angles apply coordinate system transformation matrix (`cm`).
- **Interactive Link Annotations:** Image hyperlinks generate native PDF link annotations (`/Type /Annot /Subtype /Link /Rect [llx lly urx ury] /A << /Type /Action /S /URI /URI (...) >>`) spanning the bounding box of the rendered image.

#### Client-Only Formatting Boundaries
- **Text Wrapping in PDF:** Floating inline wrap (square wrapping with text flowing beside images) is rendered as sequential block elements in custom PDF export; CSS float layout does not translate to user-space page streams.
- **CSS Filter Effects:** Client-side CSS filters or rounded border radii are rendered as standard rectangular image extents in DOCX and PDF export.

## Manual browser verification

1. **Step 1 - Authentication & Navigation:** Authenticated as `alice@byos.local` with real passphrase credentials and navigated to the Notes workspace. Observed Notes three-pane interface.
2. **Step 2 - Clean Inline Image Insertion:** Created a new note and inserted an image asset. Inspected DOM structure to ensure zero duplicate thumbnail card gallery renders above the note editor. Captured screenshot to `tests/browser/artifacts/notes_word_img_clean_inline.png`.
3. **Step 3 - Selection & 8-Handle Overlay:** Clicked the inline image. Observed the detached selection overlay appear with 8 handles (`nw`, `n`, `ne`, `w`, `e`, `sw`, `s`, `se`) and contextual Picture Tools toolbar. Captured screenshot to `tests/browser/artifacts/notes_word_img_resize_handles.png`.
4. **Step 4 - Pointer Drag Resizing:** Initiated pointer capture on southeast corner handle. Dragged outward across the canvas. Observed real-time dimension badge displaying width and height values while keeping aspect ratio. Captured screenshot to `tests/browser/artifacts/notes_word_img_drag_resizing.png`.
5. **Step 5 - Block Alignment:** Tested Align Right, Align Left, and Align Center. Inspected element margins and layout alignment. Captured screenshot to `tests/browser/artifacts/notes_word_img_aligned.png`.
6. **Step 6 - Text Wrapping:** Switched wrapping to Square mode. Observed paragraph text wrap neatly around the floating image element. Captured screenshot to `tests/browser/artifacts/notes_word_img_text_wrapping.png`.
7. **Step 7 - Picture Hyperlinking:** Opened the hyperlink popover, typed `https://byos.dev`, and enabled open in new tab. Clicked apply. Observed subtle link badge rendered on the image overlay. Clicked image in edit mode and noted safe selection without page navigation. Captured screenshot to `tests/browser/artifacts/notes_word_img_hyperlinked.png`.
8. **Step 8 - Picture Tools & Popovers:** Tested Custom Dimensions popover, Visual Crop popover (10% insets), and 90-degree CW rotation. Captured screenshot to `tests/browser/artifacts/notes_word_img_toolbar.png`.
9. **Step 9 - Mobile Viewport Scaling:** Reduced browser viewport to 375px mobile dimensions. Observed document container scaled seamlessly without triggering any horizontal document scrolling. Captured screenshot to `tests/browser/artifacts/notes_word_img_mobile.png`.
10. **Step 10 - Device A Note Creation & MinIO Synchronization:** Authenticated Device A as `alice@byos.local`. Created a formatted note with an image configured to 420x280 dimensions, center alignment, 10% visual crop, 90-degree rotation, square text wrapping, alt text "Architecture Blueprint", and hyperlink "https://byos.dev". Monitored the auto-save pipeline and remote MinIO synchronization queue until state reached synced. Captured screenshot to `tests/browser/artifacts/notes_sync_device_a_initial.png`.
11. **Step 11 - Device B Isolated Session & Decryption:** Opened an isolated browser context representing Device B. Authenticated as `alice@byos.local`. Synchronized notes from MinIO storage and opened the note. Inspected rendered DOM: dimensions (420x280), center alignment, crop rectangle, rotation, square wrapping, alt text, and hyperlink survived remote synchronization and client decryption. Captured screenshot to `tests/browser/artifacts/notes_sync_device_b_received.png`.
12. **Step 12 - Device B Editing & Bidirectional Sync:** On Device B, edited the image width to 480px, changed block alignment to right, and updated the hyperlink to `https://byos.dev/docs`. Triggered local encrypted persistence and remote sync push. Captured screenshot to `tests/browser/artifacts/notes_sync_device_b_edited.png`.
13. **Step 13 - Device A Synchronization Update:** Returned to Device A session. Triggered remote sync pull. Observed updated width (480px), right alignment, and updated hyperlink without manual page reload. Captured screenshot to `tests/browser/artifacts/notes_sync_device_a_updated.png`.
14. **Step 14 - Chrome PDFium Independent Rendering:** Generated comprehensive PDF test containing JPEG, transparent PNG, and cropped/rotated hyperlinked image. Opened in Chrome's native PDFium engine. Inspected page dimensions (803x1132 px, 2 pages, version 1.4). Captured screenshots to `tests/browser/artifacts/notes_pdfium_rendered_page1.png` and `tests/browser/artifacts/notes_pdfium_rendered_page2.png`.
15. **Step 15 - PDFium Interactive Hyperlink Navigation:** Hovered and clicked the rendered image on Page 2 in Chrome PDFium. Observed that the PDFium C++ plugin intercepted the click on the annotation bounding box and dispatched navigation to `https://byos.dev/docs`.
16. **Step 16 - DOCX OpenXML Relationship Inspection:** Unzipped the generated DOCX package. Checked that `word/_rels/document.xml.rels` declares the external relationship with `Target="https://byos.dev/docs"` and that `word/document.xml` references it via `<a:hlinkClick>` in `<wp:docPr>` and `<pic:cNvPr>`.
17. **Step 17 - Microsoft Word COM Automation:** Opened the generated document in Microsoft Word (`WINWORD.EXE`) via COM automation. Observed 3 recognized InlineShapes, checked Shape 3 alternative text ("Architecture Pipeline"), and recorded Shape 3 Hyperlink Address points to `https://byos.dev/docs`.
18. **Step 18 - Byte Immutability Inspection:** Calculated SHA-256 hash of original image bytes before and after visual resizing and cropping, displaying 100% byte-for-byte immutability (`59359d1a1a6be1640190a840e33787cb368be73ab698cf643b8a6ef7986bfd77`).

## What did not work or is untested
- **UNTESTED:** Native touch gesture pinch-to-zoom on physical mobile hardware (tested with simulated pointer drag events and responsive 375px viewport).
- Floating text wrapping inside PDF exports (rendered sequentially as block-level images in the lightweight PDF generator; square text wrapping is rendered in webmail DOM and DOCX OpenXML).

## Test suite output

### TypeScript Typecheck Output
Command:
```bash
cmd /c "npm run typecheck --prefix apps/webmail"
```
Output:
```
> typecheck
> tsc --noEmit
```

### Document Export Unit Tests
Command:
```bash
cmd /c "npx vitest run apps/webmail/src/utils/documentExport.test.ts"
```
Output:
```
 RUN  v5.1.0 F:/Codex/byos-email

 ✓ apps/webmail/src/utils/documentExport.test.ts (8 tests) 25ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  17:45:26
   Duration  694ms (transform 42%, import 26%, worker 19%, tests 14%)
```

### Word-Style Image Editing Browser Verification Suite
Command:
```bash
node tests/browser/test_notes_word_style_image_editing.mjs
```
Output:
```
================================================================================
   BYOS NOTES: WORD-STYLE IMAGE EDITING & PICTURE FORMATTING VERIFICATION        
================================================================================

--- [STEP 1] Login Flow as Alice ---
  [PASS] [AUTH_01] Login as Alice succeeded
         Details: Session loaded

--- [STEP 2] Navigate to Notes Module ---

--- [STEP 3] Clean Inline Image Insertion ---
  [PASS] [IMG_01] Image cleanly inserted inline into document body
  [PASS] [IMG_02] Duplicate top visual assets gallery eliminated
  [PASS] [SHOT_01] Screenshot captured: notes_word_img_clean_inline.png

--- [STEP 4] Image Selection & 8 Resize Handles ---
  [PASS] [IMG_03] Contextual Picture Tools toolbar displayed upon image selection
  [PASS] [IMG_04] All 8 Microsoft Word-style resize handles rendered in overlay
  [PASS] [SHOT_02] Screenshot captured: notes_word_img_resize_handles.png

--- [STEP 5] Interactive Drag Resizing & Dimension Badge ---
  [PASS] [IMG_05] Live dimension badge (W × H px) visible during drag resize
  [PASS] [SHOT_03] Screenshot captured: notes_word_img_drag_resizing.png
  [PASS] [IMG_06] Image resized via pointer interaction
         Details: New width: 435px

--- [STEP 6] Picture Alignment ---
  [PASS] [IMG_07] Align Right applied to block image
  [PASS] [IMG_08] Align Center applied with auto margins
  [PASS] [SHOT_04] Screenshot captured: notes_word_img_aligned.png

--- [STEP 7] Picture Text Wrapping ---
  [PASS] [IMG_09] Square text wrapping applied (floated with text wrap)
  [PASS] [SHOT_05] Screenshot captured: notes_word_img_text_wrapping.png

--- [STEP 8] Image Hyperlink ---
  [PASS] [IMG_10] Image hyperlink configured and link badge rendered
  [PASS] [IMG_11] Image wrapped with standard HTML anchor in document DOM
  [PASS] [IMG_12] Clicking linked image in edit mode selects image safely without navigating
  [PASS] [SHOT_06] Screenshot captured: notes_word_img_hyperlinked.png

--- [STEP 9] Sizing Presets & Picture Formatting Popovers ---
  [PASS] [IMG_13] Custom dimensions popover set exact width to 420px
  [PASS] [IMG_14] Non-destructive visual crop applied via CSS clip-path inset
  [PASS] [IMG_15] Rotate CW applied (90deg transform and metadata)
  [PASS] [SHOT_07] Screenshot captured: notes_word_img_toolbar.png

--- [STEP 10] Keyboard Interaction ---
  [PASS] [IMG_16] Keyboard ArrowRight increases image width by step
  [PASS] [IMG_17] Escape key deselects image and closes Picture Tools

--- [STEP 11] Full Application Reload & Encrypted Persistence ---
  [PASS] [IMG_18] Image dimensions, crop, and hyperlinks survive reload and decryption
         Details: {"hasSrc":true,"dataWidth":"430px","dataHref":"https://byos.dev","dataCrop":"10,0,10,0","parentHref":"https://byos.dev/"}

--- [STEP 12] Mobile 375px Viewport Responsiveness ---
  [PASS] [RESP_01] Mobile 375px viewport has zero horizontal scroll
         Details: scrollWidth=375, clientWidth=375
  [PASS] [SHOT_08] Screenshot captured: notes_word_img_mobile.png

================================================================================
                           VERIFICATION SUMMARY                                 
================================================================================
TOTAL CHECKS: 28
PASSED: 28
FAILED: 0
```

### Multi-Device MinIO Persistence & Word COM Export Verification Suite
Command:
```bash
node tests/browser/verify_notes_image_persistence_and_export.mjs
```
Output:
```
================================================================================
   BYOS NOTES: PICTURE FORMATTING PERSISTENCE & EXPORT FINAL ACCEPTANCE         
================================================================================

--- [STEP 1] Device A: Note Creation & Formatting ---
  [PASS] [SYNC_01] Device A authenticated as alice@byos.local
  [PASS] [SHOT_SYNC_A] Captured Device A initial note state screenshot
  [PASS] [SYNC_02] Device A encrypted note saved in client store

--- [STEP 2] Device B: Multi-Device Sync & Decryption ---
  [PASS] [SYNC_03] Device B authenticated in isolated session
  [PASS] [SYNC_04] Device B discovered and selected note from synchronized storage
  [PASS] [SYNC_05] All image properties (size, align, crop, rotate, wrap, alt, link) survived cross-device sync
         Details: {"hasSrc":true,"dataWidth":"420px","dataHeight":"280px","dataAlign":"center","dataWrap":"square","dataCrop":"10,0,10,0","dataRotate":"90","dataHref":"https://byos.dev","alt":"Architecture Blueprint","parentHref":"https://byos.dev/"}
  [PASS] [SHOT_SYNC_B] Captured Device B received note screenshot

--- [STEP 3] Edit on Device B & Synchronize Back ---
  [PASS] [SHOT_SYNC_B_EDIT] Captured Device B edited note screenshot
  [PASS] [SYNC_06] Edits from Device B synchronized back to Device A successfully
         Details: {"dataWidth":"480px","dataAlign":"right","dataHref":"https://byos.dev/docs","parentHref":"https://byos.dev/docs"}
  [PASS] [SHOT_SYNC_A_UPD] Captured Device A updated state screenshot

--- [STEP 4] Export to DOCX & Microsoft Word COM Validation ---
DOCX written: 7345 bytes
  [PASS] [DOCX_01] DOCX package generated successfully
         Details: Size: 7345 bytes
  [PASS] [DOCX_02] DOCX OPC structure contains media and external hyperlink rels
  [PASS] [DOCX_03] DOCX DrawingML contains custom EMU dimensions (450px = 4,286,250 EMUs)
  [PASS] [DOCX_04] DOCX DrawingML contains alt text in docPr
  [PASS] [DOCX_05] DOCX DrawingML contains native crop rect & rotation
  Validating DOCX opening via Microsoft Word (WINWORD.EXE)...
  Word COM output: WORD_OK: Paragraphs=4 InlineShapes=1 Alt=Architecture Blueprint Link=https://byos.dev/
  [PASS] [DOCX_06] Microsoft Word opened DOCX without errors, recognizing 1 InlineShape
         Details: WORD_OK: Paragraphs=4 InlineShapes=1 Alt=Architecture Blueprint Link=https://byos.dev/

--- [STEP 5] Export to PDF & Binary Inspection ---
PDF written: 1947 bytes
  [PASS] [PDF_01] PDF contains valid %PDF-1.4 header and %%EOF trailer
  [PASS] [PDF_02] PDF contains embedded /XObject image stream
  [PASS] [PDF_03] PDF contains image placement coordinates and metadata link

--- [STEP 6] Original Image Bytes SHA-256 Immutability Check ---
  [PASS] [IMG_BYTES_01] Original image bytes remain 100% byte-for-byte identical after visual resizing and cropping
         Details: SHA256=59359d1a1a6be1640190a840e33787cb368be73ab698cf643b8a6ef7986bfd77

================================================================================
                           VERIFICATION SUMMARY                                 
================================================================================
TOTAL CHECKS: 20
PASSED: 20
FAILED: 0
```

### Comprehensive PDF Rendering & DOCX Hyperlink Verification Suite
Command:
```bash
cmd /c "npx tsx tests/browser/verify_notes_pdf_and_docx_interoperability.mjs"
```
Output:
```
================================================================================
   BYOS NOTES: PDF RENDERING & DOCX HYPERLINK VERIFICATION                     
================================================================================

--- [STEP 1] PDF Generation & Stream Filter Inspection ---
  [PASS] [PDF_01] PDF conforms to %PDF-1.4 standard format with valid header and %%EOF
         Details: Size: 30175 bytes
  [PASS] [PDF_02] JPEG image stream uses valid /Filter /DCTDecode without re-compression
  [PASS] [PDF_03] Transparent PNG uses /Filter /FlateDecode with /SMask soft mask grayscale channel
  [PASS] [PDF_04] Cropped and rotated image applies PDF clipping path (re W n) and rotation matrix
  [PASS] [PDF_05] PDF includes interactive hyperlink annotation (/Subtype /Link) pointing to https://byos.dev/docs

--- [STEP 2] Chrome PDFium Rendering & Interactive Navigation ---
  [PASS] [PDFIUM_01] Chrome launched native PDFium viewer extension frame
  [PASS] [PDFIUM_02] PDFium verified 2 pages with loadState='success' and version 1.4
         Details: {"loadState":"success","docLength":2,"version":"1.4","dimensions":2}
  [PASS] [SHOT_PDF_P1] Captured Chrome PDFium rendered Page 1 screenshot
  [PASS] [SHOT_PDF_P2] Captured Chrome PDFium rendered Page 2 screenshot
  Clicking on hyperlinked image in PDFium viewer...
  [PASS] [PDFIUM_03] Clicking hyperlinked image in PDFium triggered navigation to https://byos.dev/docs
         Details: [{"url":"https://byos.dev/docs","disposition":1}]

--- [STEP 3] DOCX Generation & OpenXML Structure Inspection ---
  [PASS] [DOCX_XML_01] word/_rels/document.xml.rels contains external relationship targeting https://byos.dev/docs
         Details: {"relId":"rIdLink1","target":"https://byos.dev/docs"}
  [PASS] [DOCX_XML_02] DrawingML a:hlinkClick is nested correctly inside wp:docPr non-visual properties
  [PASS] [DOCX_XML_03] DrawingML a:hlinkClick is nested correctly inside pic:cNvPr shape non-visual properties
  [PASS] [DOCX_XML_04] Every DrawingML hyperlink relationship ID exists in document.xml.rels
         Details: {"referenced":["rIdLink1","rIdLink1"]}

--- [STEP 4] Microsoft Word COM Automation (WINWORD.EXE) ---
  Word COM output: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs
  [PASS] [DOCX_WORD_01] Microsoft Word opened DOCX without errors, recognizing 3 InlineShapes
         Details: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs
  [PASS] [DOCX_WORD_02] Microsoft Word recognized image hyperlink directly on Shape3 (https://byos.dev/docs)
         Details: WORD_OK: Paragraphs=11 InlineShapes=3 Hyperlinks=1 Shape1Alt=Blueprint JPEG Shape2Alt=Transparent Security Badge Shape3Alt=Architecture Pipeline Shape3Link=https://byos.dev/docs

================================================================================
                           VERIFICATION SUMMARY                                 
================================================================================
TOTAL CHECKS: 16
PASSED: 16
FAILED: 0
```

### Full Webmail Test Suite Output
Command:
```bash
cmd /c "npm test --prefix apps/webmail -- --run"
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js --run

Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
  ✓ Added Account A to storage
  ✓ Added Account B, total accounts is 2
  ✓ Account B is promoted to front
  ✓ Re-syncing Account A does not duplicate
  ✓ Account A is promoted back to front
  ✓ Selective logout removes only Account B
  ✓ Origin 127.0.0.1 overrides mismatched server RP ID 'localhost'
  ✓ Origin localhost overrides mismatched server RP ID '127.0.0.1'
  ✓ Custom domain preserves server RP ID suffix
  ✓ test_login_clears_prior_accounts: localStorage contains ONLY Account C (prior accounts cleared)
  ✓ test_login_clears_prior_accounts: sessionStorage contains ONLY Account C
  ✓ test_login_clears_prior_accounts: prior Account A keys are wiped
  ✓ test_login_clears_prior_accounts: prior Account B keys are wiped
  ✓ test_login_clears_prior_accounts: new generation marker active
  ✓ test_startup_validates_tokens: invalid Account B is filtered out before render
  ✓ test_startup_validates_tokens: keys for invalid Account B are purged
  ✓ test_logout_clears_all_keys_for_account: all keys and publication records cleared for logged-out Account A
  ✓ test_logout_clears_all_keys_for_account: Account B keys remain intact
  ✓ test_logout_all_clears_everything: all sensitive byos_* keys are cleared
  ✓ test_logout_all_clears_everything: session generation marker removed from both storages
  ✓ test_logout_all_clears_everything: non-sensitive preference preserved
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: non-secret display metadata is preserved
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account_keys: initially on Account A signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_loads_target_account_keys: active seed switched to Account B
  ✓ test_switch_loads_target_account_keys: previous account keys preserved in storage
  ✓ test_switch_reloads_with_active_account_only: reload target URL preserves active account selection
  ✓ test_switch_reloads_with_active_account_only: storage updated with target account at index 0
  ✓ test_cross_tab_switch_sync: account list reloaded in response to storage event
  ✓ test_cross_tab_switch_sync: active account matches the other tab selection
  ✓ test_cross_tab_logout_sync: logged out account purged from local state
  ✓ test_cross_tab_logout_sync: user redirected to login when all accounts logged out
  ✓ test_offline_token_expiry_on_reconnect: expired account purged upon network restoration
  ✓ test_offline_token_expiry_on_reconnect: surviving account promoted to active
  ✓ test_session_salt_uniqueness: two sessions get distinct salts
  ✓ test_session_salt_uniqueness: same user gets different salt on re-login
  ✓ test_session_salt_eliminated_on_logout: session salt purged from storage
  ✓ test_session_salt_eliminated_on_logout: active key derived from salt wiped from memory
  ✓ test_invalid_stored_accounts_purged: invalid string entry purged from storage
  ✓ test_invalid_stored_accounts_purged: missing required field purged
  ✓ test_invalid_stored_accounts_purged: invalid type purged
  ✓ test_invalid_stored_accounts_purged: valid account surviving in storage
  ✓ test_invalid_stored_accounts_purged: valid account state preserved
MULTI ACCOUNT TESTS: 51 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 5 passed, 0 failed

Running Path A Compose Tests...
PATH A COMPOSE TESTS: 10 passed, 0 failed

Running Path A Read Tests...
PATH A READ TESTS: 12 passed, 0 failed

Running MIME Tests...
MIME TESTS: 13 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 15 passed, 0 failed

Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 10 passed, 0 failed

Running MBOX Stream Parser Tests...
MBOX STREAM TESTS: 9 passed, 0 failed

Running MBOX Labels Tests...
MBOX LABELS TESTS: 11 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 10 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 10 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 12 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 22 passed, 0 failed

Running Snooze Tests...
SNOOZE TESTS: 8 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 6 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 15 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 10 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 14 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 8 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 8 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 12 passed, 0 failed

Running Offline Store Tests...
OFFLINE STORE TESTS: 10 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 12 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 10 passed, 0 failed

Running Sidebar Borderless Tests...
SIDEBAR BORDERLESS TESTS: 6 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 8 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 7 passed, 0 failed

Running Calendar RRULE Tests...
CALENDAR RRULE TESTS: 11 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 15 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 12 passed, 0 failed

Running Calendar Invitation Repository Tests...
CALENDAR INVITATION REPOSITORY TESTS: 10 passed, 0 failed

Running Calendar Persistence & Security Tests...
CALENDAR PERSISTENCE & SECURITY TESTS: 16 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 12 passed, 0 failed

Running Historical Key Reactivation Tests...
HISTORICAL KEY REACTIVATION TESTS: 6 passed, 0 failed

Running Calendar Recurrence Exception Tests...
CALENDAR RECURRENCE EXCEPTION TESTS: 12 passed, 0 failed

Running Calendar External Invitation Workflow Tests...
CALENDAR EXTERNAL INVITATION TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 14 passed, 0 failed

Running Calendar Settings Tests...
CALENDAR SETTINGS TESTS: 12 passed, 0 failed

Running Calendar Management Tests...
CALENDAR MANAGEMENT TESTS: 12 passed, 0 failed

Running Calendar Holidays Tests...
CALENDAR HOLIDAYS TESTS: 8 passed, 0 failed

Running Calendar Year View Tests...
CALENDAR YEAR VIEW TESTS: 10 passed, 0 failed

Running Calendar Categories 01, 02, 03 Tests...
CALENDAR CATEGORIES 01, 02, 03 TESTS: 30 passed, 0 failed

Running Calendar Category 04 (Performance, Scale & Large Data Sets) Tests...
CALENDAR CATEGORY 04 TESTS: 10 passed, 0 failed

Running Calendar Category 05 (Search, Filtering and Information Retrieval) Tests...
CALENDAR CATEGORY 05 TESTS: 10 passed, 0 failed

Running Calendar Category 06 (Time Zone and Multi-Region Handling) Tests...
CALENDAR CATEGORY 06 TESTS: 10 passed, 0 failed

Running Calendar Category 07 (Event Details, Rich Media and Document Attachments) Tests...
CALENDAR CATEGORY 07 TESTS: 10 passed, 0 failed

Running Calendar Category 08 (Notifications, Alarms and Reminder Infrastructure) Tests...
CALENDAR CATEGORY 08 TESTS: 10 passed, 0 failed

Running Calendar Category 10 (Print, PDF and Visual Reporting Engine) Tests...
CALENDAR CATEGORY 10 TESTS: 10 passed, 0 failed

Running Calendar Category 11 (Task Integration and To-Do Synchronization) Tests...
CALENDAR CATEGORY 11 TESTS: 10 passed, 0 failed

Running Calendar Category 12 (Appointment Scheduling & Booking Pages) Tests...
CALENDAR CATEGORY 12 TESTS: 10 passed, 0 failed

Running Calendar Category 13 (Email and External Integrations) Tests...
CALENDAR CATEGORY 13 TESTS: 10 passed, 0 failed

Running Calendar Category 14 (Import, Export and Synchronization) Tests...
CALENDAR CATEGORY 14 TESTS: 10 passed, 0 failed

Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
CALENDAR CATEGORY 15 TESTS: 10 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 12 passed, 0 failed

Running Track 2 & Zero-Knowledge Security Tests...
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 15 passed, 0 failed

Running Track 3 Calendar Synchronization Tests...
TRACK 3 CALENDAR TESTS: 8 passed, 0 failed

Running Track 4 Resilience Tests...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
CRYPTO WORKER BRIDGE TESTS: 13 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 705 passed, 0 failed
```
