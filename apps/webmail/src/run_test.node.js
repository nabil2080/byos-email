import { runAttachmentCryptoTests } from "./attachment_crypto.test.js";
import { runTotpTests } from "./utils/totp.test.js";
import { runDateTimeTests } from "./utils/dateTime.test.js";
import { runFileTypeTests } from "./fileType.test.js";
import { runMultiAccountTests } from "./multi_account.test.js";
import { runPasswordRewrapTests } from "./password_rewrap.test.js";
import { runPathAComposeTests } from "./path_a_compose.test.js";
import { runPathAReadTests } from "./path_a_read.test.js";
import { runMimeTests } from "./mime.test.js";
import { runSignatureTests } from "./signature.test.js";
import { runReplySignatureTests } from "./reply_signature.test.js";
import { runMboxStreamTests } from "./mbox_stream.test.js";
import { runMboxLabelsTests } from "./mbox_labels.test.js";
import { runImportQueueTests } from "./import_queue.test.js";
import { runThreadingTests } from "./threading.test.js";
import { runUndoSendTests } from "./undo_send.test.js";
import { runKeyboardShortcutsTests } from "./keyboard_shortcuts.test.js";
import { runSnoozeTests } from "./snooze.test.js";
import { runScheduledFolderTests } from "./scheduled_folder.test.js";
import { runDisplayPartyTests } from "./display_party.test.js";
import { runNestedLabelsTests } from "./nested_labels.test.js";
import { runApiErrorTests } from "./api_error.test.js";
import { runUnifiedInboxTests } from "./unified_inbox.test.js";
import { runMaskedEmailTests } from "./masked_email.test.js";
import { runFocusedInboxTests } from "./focused_inbox.test.js";
import { runOfflineTests } from "./offline.test.js";
import { runComposerSanitizerTests } from "./composer_sanitizer.test.js";
import { runContactsTests } from "./contacts.test.js";
import { runSidebarBorderlessTests } from "./sidebar_borderless.test.js";

async function main() {
  let totalPassed = 0;
  let totalFailed = 0;

  console.log("Running Attachment Crypto Tests...");
  const attachmentRes = await runAttachmentCryptoTests();
  console.log(`ATTACHMENT CRYPTO TESTS: ${attachmentRes.passed} passed, ${attachmentRes.failed} failed\n`);
  totalPassed += attachmentRes.passed;
  totalFailed += attachmentRes.failed;

  console.log("Running TOTP Tests...");
  const totpRes = await runTotpTests();
  console.log(`TOTP TESTS: ${totpRes.passed} passed, ${totpRes.failed} failed\n`);
  totalPassed += totpRes.passed;
  totalFailed += totpRes.failed;

  console.log("Running Date Time Tests...");
  const dateTimeRes = runDateTimeTests();
  console.log(`DATE TIME TESTS: ${dateTimeRes.passed} passed, ${dateTimeRes.failed} failed\n`);
  totalPassed += dateTimeRes.passed;
  totalFailed += dateTimeRes.failed;

  console.log("Running File Type Tests...");
  const fileTypeRes = runFileTypeTests();
  console.log(`FILE TYPE TESTS: ${fileTypeRes.passed} passed, ${fileTypeRes.failed} failed\n`);
  totalPassed += fileTypeRes.passed;
  totalFailed += fileTypeRes.failed;

  const multiAccountRes = await runMultiAccountTests();
  console.log(`MULTI ACCOUNT TESTS: ${multiAccountRes.passed} passed, ${multiAccountRes.failed} failed\n`);
  totalPassed += multiAccountRes.passed;
  totalFailed += multiAccountRes.failed;

  console.log("Running Password Rewrap Tests...");
  const rewrapRes = runPasswordRewrapTests();
  console.log(`PASSWORD REWRAP TESTS: ${rewrapRes.passed} passed, ${rewrapRes.failed} failed\n`);
  totalPassed += rewrapRes.passed;
  totalFailed += rewrapRes.failed;

  console.log("Running Path A Compose Tests...");
  const pathARes = await runPathAComposeTests();
  console.log(`PATH A COMPOSE TESTS: ${pathARes.passed} passed, ${pathARes.failed} failed\n`);
  totalPassed += pathARes.passed;
  totalFailed += pathARes.failed;

  console.log("Running Path A Read Tests...");
  const pathAReadRes = await runPathAReadTests();
  console.log(`PATH A READ TESTS: ${pathAReadRes.passed} passed, ${pathAReadRes.failed} failed\n`);
  totalPassed += pathAReadRes.passed;
  totalFailed += pathAReadRes.failed;

  console.log("Running MIME Parser Tests...");
  const mimeRes = runMimeTests();
  console.log(`MIME PARSER TESTS: ${mimeRes.passed} passed, ${mimeRes.failed} failed\n`);
  totalPassed += mimeRes.passed;
  totalFailed += mimeRes.failed;

  console.log("Running Signature Tests...");
  const sigRes = runSignatureTests();
  console.log(`SIGNATURE TESTS: ${sigRes.passed} passed, ${sigRes.failed} failed\n`);
  totalPassed += sigRes.passed;
  totalFailed += sigRes.failed;

  console.log("Running Reply Signature Tests...");
  const replySigRes = runReplySignatureTests();
  console.log(`REPLY SIGNATURE TESTS: ${replySigRes.passed} passed, ${replySigRes.failed} failed\n`);
  totalPassed += replySigRes.passed;
  totalFailed += replySigRes.failed;

  console.log("Running Mbox Stream Tests...");
  const mboxStreamRes = await runMboxStreamTests();
  console.log(`MBOX STREAM TESTS: ${mboxStreamRes.passed} passed, ${mboxStreamRes.failed} failed\n`);
  totalPassed += mboxStreamRes.passed;
  totalFailed += mboxStreamRes.failed;

  console.log("Running Mbox Labels Tests...");
  const mboxLabelsRes = runMboxLabelsTests();
  console.log(`MBOX LABELS TESTS: ${mboxLabelsRes.passed} passed, ${mboxLabelsRes.failed} failed\n`);
  totalPassed += mboxLabelsRes.passed;
  totalFailed += mboxLabelsRes.failed;

  console.log("Running Import Queue Tests...");
  const importQueueRes = await runImportQueueTests();
  console.log(`IMPORT QUEUE TESTS: ${importQueueRes.passed} passed, ${importQueueRes.failed} failed\n`);
  totalPassed += importQueueRes.passed;
  totalFailed += importQueueRes.failed;

  console.log("Running Conversation Threading Tests...");
  const threadingRes = await runThreadingTests();
  console.log(`CONVERSATION THREADING TESTS: ${threadingRes.passed} passed, ${threadingRes.failed} failed\n`);
  totalPassed += threadingRes.passed;
  totalFailed += threadingRes.failed;

  console.log("Running Undo Send Tests...");
  const undoSendRes = await runUndoSendTests();
  console.log(`UNDO SEND TESTS: ${undoSendRes.passed} passed, ${undoSendRes.failed} failed\n`);
  totalPassed += undoSendRes.passed;
  totalFailed += undoSendRes.failed;

  console.log("Running Keyboard Shortcuts Tests...");
  const keyboardRes = runKeyboardShortcutsTests();
  console.log(`KEYBOARD SHORTCUTS TESTS: ${keyboardRes.passed} passed, ${keyboardRes.failed} failed\n`);
  totalPassed += keyboardRes.passed;
  totalFailed += keyboardRes.failed;

  console.log("Running Snooze Tests...");
  const snoozeRes = runSnoozeTests();
  console.log(`SNOOZE TESTS: ${snoozeRes.passed} passed, ${snoozeRes.failed} failed\n`);
  totalPassed += snoozeRes.passed;
  totalFailed += snoozeRes.failed;

  console.log("Running Scheduled Folder Tests...");
  const scheduledRes = runScheduledFolderTests();
  console.log(`SCHEDULED FOLDER TESTS: ${scheduledRes.passed} passed, ${scheduledRes.failed} failed\n`);
  totalPassed += scheduledRes.passed;
  totalFailed += scheduledRes.failed;

  console.log("Running Display Party Tests...");
  const displayPartyRes = runDisplayPartyTests();
  console.log(`DISPLAY PARTY TESTS: ${displayPartyRes.passed} passed, ${displayPartyRes.failed} failed\n`);
  totalPassed += displayPartyRes.passed;
  totalFailed += displayPartyRes.failed;

  console.log("Running Nested Labels Tests...");
  const nestedLabelsRes = await runNestedLabelsTests();
  console.log(`NESTED LABELS TESTS: ${nestedLabelsRes.passed} passed, ${nestedLabelsRes.failed} failed\n`);
  totalPassed += nestedLabelsRes.passed;
  totalFailed += nestedLabelsRes.failed;

  console.log("Running API Error Handling Tests...");
  const apiErrorRes = await runApiErrorTests();
  console.log(`API ERROR HANDLING TESTS: ${apiErrorRes.passed} passed, ${apiErrorRes.failed} failed\n`);
  totalPassed += apiErrorRes.passed;
  totalFailed += apiErrorRes.failed;

  console.log("Running Unified Inbox Tests...");
  const unifiedInboxRes = runUnifiedInboxTests();
  console.log(`UNIFIED INBOX TESTS: ${unifiedInboxRes.passed} passed, ${unifiedInboxRes.failed} failed\n`);
  totalPassed += unifiedInboxRes.passed;
  totalFailed += unifiedInboxRes.failed;

  console.log("Running Masked Email Tests...");
  const maskedEmailRes = await runMaskedEmailTests();
  console.log(`MASKED EMAIL TESTS: ${maskedEmailRes.passed} passed, ${maskedEmailRes.failed} failed\n`);
  totalPassed += maskedEmailRes.passed;
  totalFailed += maskedEmailRes.failed;

  console.log("Running Focused Inbox Tests...");
  const focusedInboxRes = runFocusedInboxTests();
  console.log(`FOCUSED INBOX TESTS: ${focusedInboxRes.passed} passed, ${focusedInboxRes.failed} failed\n`);
  totalPassed += focusedInboxRes.passed;
  totalFailed += focusedInboxRes.failed;

  console.log("Running Offline Support Tests...");
  const offlineRes = await runOfflineTests();
  console.log(`OFFLINE SUPPORT TESTS: ${offlineRes.passed} passed, ${offlineRes.failed} failed\n`);
  totalPassed += offlineRes.passed;
  totalFailed += offlineRes.failed;

  console.log("Running Composer Sanitizer Tests...");
  const sanitizerRes = await runComposerSanitizerTests();
  console.log(`COMPOSER SANITIZER TESTS: ${sanitizerRes.passed} passed, ${sanitizerRes.failed} failed\n`);
  totalPassed += sanitizerRes.passed;
  totalFailed += sanitizerRes.failed;

  console.log("Running Contacts Management Tests...");
  const contactsRes = await runContactsTests();
  console.log(`CONTACTS MANAGEMENT TESTS: ${contactsRes.passed} passed, ${contactsRes.failed} failed\n`);
  totalPassed += contactsRes.passed;
  totalFailed += contactsRes.failed;

  console.log("Running Sidebar Borderless Tests...");
  const sidebarBorderlessRes = await runSidebarBorderlessTests();
  console.log(`SIDEBAR BORDERLESS TESTS: ${sidebarBorderlessRes.passed} passed, ${sidebarBorderlessRes.failed} failed\n`);
  totalPassed += sidebarBorderlessRes.passed;
  totalFailed += sidebarBorderlessRes.failed;

  console.log(`OVERALL: ${totalPassed} passed, ${totalFailed} failed`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
