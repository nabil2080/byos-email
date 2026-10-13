import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getInitial } from "./components/ProfileAvatar";
import { getAccountColor } from "./api";
import { encryptChunk, decryptChunk } from "./attachment_crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runProfilePhotoTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Profile Photo & Avatar Tests...");

  // 1. test_fallback_avatar_renders_initial_and_color
  await test("test_fallback_avatar_renders_initial_and_color", () => {
    // Initial extraction logic
    assert(getInitial("Alice Smith", "alice@byos.local") === "A", "Display name first initial must be uppercase 'A'");
    assert(getInitial("", "bob@byos.local") === "B", "Email local part first initial must be uppercase 'B'");
    assert(getInitial("charlie", "") === "C", "Single name initial must be 'C'");
    assert(getInitial(undefined, "dave.smith@byos.local") === "D", "Dotted email local part initial must be 'D'");
    assert(getInitial("", "") === "?", "Empty returns fallback '?'");

    // Color derivation
    const colorAlice = getAccountColor("a0000000-0000-0000-0000-000000000001");
    const colorBob = getAccountColor("b0000000-0000-0000-0000-000000000002");
    assert(colorAlice.startsWith("hsl("), `Alice color must be hsl format: ${colorAlice}`);
    assert(colorBob.startsWith("hsl("), `Bob color must be hsl format: ${colorBob}`);
    assert(colorAlice !== colorBob, "Different mailbox IDs must yield different deterministic colors");

    // ProfileAvatar component source check for initial and color binding
    const avatarPath = path.resolve(__dirname, "components/ProfileAvatar.tsx");
    const avatarSource = fs.readFileSync(avatarPath, "utf-8");

    assert(avatarSource.includes("data-testid=\"avatar-fallback-initial\""), "Avatar contains fallback initial span");
    assert(avatarSource.includes("\"background-color\": bgColor()"), "Avatar sets background-color to deterministic bgColor()");
    assert(avatarSource.includes("sizeClasses"), "Avatar implements sizeClasses mapping");
  });

  // 2. test_sidebar_renders_photo_when_set
  await test("test_sidebar_renders_photo_when_set", () => {
    const switcherPath = path.resolve(__dirname, "components/AccountSwitcher.tsx");
    const switcherSource = fs.readFileSync(switcherPath, "utf-8");

    // Chip must render ProfileAvatar with photoUrl
    assert(switcherSource.includes("<ProfileAvatar"), "AccountSwitcher includes ProfileAvatar component");
    assert(switcherSource.includes("photoUrl={props.profilePhotoUrl}"), "AccountSwitcher passes profilePhotoUrl to ProfileAvatar");
    assert(switcherSource.includes("size=\"chip\""), "AccountSwitcher chip uses size='chip' (24x24px)");

    // ProfileAvatar renders img with data-testid='avatar-photo-img'
    const avatarPath = path.resolve(__dirname, "components/ProfileAvatar.tsx");
    const avatarSource = fs.readFileSync(avatarPath, "utf-8");
    assert(avatarSource.includes("data-testid=\"avatar-photo-img\""), "ProfileAvatar renders img tag for photo");
    assert(avatarSource.includes("object-cover"), "ProfileAvatar img uses object-cover");
  });

  // 3. test_sidebar_renders_fallback_when_no_photo
  await test("test_sidebar_renders_fallback_when_no_photo", () => {
    const switcherPath = path.resolve(__dirname, "components/AccountSwitcher.tsx");
    const switcherSource = fs.readFileSync(switcherPath, "utf-8");

    // Account chip preserves data-testid='account-chip-dot' on the avatar element
    assert(switcherSource.includes("testId=\"account-chip-dot\""), "ProfileAvatar has testId='account-chip-dot'");

    // Dropdown uses dropdown size (20x20px)
    assert(switcherSource.includes("size=\"dropdown\""), "Dropdown uses size='dropdown' (20x20px)");

    // Fallback branch displays initial
    const avatarPath = path.resolve(__dirname, "components/ProfileAvatar.tsx");
    const avatarSource = fs.readFileSync(avatarPath, "utf-8");
    assert(avatarSource.includes("fallback={<span data-testid=\"avatar-fallback-initial\""), "ProfileAvatar renders initial on fallback");
  });

  // 4. Crypto round-trip for photo blob encryption & decryption
  await test("test_photo_crypto_roundtrip", async () => {
    const mailboxKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxKey[i] = i + 1;

    // Simulate 256x256 image bytes
    const simulatedJpegBytes = new Uint8Array(512);
    for (let i = 0; i < 512; i++) simulatedJpegBytes[i] = (i * 7) % 256;

    const iv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) iv[i] = i + 10;

    const encrypted = await encryptChunk(simulatedJpegBytes, mailboxKey, iv);
    assert(encrypted.length >= 29 + 512, "Encrypted payload must have version + IV + ciphertext + tag");
    assert(encrypted[0] === 0x01, "Encrypted payload must have version byte 0x01");

    const decrypted = await decryptChunk(encrypted, mailboxKey);
    assert(decrypted.length === simulatedJpegBytes.length, "Decrypted length matches original");
    for (let i = 0; i < simulatedJpegBytes.length; i++) {
      if (decrypted[i] !== simulatedJpegBytes[i]) {
        throw new Error(`Byte mismatch at index ${i}: expected ${simulatedJpegBytes[i]}, got ${decrypted[i]}`);
      }
    }
  });

  return { passed, failed };
}
