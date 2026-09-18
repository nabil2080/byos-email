pub mod error;
pub mod core;
pub mod envelope;
pub mod hpke;
pub mod dispatch;

pub use error::*;
pub use crate::core::*;
pub use crate::envelope::*;
pub use crate::hpke::*;
pub use crate::dispatch::*;

use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

/// KeyHandle holds a zeroized private key in memory and its associated algorithm.
#[wasm_bindgen]
pub struct KeyHandle {
    raw: Zeroizing<Vec<u8>>,
    algorithm: String,
}

#[wasm_bindgen]
impl KeyHandle {
    #[wasm_bindgen(getter)]
    pub fn algorithm(&self) -> String {
        self.algorithm.clone()
    }
}

impl KeyHandle {
    pub fn new(key_bytes: Vec<u8>, algorithm: String) -> Self {
        Self {
            raw: Zeroizing::new(key_bytes),
            algorithm,
        }
    }

    pub fn raw(&self) -> &[u8] {
        &self.raw
    }
}

/// Loads private key bytes for a given algorithm without exposing hex strings.
#[wasm_bindgen]
pub fn load_private_key(key_bytes: &[u8], algorithm: &str) -> Result<KeyHandle, JsValue> {
    match algorithm {
        ALG_X25519 => {
            if key_bytes.len() != X25519_ENC_SIZE {
                return Err(CryptoError::InvalidKeyLength.into());
            }
        }
        ALG_XWING => {
            if key_bytes.len() != core::DECAPSULATION_KEY_SIZE {
                return Err(CryptoError::InvalidKeyLength.into());
            }
        }
        _ => return Err(CryptoError::UnsupportedAlgorithm.into()),
    }

    Ok(KeyHandle {
        raw: Zeroizing::new(key_bytes.to_vec()),
        algorithm: algorithm.to_string(),
    })
}

/// Pure Rust decryption helper for internal and testing usage.
pub fn decrypt_envelope_bytes(
    envelope_json: &str,
    key_handle: &KeyHandle,
) -> Result<Vec<u8>, CryptoError> {
    let env = envelope::unmarshal_canonical(envelope_json.as_bytes())?;
    if env.alg != key_handle.algorithm {
        return Err(CryptoError::UnsupportedAlgorithm);
    }
    dispatch::open(&env, &key_handle.raw)
}

/// Decrypts a canonical envelope JSON string using the provided KeyHandle.
/// Returns a Uint8Array containing the decrypted plaintext.
#[wasm_bindgen]
pub fn decrypt_envelope(
    envelope_json: &str,
    key_handle: &KeyHandle,
) -> Result<js_sys::Uint8Array, JsValue> {
    let plaintext = decrypt_envelope_bytes(envelope_json, key_handle).map_err(JsValue::from)?;
    let uint8_array = js_sys::Uint8Array::new_with_length(plaintext.len() as u32);
    uint8_array.copy_from(&plaintext);
    Ok(uint8_array)
}

/// Drops a KeyHandle, zeroizing its private key memory immediately.
#[wasm_bindgen]
pub fn drop_key(handle: KeyHandle) {
    drop(handle);
}
