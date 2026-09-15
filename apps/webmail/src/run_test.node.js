import { runAttachmentCryptoTests } from "./attachment_crypto.test.js";
import { runFileTypeTests } from "./fileType.test.js";

let totalFailed = 0;

const cryptoResults = runAttachmentCryptoTests();
console.log(`ATTACHMENT CRYPTO TESTS: ${cryptoResults.passed} passed, ${cryptoResults.failed} failed`);
totalFailed += cryptoResults.failed;

const fileTypeResults = runFileTypeTests();
console.log(`FILE TYPE TESTS: ${fileTypeResults.passed} passed, ${fileTypeResults.failed} failed`);
totalFailed += fileTypeResults.failed;

if (totalFailed > 0) {
  process.exit(1);
}
