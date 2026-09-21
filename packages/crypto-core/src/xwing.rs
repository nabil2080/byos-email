use ml_kem::{
    kem::{Decapsulate, Encapsulate},
    DecapsulationKey768, EncapsulationKey768,
};
use sha3::{
    digest::{ExtendableOutput, XofReader},
    Digest, Sha3_256, Shake256,
};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::CryptoError;

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

pub fn combine(
    ss_m: &[u8],
    ss_x: &[u8],
    ct_x: &[u8],
    pk_x: &[u8],
) -> Result<[u8; 32], CryptoError> {
    if ss_m.len() != SHARED_SECRET_SIZE
        || ss_x.len() != SHARED_SECRET_SIZE
        || ct_x.len() != X25519_POINT_SIZE
        || pk_x.len() != X25519_POINT_SIZE
    {
        return Err(CryptoError::InvalidHPKE);
    }

    let mut hasher = Sha3_256::new();
    hasher.update(ss_m);
    hasher.update(ss_x);
    hasher.update(ct_x);
    hasher.update(pk_x);
    hasher.update(X_WING_LABEL);
    Ok(hasher.finalize().into())
}

pub fn expand_decapsulation_key(
    sk_seed: &[u8],
) -> Result<(MlKem768Sk, X25519Sk, MlKem768Pk, X25519Pk), CryptoError> {
    if sk_seed.len() != DECAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidFormat);
    }

    let mut hasher = Shake256::default();
    sha3::digest::Update::update(&mut hasher, sk_seed);
    let mut reader = hasher.finalize_xof();
    let mut expanded = [0u8; 96];
    reader.read(&mut expanded);

    let seed_64: [u8; 64] = expanded[0..64]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let dk_m = DecapsulationKey768::from_seed(seed_64.into());
    let ek_m = dk_m.encapsulation_key().clone();

    let sk_x_bytes: [u8; 32] = expanded[64..96]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let sk_x = StaticSecret::from(sk_x_bytes);
    let pk_x = PublicKey::from(&sk_x);

    Ok((dk_m, sk_x, ek_m, pk_x))
}

pub fn decapsulate(sk_seed: &[u8], enc: &[u8]) -> Result<[u8; 32], CryptoError> {
    if enc.len() != CIPHERTEXT_SIZE {
        return Err(CryptoError::InvalidHPKE);
    }

    let (dk_m, sk_x, _ek_m, pk_x) = expand_decapsulation_key(sk_seed)?;
    let ct_m_bytes: [u8; MLKEM768_CIPHERTEXT_SIZE] = enc[0..MLKEM768_CIPHERTEXT_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidHPKE)?;
    let ct_x_bytes: [u8; X25519_POINT_SIZE] = enc[MLKEM768_CIPHERTEXT_SIZE..CIPHERTEXT_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidHPKE)?;

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

pub fn encapsulate(pk: &[u8]) -> Result<(Vec<u8>, [u8; 32]), CryptoError> {
    if pk.len() != ENCAPSULATION_KEY_SIZE {
        return Err(CryptoError::InvalidFormat);
    }

    let pk_m_bytes: [u8; MLKEM768_ENCAPSULATION_KEY_SIZE] = pk[0..MLKEM768_ENCAPSULATION_KEY_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let pk_x_bytes: [u8; X25519_POINT_SIZE] = pk[MLKEM768_ENCAPSULATION_KEY_SIZE..]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;

    let ek_m =
        EncapsulationKey768::new(&pk_m_bytes.into()).map_err(|_| CryptoError::InvalidHPKE)?;
    let (ct_m, ss_m) = ek_m.encapsulate();

    let mut rng = rand::rng();
    let ek_x = StaticSecret::random_from_rng(&mut rng);
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

pub fn encapsulate_deterministic(
    pk: &[u8],
    eseed: &[u8],
) -> Result<(Vec<u8>, [u8; 32]), CryptoError> {
    if pk.len() != ENCAPSULATION_KEY_SIZE || eseed.len() != 64 {
        return Err(CryptoError::InvalidFormat);
    }

    let pk_m_bytes: [u8; MLKEM768_ENCAPSULATION_KEY_SIZE] = pk[0..MLKEM768_ENCAPSULATION_KEY_SIZE]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let pk_x_bytes: [u8; X25519_POINT_SIZE] = pk[MLKEM768_ENCAPSULATION_KEY_SIZE..]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let m_seed: [u8; 32] = eseed[0..32]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let x_seed: [u8; 32] = eseed[32..64]
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;

    let ek_m =
        EncapsulationKey768::new(&pk_m_bytes.into()).map_err(|_| CryptoError::InvalidHPKE)?;
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

pub fn public_key_from_seed(sk_seed: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use ml_kem::KeyExport;

    let (_dk_m, _sk_x, ek_m, pk_x) = expand_decapsulation_key(sk_seed)?;
    let mut pk = Vec::with_capacity(ENCAPSULATION_KEY_SIZE);
    pk.extend_from_slice(ek_m.to_bytes().as_slice());
    pk.extend_from_slice(pk_x.as_bytes());
    Ok(pk)
}
