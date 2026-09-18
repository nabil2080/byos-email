use crypto_core::{decapsulate, encapsulate_deterministic, expand_decapsulation_key};
use ml_kem::KeyExport;
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct XWingVector {
    seed: String,
    sk: String,
    pk: String,
    eseed: String,
    ct: String,
    ss: String,
}

#[test]
fn test_xwing_draft10_vectors() {
    let candidate_paths = [
        "../../testdata/xwing_vectors.json",
        "../testdata/xwing_vectors.json",
        "testdata/xwing_vectors.json",
    ];

    let mut data_opt = None;
    for path in candidate_paths {
        if Path::new(path).exists() {
            if let Ok(content) = fs::read(path) {
                data_opt = Some(content);
                break;
            }
        }
    }

    let data = data_opt.expect("Failed to locate xwing_vectors.json");
    let vectors: Vec<XWingVector> = serde_json::from_slice(&data).expect("Valid JSON vectors");
    assert_eq!(vectors.len(), 3, "Expected 3 test vectors from draft-10 Appendix C");

    for (i, v) in vectors.iter().enumerate() {
        let seed_bytes = hex::decode(&v.seed).expect("hex seed");
        let sk_bytes = hex::decode(&v.sk).expect("hex sk");
        let pk_expected = hex::decode(&v.pk).expect("hex pk");
        let eseed_bytes = hex::decode(&v.eseed).expect("hex eseed");
        let ct_expected = hex::decode(&v.ct).expect("hex ct");
        let ss_expected = hex::decode(&v.ss).expect("hex ss");

        // 1. expand_decapsulation_key reproduces pk byte-for-byte (1216 bytes)
        let (_dk_m, _sk_x, ek_m, pk_x) = expand_decapsulation_key(&seed_bytes)
            .unwrap_or_else(|e| panic!("Vector {} expand_decapsulation_key failed: {:?}", i + 1, e));

        let pk_m_bytes = ek_m.to_bytes();
        let mut pk_actual = Vec::with_capacity(1216);
        pk_actual.extend_from_slice(pk_m_bytes.as_slice());
        pk_actual.extend_from_slice(pk_x.as_bytes());

        assert_eq!(
            pk_actual, pk_expected,
            "Vector {} public key mismatch:\n  got:  {}\n  want: {}",
            i + 1,
            hex::encode(&pk_actual),
            v.pk
        );

        // 2. decapsulate(sk, ct) returns expected ss byte-for-byte (32 bytes)
        let ss_actual = decapsulate(&sk_bytes, &ct_expected)
            .unwrap_or_else(|e| panic!("Vector {} decapsulate failed: {:?}", i + 1, e));

        assert_eq!(
            ss_actual.to_vec(),
            ss_expected,
            "Vector {} decapsulated shared secret mismatch:\n  got:  {}\n  want: {}",
            i + 1,
            hex::encode(ss_actual),
            v.ss
        );

        // 3. encapsulate_deterministic(pk, eseed) reproduces ciphertext and shared secret
        let (ct_actual, ss_enc) = encapsulate_deterministic(&pk_expected, &eseed_bytes)
            .unwrap_or_else(|e| panic!("Vector {} encapsulate_deterministic failed: {:?}", i + 1, e));

        assert_eq!(
            ct_actual, ct_expected,
            "Vector {} ciphertext mismatch:\n  got:  {}\n  want: {}",
            i + 1,
            hex::encode(&ct_actual),
            v.ct
        );
        assert_eq!(
            ss_enc.to_vec(),
            ss_expected,
            "Vector {} encapsulated shared secret mismatch:\n  got:  {}\n  want: {}",
            i + 1,
            hex::encode(ss_enc),
            v.ss
        );

        println!("Vector {} (seed {}...): PASSED", i + 1, &v.seed[0..16]);
    }
}
