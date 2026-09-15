import { runAttachmentCryptoTests } from "./attachment_crypto.test.js";
import { runDateTimeTests } from "./utils/dateTime.test.js";

let totalPassed = 0;
let totalFailed = 0;

const attachCryptoRes = runAttachmentCryptoTests();
console.log(`ATTACHMENT CRYPTO TESTS: ${attachCryptoRes.passed} passed, ${attachCryptoRes.failed} failed`);
totalPassed += attachCryptoRes.passed;
totalFailed += attachCryptoRes.failed;

const dateTimeRes = runDateTimeTests();
console.log(`DATE TIME TESTS: ${dateTimeRes.passed} passed, ${dateTimeRes.failed} failed`);
totalPassed += dateTimeRes.passed;
totalFailed += dateTimeRes.failed;

console.log(`\nOVERALL: ${totalPassed} passed, ${totalFailed} failed`);
if (totalFailed > 0) {
  process.exit(1);
}
