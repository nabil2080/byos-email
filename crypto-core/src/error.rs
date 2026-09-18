use std::fmt;
use wasm_bindgen::JsValue;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    UnsupportedVersion = 1001,
    UnsupportedAlgorithm = 1002,
    InvalidBase64 = 1003,
    InvalidNonceLength = 1004,
    DecapsulationFailed = 1005,
    DecryptionFailed = 1006,
    InvalidKeyLength = 1007,
    UnknownKeyEpoch = 1008,
    SerializationError = 1009,
    AADMismatch = 1010,
    InvalidSignature = 1011,
    UnknownSenderKey = 1012,
    SignatureVerificationFailed = 1013,
}

impl CryptoError {
    pub fn code(&self) -> u32 {
        *self as u32
    }

    pub fn message(&self) -> &'static str {
        match self {
            CryptoError::UnsupportedVersion => "unsupported envelope version",
            CryptoError::UnsupportedAlgorithm => "unsupported cryptographic algorithm",
            CryptoError::InvalidBase64 => "invalid base64 encoding",
            CryptoError::InvalidNonceLength => "invalid nonce length: must be 12 bytes",
            CryptoError::DecapsulationFailed => "KEM decapsulation failed",
            CryptoError::DecryptionFailed => "AEAD decryption or authentication failed",
            CryptoError::InvalidKeyLength => "invalid key length",
            CryptoError::UnknownKeyEpoch => "unknown or unsupported key epoch",
            CryptoError::SerializationError => "serialization or canonical JSON error",
            CryptoError::AADMismatch => "additional authenticated data mismatch",
            CryptoError::InvalidSignature => "invalid signature format",
            CryptoError::UnknownSenderKey => "unknown sender key for verification",
            CryptoError::SignatureVerificationFailed => "signature verification failed",
        }
    }
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CryptoError {}: {}", self.code(), self.message())
    }
}

impl std::error::Error for CryptoError {}

impl From<CryptoError> for JsValue {
    fn from(err: CryptoError) -> Self {
        let obj = js_sys::Object::new();
        let code_key = JsValue::from_str("code");
        let code_val = JsValue::from_f64(err.code() as f64);
        let msg_key = JsValue::from_str("message");
        let msg_val = JsValue::from_str(err.message());
        let _ = js_sys::Reflect::set(&obj, &code_key, &code_val);
        let _ = js_sys::Reflect::set(&obj, &msg_key, &msg_val);
        obj.into()
    }
}
