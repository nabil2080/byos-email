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

async function main() {
  let totalPassed = 0;
  let totalFailed = 0;

  console.log("Running Attachment Crypto Tests...");
  const attachmentRes = runAttachmentCryptoTests();
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

  const multiAccountRes = runMultiAccountTests();
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

  console.log(`OVERALL: ${totalPassed} passed, ${totalFailed} failed`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
