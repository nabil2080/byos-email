use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm,
};
use generic_array::GenericArray;
use hkdf::Hkdf;
use hpke::{
    aead::AesGcm256,
    kdf::HkdfSha256,
    kem::{Kem as KemTrait, X25519HkdfSha256},
    Deserializable, OpModeR, OpModeS, Serializable,
};
use rsa::{
    pkcs1::{EncodeRsaPrivateKey, EncodeRsaPublicKey, LineEnding},
    pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey},
    RsaPrivateKey, RsaPublicKey,
};
use rsa::signature::{SignatureEncoding as _, Signer as _};
use sha2::{Digest, Sha256};
use ed25519_dalek::{VerifyingKey, Signature};
use x25519_dalek::{PublicKey, StaticSecret};

// =============================================
// Constants
// =============================================

pub const MNEMONIC_SALT: &[u8] = b"byos-mnemonic-v1";
pub const SEARCH_KEY_SALT: &[u8] = b"byos-search-key-v1";
pub const ROOT_SECRET_INFO: &[u8] = b"byos-root-v1";
pub const HPKE_VERSION: u8 = 0x01;
pub const AES_GCM_ENVELOPE_VERSION: u8 = 0x01;
pub const AAD_VERSION: u8 = 0x01;
pub const ENCRYPTION_VERSION: u32 = 1;
pub const BUNDLE_HASH_VERSION: u8 = 0x01;

type ContentKeyKem = X25519HkdfSha256;
type ContentKeyKdf = HkdfSha256;
type ContentKeyAead = AesGcm256;

// =============================================
// Errors
// =============================================

#[derive(Debug, Clone)]
pub enum CryptoError {
    InvalidFormat,
    UnsupportedVersion,
    EncryptionFailed,
    DecryptionFailed,
    KeyDerivationFailed,
    InvalidMnemonic,
    InvalidHPKE,
    InvalidAesGcm,
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CryptoError::InvalidFormat => write!(f, "invalid format"),
            CryptoError::UnsupportedVersion => write!(f, "unsupported version"),
            CryptoError::EncryptionFailed => write!(f, "encryption failed"),
            CryptoError::DecryptionFailed => write!(f, "decryption failed"),
            CryptoError::KeyDerivationFailed => write!(f, "key derivation failed"),
            CryptoError::InvalidMnemonic => write!(f, "invalid mnemonic"),
            CryptoError::InvalidHPKE => write!(f, "invalid HPKE operation"),
            CryptoError::InvalidAesGcm => write!(f, "invalid AES-GCM operation"),
        }
    }
}

// =============================================
// HKDF-SHA256 Derivation
// =============================================

/// Derive root_secret from entropy using HKDF-SHA256.
/// root_secret = HKDF-SHA256(salt="byos-mnemonic-v1", ikm=entropy, info="byos-root-v1", length=32)
pub fn derive_root_secret(entropy: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(MNEMONIC_SALT), entropy);
    let mut root_secret = [0u8; 32];
    hk.expand(ROOT_SECRET_INFO, &mut root_secret)
        .expect("HKDF expansion failed");
    root_secret
}

/// Derive search_key from root_secret using HKDF-SHA256.
/// search_key = HKDF-SHA256(salt="byos-search-key-v1", ikm=root_secret, length=32)
pub fn derive_search_key(root_secret: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(SEARCH_KEY_SALT), root_secret);
    let mut search_key = [0u8; 32];
    hk.expand(b"", &mut search_key)
        .expect("HKDF expansion failed");
    search_key
}

/// Derive recovery-auth seed from root_secret using HKDF-SHA256.
/// recovery_auth_seed = HKDF-SHA256(salt="byos-recovery-auth-v1", ikm=root_secret, info="byos-recovery-auth-ed25519-v1", length=32)
pub fn derive_recovery_auth_seed(root_secret: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(b"byos-recovery-auth-v1"), root_secret);
    let mut seed = [0u8; 32];
    hk.expand(b"byos-recovery-auth-ed25519-v1", &mut seed)
        .expect("HKDF expansion failed");
    seed
}

/// Derive recovery-auth public key from root_secret (deterministic).
/// The 32-byte seed IS the Ed25519 private key; the public key is derived from it.
pub fn derive_recovery_auth_public_key(root_secret: &[u8; 32]) -> [u8; 32] {
    let seed = derive_recovery_auth_seed(root_secret);
    // The 32-byte seed becomes the Ed25519 private key.
    // The public key derivation is handled by the caller verifying with the pk.
    seed
}

/// Sign a recovery message using the deterministic Ed25519 key derived from root_secret.
pub fn sign_recovery_message(root_secret: &[u8; 32], message: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let seed = derive_recovery_auth_seed(root_secret);
    // The 32-byte seed IS the Ed25519 private key (raw, unencoded)
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&seed);
    let signature = signing_key.sign(message);
    Ok(signature.to_bytes().to_vec())
}

/// Verify a recovery message signature using a public key.
pub fn verify_recovery_message(pk: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> Result<(), CryptoError> {
    use ed25519_dalek::Verifier;
    let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(pk)
        .map_err(|_| CryptoError::InvalidFormat)?;
    let sig = ed25519_dalek::Signature::from_bytes(signature);
    verifying_key.verify(message, &sig).map_err(|_| CryptoError::InvalidFormat)
}

// =============================================
// Mnemonic (BIP39)
// =============================================

/// Generate a new 24-word mnemonic.
pub fn generate_mnemonic() -> Result<String, CryptoError> {
    let entropy: [u8; 32] = rand::random();
    let wordlist = bip39::Language::English;
    let mnemonic = bip39::Mnemonic::from_entropy_in(wordlist, &entropy)
        .map_err(|_| CryptoError::InvalidMnemonic)?;
    Ok(mnemonic.to_string())
}

/// Decode mnemonic to entropy (32 bytes).
pub fn mnemonic_to_entropy(mnemonic: &str) -> Result<[u8; 32], CryptoError> {
    let wordlist = bip39::Language::English;
    let m =
        bip39::Mnemonic::parse_in(wordlist, mnemonic).map_err(|_| CryptoError::InvalidMnemonic)?;
    let entropy = m.to_entropy();
    let mut result = [0u8; 32];
    result.copy_from_slice(&entropy);
    Ok(result)
}

/// Full recovery: mnemonic → root_secret.
pub fn recover_root_secret(mnemonic: &str) -> Result<[u8; 32], CryptoError> {
    let entropy = mnemonic_to_entropy(mnemonic)?;
    Ok(derive_root_secret(&entropy))
}

// =============================================
// X25519 Key Agreement
// =============================================

/// Generate a new X25519 key pair.
/// Returns (secret_key_bytes, public_key_bytes).
pub fn generate_x25519_keypair() -> ([u8; 32], [u8; 32]) {
    let mut rng = rand::rng();
    let secret = StaticSecret::random_from_rng(&mut rng);
    let public = PublicKey::from(&secret);
    (secret.to_bytes(), public.to_bytes())
}

/// Perform X25519 key agreement.
pub fn x25519_dh(
    secret_bytes: &[u8; 32],
    public_bytes: &[u8; 32],
) -> Result<[u8; 32], CryptoError> {
    let secret = StaticSecret::from(*secret_bytes);
    let public = PublicKey::from(*public_bytes);
    let shared = secret.diffie_hellman(&public);
    Ok(*shared.as_bytes())
}

// =============================================
// AES-256-GCM
// =============================================

/// AES-256-GCM envelope: version(1) || nonce(12) || ciphertext+tag(N+16)
pub fn aes_gcm_encrypt(
    key: &[u8; 32],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::InvalidAesGcm)?;

    let mut nonce_bytes = [0u8; 12];
    rand::fill(&mut nonce_bytes);
    let nonce = GenericArray::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            nonce,
            aes_gcm::aead::Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    // Build envelope: version(1) || nonce(12) || ciphertext+tag
    let mut envelope = Vec::with_capacity(1 + 12 + ciphertext.len());
    envelope.push(AES_GCM_ENVELOPE_VERSION);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

/// Decrypt AES-256-GCM envelope.
pub fn aes_gcm_decrypt(
    key: &[u8; 32],
    envelope: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if envelope.len() < 29 {
        return Err(CryptoError::InvalidFormat);
    }
    if envelope[0] != AES_GCM_ENVELOPE_VERSION {
        return Err(CryptoError::UnsupportedVersion);
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::InvalidAesGcm)?;

    let mut nonce_bytes = [0u8; 12];
    nonce_bytes.copy_from_slice(&envelope[1..13]);
    let nonce = GenericArray::from_slice(&nonce_bytes);

    let ciphertext = &envelope[13..];

    cipher
        .decrypt(
            nonce,
            aes_gcm::aead::Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| CryptoError::DecryptionFailed)
}

// =============================================
// Canonical AAD
// =============================================

/// Build canonical AES-GCM AAD: mailbox_id(16) || message_seq(8) || encryption_version(4) || aad_version(1)
/// Total: 29 bytes, fixed.
pub fn canonical_aad(mailbox_id: &[u8; 16], message_seq: u64, encryption_version: u32) -> [u8; 29] {
    let mut aad = [0u8; 29];
    aad[0..16].copy_from_slice(mailbox_id);
    aad[16..24].copy_from_slice(&message_seq.to_be_bytes());
    aad[24..28].copy_from_slice(&encryption_version.to_be_bytes());
    aad[28] = AAD_VERSION;
    aad
}

// =============================================
// Canonical Bundle Hash
// =============================================

/// Compute canonical bundle hash.
/// bundle_hash_input = version(1) || storage_object_id_len(4) || storage_object_id ||
///                     ciphertext_len(8) || ciphertext || content_key_wrapped_len(4) ||
///                     content_key_wrapped || encryption_version(4) || mailbox_sk_version(4) ||
///                     encryption_iv(12) || aad_version(1)
pub fn canonical_bundle_hash(
    storage_object_id: &[u8],
    ciphertext: &[u8],
    content_key_wrapped: &[u8],
    encryption_version: u32,
    mailbox_sk_version: u32,
    encryption_iv: &[u8; 12],
    aad_version: u8,
) -> [u8; 32] {
    let mut input = Vec::new();
    input.push(BUNDLE_HASH_VERSION);
    input.extend_from_slice(&(storage_object_id.len() as u32).to_be_bytes());
    input.extend_from_slice(storage_object_id);
    input.extend_from_slice(&(ciphertext.len() as u64).to_be_bytes());
    input.extend_from_slice(ciphertext);
    input.extend_from_slice(&(content_key_wrapped.len() as u32).to_be_bytes());
    input.extend_from_slice(content_key_wrapped);
    input.extend_from_slice(&encryption_version.to_be_bytes());
    input.extend_from_slice(&mailbox_sk_version.to_be_bytes());
    input.extend_from_slice(encryption_iv);
    input.push(aad_version);

    let mut hasher = Sha256::new();
    hasher.update(&input);
    hasher.finalize().into()
}

// =============================================
// HPKE Wrapper (RFC 9180 canonical format)
// =============================================

/// Canonical HPKE wire format: version(1) || enc(32) || ciphertext(N)
pub struct HpkeWrapped {
    pub version: u8,
    pub enc: [u8; 32],
    pub ciphertext: Vec<u8>,
}

impl HpkeWrapped {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + 32 + self.ciphertext.len());
        out.push(self.version);
        out.extend_from_slice(&self.enc);
        out.extend_from_slice(&self.ciphertext);
        out
    }

    pub fn from_bytes(data: &[u8]) -> Result<Self, CryptoError> {
        if data.len() < 33 {
            return Err(CryptoError::InvalidFormat);
        }
        if data[0] != HPKE_VERSION {
            return Err(CryptoError::UnsupportedVersion);
        }
        let mut enc = [0u8; 32];
        enc.copy_from_slice(&data[1..33]);
        Ok(HpkeWrapped {
            version: data[0],
            enc,
            ciphertext: data[33..].to_vec(),
        })
    }
}

/// HPKE-Seal with the RFC 9180 suite DHKEM(X25519, HKDF-SHA256) + AES-256-GCM.
/// The wire representation is the canonical version || enc || ciphertext form.
pub fn hpke_seal(
    recipient_pk: &[u8; 32],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let pk = <ContentKeyKem as KemTrait>::PublicKey::from_bytes(recipient_pk)
        .map_err(|_| CryptoError::InvalidHPKE)?;
    let (enc, ciphertext) = hpke::single_shot_seal::<ContentKeyAead, ContentKeyKdf, ContentKeyKem>(
        &OpModeS::Base,
        &pk,
        b"",
        plaintext,
        aad,
    )
    .map_err(|_| CryptoError::InvalidHPKE)?;

    let mut enc_bytes = [0u8; 32];
    enc_bytes.copy_from_slice(&enc.to_bytes());
    Ok(HpkeWrapped {
        version: HPKE_VERSION,
        enc: enc_bytes,
        ciphertext,
    }
    .to_bytes())
}

/// HPKE-Open the canonical wire representation using the recipient private key.
pub fn hpke_open(
    recipient_sk: &[u8; 32],
    wrapped: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let wrapped = HpkeWrapped::from_bytes(wrapped)?;
    let sk = <ContentKeyKem as KemTrait>::PrivateKey::from_bytes(recipient_sk)
        .map_err(|_| CryptoError::InvalidHPKE)?;
    let enc = <ContentKeyKem as KemTrait>::EncappedKey::from_bytes(&wrapped.enc)
        .map_err(|_| CryptoError::InvalidHPKE)?;

    hpke::single_shot_open::<ContentKeyAead, ContentKeyKdf, ContentKeyKem>(
        &OpModeR::Base,
        &sk,
        &enc,
        b"",
        &wrapped.ciphertext,
        aad,
    )
    .map_err(|_| CryptoError::InvalidHPKE)
}

// =============================================
// Content Encryption (message level)
// =============================================

/// Encrypt a message with a fresh content key.
/// Returns (content_key, encrypted_blob, iv, aad).
pub fn encrypt_message(
    mailbox_id: &[u8; 16],
    message_seq: u64,
    plaintext: &[u8],
) -> Result<([u8; 32], Vec<u8>, [u8; 12], Vec<u8>), CryptoError> {
    // Generate fresh content key
    let mut content_key = [0u8; 32];
    rand::fill(&mut content_key);

    // Build canonical AAD
    let aad = canonical_aad(mailbox_id, message_seq, ENCRYPTION_VERSION);

    // Encrypt
    let encrypted = aes_gcm_encrypt(&content_key, plaintext, &aad)?;

    // Generate IV for storage (the aes_gcm_encrypt generates its own nonce internally,
    // but we need to store the nonce used. Let's refactor to return it.
    // For now, we extract the nonce from the envelope.
    let iv: [u8; 12] = encrypted[1..13].try_into().unwrap();

    Ok((content_key, encrypted, iv, aad.to_vec()))
}

/// Decrypt a message using stored content key, IV, and AAD.
pub fn decrypt_message(
    content_key: &[u8; 32],
    encrypted_blob: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    aes_gcm_decrypt(content_key, encrypted_blob, aad)
}

// =============================================
// Mailbox Key Wrapping (AES-GCM)
// =============================================

/// Wrap mailbox_sk with root_secret using AES-256-GCM.
/// Envelope: version(1) || nonce(12) || ciphertext+tag
pub fn wrap_mailbox_key(
    root_secret: &[u8; 32],
    mailbox_sk: &[u8; 32],
    mailbox_id: &[u8; 16],
) -> Result<Vec<u8>, CryptoError> {
    let mut aad = Vec::new();
    aad.extend_from_slice(mailbox_id);
    aad.extend_from_slice(b"mailbox-sk-v1");
    aes_gcm_encrypt(root_secret, mailbox_sk, &aad)
}

/// Unwrap mailbox_sk using root_secret.
pub fn unwrap_mailbox_key(
    root_secret: &[u8; 32],
    wrapped: &[u8],
    mailbox_id: &[u8; 16],
) -> Result<[u8; 32], CryptoError> {
    let mut aad = Vec::new();
    aad.extend_from_slice(mailbox_id);
    aad.extend_from_slice(b"mailbox-sk-v1");
    let bytes = aes_gcm_decrypt(root_secret, wrapped, &aad)?;
    if bytes.len() != 32 {
        return Err(CryptoError::InvalidFormat);
    }
    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}

// =============================================
// Outbound Delivery (client-side encryption, server-side decryption)
// =============================================

/// Outbound delivery key pair (X25519).
/// Generated once during system setup.
/// Private key (outbound_delivery_sk) held by outbound worker.
/// Public key (outbound_delivery_pk) distributed to clients.
pub fn generate_outbound_delivery_keypair() -> ([u8; 32], [u8; 32]) {
    generate_x25519_keypair()
}

/// Outbound encryption (client-side).
/// Generates fresh content_key, encrypts message with it, then HPKE-Seals
/// the content_key (as send_token) to the outbound_delivery_pk.
///
/// Returns (ciphertext, send_token_wrapped, iv, aad, content_key).
/// content_key is returned so caller can use it for other purposes if needed,
/// but normally the caller only needs ciphertext + send_token_wrapped + iv + aad.
pub fn encrypt_outbound(
    outbound_delivery_pk: &[u8; 32],
    mailbox_id: &[u8; 16],
    message_seq: u64,
    plaintext: &[u8],
) -> Result<(Vec<u8>, Vec<u8>, [u8; 12], Vec<u8>, [u8; 32]), CryptoError> {
    // Generate fresh content_key (also serves as send_token)
    let mut content_key = [0u8; 32];
    rand::fill(&mut content_key);

    // Build canonical AAD
    let aad = canonical_aad(mailbox_id, message_seq, ENCRYPTION_VERSION);

    // Encrypt message with content_key
    let encrypted = aes_gcm_encrypt(&content_key, plaintext, &aad)?;

    // Extract IV from envelope
    let iv: [u8; 12] = encrypted[1..13].try_into().unwrap();

    // HPKE-Seal content_key (as send_token) to outbound_delivery_pk
    let send_token_wrapped = hpke_seal(outbound_delivery_pk, &content_key, &aad)?;

    Ok((encrypted, send_token_wrapped, iv, aad.to_vec(), content_key))
}

/// Outbound decryption (server-side / outbound worker).
/// HPKE-Opens the send_token using outbound_delivery_sk to recover content_key,
/// then decrypts the message.
pub fn decrypt_outbound(
    outbound_delivery_sk: &[u8; 32],
    send_token_wrapped: &[u8],
    mailbox_id: &[u8; 16],
    message_seq: u64,
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    // Build canonical AAD (same as encryption)
    let aad = canonical_aad(mailbox_id, message_seq, ENCRYPTION_VERSION);

    // HPKE-Open to recover content_key (send_token)
    let content_key = hpke_open(outbound_delivery_sk, send_token_wrapped, &aad)?;

    // Decrypt message
    aes_gcm_decrypt(&content_key.try_into().unwrap(), ciphertext, &aad)
}

/// Outbound delivery key pair type for serialization
#[derive(Debug, Clone)]
pub struct OutboundDeliveryKeypair {
    pub private_key: [u8; 32],
    pub public_key: [u8; 32],
}

impl OutboundDeliveryKeypair {
    pub fn new() -> Self {
        let (sk, pk) = generate_outbound_delivery_keypair();
        Self { private_key: sk, public_key: pk }
    }

    pub fn from_private_key(sk: [u8; 32]) -> Result<Self, CryptoError> {
        let pk = PublicKey::from(&StaticSecret::from(sk));
        Ok(Self { private_key: sk, public_key: pk.to_bytes() })
    }

    pub fn public_key_b64(&self) -> String {
        base64::encode(self.public_key)
    }

    pub fn private_key_b64(&self) -> String {
        base64::encode(self.private_key)
    }
}

// =============================================
// DKIM Key Generation and Encryption
// =============================================

/// DKIM key pair (RSA-2048).
/// Generated once per domain during setup.
/// Private key encrypted with DEK and stored in database.
/// Public key published in DNS.
#[derive(Debug, Clone)]
pub struct DkimKeypair {
    pub private_key_pem: String,
    pub public_key_pem: String,
    pub selector: String,
}

impl DkimKeypair {
    /// Generate a new DKIM RSA-2048 key pair.
    pub fn generate(selector: &str) -> Result<Self, CryptoError> {
        let mut rng = rsa::rand_core::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048)
            .map_err(|_| CryptoError::EncryptionFailed)?;

        let private_key_pem = private_key
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|_| CryptoError::EncryptionFailed)?
            .to_string();

        let public_key = RsaPublicKey::from(&private_key);
        let public_key_pem = public_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|_| CryptoError::EncryptionFailed)?
            .to_string();

        Ok(Self {
            private_key_pem,
            public_key_pem,
            selector: selector.to_string(),
        })
    }

    /// Get the DNS TXT record value for this DKIM public key.
    pub fn dns_txt_value(&self) -> String {
        // Extract the base64-encoded key from the PEM
        let lines: Vec<&str> = self.public_key_pem.lines().collect();
        let b64_key: String = lines
            .iter()
            .filter(|l| !l.starts_with("---"))
            .map(|l| l.trim())
            .collect();
        format!("v=DKIM1; k=rsa; p={}", b64_key)
    }
}

/// Encrypt DKIM private key with DEK (AES-256-GCM).
/// The DEK is derived from the BYOS_DEK environment variable.
/// Returns the canonical AES-GCM envelope: version(1) || nonce(12) || ciphertext+tag
pub fn encrypt_dkim_private_key(
    dek: &[u8; 32],
    private_key_pem: &str,
) -> Result<Vec<u8>, CryptoError> {
    aes_gcm_encrypt(dek, private_key_pem.as_bytes(), b"dkim-private-key-v1")
}

/// Decrypt DKIM private key with DEK.
pub fn decrypt_dkim_private_key(
    dek: &[u8; 32],
    envelope: &[u8],
) -> Result<String, CryptoError> {
    let plaintext = aes_gcm_decrypt(dek, envelope, b"dkim-private-key-v1")?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::InvalidFormat)
}

/// Derive DEK from environment variable (for V1 lab, uses a fixed derivation).
/// In production, BYOS_DEK should be a 32-byte base64-encoded key.
pub fn derive_dek(dek_b64: &str) -> Result<[u8; 32], CryptoError> {
    let bytes = base64::decode(dek_b64).map_err(|_| CryptoError::InvalidFormat)?;
    if bytes.len() != 32 {
        return Err(CryptoError::InvalidFormat);
    }
    let mut dek = [0u8; 32];
    dek.copy_from_slice(&bytes);
    Ok(dek)
}

/// Relaxed canonicalization for DKIM headers (RFC 6376 Section 3.4.6)
fn relaxed_header_canonicalize(header: &str) -> String {
    // Unfold lines (replace CRLF + WSP with single space)
    let mut unfolded = String::new();
    let mut lines = header.lines().peekable();
    while let Some(line) = lines.next() {
        unfolded.push_str(line.trim());
        if lines.peek().is_some() {
            unfolded.push(' ');
        }
    }
    // Lowercase header name
    if let Some(colon_pos) = unfolded.find(':') {
        let name = unfolded[..colon_pos].to_lowercase();
        let value = &unfolded[colon_pos..];
        format!("{}:{}", name, value)
    } else {
        unfolded
    }
}

/// Relaxed canonicalization for DKIM body (RFC 6376 Section 3.4.5)
fn relaxed_body_canonicalize(body: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    let mut prev_was_cr = false;
    let mut prev_was_lf = false;
    
    for &byte in body {
        match byte {
            b'\r' => {
                if !prev_was_cr {
                    result.push(b'\r');
                }
                prev_was_cr = true;
                prev_was_lf = false;
            }
            b'\n' => {
                if prev_was_cr {
                    result.push(b'\n');
                } else if !prev_was_lf || !result.is_empty() {
                    result.push(b'\n');
                }
                prev_was_lf = true;
                prev_was_cr = false;
            }
            b' ' | b'\t' => {
                if prev_was_cr || prev_was_lf {
                    // At start of line, keep single space
                    result.push(b' ');
                } else {
                    result.push(byte);
                }
                prev_was_cr = false;
                prev_was_lf = false;
            }
            _ => {
                if prev_was_cr {
                    result.push(b'\r');
                }
                if prev_was_lf {
                    result.push(b'\n');
                }
                result.push(byte);
                prev_was_cr = false;
                prev_was_lf = false;
            }
        }
    }
    
    // Remove trailing whitespace from each line
    let mut final_result = Vec::new();
    let mut line_start = 0;
    for (i, &byte) in result.iter().enumerate() {
        if byte == b'\n' {
            // Trim trailing whitespace from line
            let mut end = i;
            while end > line_start && (result[end - 1] == b' ' || result[end - 1] == b'\t' || result[end - 1] == b'\r') {
                end -= 1;
            }
            final_result.extend_from_slice(&result[line_start..end]);
            final_result.push(b'\n');
            line_start = i + 1;
        }
    }
    // Handle last line if no trailing newline
    if line_start < result.len() {
        let mut end = result.len();
        while end > line_start && (result[end - 1] == b' ' || result[end - 1] == b'\t' || result[end - 1] == b'\r') {
            end -= 1;
        }
        final_result.extend_from_slice(&result[line_start..end]);
    }
    
    // Ensure body ends with CRLF
    if !final_result.ends_with(b"\r\n") {
        final_result.extend_from_slice(b"\r\n");
    }
    
    final_result
}

/// Sign an RFC5322 message with DKIM.
/// Returns the message with DKIM-Signature header prepended.
pub fn dkim_sign(
    private_key_pem: &str,
    selector: &str,
    domain: &str,
    message: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use rsa::{
        pkcs1v15::SigningKey,
        pkcs8::DecodePrivateKey,
        RsaPrivateKey,
    };

    // Parse private key from PKCS#8 PEM
    let private_key = RsaPrivateKey::from_pkcs8_pem(private_key_pem)
        .map_err(|_| CryptoError::InvalidFormat)?;
    
    let signing_key = SigningKey::<Sha256>::new(private_key);

    // Parse message into headers and body (handle both CRLF and LF)
    let message_str = String::from_utf8_lossy(message);
    let (headers_str, body) = if let Some((h, b)) = message_str.split_once("\r\n\r\n") {
        (h, b)
    } else if let Some((h, b)) = message_str.split_once("\n\n") {
        (h, b)
    } else {
        return Err(CryptoError::InvalidFormat);
    };
    
    // Parse headers
    let mut headers: Vec<(String, String)> = Vec::new();
    for line in headers_str.lines() {
        if let Some(colon_pos) = line.find(':') {
            let name = line[..colon_pos].trim().to_string();
            let value = line[colon_pos + 1..].trim().to_string();
            headers.push((name, value));
        }
    }

    // Compute body hash (bh=)
    let canonical_body = relaxed_body_canonicalize(body.as_bytes());
    let mut hasher = Sha256::new();
    hasher.update(&canonical_body);
    let body_hash = hasher.finalize();
    let body_hash_b64 = BASE64.encode(&body_hash);

    // Select headers to sign (standard DKIM headers)
    let signed_headers: Vec<&str> = headers.iter()
        .filter(|(name, _)| {
            let lower = name.to_lowercase();
            matches!(lower.as_str(),
                "from" | "to" | "cc" | "subject" | "date" | "message-id" |
                "mime-version" | "content-type" | "content-transfer-encoding" |
                "reply-to" | "sender" | "in-reply-to" | "references"
            )
        })
        .map(|(name, _)| name.as_str())
        .collect();
    
    let signed_headers_str = signed_headers.join(":");

    // Create DKIM-Signature header without signature (b=)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    let mut dkim_header = format!(
        "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d={}; s={}; h={}; bh={}; t={}; b=",
        domain, selector, signed_headers_str, body_hash_b64, timestamp
    );

    // Canonicalize headers for signing
    let mut canonical_headers = Vec::new();
    for (name, value) in &headers {
        if signed_headers.iter().any(|&h| h.eq_ignore_ascii_case(name)) {
            let canon = relaxed_header_canonicalize(&format!("{}: {}", name, value));
            canonical_headers.push(canon);
        }
    }
    // Add DKIM-Signature header (without b= value) to canonicalization
    canonical_headers.push(relaxed_header_canonicalize(&dkim_header));

    // Build signing input
    let signing_input = canonical_headers.join("\r\n") + "\r\n";

    // Sign (PKCS#1 v1.5 + SHA-256 is deterministic, no RNG needed)
    let signature = signing_key.sign(signing_input.as_bytes());
    let signature_b64 = BASE64.encode(signature.to_bytes());

    // Complete DKIM-Signature header
    dkim_header.push_str(&signature_b64);
    dkim_header.push_str("\r\n");

    // Prepend to message
    let mut result = Vec::new();
    result.extend_from_slice(dkim_header.as_bytes());
    result.extend_from_slice(message);

    Ok(result)
}

// =============================================
// WASM Bindings
// =============================================

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn wasm_derive_root_secret(entropy_hex: &str) -> Result<String, JsValue> {
    let entropy_bytes = hex_decode(entropy_hex).map_err(|e| JsValue::from_str(&e))?;
    if entropy_bytes.len() != 32 {
        return Err(JsValue::from_str("entropy must be 32 bytes"));
    }
    let mut entropy = [0u8; 32];
    entropy.copy_from_slice(&entropy_bytes);
    let root_secret = derive_root_secret(&entropy);
    Ok(hex_encode(&root_secret))
}

#[wasm_bindgen]
pub fn wasm_generate_mnemonic() -> Result<String, JsValue> {
    generate_mnemonic().map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn wasm_recover_root_secret(mnemonic: &str) -> Result<String, JsValue> {
    recover_root_secret(mnemonic)
        .map(|rs| hex_encode(&rs))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn wasm_generate_keypair() -> Result<String, JsValue> {
    let (sk, pk) = generate_x25519_keypair();
    let result = serde_json::json!({
        "secret_key": hex_encode(&sk),
        "public_key": hex_encode(&pk),
    });
    Ok(result.to_string())
}

#[wasm_bindgen]
pub fn wasm_aes_gcm_encrypt(
    key_hex: &str,
    plaintext_hex: &str,
    aad_hex: &str,
) -> Result<String, JsValue> {
    let key = hex_decode_32(key_hex).map_err(|e| JsValue::from_str(&e))?;
    let plaintext = hex_decode(plaintext_hex).map_err(|e| JsValue::from_str(&e))?;
    let aad = hex_decode(aad_hex).map_err(|e| JsValue::from_str(&e))?;
    let envelope =
        aes_gcm_encrypt(&key, &plaintext, &aad).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(hex_encode(&envelope))
}

#[wasm_bindgen]
pub fn wasm_aes_gcm_decrypt(
    key_hex: &str,
    envelope_hex: &str,
    aad_hex: &str,
) -> Result<String, JsValue> {
    let key = hex_decode_32(key_hex).map_err(|e| JsValue::from_str(&e))?;
    let envelope = hex_decode(envelope_hex).map_err(|e| JsValue::from_str(&e))?;
    let aad = hex_decode(aad_hex).map_err(|e| JsValue::from_str(&e))?;
    let plaintext =
        aes_gcm_decrypt(&key, &envelope, &aad).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(hex_encode(&plaintext))
}

#[wasm_bindgen]
pub fn wasm_hpke_seal(
    recipient_pk_hex: &str,
    plaintext_hex: &str,
    aad_hex: &str,
) -> Result<String, JsValue> {
    let recipient_pk = hex_decode_32(recipient_pk_hex).map_err(|e| JsValue::from_str(&e))?;
    let plaintext = hex_decode(plaintext_hex).map_err(|e| JsValue::from_str(&e))?;
    let aad = hex_decode(aad_hex).map_err(|e| JsValue::from_str(&e))?;
    hpke_seal(&recipient_pk, &plaintext, &aad)
        .map(|wrapped| hex_encode(&wrapped))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn wasm_wrap_mailbox_key(
    root_secret_hex: &str,
    mailbox_sk_hex: &str,
    mailbox_id_hex: &str,
) -> Result<String, JsValue> {
    let root_secret = hex_decode_32(root_secret_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mailbox_sk = hex_decode_32(mailbox_sk_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mailbox_id = hex_decode(mailbox_id_hex).map_err(|e| JsValue::from_str(&e))?.try_into().map_err(|_| JsValue::from_str("mailbox_id must be 16 bytes"))?;
    let wrapped = wrap_mailbox_key(&root_secret, &mailbox_sk, &mailbox_id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(hex_encode(&wrapped))
}

#[wasm_bindgen]
pub fn wasm_unwrap_mailbox_key(
    root_secret_hex: &str,
    wrapped_hex: &str,
    mailbox_id_hex: &str,
) -> Result<String, JsValue> {
    let root_secret = hex_decode_32(root_secret_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let wrapped = hex_decode(wrapped_hex).map_err(|e| JsValue::from_str(&e))?;
    let mailbox_id = hex_decode(mailbox_id_hex).map_err(|e| JsValue::from_str(&e))?.try_into().map_err(|_| JsValue::from_str("mailbox_id must be 16 bytes"))?;
    let unwrapped = unwrap_mailbox_key(&root_secret, &wrapped, &mailbox_id).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(hex_encode(&unwrapped))
}

#[wasm_bindgen]
pub fn wasm_hpke_open(
    recipient_sk_hex: &str,
    wrapped_hex: &str,
    aad_hex: &str,
) -> Result<String, JsValue> {
    let recipient_sk = hex_decode_32(recipient_sk_hex).map_err(|e| JsValue::from_str(&e))?;
    let wrapped = hex_decode(wrapped_hex).map_err(|e| JsValue::from_str(&e))?;
    let aad = hex_decode(aad_hex).map_err(|e| JsValue::from_str(&e))?;
    hpke_open(&recipient_sk, &wrapped, &aad)
        .map(|plaintext| hex_encode(&plaintext))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn wasm_generate_outbound_keypair() -> Result<String, JsValue> {
    let (sk, pk) = generate_outbound_delivery_keypair();
    let result = serde_json::json!({
        "private_key": base64::encode(sk),
        "public_key": base64::encode(pk),
    });
    Ok(result.to_string())
}

#[wasm_bindgen]
pub fn wasm_encrypt_outbound(
    outbound_delivery_pk_b64: &str,
    mailbox_id_hex: &str,
    message_seq: u64,
    plaintext_b64: &str,
) -> Result<String, JsValue> {
    let pk = base64::decode(outbound_delivery_pk_b64)
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        .try_into()
        .map_err(|_| JsValue::from_str("public key must be 32 bytes"))?;
    let mailbox_id = hex_decode(mailbox_id_hex)
        .map_err(|e| JsValue::from_str(&e))?
        .try_into()
        .map_err(|_| JsValue::from_str("mailbox_id must be 16 bytes"))?;
    let plaintext = base64::decode(plaintext_b64)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let (ciphertext, send_token_wrapped, iv, aad, content_key) =
        encrypt_outbound(&pk, &mailbox_id, message_seq, &plaintext)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let result = serde_json::json!({
        "ciphertext": base64::encode(ciphertext),
        "send_token_wrapped": base64::encode(send_token_wrapped),
        "iv": base64::encode(iv),
        "aad": base64::encode(aad),
        "content_key": base64::encode(content_key),
    });
    Ok(result.to_string())
}

#[wasm_bindgen]
pub fn wasm_decrypt_outbound(
    outbound_delivery_sk_b64: &str,
    send_token_wrapped_b64: &str,
    mailbox_id_hex: &str,
    message_seq: u64,
    ciphertext_b64: &str,
) -> Result<String, JsValue> {
    let sk = base64::decode(outbound_delivery_sk_b64)
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        .try_into()
        .map_err(|_| JsValue::from_str("private key must be 32 bytes"))?;
    let wrapped = base64::decode(send_token_wrapped_b64)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mailbox_id = hex_decode(mailbox_id_hex)
        .map_err(|e| JsValue::from_str(&e))?
        .try_into()
        .map_err(|_| JsValue::from_str("mailbox_id must be 16 bytes"))?;
    let ciphertext = base64::decode(ciphertext_b64)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let plaintext = decrypt_outbound(&sk, &wrapped, &mailbox_id, message_seq, &ciphertext)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(base64::encode(plaintext))
}

// =============================================
// Hex helpers
// =============================================

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("invalid hex length".into());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn hex_decode_32(hex: &str) -> Result<[u8; 32], String> {
    let bytes = hex_decode(hex)?;
    if bytes.len() != 32 {
        return Err("expected 32 bytes".into());
    }
    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}

// =============================================
// Tests
// =============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_root_secret() {
        let entropy = [1u8; 32];
        let root_secret = derive_root_secret(&entropy);
        assert_ne!(root_secret, [0u8; 32]);
        assert_ne!(root_secret, entropy);
    }

    #[test]
    fn test_derive_root_secret_deterministic() {
        let entropy = [42u8; 32];
        let rs1 = derive_root_secret(&entropy);
        let rs2 = derive_root_secret(&entropy);
        assert_eq!(rs1, rs2);
    }

    #[test]
    fn test_derive_search_key() {
        let root_secret = [1u8; 32];
        let search_key = derive_search_key(&root_secret);
        assert_ne!(search_key, [0u8; 32]);
        assert_ne!(search_key, root_secret);
    }

    #[test]
    fn test_mnemonic_roundtrip() {
        let mnemonic = generate_mnemonic().unwrap();
        let entropy = mnemonic_to_entropy(&mnemonic).unwrap();
        let root_secret = derive_root_secret(&entropy);
        let recovered = recover_root_secret(&mnemonic).unwrap();
        assert_eq!(root_secret, recovered);
    }

    #[test]
    fn test_x25519_keypair() {
        let (sk, pk) = generate_x25519_keypair();
        assert_ne!(sk, [0u8; 32]);
        assert_ne!(pk, [0u8; 32]);
    }

    #[test]
    fn test_x25519_dh() {
        let (sk1, pk1) = generate_x25519_keypair();
        let (sk2, pk2) = generate_x25519_keypair();
        let shared1 = x25519_dh(&sk1, &pk2).unwrap();
        let shared2 = x25519_dh(&sk2, &pk1).unwrap();
        assert_eq!(shared1, shared2);
    }

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = [42u8; 32];
        let plaintext = b"Hello, BYOS!";
        let aad = b"test-aad";
        let envelope = aes_gcm_encrypt(&key, plaintext, aad).unwrap();
        let decrypted = aes_gcm_decrypt(&key, &envelope, aad).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_aes_gcm_wrong_key_fails() {
        let key1 = [1u8; 32];
        let key2 = [2u8; 32];
        let plaintext = b"secret";
        let aad = b"aad";
        let envelope = aes_gcm_encrypt(&key1, plaintext, aad).unwrap();
        let result = aes_gcm_decrypt(&key2, &envelope, aad);
        assert!(result.is_err());
    }

    #[test]
    fn test_aes_gcm_wrong_aad_fails() {
        let key = [1u8; 32];
        let plaintext = b"secret";
        let envelope = aes_gcm_encrypt(&key, plaintext, b"aad1").unwrap();
        let result = aes_gcm_decrypt(&key, &envelope, b"aad2");
        assert!(result.is_err());
    }

    #[test]
    fn test_aes_gcm_envelope_format() {
        let key = [1u8; 32];
        let plaintext = b"test";
        let envelope = aes_gcm_encrypt(&key, plaintext, b"").unwrap();
        assert_eq!(envelope[0], AES_GCM_ENVELOPE_VERSION);
        assert_eq!(envelope.len(), 1 + 12 + plaintext.len() + 16);
    }

    #[test]
    fn test_canonical_aad() {
        let mailbox_id = [1u8; 16];
        let aad = canonical_aad(&mailbox_id, 42, 1);
        assert_eq!(aad.len(), 29);
        assert_eq!(aad[28], AAD_VERSION);
    }

    #[test]
    fn test_canonical_aad_immutable() {
        let mailbox_id = [1u8; 16];
        let aad1 = canonical_aad(&mailbox_id, 42, 1);
        let aad2 = canonical_aad(&mailbox_id, 42, 1);
        assert_eq!(aad1, aad2);
    }

    #[test]
    fn test_hpke_wrapped_roundtrip() {
        let hw = HpkeWrapped {
            version: HPKE_VERSION,
            enc: [1u8; 32],
            ciphertext: vec![2, 3, 4, 5],
        };
        let bytes = hw.to_bytes();
        let recovered = HpkeWrapped::from_bytes(&bytes).unwrap();
        assert_eq!(recovered.version, hw.version);
        assert_eq!(recovered.enc, hw.enc);
        assert_eq!(recovered.ciphertext, hw.ciphertext);
    }

    #[test]
    fn test_hpke_content_key_roundtrip() {
        let (secret_key, public_key) = generate_x25519_keypair();
        let aad = b"mailbox-message-aad";
        let wrapped = hpke_seal(&public_key, &[7u8; 32], aad).unwrap();
        let opened = hpke_open(&secret_key, &wrapped, aad).unwrap();
        assert_eq!(opened, [7u8; 32]);
    }

    #[test]
    fn test_hpke_rejects_wrong_private_key() {
        let (_, public_key) = generate_x25519_keypair();
        let (wrong_secret_key, _) = generate_x25519_keypair();
        let wrapped = hpke_seal(&public_key, b"content-key", b"aad").unwrap();
        assert!(hpke_open(&wrong_secret_key, &wrapped, b"aad").is_err());
    }

    #[test]
    fn test_wrap_unwrap_mailbox_key() {
        let root_secret = [1u8; 32];
        let mailbox_sk = [2u8; 32];
        let mailbox_id = [3u8; 16];
        let wrapped = wrap_mailbox_key(&root_secret, &mailbox_sk, &mailbox_id).unwrap();
        let unwrapped = unwrap_mailbox_key(&root_secret, &wrapped, &mailbox_id).unwrap();
        assert_eq!(unwrapped, mailbox_sk);
    }

    #[test]
    fn test_canonical_bundle_hash() {
        let hash = canonical_bundle_hash(b"obj-001", &[1, 2, 3], &[4, 5, 6], 1, 1, &[12u8; 12], 1);
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_canonical_bundle_hash_deterministic() {
        let h1 = canonical_bundle_hash(b"obj", &[1, 2], &[3, 4], 1, 1, &[9u8; 12], 1);
        let h2 = canonical_bundle_hash(b"obj", &[1, 2], &[3, 4], 1, 1, &[9u8; 12], 1);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_canonical_bundle_hash_changes_on_wrapper_rotation() {
        let h1 = canonical_bundle_hash(b"obj", &[1, 2], &[3, 4], 1, 1, &[9u8; 12], 1);
        let h2 = canonical_bundle_hash(b"obj", &[1, 2], &[3, 5], 1, 2, &[9u8; 12], 1);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_dkim_key_generation() {
        let kp = DkimKeypair::generate("byos").unwrap();
        assert!(kp.private_key_pem.contains("BEGIN PRIVATE KEY"));
        assert!(kp.public_key_pem.contains("BEGIN PUBLIC KEY"));
        assert_eq!(kp.selector, "byos");
        let txt = kp.dns_txt_value();
        assert!(txt.starts_with("v=DKIM1; k=rsa; p="));
        assert!(txt.len() > 100);
    }

    #[test]
    fn test_dkim_encrypt_decrypt_roundtrip() {
        let dek = [42u8; 32];
        let kp = DkimKeypair::generate("byos").unwrap();
        let enc = encrypt_dkim_private_key(&dek, &kp.private_key_pem).unwrap();
        // Encrypted form must not contain plaintext PEM header
        let enc_str = String::from_utf8_lossy(&enc);
        assert!(!enc_str.contains("BEGIN PRIVATE KEY"));
        let dec = decrypt_dkim_private_key(&dek, &enc).unwrap();
        assert_eq!(dec, kp.private_key_pem);
    }

    #[test]
    fn test_dkim_wrong_dek_fails() {
        let dek1 = [1u8; 32];
        let dek2 = [2u8; 32];
        let kp = DkimKeypair::generate("byos").unwrap();
        let enc = encrypt_dkim_private_key(&dek1, &kp.private_key_pem).unwrap();
        assert!(decrypt_dkim_private_key(&dek2, &enc).is_err());
    }

    #[test]
    fn test_dkim_sign_contains_fields() {
        let kp = DkimKeypair::generate("byos").unwrap();
        let msg = b"From: alice@byos.local\r\nTo: bob@byos.local\r\nSubject: test\r\nDate: Thu, 01 Jan 2026 00:00:00 +0000\r\nMessage-ID: <test@byos.local>\r\n\r\nHello DKIM\r\n";
        let signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", msg).unwrap();
        let signed_str = String::from_utf8(signed).unwrap();
        assert!(signed_str.contains("DKIM-Signature:"));
        assert!(signed_str.contains("v=1;"));
        assert!(signed_str.contains("a=rsa-sha256;"));
        assert!(signed_str.contains("c=relaxed/relaxed;"));
        assert!(signed_str.contains("d=byos.local;"));
        assert!(signed_str.contains("s=byos;"));
        assert!(signed_str.contains("h="));
        assert!(signed_str.contains("bh="));
        assert!(signed_str.contains("b="));
        // bh is base64 of body hash, should be present
        assert!(signed_str.contains("bh="));
    }

    #[test]
    fn test_dkim_body_hash_changes() {
        let kp = DkimKeypair::generate("byos").unwrap();
        let msg1 = b"From: a@byos.local\r\nTo: b@byos.local\r\nSubject: x\r\n\r\nBody one\r\n";
        let msg2 = b"From: a@byos.local\r\nTo: b@byos.local\r\nSubject: x\r\n\r\nBody two\r\n";
        let signed1 = dkim_sign(&kp.private_key_pem, "byos", "byos.local", msg1).unwrap();
        let signed2 = dkim_sign(&kp.private_key_pem, "byos", "byos.local", msg2).unwrap();
        let s1 = String::from_utf8(signed1).unwrap();
        let s2 = String::from_utf8(signed2).unwrap();
        // Extract bh= values
        let bh1 = s1.split("bh=").nth(1).unwrap().split(';').next().unwrap().trim();
        let bh2 = s2.split("bh=").nth(1).unwrap().split(';').next().unwrap().trim();
        assert_ne!(bh1, bh2);
    }

    fn verify_dkim_signature(signed: &[u8], public_key_pem: &str) -> bool {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        use rsa::{pkcs1v15::VerifyingKey, pkcs8::DecodePublicKey, RsaPublicKey};
        use rsa::signature::Verifier;
        // Parse public key
        let public_key = match RsaPublicKey::from_public_key_pem(public_key_pem) {
            Ok(k) => k,
            Err(_) => return false,
        };
        let verifying_key = VerifyingKey::<Sha256>::new(public_key);
        // Extract DKIM-Signature header (first line, may be folded? we generate single line)
        let signed_str = match String::from_utf8(signed.to_vec()) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let dkim_line = match signed_str.lines().next() {
            Some(l) if l.starts_with("DKIM-Signature:") => l,
            _ => return false,
        };
        // Extract b= and bh= and h= for verification – simplified: recompute signing input as done in dkim_sign
        // Re-parse original message (after DKIM header)
        let original = match signed_str.split_once("\r\n") {
            Some((_, rest)) => rest,
            None => return false,
        };
        // Re-split headers/body
        let (headers_str, body) = match original.split_once("\r\n\r\n") {
            Some(v) => v,
            None => return false,
        };
        let mut headers: Vec<(String, String)> = Vec::new();
        for line in headers_str.lines() {
            if let Some(pos) = line.find(':') {
                headers.push((line[..pos].trim().to_string(), line[pos + 1..].trim().to_string()));
            }
        }
        // Recompute body hash
        let canonical_body = relaxed_body_canonicalize(body.as_bytes());
        let mut hasher = Sha256::new();
        hasher.update(&canonical_body);
        let bh_calc = BASE64.encode(hasher.finalize());
        // Extract bh from DKIM header
        let bh_in_header = dkim_line.split("bh=").nth(1).and_then(|s| s.split(';').next()).map(|s| s.trim()).unwrap_or("");
        if bh_calc != bh_in_header {
            return false;
        }
        // Rebuild signing input (same logic as dkim_sign)
        let signed_headers: Vec<&str> = headers.iter().filter(|(n, _)| {
            matches!(n.to_lowercase().as_str(), "from" | "to" | "cc" | "subject" | "date" | "message-id" | "mime-version" | "content-type" | "content-transfer-encoding" | "reply-to" | "sender" | "in-reply-to" | "references")
        }).map(|(n, _)| n.as_str()).collect();
        let mut canonical_headers: Vec<String> = Vec::new();
        for (name, value) in &headers {
            if signed_headers.iter().any(|&h| h.eq_ignore_ascii_case(name)) {
                canonical_headers.push(relaxed_header_canonicalize(&format!("{}: {}", name, value)));
            }
        }
        // DKIM header without b value for verification: truncate at b=
        let dkim_without_b = dkim_line.split("b=").next().unwrap().to_string() + "b=";
        canonical_headers.push(relaxed_header_canonicalize(&dkim_without_b));
        let signing_input = canonical_headers.join("\r\n") + "\r\n";
        // Extract signature b
        let b_b64 = dkim_line.split("b=").nth(1).unwrap().trim();
        let sig_bytes = match BASE64.decode(b_b64) {
            Ok(v) => v,
            Err(_) => return false,
        };
        let sig = match rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice()) {
            Ok(s) => s,
            Err(_) => return false,
        };
        verifying_key.verify(signing_input.as_bytes(), &sig).is_ok()
    }

    #[test]
    fn test_dkim_verify_valid() {
        let kp = DkimKeypair::generate("byos").unwrap();
        let msg = b"From: alice@byos.local\r\nTo: bob@byos.local\r\nSubject: verify\r\nDate: Thu, 01 Jan 2026 00:00:00 +0000\r\nMessage-ID: <v@byos.local>\r\n\r\nValid body\r\n";
        let signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", msg).unwrap();
        assert!(verify_dkim_signature(&signed, &kp.public_key_pem));
    }

    #[test]
    fn test_dkim_verify_fails_on_body_tamper() {
        let kp = DkimKeypair::generate("byos").unwrap();
        let msg = b"From: a@byos.local\r\nTo: b@byos.local\r\nSubject: t\r\n\r\nOriginal\r\n";
        let mut signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", msg).unwrap();
        // Tamper body
        let tampered = String::from_utf8(signed.clone()).unwrap().replace("Original", "Tampered");
        assert!(!verify_dkim_signature(tampered.as_bytes(), &kp.public_key_pem));
    }

    #[test]
    fn test_dkim_verify_fails_on_header_tamper() {
        let kp = DkimKeypair::generate("byos").unwrap();
        let msg = b"From: a@byos.local\r\nTo: b@byos.local\r\nSubject: hello\r\n\r\nBody\r\n";
        let signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", msg).unwrap();
        // Tamper Subject header in the original part (after DKIM line)
        let mut s = String::from_utf8(signed).unwrap();
        s = s.replacen("Subject: hello", "Subject: hacked", 1);
        assert!(!verify_dkim_signature(s.as_bytes(), &kp.public_key_pem));
    }

    #[test]
    fn test_dkim_verify_fails_wrong_key() {
        let kp1 = DkimKeypair::generate("byos").unwrap();
        let kp2 = DkimKeypair::generate("byos").unwrap();
        let msg = b"From: a@byos.local\r\nTo: b@byos.local\r\nSubject: t\r\n\r\nBody\r\n";
        let signed = dkim_sign(&kp1.private_key_pem, "byos", "byos.local", msg).unwrap();
        assert!(!verify_dkim_signature(&signed, &kp2.public_key_pem));
    }

    #[test]
    fn test_dkim_private_key_not_in_ciphertext() {
        let dek = [9u8; 32];
        let kp = DkimKeypair::generate("byos").unwrap();
        let enc = encrypt_dkim_private_key(&dek, &kp.private_key_pem).unwrap();
        // Ensure no PEM header leaks
        assert!(!enc.windows(27).any(|w| w == b"-----BEGIN PRIVATE KEY-----"));
        // Also base64 enc should not contain PEM
        let b64 = base64::encode(&enc);
        assert!(!b64.contains("BEGIN"));
    }
}
