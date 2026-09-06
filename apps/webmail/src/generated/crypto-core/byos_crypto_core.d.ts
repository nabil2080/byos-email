/* tslint:disable */
/* eslint-disable */

export function wasm_aes_gcm_decrypt(key_hex: string, envelope_hex: string, aad_hex: string): string;

export function wasm_aes_gcm_encrypt(key_hex: string, plaintext_hex: string, aad_hex: string): string;

export function wasm_decrypt_outbound(outbound_delivery_sk_b64: string, send_token_wrapped_b64: string, mailbox_id_hex: string, message_seq: bigint, ciphertext_b64: string): string;

export function wasm_derive_root_secret(entropy_hex: string): string;

export function wasm_encrypt_outbound(outbound_delivery_pk_b64: string, mailbox_id_hex: string, message_seq: bigint, plaintext_b64: string): string;

export function wasm_generate_keypair(): string;

export function wasm_generate_mnemonic(): string;

export function wasm_generate_outbound_keypair(): string;

export function wasm_hpke_open(recipient_sk_hex: string, wrapped_hex: string, aad_hex: string): string;

export function wasm_hpke_seal(recipient_pk_hex: string, plaintext_hex: string, aad_hex: string): string;

export function wasm_recover_root_secret(mnemonic: string): string;

export function wasm_unwrap_mailbox_key(root_secret_hex: string, wrapped_hex: string, mailbox_id_hex: string): string;

export function wasm_wrap_mailbox_key(root_secret_hex: string, mailbox_sk_hex: string, mailbox_id_hex: string): string;
