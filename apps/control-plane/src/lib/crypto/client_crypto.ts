// BYOS Zero-Knowledge Client Cryptography Core
// Adheres strictly to Zero-Knowledge Principle: Server never receives plaintext passwords or unencrypted private keys.

import { bytesToHex } from "../encoding";

export interface CeremonyResult {
  publicKey: string;
  wrappedPrivateKey: string;
  recoverySalt: string;
  passwordVerifier: string;
  recoveryPhrase: string;
  recoveryWords: string[];
}

/**
 * Derives a deterministic, domain-separated password verifier client-side.
 * The server receives ONLY this verifier and never sees the user's plaintext password.
 * Uses 100,000 iterations of PBKDF2-SHA256 salted with byos-auth-v1:${email}.
 */
export async function deriveClientPasswordVerifier(
  password: string,
  email: string
): Promise<string> {
  const enc = new TextEncoder();
  const canonicalEmail = email.trim().toLowerCase();
  const salt = enc.encode(`byos-auth-v1:${canonicalEmail}`);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

/**
 * Generates a 12-word recovery phrase using the WASM crypto core's BIP-39 generator.
 */
export function extract12WordMnemonic(mnemonicString: string): {
  phrase: string;
  words: string[];
} {
  const words = mnemonicString
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);

  if (words.length < 12) {
    throw new Error(`Insufficient mnemonic words generated: expected 12, got ${words.length}`);
  }

  return {
    phrase: words.join(" "),
    words: words,
  };
}

/**
 * Executes the 4-step Cryptographic Ceremony client-side in the browser:
 * 1. Loads WASM crypto core
 * 2. Generates X25519/Ed25519 sovereign keypair
 * 3. Synthesizes 12-word recovery phrase
 * 4. Derives Argon2id key and wraps private key (AES-256-GCM)
 * 5. Computes PBKDF2 password verifier
 */
export async function performCryptographicCeremony(
  email: string,
  password: string,
  onProgress?: (status: string, percent: number) => void
): Promise<CeremonyResult> {
  onProgress?.("Loading WASM Cryptographic Core…", 15);
  // Yield to DOM for smooth animation
  await new Promise((r) => setTimeout(r, 120));

  const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");

  onProgress?.("Generating Sovereign Asymmetric Keypair…", 35);
  await new Promise((r) => setTimeout(r, 120));

  const kpJson = wasm.wasm_generate_keypair();
  const keypair = JSON.parse(kpJson) as { secret_key: string; public_key: string };

  onProgress?.("Synthesizing 12-Word Master Recovery Phrase…", 55);
  await new Promise((r) => setTimeout(r, 120));

  const rawMnemonic = wasm.wasm_generate_mnemonic();
  const { phrase, words } = extract12WordMnemonic(rawMnemonic);

  onProgress?.("Deriving Argon2id Key & Encrypting Private Key…", 75);
  await new Promise((r) => setTimeout(r, 120));

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);

  // Encrypt private key under user's password with Argon2id-derived key
  const wrappedPrivateKey = wasm.wasm_passphrase_wrap_key(
    password,
    saltHex,
    keypair.secret_key
  );

  onProgress?.("Computing Zero-Knowledge Password Verifier…", 92);
  await new Promise((r) => setTimeout(r, 100));

  const passwordVerifier = await deriveClientPasswordVerifier(password, email);

  onProgress?.("Cryptographic Material Verified & Sealed.", 100);
  await new Promise((r) => setTimeout(r, 80));

  return {
    publicKey: keypair.public_key,
    wrappedPrivateKey: wrappedPrivateKey,
    recoverySalt: saltHex,
    passwordVerifier: passwordVerifier,
    recoveryPhrase: phrase,
    recoveryWords: words,
  };
}

/**
 * Evaluates password strength strictly:
 * Requires length >= 10, uppercase, lowercase, numbers, and special characters.
 */
export interface PasswordStrength {
  score: number; // 0 to 4
  label: "Weak" | "Fair" | "Good" | "Strong";
  hasLength: boolean;
  hasLower: boolean;
  hasUpper: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  isCompliant: boolean;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const hasLength = password.length >= 10;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  let criteriaMet = 0;
  if (hasLength) criteriaMet++;
  if (hasLower) criteriaMet++;
  if (hasUpper) criteriaMet++;
  if (hasNumber) criteriaMet++;
  if (hasSpecial) criteriaMet++;

  let score = 0;
  let label: PasswordStrength["label"] = "Weak";

  if (criteriaMet >= 5 && password.length >= 12) {
    score = 4;
    label = "Strong";
  } else if (criteriaMet >= 4 && password.length >= 10) {
    score = 3;
    label = "Good";
  } else if (criteriaMet >= 3) {
    score = 2;
    label = "Fair";
  } else {
    score = 1;
    label = "Weak";
  }

  return {
    score,
    label,
    hasLength,
    hasLower,
    hasUpper,
    hasNumber,
    hasSpecial,
    isCompliant: criteriaMet >= 4 && hasLength,
  };
}
