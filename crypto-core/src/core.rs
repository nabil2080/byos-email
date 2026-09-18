use crate::error::CryptoError;
use ml_kem::{
    kem::{Decapsulate, Encapsulate},
    DecapsulationKey768, EncapsulationKey768,
};
use sha3::{
    digest::{ExtendableOutput, XofReader},
    Digest, Sha3_256, Shake256,
};
use x25519_dalek::{PublicKey, StaticSecret};

pub const DECAPSULATION_KEY_SIZE: usize = 32;
pub const ENCAPSULATION_KEY_SIZE: usize = 1216;
pub const CIPHERTEXT_SIZE: usize = 1120;
pub const SHARED_SECRET_SIZE: usize = 32;
pub const MLKEM768_ENCAPSULATION_KEY_SIZE: usize = 1184;
pub const MLKEM768_CIPHERTEXT_SIZE: usize = 1088;
pub const X25519_POINT_SIZE: usize = 32;

pub const X_WING_LABEL: [u8; 6] = [0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c];

pub type MlKem768Sk = DecapsulationKey768;
pub type X25519Sk = StaticSecret;
pub type MlKem768Pk = EncapsulationKey768;
pub type X25519Pk = PublicKey;

/// combine implements the verbatim X-Wing combiner from draft-connolly-cfrg-xwing-kem §5.3:
/// SHA3-256(ss_M || ss_X || ct_X || pk_X || XWingLabel)
pub fn combine(ss_m: &[u8], ss_x: &[u8], ct_x: &[u8], pk_x: &[u8]) -> Result<[u8; 32], CryptoError> {
    if ss_m.len() != SHARED_SECRET_SIZE
        || ss_x.len() != SHARED_SECRET_SIZE
        || ct_x.len() != X25519_POINT_SIZE
        || pk_x.len() != X25519_POINT_SIZE
    {
        return Err(CryptoError::DecapsulationFailed);
    }

    let mut hasher = Sha3_256::new();
    Digest::update(&mut hasher, ss_m);
    Digest::update(&mut hasher, ss_x);
    Digest::update(&mut hasher, ct_x);
    Digest::update(&mut hasher, pk_x);
    Digest::update(&mut hasher, &X_WING_LABEL);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    Ok(out)
}

/// expand_decapsulation_key expands a 32-byte seed into ML-KEM-768 and X25519 keypairs
/// per draft-connolly-cfrg-xwing-kem §5.2:
///   expanded = SHAKE256(sk, 96*8)
///   (pk_M, sk_M) = ML-KEM-768.KeyGen_internal(expanded[0:32], expanded[32:64])
///   sk_X = expanded[64:96]
///   pk_X = X25519(sk_X, X25519_BASE)
pub fn expand_decapsulation_key(
    sk_seed: &[u8],
) -> Result<(MlKem768Sk, X25519Sk, MlKem768Pk, X25519Pk), CryptoError> {
    if sk_seed.len() != DECAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }

    let mut hasher = Shake256::default();
    sha3::digest::Update::update(&mut hasher, sk_seed);
    let mut reader = hasher.finalize_xof();
    let mut expanded = [0u8; 96];
    reader.read(&mut expanded);

    let seed_64: [u8; 64] = expanded[0..64]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let dk_m = DecapsulationKey768::from_seed(seed_64.into());
    let ek_m = dk_m.encapsulation_key().clone();

    let sk_x_bytes: [u8; 32] = expanded[64..96]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let sk_x = StaticSecret::from(sk_x_bytes);
    let pk_x = PublicKey::from(&sk_x);

    Ok((dk_m, sk_x, ek_m, pk_x))
}

/// decapsulate decapsulates an X-Wing ciphertext (1120 bytes) using recipient seed (32 bytes).
pub fn decapsulate(sk_seed: &[u8], enc: &[u8]) -> Result<[u8; 32], CryptoError> {
    if enc.len() != CIPHERTEXT_SIZE {
        return Err(CryptoError::DecapsulationFailed);
    }

    let (dk_m, sk_x, _ek_m, pk_x) = expand_decapsulation_key(sk_seed)?;

    let ct_m_bytes: [u8; MLKEM768_CIPHERTEXT_SIZE] = enc[0..MLKEM768_CIPHERTEXT_SIZE]
        .try_into()
        .map_err(|_| CryptoError::DecapsulationFailed)?;
    let ct_x_bytes: [u8; X25519_POINT_SIZE] = enc[MLKEM768_CIPHERTEXT_SIZE..CIPHERTEXT_SIZE]
        .try_into()
        .map_err(|_| CryptoError::DecapsulationFailed)?;

    let ss_m = dk_m.decapsulate(&ct_m_bytes.into());

    let pub_x = PublicKey::from(ct_x_bytes);
    let ss_x = sk_x.diffie_hellman(&pub_x);

    combine(
        ss_m.as_slice(),
        ss_x.as_bytes(),
        &ct_x_bytes,
        pk_x.as_bytes(),
    )
}

/// encapsulate encapsulates a fresh shared secret for the 1216-byte X-Wing public key.
pub fn encapsulate(pk: &[u8]) -> Result<(Vec<u8>, [u8; 32]), CryptoError> {
    if pk.len() != ENCAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }

    let pk_m_bytes: [u8; MLKEM768_ENCAPSULATION_KEY_SIZE] = pk[0..MLKEM768_ENCAPSULATION_KEY_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let pk_x_bytes: [u8; X25519_POINT_SIZE] = pk[MLKEM768_ENCAPSULATION_KEY_SIZE..ENCAPSULATION_KEY_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let ek_m = EncapsulationKey768::new(&pk_m_bytes.into())
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let (ct_m, ss_m) = ek_m.encapsulate();

    let ek_x = StaticSecret::random_from_rng(&mut rand_core::OsRng);
    let ct_x = PublicKey::from(&ek_x);

    let pub_x = PublicKey::from(pk_x_bytes);
    let ss_x = ek_x.diffie_hellman(&pub_x);

    let ss_combined = combine(
        ss_m.as_slice(),
        ss_x.as_bytes(),
        ct_x.as_bytes(),
        &pk_x_bytes,
    )?;

    let mut enc = Vec::with_capacity(CIPHERTEXT_SIZE);
    enc.extend_from_slice(ct_m.as_slice());
    enc.extend_from_slice(ct_x.as_bytes());

    Ok((enc, ss_combined))
}

/// encapsulate_deterministic encapsulates using explicit randomness for testing parity.
pub fn encapsulate_deterministic(pk: &[u8], eseed: &[u8]) -> Result<(Vec<u8>, [u8; 32]), CryptoError> {
    if pk.len() != ENCAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidKeyLength);
    }
    if eseed.len() != 64 {
        return Err(CryptoError::InvalidKeyLength);
    }

    let pk_m_bytes: [u8; MLKEM768_ENCAPSULATION_KEY_SIZE] = pk[0..MLKEM768_ENCAPSULATION_KEY_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let pk_x_bytes: [u8; X25519_POINT_SIZE] = pk[MLKEM768_ENCAPSULATION_KEY_SIZE..ENCAPSULATION_KEY_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let m_seed: [u8; 32] = eseed[0..32].try_into().map_err(|_| CryptoError::InvalidKeyLength)?;
    let x_seed: [u8; 32] = eseed[32..64].try_into().map_err(|_| CryptoError::InvalidKeyLength)?;

    let ek_m = EncapsulationKey768::new(&pk_m_bytes.into())
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let (ct_m, ss_m) = ek_m.encapsulate_deterministic(&m_seed.into());

    let ek_x = StaticSecret::from(x_seed);
    let ct_x = PublicKey::from(&ek_x);

    let pub_x = PublicKey::from(pk_x_bytes);
    let ss_x = ek_x.diffie_hellman(&pub_x);

    let ss_combined = combine(
        ss_m.as_slice(),
        ss_x.as_bytes(),
        ct_x.as_bytes(),
        &pk_x_bytes,
    )?;

    let mut enc = Vec::with_capacity(CIPHERTEXT_SIZE);
    enc.extend_from_slice(ct_m.as_slice());
    enc.extend_from_slice(ct_x.as_bytes());

    Ok((enc, ss_combined))
}
