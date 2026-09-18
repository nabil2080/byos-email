use std::fmt::Write as _;
use base64::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::CryptoError;

pub const CURRENT_VERSION: u8 = 1;
pub const NONCE_SIZE: usize = 12;
pub const TAG_SIZE: usize = 16;
pub const X25519_ENC_SIZE: usize = 32;
pub const XWING_ENC_SIZE: usize = 1120;

pub const ALG_X25519: &str = "HPKE-X25519-AES256GCM-v1";
pub const ALG_XWING: &str = "HPKE-XWing-AES256GCM-v1";

/// CryptoEnvelope defines the version 1 cryptographic envelope wire format
/// specified in BYOS-SPEC-CRYPTO-ENV-V1 §2.1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CryptoEnvelope {
    pub alg: String,
    pub ciphertext: String,
    pub enc: String,
    pub key_epoch: u32,
    pub key_id: String,
    pub nonce: String,
    #[serde(default)]
    pub sig: Option<String>,
    pub v: u8,
}

/// DecodedPayload contains the raw binary slices decoded from the envelope fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedPayload {
    pub raw_enc: Vec<u8>,
    pub raw_nonce: Vec<u8>,
    pub raw_ciphertext: Vec<u8>,
    pub raw_sig: Option<Vec<u8>>,
}

impl CryptoEnvelope {
    /// Decodes and strictly validates all Base64 fields in the envelope.
    pub fn decode_base64(&self) -> Result<DecodedPayload, CryptoError> {
        let raw_enc = BASE64_STANDARD
            .decode(&self.enc)
            .map_err(|_| CryptoError::InvalidBase64)?;

        let raw_nonce = BASE64_STANDARD
            .decode(&self.nonce)
            .map_err(|_| CryptoError::InvalidBase64)?;

        let raw_ciphertext = BASE64_STANDARD
            .decode(&self.ciphertext)
            .map_err(|_| CryptoError::InvalidBase64)?;

        let raw_sig = match &self.sig {
            Some(s) => {
                let decoded = BASE64_STANDARD
                    .decode(s)
                    .map_err(|_| CryptoError::InvalidBase64)?;
                Some(decoded)
            }
            None => None,
        };

        Ok(DecodedPayload {
            raw_enc,
            raw_nonce,
            raw_ciphertext,
            raw_sig,
        })
    }
}

/// Validates full structural, algorithmic, and cryptographic bounds checks
/// on the envelope according to BYOS-SPEC-CRYPTO-ENV-V1.
pub fn validate(env: &CryptoEnvelope) -> Result<(), CryptoError> {
    // 1. Version check (§8)
    if env.v != CURRENT_VERSION {
        return Err(CryptoError::UnsupportedVersion);
    }

    // 2. Algorithm check (§5)
    if env.alg != ALG_X25519 && env.alg != ALG_XWING {
        return Err(CryptoError::UnsupportedAlgorithm);
    }
    if env.alg.is_empty() || env.alg.len() > 255 {
        return Err(CryptoError::UnsupportedAlgorithm);
    }

    // 3. Key Epoch check (§6)
    if env.key_epoch == 0 {
        return Err(CryptoError::UnknownKeyEpoch);
    }

    // 4. Key ID check (§3.2)
    if env.key_id.is_empty() || env.key_id.len() > 255 {
        return Err(CryptoError::SerializationError);
    }

    // 5. Base64 decoding & verification (§2.2 rule 5)
    let decoded = env.decode_base64()?;

    // 6. Nonce length check (§3.2 rule 5, §4.1)
    if decoded.raw_nonce.len() != NONCE_SIZE {
        return Err(CryptoError::InvalidNonceLength);
    }

    // 7. Ciphertext length check (§2.1, AES-GCM tag is 16 bytes)
    if decoded.raw_ciphertext.len() < TAG_SIZE {
        return Err(CryptoError::SerializationError);
    }

    // 8. Encapsulation length check per algorithm (§5.1, §5.2)
    match env.alg.as_str() {
        ALG_X25519 => {
            if decoded.raw_enc.len() != X25519_ENC_SIZE {
                return Err(CryptoError::InvalidKeyLength);
            }
        }
        ALG_XWING => {
            if decoded.raw_enc.len() != XWING_ENC_SIZE {
                return Err(CryptoError::InvalidKeyLength);
            }
        }
        _ => return Err(CryptoError::UnsupportedAlgorithm),
    }

    // 9. Signature check (§7)
    // In V1, sig is null. Non-null sig is tolerated for forward compatibility,
    // but must be valid base64 (already checked in decode_base64).

    Ok(())
}

/// Writes an RFC 8259 compliant JSON string without HTML escaping.
fn write_json_string(buf: &mut Vec<u8>, s: &str) {
    buf.push(b'"');
    for &c in s.as_bytes() {
        match c {
            b'"' => buf.extend_from_slice(b"\\\""),
            b'\\' => buf.extend_from_slice(b"\\\\"),
            0x08 => buf.extend_from_slice(b"\\b"),
            0x0c => buf.extend_from_slice(b"\\f"),
            b'\n' => buf.extend_from_slice(b"\\n"),
            b'\r' => buf.extend_from_slice(b"\\r"),
            b'\t' => buf.extend_from_slice(b"\\t"),
            b if b < 0x20 => {
                let mut esc = String::new();
                let _ = write!(esc, "\\u{:04x}", b);
                buf.extend_from_slice(esc.as_bytes());
            }
            b => buf.push(b),
        }
    }
    buf.push(b'"');
}

/// Serializes env into canonical JSON per BYOS-SPEC-CRYPTO-ENV-V1 §2.2
/// using explicit byte-buffer construction to ensure strict field ordering independent
/// of struct declaration order:
/// "alg" -> "ciphertext" -> "enc" -> "key_epoch" -> "key_id" -> "nonce" -> "sig" -> "v"
pub fn marshal_canonical(env: &CryptoEnvelope) -> Result<Vec<u8>, CryptoError> {
    let mut buf = Vec::with_capacity(256 + env.ciphertext.len() + env.enc.len());
    buf.push(b'{');

    // 1. alg
    buf.extend_from_slice(b"\"alg\":");
    write_json_string(&mut buf, &env.alg);
    buf.push(b',');

    // 2. ciphertext
    buf.extend_from_slice(b"\"ciphertext\":");
    write_json_string(&mut buf, &env.ciphertext);
    buf.push(b',');

    // 3. enc
    buf.extend_from_slice(b"\"enc\":");
    write_json_string(&mut buf, &env.enc);
    buf.push(b',');

    // 4. key_epoch
    buf.extend_from_slice(b"\"key_epoch\":");
    buf.extend_from_slice(env.key_epoch.to_string().as_bytes());
    buf.push(b',');

    // 5. key_id
    buf.extend_from_slice(b"\"key_id\":");
    write_json_string(&mut buf, &env.key_id);
    buf.push(b',');

    // 6. nonce
    buf.extend_from_slice(b"\"nonce\":");
    write_json_string(&mut buf, &env.nonce);
    buf.push(b',');

    // 7. sig
    buf.extend_from_slice(b"\"sig\":");
    match &env.sig {
        Some(s) => write_json_string(&mut buf, s),
        None => buf.extend_from_slice(b"null"),
    }
    buf.push(b',');

    // 8. v
    buf.extend_from_slice(b"\"v\":");
    buf.extend_from_slice(env.v.to_string().as_bytes());

    buf.push(b'}');
    Ok(buf)
}

/// Unmarshals JSON data into a CryptoEnvelope without validation.
pub fn unmarshal(data: &[u8]) -> Result<CryptoEnvelope, CryptoError> {
    if data.is_empty() {
        return Err(CryptoError::SerializationError);
    }
    serde_json::from_slice(data).map_err(|_| CryptoError::SerializationError)
}

/// Parses JSON data into a CryptoEnvelope and runs full validation.
/// All 8 fields defined in BYOS-SPEC-CRYPTO-ENV-V1 §2.1 must be present:
/// "alg", "ciphertext", "enc", "key_epoch", "key_id", "nonce", "sig", "v".
pub fn unmarshal_canonical(data: &[u8]) -> Result<CryptoEnvelope, CryptoError> {
    if data.is_empty() {
        return Err(CryptoError::SerializationError);
    }

    let raw_val: serde_json::Value =
        serde_json::from_slice(data).map_err(|_| CryptoError::SerializationError)?;

    let map = raw_val.as_object().ok_or(CryptoError::SerializationError)?;

    const REQUIRED_FIELDS: [&str; 8] = [
        "alg",
        "ciphertext",
        "enc",
        "key_epoch",
        "key_id",
        "nonce",
        "sig",
        "v",
    ];

    for field in REQUIRED_FIELDS {
        if !map.contains_key(field) {
            return Err(CryptoError::SerializationError);
        }
    }

    let env: CryptoEnvelope =
        serde_json::from_value(raw_val).map_err(|_| CryptoError::SerializationError)?;

    validate(&env)?;

    Ok(env)
}

/// Constructs the deterministic binary AAD from already decoded raw components.
pub fn build_aad_raw(
    v: u8,
    alg: &str,
    key_id: &str,
    key_epoch: u32,
    raw_enc: &[u8],
    raw_nonce: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if alg.is_empty() || alg.len() > 255 {
        return Err(CryptoError::AADMismatch);
    }
    if key_id.is_empty() || key_id.len() > 255 {
        return Err(CryptoError::AADMismatch);
    }
    if raw_nonce.len() != NONCE_SIZE {
        return Err(CryptoError::InvalidNonceLength);
    }

    let total_len = 1 + 1 + alg.len() + 1 + key_id.len() + 4 + 4 + raw_enc.len() + 1 + raw_nonce.len();
    let mut buf = Vec::with_capacity(total_len);

    // 0: v
    buf.push(v);

    // 1: alg_length
    buf.push(alg.len() as u8);

    // 2 .. 2+n: alg
    buf.extend_from_slice(alg.as_bytes());

    // pos: key_id_length
    buf.push(key_id.len() as u8);

    // pos .. pos+m: key_id
    buf.extend_from_slice(key_id.as_bytes());

    // pos: key_epoch (Big-Endian uint32)
    buf.extend_from_slice(&key_epoch.to_be_bytes());

    // pos: enc_length (Big-Endian uint32 raw bytes)
    buf.extend_from_slice(&(raw_enc.len() as u32).to_be_bytes());

    // pos .. pos+k: enc (raw bytes)
    buf.extend_from_slice(raw_enc);

    // pos: nonce_length (uint8 = 12)
    buf.push(raw_nonce.len() as u8);

    // pos .. pos+12: nonce
    buf.extend_from_slice(raw_nonce);

    Ok(buf)
}

/// Constructs the deterministic packed binary Additional Authenticated Data (AAD)
/// buffer for env according to BYOS-SPEC-CRYPTO-ENV-V1 §3.1.
pub fn build_aad(env: &CryptoEnvelope) -> Result<Vec<u8>, CryptoError> {
    if env.v != CURRENT_VERSION {
        return Err(CryptoError::UnsupportedVersion);
    }
    if env.alg.is_empty() || env.alg.len() > 255 {
        return Err(CryptoError::AADMismatch);
    }
    if env.key_id.is_empty() || env.key_id.len() > 255 {
        return Err(CryptoError::AADMismatch);
    }

    let raw_enc = BASE64_STANDARD
        .decode(&env.enc)
        .map_err(|_| CryptoError::InvalidBase64)?;

    let raw_nonce = BASE64_STANDARD
        .decode(&env.nonce)
        .map_err(|_| CryptoError::InvalidBase64)?;

    if raw_nonce.len() != NONCE_SIZE {
        return Err(CryptoError::InvalidNonceLength);
    }

    build_aad_raw(env.v, &env.alg, &env.key_id, env.key_epoch, &raw_enc, &raw_nonce)
}
