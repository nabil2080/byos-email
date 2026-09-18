use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::prelude::*;
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::core;
use crate::envelope::{
    self, CryptoEnvelope, ALG_X25519, ALG_XWING, CURRENT_VERSION, NONCE_SIZE, X25519_ENC_SIZE,
};
use crate::error::CryptoError;

type HmacSha256 = Hmac<Sha256>;

// HPKE Suite Identifiers per RFC 9180 §7.1 - §7.3
pub const KEM_ID_DHKEM_X25519_HKDF_SHA256: u16 = 0x0020;
pub const KEM_ID_XWING: u16 = 0x647a;
pub const KDF_ID_HKDF_SHA256: u16 = 0x0001;
pub const AEAD_ID_AES_256_GCM: u16 = 0x0002;

// SuiteX25519 is the 10-byte HPKE suite identifier for HPKE-X25519-AES256GCM-v1:
// "HPKE" || 0x0020 (KEM) || 0x0001 (KDF) || 0x0002 (AEAD)
pub const SUITE_X25519: &[u8; 10] = b"HPKE\x00\x20\x00\x01\x00\x02";

// SuiteXWing is the 10-byte HPKE suite identifier for HPKE-XWing-AES256GCM-v1:
// "HPKE" || 0x647a (KEM) || 0x0001 (KDF) || 0x0002 (AEAD)
pub const SUITE_XWING: &[u8; 10] = b"HPKE\x64\x7a\x00\x01\x00\x02";

// DHKEMX25519SuiteID is the 5-byte KEM suite identifier: "KEM" || 0x0020
pub const DHKEM_X25519_SUITE_ID: &[u8; 5] = b"KEM\x00\x20";

/// hkdf_expand implements RFC 5869 §2.3 HMAC-SHA256 expansion.
pub fn hkdf_expand(prk: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, CryptoError> {
    let hash_len = 32;
    if length > 255 * hash_len {
        return Err(CryptoError::SerializationError);
    }
    let n = (length + hash_len - 1) / hash_len;
    let mut okm = Vec::with_capacity(n * hash_len);
    let mut prev = Vec::<u8>::new();
    for i in 1..=n {
        let mut h = <HmacSha256 as Mac>::new_from_slice(prk).map_err(|_| CryptoError::SerializationError)?;
        if !prev.is_empty() {
            h.update(&prev);
        }
        if !info.is_empty() {
            h.update(info);
        }
        h.update(&[i as u8]);
        let res = h.finalize().into_bytes();
        prev = res.to_vec();
        okm.extend_from_slice(&prev);
    }
    okm.truncate(length);
    Ok(okm)
}

/// LabeledExtract implements RFC 9180 §4:
/// LabeledExtract(salt, label, ikm) = HMAC-SHA256(salt, "HPKE-v1" || suite_id || label || ikm)
pub fn labeled_extract(
    salt: Option<&[u8]>,
    label: &str,
    ikm: Option<&[u8]>,
    suite_id: &[u8],
) -> [u8; 32] {
    let salt_bytes = salt.unwrap_or(&[]);
    let mut mac = <HmacSha256 as Mac>::new_from_slice(salt_bytes).expect("HMAC supports arbitrary key length");
    mac.update(b"HPKE-v1");
    mac.update(suite_id);
    mac.update(label.as_bytes());
    if let Some(ikm_bytes) = ikm {
        if !ikm_bytes.is_empty() {
            mac.update(ikm_bytes);
        }
    }
    mac.finalize().into_bytes().into()
}

/// LabeledExpand implements RFC 9180 §4:
/// LabeledExpand(prk, label, info, L) = HKDF-Expand(prk, I2OSP(L,2) || "HPKE-v1" || suite_id || label || info, L)
pub fn labeled_expand(
    prk: &[u8],
    label: &str,
    info: Option<&[u8]>,
    length: usize,
    suite_id: &[u8],
) -> Vec<u8> {
    let mut labeled_info = Vec::with_capacity(2 + 7 + suite_id.len() + label.len() + info.map_or(0, |i| i.len()));
    labeled_info.extend_from_slice(&(length as u16).to_be_bytes());
    labeled_info.extend_from_slice(b"HPKE-v1");
    labeled_info.extend_from_slice(suite_id);
    labeled_info.extend_from_slice(label.as_bytes());
    if let Some(info_bytes) = info {
        if !info_bytes.is_empty() {
            labeled_info.extend_from_slice(info_bytes);
        }
    }
    hkdf_expand(prk, &labeled_info, length).expect("valid length")
}

/// DHKEMExtractAndExpand derives shared_secret from raw DH output and kem_context
/// per RFC 9180 §4.1:
///   eae_prk = LabeledExtract("", "eae_prk", dh)
///   shared_secret = LabeledExpand(eae_prk, "shared_secret", kem_context, Nsecret)
pub fn dhkem_extract_and_expand(dh: &[u8], enc: &[u8], pk_r: &[u8]) -> [u8; 32] {
    let eae_prk = labeled_extract(None, "eae_prk", Some(dh), DHKEM_X25519_SUITE_ID);
    let mut kem_context = Vec::with_capacity(enc.len() + pk_r.len());
    kem_context.extend_from_slice(enc);
    kem_context.extend_from_slice(pk_r);
    let out = labeled_expand(&eae_prk, "shared_secret", Some(&kem_context), 32, DHKEM_X25519_SUITE_ID);
    let mut ss = [0u8; 32];
    ss.copy_from_slice(&out);
    ss
}

/// DeriveAEADKey derives the 32-byte AES-256-GCM symmetric key from shared_secret
/// using RFC 9180 §5.1 key schedule primitives with the parameterized suite_id.
pub fn derive_aead_key(shared_secret: &[u8], suite_id: &[u8]) -> Result<[u8; 32], CryptoError> {
    if shared_secret.is_empty() || suite_id.is_empty() {
        return Err(CryptoError::SerializationError);
    }

    let psk_id_hash = labeled_extract(None, "psk_id_hash", None, suite_id);
    let info_hash = labeled_extract(None, "info_hash", None, suite_id);

    let mut ks_context = Vec::with_capacity(1 + psk_id_hash.len() + info_hash.len());
    ks_context.push(0x00); // Mode Base = 0x00
    ks_context.extend_from_slice(&psk_id_hash);
    ks_context.extend_from_slice(&info_hash);

    let secret = labeled_extract(Some(shared_secret), "secret", None, suite_id);
    let key_bytes = labeled_expand(&secret, "key", Some(&ks_context), 32, suite_id);
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    Ok(key)
}

/// Generates a fresh random X25519 key pair: (priv, pub).
pub fn generate_key_pair_x25519() -> ([u8; 32], [u8; 32]) {
    let priv_key = StaticSecret::random_from_rng(OsRng);
    let pub_key = PublicKey::from(&priv_key);
    (priv_key.to_bytes(), pub_key.to_bytes())
}

/// EncapsulateX25519WithKey encapsulates using a pre-determined ephemeral private key
/// (used for deterministic test vector validation per RFC 9180 Appendix A.1).
pub fn encapsulate_x25519_with_key(
    ephemeral_priv: &[u8; 32],
    recipient_pub: &[u8; 32],
) -> Result<([u8; 32], [u8; 32]), CryptoError> {
    let priv_e = StaticSecret::from(*ephemeral_priv);
    let enc = PublicKey::from(&priv_e).to_bytes();

    let pub_r = PublicKey::from(*recipient_pub);
    let dh = priv_e.diffie_hellman(&pub_r).to_bytes();

    let shared_secret = dhkem_extract_and_expand(&dh, &enc, recipient_pub);
    Ok((enc, shared_secret))
}

/// EncapsulateX25519 encapsulates a shared secret for recipient_pub using
/// DHKEM(X25519, HKDF-SHA256) per RFC 9180 §4.1.
pub fn encapsulate_x25519(
    recipient_pub: &[u8; 32],
) -> Result<([u8; 32], [u8; 32]), CryptoError> {
    let priv_e = StaticSecret::random_from_rng(OsRng);
    let enc = PublicKey::from(&priv_e).to_bytes();

    let pub_r = PublicKey::from(*recipient_pub);
    let dh = priv_e.diffie_hellman(&pub_r).to_bytes();

    let shared_secret = dhkem_extract_and_expand(&dh, &enc, recipient_pub);
    Ok((enc, shared_secret))
}

/// DecapsulateX25519 decapsulates an X25519 enc (32 bytes) using recipient's private key (32 bytes)
/// per RFC 9180 §4.1.
pub fn decapsulate_x25519(
    recipient_priv: &[u8],
    enc: &[u8],
) -> Result<[u8; 32], CryptoError> {
    if recipient_priv.len() != X25519_ENC_SIZE || enc.len() != X25519_ENC_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }

    let priv_bytes: [u8; 32] = recipient_priv.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    let enc_bytes: [u8; 32] = enc.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;

    let priv_r = StaticSecret::from(priv_bytes);
    let pub_r = PublicKey::from(&priv_r).to_bytes();

    let pub_e = PublicKey::from(enc_bytes);
    let dh = priv_r.diffie_hellman(&pub_e).to_bytes();

    Ok(dhkem_extract_and_expand(&dh, &enc_bytes, &pub_r))
}

/// SealX25519 seals plaintext for recipient_pub using HPKE-X25519-AES256GCM-v1.
pub fn seal_x25519(
    recipient_pub: &[u8],
    plaintext: &[u8],
    key_id: &str,
    key_epoch: u32,
) -> Result<CryptoEnvelope, CryptoError> {
    if recipient_pub.len() != X25519_ENC_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    if key_id.is_empty() || key_id.len() > 255 {
        return Err(CryptoError::SerializationError);
    }
    if key_epoch == 0 {
        return Err(CryptoError::UnknownKeyEpoch);
    }

    let pub_bytes: [u8; 32] = recipient_pub.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    let (enc, shared_secret) = encapsulate_x25519(&pub_bytes)?;

    let aes_key = derive_aead_key(&shared_secret, SUITE_X25519)?;

    let mut nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);

    let aad = envelope::build_aad_raw(CURRENT_VERSION, ALG_X25519, key_id, key_epoch, &enc, &nonce)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let gcm_nonce = Nonce::from_slice(&nonce);
    let payload = Payload {
        msg: plaintext,
        aad: &aad,
    };
    let ciphertext = cipher.encrypt(gcm_nonce, payload).map_err(|_| CryptoError::DecryptionFailed)?;

    Ok(CryptoEnvelope {
        alg: ALG_X25519.to_string(),
        ciphertext: BASE64_STANDARD.encode(&ciphertext),
        enc: BASE64_STANDARD.encode(&enc),
        key_epoch,
        key_id: key_id.to_string(),
        nonce: BASE64_STANDARD.encode(&nonce),
        sig: None,
        v: CURRENT_VERSION,
    })
}

/// OpenX25519 decrypts and verifies a CryptoEnvelope using recipient's 32-byte private key.
pub fn open_x25519(
    recipient_priv: &[u8],
    env: &CryptoEnvelope,
) -> Result<Vec<u8>, CryptoError> {
    envelope::validate(env)?;
    if env.alg != ALG_X25519 {
        return Err(CryptoError::UnsupportedAlgorithm);
    }

    let decoded = env.decode_base64()?;
    let shared_secret = decapsulate_x25519(recipient_priv, &decoded.raw_enc)?;

    let aes_key = derive_aead_key(&shared_secret, SUITE_X25519)?;
    let aad = envelope::build_aad(env)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let gcm_nonce = Nonce::from_slice(&decoded.raw_nonce);
    let payload = Payload {
        msg: &decoded.raw_ciphertext,
        aad: &aad,
    };

    cipher.decrypt(gcm_nonce, payload).map_err(|_| CryptoError::DecryptionFailed)
}

/// Test-only helper: deterministic X25519 seal for byte-parity verification.
pub fn seal_x25519_deterministic(
    recipient_pub: &[u8],
    ephemeral_priv: &[u8],
    plaintext: &[u8],
    nonce: &[u8],
    key_id: &str,
    key_epoch: u32,
) -> Result<CryptoEnvelope, CryptoError> {
    if recipient_pub.len() != X25519_ENC_SIZE || ephemeral_priv.len() != X25519_ENC_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    if nonce.len() != NONCE_SIZE {
        return Err(CryptoError::InvalidNonceLength);
    }
    if key_id.is_empty() || key_id.len() > 255 {
        return Err(CryptoError::SerializationError);
    }
    if key_epoch == 0 {
        return Err(CryptoError::UnknownKeyEpoch);
    }

    let pub_bytes: [u8; 32] = recipient_pub.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    let eph_bytes: [u8; 32] = ephemeral_priv.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;

    let (enc, shared_secret) = encapsulate_x25519_with_key(&eph_bytes, &pub_bytes)?;
    let aes_key = derive_aead_key(&shared_secret, SUITE_X25519)?;

    let aad = envelope::build_aad_raw(CURRENT_VERSION, ALG_X25519, key_id, key_epoch, &enc, nonce)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let gcm_nonce = Nonce::from_slice(nonce);
    let payload = Payload {
        msg: plaintext,
        aad: &aad,
    };
    let ciphertext = cipher.encrypt(gcm_nonce, payload).map_err(|_| CryptoError::DecryptionFailed)?;

    Ok(CryptoEnvelope {
        alg: ALG_X25519.to_string(),
        ciphertext: BASE64_STANDARD.encode(&ciphertext),
        enc: BASE64_STANDARD.encode(&enc),
        key_epoch,
        key_id: key_id.to_string(),
        nonce: BASE64_STANDARD.encode(nonce),
        sig: None,
        v: CURRENT_VERSION,
    })
}

/// Generates a fresh random X-Wing key pair: (sk_seed, pk).
pub fn generate_key_pair_xwing() -> Result<([u8; 32], Vec<u8>), CryptoError> {
    use ml_kem::KeyExport;
    let mut sk_seed = [0u8; 32];
    OsRng.fill_bytes(&mut sk_seed);
    let (_dk_m, _sk_x, ek_m, pk_x) = core::expand_decapsulation_key(&sk_seed)?;
    let mut pk = Vec::with_capacity(core::ENCAPSULATION_KEY_SIZE);
    pk.extend_from_slice(&ek_m.to_bytes());
    pk.extend_from_slice(pk_x.as_bytes());
    Ok((sk_seed, pk))
}

/// Encapsulates a shared secret for recipient_xwing_pub (1216 bytes)
/// using X-Wing hybrid KEM (ML-KEM-768 + X25519).
pub fn encapsulate_xwing(
    recipient_xwing_pub: &[u8],
) -> Result<(Vec<u8>, [u8; 32]), CryptoError> {
    if recipient_xwing_pub.len() != core::ENCAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    let pk: &[u8; 1216] = recipient_xwing_pub.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    core::encapsulate(pk)
}

/// Decapsulates an X-Wing enc (1120 bytes) using recipient's 32-byte private key seed.
pub fn decapsulate_xwing(
    recipient_priv_seed: &[u8],
    enc: &[u8],
) -> Result<[u8; 32], CryptoError> {
    if recipient_priv_seed.len() != core::DECAPSULATION_KEY_SIZE || enc.len() != core::CIPHERTEXT_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    let seed: &[u8; 32] = recipient_priv_seed.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    let ct: &[u8; 1120] = enc.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    core::decapsulate(seed, ct)
}

/// SealXWing seals plaintext for recipient_xwing_pub using HPKE-XWing-AES256GCM-v1.
pub fn seal_xwing(
    recipient_xwing_pub: &[u8],
    plaintext: &[u8],
    key_id: &str,
    key_epoch: u32,
) -> Result<CryptoEnvelope, CryptoError> {
    if recipient_xwing_pub.len() != core::ENCAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    if key_id.is_empty() || key_id.len() > 255 {
        return Err(CryptoError::SerializationError);
    }
    if key_epoch == 0 {
        return Err(CryptoError::UnknownKeyEpoch);
    }

    let (enc, shared_secret) = encapsulate_xwing(recipient_xwing_pub)?;
    let aes_key = derive_aead_key(&shared_secret, SUITE_XWING)?;

    let mut nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);

    let aad = envelope::build_aad_raw(CURRENT_VERSION, ALG_XWING, key_id, key_epoch, &enc, &nonce)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let gcm_nonce = Nonce::from_slice(&nonce);
    let payload = Payload {
        msg: plaintext,
        aad: &aad,
    };
    let ciphertext = cipher.encrypt(gcm_nonce, payload).map_err(|_| CryptoError::DecryptionFailed)?;

    Ok(CryptoEnvelope {
        alg: ALG_XWING.to_string(),
        ciphertext: BASE64_STANDARD.encode(&ciphertext),
        enc: BASE64_STANDARD.encode(&enc),
        key_epoch,
        key_id: key_id.to_string(),
        nonce: BASE64_STANDARD.encode(&nonce),
        sig: None,
        v: CURRENT_VERSION,
    })
}

/// OpenXWing decrypts and verifies a CryptoEnvelope using recipient's 32-byte private key seed.
pub fn open_xwing(
    recipient_priv_seed: &[u8],
    env: &CryptoEnvelope,
) -> Result<Vec<u8>, CryptoError> {
    envelope::validate(env)?;
    if env.alg != ALG_XWING {
        return Err(CryptoError::UnsupportedAlgorithm);
    }

    let decoded = env.decode_base64()?;
    let shared_secret = decapsulate_xwing(recipient_priv_seed, &decoded.raw_enc)?;

    let aes_key = derive_aead_key(&shared_secret, SUITE_XWING)?;
    let aad = envelope::build_aad(env)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let gcm_nonce = Nonce::from_slice(&decoded.raw_nonce);
    let payload = Payload {
        msg: &decoded.raw_ciphertext,
        aad: &aad,
    };

    cipher.decrypt(gcm_nonce, payload).map_err(|_| CryptoError::DecryptionFailed)
}

/// Test-only helper: deterministic X-Wing seal for byte-parity verification.
pub fn seal_xwing_deterministic(
    recipient_xwing_pub: &[u8],
    eseed: &[u8],
    plaintext: &[u8],
    nonce: &[u8],
    key_id: &str,
    key_epoch: u32,
) -> Result<CryptoEnvelope, CryptoError> {
    if recipient_xwing_pub.len() != core::ENCAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    if eseed.len() != 64 {
        return Err(CryptoError::InvalidKeyLength);
    }
    if nonce.len() != NONCE_SIZE {
        return Err(CryptoError::InvalidNonceLength);
    }
    if key_id.is_empty() || key_id.len() > 255 {
        return Err(CryptoError::SerializationError);
    }
    if key_epoch == 0 {
        return Err(CryptoError::UnknownKeyEpoch);
    }

    let pk: &[u8; 1216] = recipient_xwing_pub.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    let eseed_bytes: &[u8; 64] = eseed.try_into().map_err(|_| CryptoError::InvalidKeyLength)?;

    let (enc, shared_secret) = core::encapsulate_deterministic(pk, eseed_bytes)?;
    let aes_key = derive_aead_key(&shared_secret, SUITE_XWING)?;

    let aad = envelope::build_aad_raw(CURRENT_VERSION, ALG_XWING, key_id, key_epoch, &enc, nonce)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let gcm_nonce = Nonce::from_slice(nonce);
    let payload = Payload {
        msg: plaintext,
        aad: &aad,
    };
    let ciphertext = cipher.encrypt(gcm_nonce, payload).map_err(|_| CryptoError::DecryptionFailed)?;

    Ok(CryptoEnvelope {
        alg: ALG_XWING.to_string(),
        ciphertext: BASE64_STANDARD.encode(&ciphertext),
        enc: BASE64_STANDARD.encode(&enc),
        key_epoch,
        key_id: key_id.to_string(),
        nonce: BASE64_STANDARD.encode(nonce),
        sig: None,
        v: CURRENT_VERSION,
    })
}
