use byos_crypto_core::{
    derive_signing_key, sign_message, signing_public_key, verify_message_signature, CryptoError,
};
use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Debug, Deserialize)]
struct Vector {
    id: String,
    recovery_root_hex: String,
    mailbox_id_hex: String,
    key_epoch: u32,
    expected_signing_public_key_hex: String,
    aad_hex: String,
    ciphertext_hex: String,
    expected_signature_hex: String,
}

#[derive(Debug, Deserialize)]
struct VectorsFile {
    vectors: Vec<Vector>,
}

fn hex_decode(s: &str) -> Vec<u8> {
    if s.is_empty() {
        return Vec::new();
    }
    hex::decode(s).expect("valid hex")
}

fn hex_encode(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

fn load_vectors() -> Vec<Vector> {
    let candidates = [
        "testdata/ed25519_signing_vectors.json",
        "../../testdata/ed25519_signing_vectors.json",
        "crypto/core/testdata/ed25519_signing_vectors.json",
        "../../crypto/core/testdata/ed25519_signing_vectors.json",
    ];
    let path = candidates
        .iter()
        .map(Path::new)
        .find(|path| path.exists())
        .expect("failed to locate ed25519_signing_vectors.json");
    let file: VectorsFile =
        serde_json::from_slice(&fs::read(path).expect("read vectors file")).expect("parse vectors");
    file.vectors
}

#[test]
fn test_cross_language_vectors() {
    let vectors = load_vectors();
    assert!(!vectors.is_empty(), "vectors list should not be empty");

    for vec in vectors {
        let root_bytes = hex_decode(&vec.recovery_root_hex);
        let root: [u8; 32] = root_bytes.try_into().expect("32 bytes root");
        let mb_bytes = hex_decode(&vec.mailbox_id_hex);
        let mailbox_id: [u8; 16] = mb_bytes.try_into().expect("16 bytes mailbox id");

        let signing_key = derive_signing_key(&root, &mailbox_id, vec.key_epoch)
            .expect("derive signing key in Rust");
        let pub_key = signing_public_key(&signing_key);
        let pub_key_hex = hex_encode(&pub_key);

        assert_eq!(
            pub_key_hex, vec.expected_signing_public_key_hex,
            "Public key mismatch for vector {}",
            vec.id
        );

        let aad = hex_decode(&vec.aad_hex);
        let ciphertext = hex_decode(&vec.ciphertext_hex);

        let sig = sign_message(&signing_key, &aad, &ciphertext).expect("sign in Rust");
        let sig_hex = hex_encode(&sig);

        assert_eq!(
            sig_hex, vec.expected_signature_hex,
            "Signature mismatch for vector {}",
            vec.id
        );

        // Verify with verify_message_signature
        let expected_sig_bytes = hex_decode(&vec.expected_signature_hex);
        let expected_sig: [u8; 64] = expected_sig_bytes.try_into().expect("64 bytes sig");

        verify_message_signature(&pub_key, &expected_sig, &aad, &ciphertext)
            .expect(&format!("verify failed for vector {}", vec.id));
    }
}

#[test]
fn test_derivation_deterministic() {
    let root = [0x55u8; 32];
    let mailbox_id = [0x77u8; 16];
    let epoch = 1;

    let sk1 = derive_signing_key(&root, &mailbox_id, epoch).unwrap();
    let sk2 = derive_signing_key(&root, &mailbox_id, epoch).unwrap();

    let pk1 = signing_public_key(&sk1);
    let pk2 = signing_public_key(&sk2);

    assert_eq!(pk1, pk2);
}

#[test]
fn test_derivation_different_epochs() {
    let root = [0x55u8; 32];
    let mailbox_id = [0x77u8; 16];

    let sk1 = derive_signing_key(&root, &mailbox_id, 1).unwrap();
    let sk2 = derive_signing_key(&root, &mailbox_id, 2).unwrap();

    assert_ne!(signing_public_key(&sk1), signing_public_key(&sk2));
}

#[test]
fn test_derivation_different_mailboxes() {
    let root = [0x55u8; 32];
    let mb1 = [0x01u8; 16];
    let mb2 = [0x02u8; 16];

    let sk1 = derive_signing_key(&root, &mb1, 1).unwrap();
    let sk2 = derive_signing_key(&root, &mb2, 1).unwrap();

    assert_ne!(signing_public_key(&sk1), signing_public_key(&sk2));
}

#[test]
fn test_sign_verify_round_trip() {
    let root = [0x12u8; 32];
    let mailbox_id = [0x34u8; 16];
    let epoch = 3;

    let sk = derive_signing_key(&root, &mailbox_id, epoch).unwrap();
    let pk = signing_public_key(&sk);

    let aad = b"test-aad-data";
    let ct = b"test-ciphertext-data";

    let sig = sign_message(&sk, aad, ct).unwrap();
    assert_eq!(sig.len(), 64);

    let result = verify_message_signature(&pk, &sig, aad, ct);
    assert!(result.is_ok());
}

#[test]
fn test_verify_fails_wrong_public_key() {
    let root = [0x12u8; 32];
    let mailbox_id = [0x34u8; 16];
    let sk = derive_signing_key(&root, &mailbox_id, 1).unwrap();

    let wrong_sk = derive_signing_key(&root, &mailbox_id, 2).unwrap();
    let wrong_pk = signing_public_key(&wrong_sk);

    let aad = b"aad";
    let ct = b"ct";
    let sig = sign_message(&sk, aad, ct).unwrap();

    let err = verify_message_signature(&wrong_pk, &sig, aad, ct).unwrap_err();
    assert_eq!(err, CryptoError::SignatureInvalid);
}

#[test]
fn test_verify_fails_tampered_signature() {
    let root = [0x12u8; 32];
    let mailbox_id = [0x34u8; 16];
    let sk = derive_signing_key(&root, &mailbox_id, 1).unwrap();
    let pk = signing_public_key(&sk);

    let aad = b"aad";
    let ct = b"ct";
    let mut sig = sign_message(&sk, aad, ct).unwrap();
    sig[0] ^= 0xff;

    let err = verify_message_signature(&pk, &sig, aad, ct).unwrap_err();
    assert_eq!(err, CryptoError::SignatureInvalid);
}

#[test]
fn test_verify_fails_tampered_aad() {
    let root = [0x12u8; 32];
    let mailbox_id = [0x34u8; 16];
    let sk = derive_signing_key(&root, &mailbox_id, 1).unwrap();
    let pk = signing_public_key(&sk);

    let aad = b"aad";
    let ct = b"ct";
    let sig = sign_message(&sk, aad, ct).unwrap();

    let err = verify_message_signature(&pk, &sig, b"tampered_aad", ct).unwrap_err();
    assert_eq!(err, CryptoError::SignatureInvalid);
}

#[test]
fn test_verify_fails_tampered_ciphertext() {
    let root = [0x12u8; 32];
    let mailbox_id = [0x34u8; 16];
    let sk = derive_signing_key(&root, &mailbox_id, 1).unwrap();
    let pk = signing_public_key(&sk);

    let aad = b"aad";
    let ct = b"ct";
    let sig = sign_message(&sk, aad, ct).unwrap();

    let err = verify_message_signature(&pk, &sig, aad, b"tampered_ciphertext").unwrap_err();
    assert_eq!(err, CryptoError::SignatureInvalid);
}
