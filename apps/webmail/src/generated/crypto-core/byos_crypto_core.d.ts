/* tslint:disable */
/* eslint-disable */

export class SigningKeyHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Load a signing key handle from recovery root, mailbox ID, and epoch.
     */
    static loadSigningKeyFromRoot(recovery_root: Uint8Array, mailbox_id: Uint8Array, key_epoch: number): SigningKeyHandle;
    /**
     * Sign AAD || ciphertext, returning 64-byte signature.
     */
    sign(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array;
    /**
     * Get the 32-byte public key.
     */
    signingPublicKey(): Uint8Array;
}

/**
 * Drop a SigningKeyHandle explicitly, zeroizing its private key memory.
 */
export function drop_signing_key(handle: SigningKeyHandle): void;

/**
 * Standalone helper to load a signing key handle from recovery root.
 */
export function load_signing_key_from_root(recovery_root: Uint8Array, mailbox_id: Uint8Array, key_epoch: number): SigningKeyHandle;

/**
 * Standalone helper to sign with a SigningKeyHandle.
 */
export function sign_with_handle(handle: SigningKeyHandle, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array;

/**
 * Standalone helper to get the public key from a SigningKeyHandle.
 */
export function signing_public_key_from_handle(handle: SigningKeyHandle): Uint8Array;

export function wasm_aes_gcm_decrypt(key_hex: string, envelope_hex: string, aad_hex: string): string;

export function wasm_aes_gcm_encrypt(key_hex: string, plaintext_hex: string, aad_hex: string): string;

/**
 * Build canonical AES-GCM AAD for the browser (hex in/out).
 * aad = mailbox_id(16) || message_seq(8 BE) || encryption_version(4 BE) || aad_version(1).
 * Client-side AAD MUST come from this export — frozen §13.3 forbids a
 * separate TypeScript AAD implementation.
 */
export function wasm_canonical_aad(mailbox_id_hex: string, message_seq: bigint, encryption_version: number): string;

export function wasm_decrypt_outbound(outbound_delivery_sk_b64: string, send_token_wrapped_b64: string, mailbox_id_hex: string, message_seq: bigint, ciphertext_b64: string): string;

export function wasm_derive_root_secret(entropy_hex: string): string;

/**
 * Derive the mailbox search_key from a root_secret (both hex).
 * search_key = HKDF-SHA256(salt="byos-search-key-v1", ikm=root_secret).
 * The caller HMACs normalized search terms with this key locally; the key
 * itself never leaves the browser.
 */
export function wasm_derive_search_key(root_secret_hex: string): string;

export function wasm_derive_signing_seed(recovery_root_hex: string, mailbox_id_hex: string, key_epoch: number): string;

export function wasm_encrypt_outbound(outbound_delivery_pk_b64: string, mailbox_id_hex: string, message_seq: bigint, plaintext_b64: string): string;

export function wasm_generate_keypair(): string;

export function wasm_generate_mnemonic(): string;

export function wasm_generate_outbound_keypair(): string;

export function wasm_hpke_open(recipient_sk_hex: string, wrapped_hex: string, aad_hex: string): string;

export function wasm_hpke_seal(recipient_pk_hex: string, plaintext_hex: string, aad_hex: string): string;

/**
 * Unwrap with a principal passphrase (hex in/out). Fails closed on wrong
 * passphrase, wrong salt, or tampering.
 */
export function wasm_passphrase_unwrap_key(passphrase: string, salt_hex: string, envelope_hex: string): string;

/**
 * Wrap an org recovery secret under a principal passphrase (hex in/out).
 * Salt must be exactly 16 bytes (hex). Freezes no parameters client-side:
 * cost profile is fixed in-core (see RECOVERY_KDF_* constants).
 */
export function wasm_passphrase_wrap_key(passphrase: string, salt_hex: string, plaintext_hex: string): string;

export function wasm_recover_root_secret(mnemonic: string): string;

/**
 * Derive the recovery-auth Ed25519 public key from a root secret (hex).
 * Only the public key leaves this function; the seed and signing key are
 * transient. Enrollment uploads exactly this value as recovery_auth_pk.
 */
export function wasm_recovery_auth_pk_from_root(root_secret_hex: string): string;

/**
 * Sign a recovery challenge message with the root-derived Ed25519 key.
 * message_hex is the hex-encoded canonical challenge message; returns the
 * 64-byte signature as hex. The signing key never leaves WASM memory.
 */
export function wasm_recovery_auth_sign(root_secret_hex: string, message_hex: string): string;

export function wasm_sign_with_seed(seed_hex: string, aad_hex: string, ciphertext_hex: string): string;

export function wasm_signing_public_key_from_seed(seed_hex: string): string;

export function wasm_unwrap_mailbox_key(root_secret_hex: string, wrapped_hex: string, mailbox_id_hex: string): string;

export function wasm_unwrap_signing_seed(recovery_root_hex: string, wrapped_hex: string, mailbox_id_hex: string): string;

export function wasm_verify_signature(public_key_hex: string, aad_hex: string, ciphertext_hex: string, signature_hex: string): boolean;

export function wasm_wrap_mailbox_key(root_secret_hex: string, mailbox_sk_hex: string, mailbox_id_hex: string): string;

export function wasm_wrap_signing_seed(recovery_root_hex: string, seed_hex: string, mailbox_id_hex: string): string;
