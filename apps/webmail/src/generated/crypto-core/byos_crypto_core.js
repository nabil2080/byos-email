/* @ts-self-types="./byos_crypto_core.d.ts" */
import * as wasm from "./byos_crypto_core_bg.wasm";
import { __wbg_set_wasm } from "./byos_crypto_core_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    wasm_aes_gcm_decrypt, wasm_aes_gcm_encrypt, wasm_decrypt_outbound, wasm_derive_root_secret, wasm_encrypt_outbound, wasm_generate_keypair, wasm_generate_mnemonic, wasm_generate_outbound_keypair, wasm_hpke_open, wasm_hpke_seal, wasm_recover_root_secret, wasm_unwrap_mailbox_key, wasm_wrap_mailbox_key
} from "./byos_crypto_core_bg.js";
