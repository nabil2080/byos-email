use crate::core;
use crate::envelope::{self, CryptoEnvelope, ALG_X25519, ALG_XWING, X25519_ENC_SIZE};
use crate::error::CryptoError;
use crate::hpke::{open_x25519, open_xwing, seal_x25519, seal_xwing};

/// RecipientKey encapsulates the recipient's algorithm identifier and public key bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipientKey {
    pub algorithm: String,
    pub public_key: Vec<u8>,
}

/// Seals plaintext for recipient using the algorithm specified in recipient.algorithm.
pub fn seal(
    recipient: &RecipientKey,
    plaintext: &[u8],
    key_id: &str,
    key_epoch: u32,
) -> Result<CryptoEnvelope, CryptoError> {
    match recipient.algorithm.as_str() {
        ALG_X25519 => {
            if recipient.public_key.len() != X25519_ENC_SIZE {
                return Err(CryptoError::InvalidKeyLength);
            }
            seal_x25519(&recipient.public_key, plaintext, key_id, key_epoch)
        }
        ALG_XWING => {
            if recipient.public_key.len() != core::ENCAPSULATION_KEY_SIZE {
                return Err(CryptoError::InvalidKeyLength);
            }
            seal_xwing(&recipient.public_key, plaintext, key_id, key_epoch)
        }
        _ => Err(CryptoError::UnsupportedAlgorithm),
    }
}

/// Opens and decrypts an envelope using the recipient's private key based on env.alg.
pub fn open(
    env: &CryptoEnvelope,
    private_key: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    envelope::validate(env)?;

    match env.alg.as_str() {
        ALG_X25519 => {
            if private_key.len() != X25519_ENC_SIZE {
                return Err(CryptoError::InvalidKeyLength);
            }
            open_x25519(private_key, env)
        }
        ALG_XWING => {
            if private_key.len() != core::DECAPSULATION_KEY_SIZE {
                return Err(CryptoError::InvalidKeyLength);
            }
            open_xwing(private_key, env)
        }
        _ => Err(CryptoError::UnsupportedAlgorithm),
    }
}
