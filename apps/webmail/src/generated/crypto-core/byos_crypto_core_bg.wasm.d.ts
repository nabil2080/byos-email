/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const wasm_aes_gcm_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const wasm_aes_gcm_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const wasm_decrypt_outbound: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint, h: number, i: number) => [number, number, number, number];
export const wasm_derive_root_secret: (a: number, b: number) => [number, number, number, number];
export const wasm_encrypt_outbound: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number) => [number, number, number, number];
export const wasm_generate_keypair: () => [number, number, number, number];
export const wasm_generate_mnemonic: () => [number, number, number, number];
export const wasm_generate_outbound_keypair: () => [number, number, number, number];
export const wasm_hpke_open: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const wasm_hpke_seal: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const wasm_recover_root_secret: (a: number, b: number) => [number, number, number, number];
export const wasm_unwrap_mailbox_key: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const wasm_wrap_mailbox_key: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
