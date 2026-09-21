use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::{xwing, CryptoError, HPKE_VERSION};

pub const SUITE_XWING: &[u8; 10] = b"HPKE\x64\x7a\x00\x01\x00\x02";
const WRAPPED_KEY_SIZE: usize = 1 + xwing::CIPHERTEXT_SIZE + 32 + 16;

type HmacSha256 = Hmac<Sha256>;

pub fn hkdf_expand(prk: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, CryptoError> {
    if length > 255 * 32 {
        return Err(CryptoError::InvalidHPKE);
    }
    let n = (length + 31) / 32;
    let mut okm = Vec::with_capacity(n * 32);
    let mut previous = Vec::new();
    for i in 1..=n {
        let mut mac =
            <HmacSha256 as Mac>::new_from_slice(prk).map_err(|_| CryptoError::InvalidHPKE)?;
        if !previous.is_empty() {
            mac.update(&previous);
        }
        mac.update(info);
        mac.update(&[i as u8]);
        previous = mac.finalize().into_bytes().to_vec();
        okm.extend_from_slice(&previous);
    }
    okm.truncate(length);
    Ok(okm)
}

pub fn labeled_extract(
    salt: Option<&[u8]>,
    label: &str,
    ikm: Option<&[u8]>,
    suite_id: &[u8],
) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(salt.unwrap_or(&[]))
        .expect("HMAC accepts arbitrary key lengths");
    mac.update(b"HPKE-v1");
    mac.update(suite_id);
    mac.update(label.as_bytes());
    if let Some(ikm) = ikm {
        mac.update(ikm);
    }
    mac.finalize().into_bytes().into()
}

pub fn labeled_expand(
    prk: &[u8],
    label: &str,
    info: Option<&[u8]>,
    length: usize,
    suite_id: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if length > u16::MAX as usize {
        return Err(CryptoError::InvalidHPKE);
    }
    let mut labeled_info =
        Vec::with_capacity(2 + 7 + suite_id.len() + label.len() + info.map_or(0, |v| v.len()));
    labeled_info.extend_from_slice(&(length as u16).to_be_bytes());
    labeled_info.extend_from_slice(b"HPKE-v1");
    labeled_info.extend_from_slice(suite_id);
    labeled_info.extend_from_slice(label.as_bytes());
    if let Some(info) = info {
        labeled_info.extend_from_slice(info);
    }
    hkdf_expand(prk, &labeled_info, length)
}

pub fn derive_aead_key(shared_secret: &[u8]) -> Result<[u8; 32], CryptoError> {
    if shared_secret.len() != 32 {
        return Err(CryptoError::InvalidHPKE);
    }
    let psk_id_hash = labeled_extract(None, "psk_id_hash", None, SUITE_XWING);
    let info_hash = labeled_extract(None, "info_hash", None, SUITE_XWING);
    let mut context = Vec::with_capacity(65);
    context.push(0);
    context.extend_from_slice(&psk_id_hash);
    context.extend_from_slice(&info_hash);
    let secret = labeled_extract(Some(shared_secret), "secret", None, SUITE_XWING);
    let key = labeled_expand(&secret, "key", Some(&context), 32, SUITE_XWING)?;
    key.try_into().map_err(|_| CryptoError::InvalidHPKE)
}

pub fn seal(
    recipient_xwing_pk: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let (enc, shared_secret) = xwing::encapsulate(recipient_xwing_pk)?;
    let key = derive_aead_key(&shared_secret)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::InvalidHPKE)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&[0u8; 12]),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    let mut wrapped = Vec::with_capacity(WRAPPED_KEY_SIZE);
    wrapped.push(HPKE_VERSION);
    wrapped.extend_from_slice(&enc);
    wrapped.extend_from_slice(&ciphertext);
    Ok(wrapped)
}

pub fn open(
    recipient_xwing_sk: &[u8],
    wrapped_key: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if recipient_xwing_sk.len() != xwing::DECAPSULATION_KEY_SIZE
        || wrapped_key.len() != WRAPPED_KEY_SIZE
        || wrapped_key[0] != HPKE_VERSION
    {
        return Err(CryptoError::InvalidFormat);
    }
    let enc = &wrapped_key[1..1 + xwing::CIPHERTEXT_SIZE];
    let ciphertext = &wrapped_key[1 + xwing::CIPHERTEXT_SIZE..];
    let shared_secret = xwing::decapsulate(recipient_xwing_sk, enc)?;
    let key = derive_aead_key(&shared_secret)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::InvalidHPKE)?;
    cipher
        .decrypt(
            Nonce::from_slice(&[0u8; 12]),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| CryptoError::DecryptionFailed)
}
