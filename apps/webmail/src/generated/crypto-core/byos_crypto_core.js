/* @ts-self-types="./byos_crypto_core.d.ts" */
import * as wasm from "./byos_crypto_core_bg.wasm";
import { __wbg_set_wasm } from "./byos_crypto_core_bg.js";

__wbg_set_wasm(wasm);

export {
    SigningKeyHandle, drop_signing_key, load_signing_key_from_root, sign_with_handle, signing_public_key_from_handle, wasm_aes_gcm_decrypt, wasm_aes_gcm_encrypt, wasm_canonical_aad, wasm_decrypt_outbound, wasm_derive_root_secret, wasm_derive_search_key, wasm_derive_signing_seed, wasm_derive_xwing_seed, wasm_encrypt_outbound, wasm_generate_keypair, wasm_generate_mnemonic, wasm_generate_outbound_keypair, wasm_hpke_open, wasm_hpke_seal, wasm_open_xwing_envelope, wasm_passphrase_unwrap_key, wasm_passphrase_wrap_key, wasm_recover_root_secret, wasm_recovery_auth_pk_from_root, wasm_recovery_auth_sign, wasm_seal_xwing_envelope, wasm_seal_xwing_envelope_signed, wasm_sign_with_seed, wasm_signing_public_key_from_seed, wasm_unwrap_mailbox_key, wasm_unwrap_signing_seed, wasm_unwrap_xwing_seed, wasm_verify_signature, wasm_wrap_mailbox_key, wasm_wrap_signing_seed, wasm_wrap_xwing_seed, wasm_xwing_public_key_from_seed
} from "./byos_crypto_core_bg.js";
