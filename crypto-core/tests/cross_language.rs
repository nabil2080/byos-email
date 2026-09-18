use std::fs;
use std::path::Path;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crypto_core::dispatch::open;
use crypto_core::envelope::{build_aad, marshal_canonical, unmarshal_canonical, ALG_X25519, ALG_XWING};
use crypto_core::hpke::{hkdf_expand, seal_x25519_deterministic, seal_xwing_deterministic};
use crypto_core::{decrypt_envelope_bytes, KeyHandle};

#[derive(Debug, Deserialize)]
struct VectorSuite {
    #[serde(default)]
    #[allow(dead_code)]
    _warning: Option<String>,
    vectors: Vec<CrossLanguageVector>,
}

#[derive(Debug, Deserialize)]
struct CrossLanguageVector {
    id: String,
    #[serde(default)]
    #[allow(dead_code)]
    description: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    _test_only: Option<bool>,
    algorithm: String,
    key_id: String,
    key_epoch: u32,
    recipient_public_key_hex: String,
    #[serde(alias = "recipient_private_key_hex")]
    test_only_recipient_private_key_hex: Option<String>,
    #[serde(alias = "ephemeral_private_key_hex")]
    test_only_ephemeral_private_key_hex: Option<String>,
    #[serde(alias = "eseed_hex")]
    test_only_eseed_hex: Option<String>,
    nonce_hex: String,

    #[serde(default)]
    #[allow(dead_code)]
    plaintext: Option<String>,
    #[serde(default)]
    plaintext_hex: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    plaintext_len: Option<usize>,
    #[serde(default)]
    expected_aad_hex: Option<String>,
    #[serde(default)]
    expected_envelope_canonical: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    expected_envelope: Option<serde_json::Value>,

    #[serde(default)]
    plaintext_seed_hex: Option<String>,
    #[serde(default)]
    plaintext_size: Option<usize>,
    #[serde(default)]
    plaintext_sha256: Option<String>,
    #[serde(default)]
    expected_envelope_sha256: Option<String>,
}

fn expand_test_plaintext(seed: &[u8], info_prefix: &str, size: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(size);
    let chunk_size = 4096;
    let mut offset = 0;
    while offset < size {
        let mut curr = chunk_size;
        if size - offset < curr {
            curr = size - offset;
        }
        let chunk_idx = offset / chunk_size;
        let chunk_info = format!("{}-{}", info_prefix, chunk_idx);
        let chunk = hkdf_expand(seed, chunk_info.as_bytes(), curr).expect("hkdf_expand failed");
        out.extend_from_slice(&chunk);
        offset += chunk_size;
    }
    out
}

#[test]
fn test_all_14_cross_language_vectors() {
    let path = if Path::new("testdata/cross_language_vectors.json").exists() {
        Path::new("testdata/cross_language_vectors.json")
    } else if Path::new("../testdata/cross_language_vectors.json").exists() {
        Path::new("../testdata/cross_language_vectors.json")
    } else {
        panic!("testdata/cross_language_vectors.json not found");
    };

    let data = fs::read(path).expect("Failed to read cross_language_vectors.json");
    let suite: VectorSuite = serde_json::from_slice(&data)
        .or_else(|_| -> Result<VectorSuite, serde_json::Error> {
            let vectors: Vec<CrossLanguageVector> = serde_json::from_slice(&data)?;
            Ok(VectorSuite { _warning: None, vectors })
        })
        .expect("Failed to parse cross_language_vectors.json");

    assert_eq!(
        suite.vectors.len(),
        14,
        "Expected exactly 14 vectors in testdata/cross_language_vectors.json"
    );

    for vec in &suite.vectors {
        println!("Verifying vector: {}", vec.id);

        let pub_bytes = hex::decode(&vec.recipient_public_key_hex).expect("pub key hex");
        let priv_bytes = hex::decode(
            vec.test_only_recipient_private_key_hex
                .as_ref()
                .expect("recipient private key missing"),
        )
        .expect("priv key hex");
        let nonce_bytes = hex::decode(&vec.nonce_hex).expect("nonce hex");

        let is_hash_only = vec.plaintext_size.unwrap_or(0) > 0;
        let pt_bytes = if is_hash_only {
            let seed_bytes = hex::decode(
                vec.plaintext_seed_hex
                    .as_ref()
                    .expect("plaintext_seed_hex missing"),
            )
            .expect("seed hex");
            let size = vec.plaintext_size.unwrap();
            let pt = expand_test_plaintext(&seed_bytes, "byos-test-plaintext", size);
            let mut hasher = Sha256::new();
            hasher.update(&pt);
            let pt_sha = hex::encode(hasher.finalize());
            assert_eq!(
                &pt_sha,
                vec.plaintext_sha256.as_ref().unwrap(),
                "Plaintext SHA-256 mismatch for vector {}",
                vec.id
            );
            pt
        } else if let Some(pt_hex) = &vec.plaintext_hex {
            if pt_hex.is_empty() {
                Vec::new()
            } else {
                hex::decode(pt_hex).expect("plaintext hex")
            }
        } else {
            Vec::new()
        };

        // 1. Seal deterministically
        let env = match vec.algorithm.as_str() {
            ALG_X25519 => {
                let eph_priv = hex::decode(
                    vec.test_only_ephemeral_private_key_hex
                        .as_ref()
                        .expect("ephemeral private key missing"),
                )
                .expect("eph priv hex");
                seal_x25519_deterministic(
                    &pub_bytes,
                    &eph_priv,
                    &pt_bytes,
                    &nonce_bytes,
                    &vec.key_id,
                    vec.key_epoch,
                )
                .expect("seal_x25519_deterministic failed")
            }
            ALG_XWING => {
                let eseed = hex::decode(
                    vec.test_only_eseed_hex
                        .as_ref()
                        .expect("eseed missing"),
                )
                .expect("eseed hex");
                seal_xwing_deterministic(
                    &pub_bytes,
                    &eseed,
                    &pt_bytes,
                    &nonce_bytes,
                    &vec.key_id,
                    vec.key_epoch,
                )
                .expect("seal_xwing_deterministic failed")
            }
            other => panic!("Unsupported algorithm in vector {}: {}", vec.id, other),
        };

        // 2. Canonical serialization verification
        let canon_bytes = marshal_canonical(&env).expect("marshal_canonical failed");
        let canon_str = std::str::from_utf8(&canon_bytes).expect("utf8 canon bytes");

        if is_hash_only {
            let mut hasher = Sha256::new();
            hasher.update(&canon_bytes);
            let env_sha = hex::encode(hasher.finalize());
            assert_eq!(
                &env_sha,
                vec.expected_envelope_sha256.as_ref().unwrap(),
                "Canonical envelope SHA-256 mismatch for vector {}",
                vec.id
            );
        } else {
            let expected_canon = vec
                .expected_envelope_canonical
                .as_ref()
                .expect("expected_envelope_canonical missing");
            assert_eq!(
                canon_str, expected_canon,
                "Canonical JSON mismatch for vector {}",
                vec.id
            );

            // 3. Binary AAD verification
            let aad = build_aad(&env).expect("build_aad failed");
            let aad_hex = hex::encode(aad);
            assert_eq!(
                &aad_hex,
                vec.expected_aad_hex.as_ref().unwrap(),
                "AAD mismatch for vector {}",
                vec.id
            );

            // 4. Unmarshal canonical JSON and verify roundtrip
            let unmarshaled = unmarshal_canonical(expected_canon.as_bytes())
                .expect("unmarshal_canonical failed");
            let unmarshaled_canon = marshal_canonical(&unmarshaled).expect("marshal of unmarshaled failed");
            assert_eq!(
                unmarshaled_canon, canon_bytes,
                "Unmarshal canonical re-serialization mismatch for vector {}",
                vec.id
            );
        }

        // 5. Open / decrypt envelope using dispatch::open
        let recovered = open(&env, &priv_bytes).expect("open failed");
        assert_eq!(
            recovered, pt_bytes,
            "Decrypted plaintext mismatch for vector {}",
            vec.id
        );

        // 6. Test WASM-level pure Rust helper decrypt_envelope_bytes with KeyHandle
        let key_handle = KeyHandle::new(priv_bytes.clone(), vec.algorithm.clone());
        let recovered_wasm = decrypt_envelope_bytes(canon_str, &key_handle)
            .expect("decrypt_envelope_bytes failed");
        assert_eq!(
            recovered_wasm, pt_bytes,
            "KeyHandle decrypted plaintext mismatch for vector {}",
            vec.id
        );
    }

    println!("All 14 cross-language vectors passed byte-exact verification!");
}
