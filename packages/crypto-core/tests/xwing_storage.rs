use byos_crypto_core::{
    decrypt_message_xwing, encrypt_message_xwing,
    xwing::{decapsulate, encapsulate_deterministic, public_key_from_seed},
};
use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Debug, Deserialize)]
struct XWingVector {
    seed: String,
    sk: String,
    pk: String,
    eseed: String,
    ct: String,
    ss: String,
}

fn load_vectors() -> Vec<XWingVector> {
    let candidates = [
        "crypto/core/testdata/xwing_vectors.json",
        "../../crypto/core/testdata/xwing_vectors.json",
        "testdata/xwing_vectors.json",
    ];
    let path = candidates
        .iter()
        .map(Path::new)
        .find(|path| path.exists())
        .expect("failed to locate xwing_vectors.json");
    serde_json::from_slice(&fs::read(path).expect("read X-Wing vectors"))
        .expect("parse X-Wing vectors")
}

#[test]
fn xwing_storage_round_trip() {
    let seed = [0x42u8; 32];
    let public_key = public_key_from_seed(&seed).expect("derive X-Wing public key");
    let plaintext = b"X-Wing storage round-trip";

    let (wrapped_key, blob, iv, aad) =
        encrypt_message_xwing(&public_key, 7, plaintext).expect("encrypt X-Wing message");

    assert_eq!(wrapped_key.len(), 1 + 1120 + 48);
    assert_eq!(blob[0], 1);
    assert_eq!(iv.len(), 12);
    assert_eq!(aad, 7u64.to_be_bytes());

    let recovered =
        decrypt_message_xwing(&seed, &wrapped_key, &blob, &aad).expect("decrypt X-Wing message");
    assert_eq!(recovered, plaintext);
}

#[test]
fn xwing_cross_language_vectors_match() {
    let vectors = load_vectors();
    assert_eq!(vectors.len(), 3);

    for (index, vector) in vectors.iter().enumerate() {
        let seed = hex::decode(&vector.seed).expect("seed hex");
        let sk = hex::decode(&vector.sk).expect("sk hex");
        let expected_pk = hex::decode(&vector.pk).expect("pk hex");
        let eseed = hex::decode(&vector.eseed).expect("ephemeral seed hex");
        let expected_ct = hex::decode(&vector.ct).expect("ciphertext hex");
        let expected_ss = hex::decode(&vector.ss).expect("shared secret hex");

        let actual_pk = public_key_from_seed(&seed).expect("derive public key");
        assert_eq!(actual_pk, expected_pk, "vector {index} public key mismatch");

        let actual_ss = decapsulate(&sk, &expected_ct).expect("decapsulate vector");
        assert_eq!(
            actual_ss.as_slice(),
            expected_ss,
            "vector {index} shared secret mismatch"
        );

        let (actual_ct, actual_ss) =
            encapsulate_deterministic(&expected_pk, &eseed).expect("encapsulate vector");
        assert_eq!(actual_ct, expected_ct, "vector {index} ciphertext mismatch");
        assert_eq!(
            actual_ss.as_slice(),
            expected_ss,
            "vector {index} shared secret mismatch"
        );
    }
}
