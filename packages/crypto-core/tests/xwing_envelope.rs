use byos_crypto_core::{
    marshal_canonical, unmarshal_canonical, wasm_open_xwing_envelope, wasm_seal_xwing_envelope,
    xwing,
};

fn make_keypair() -> (Vec<u8>, Vec<u8>) {
    let mut seed = [0u8; 32];
    rand::fill(&mut seed);
    let pk = xwing::public_key_from_seed(&seed).expect("derive X-Wing public key");
    (seed.to_vec(), pk)
}

#[test]
fn test_envelope_round_trip() {
    let (seed, pk) = make_keypair();
    let plaintext = b"Hello, internal E2E mail";

    let json = wasm_seal_xwing_envelope(
        &hex::encode(&pk),
        "mbx_test_001",
        1,
        &hex::encode(plaintext),
    )
    .expect("seal envelope");

    let recovered_hex =
        wasm_open_xwing_envelope(&hex::encode(&seed), &json).expect("open envelope");

    let recovered = hex::decode(&recovered_hex).expect("decode hex plaintext");
    assert_eq!(recovered, plaintext);
}

#[test]
fn test_envelope_tamper_ciphertext() {
    let (seed, pk) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx", 1, "00").expect("seal");

    // Modify ciphertext in JSON: parse, alter ciphertext, re-marshal
    let mut env = unmarshal_canonical(&json).expect("unmarshal");
    let mut ct_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &env.ciphertext,
    )
    .expect("decode ct");
    ct_bytes[0] ^= 0x01;
    env.ciphertext =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ct_bytes);
    let tampered_json = marshal_canonical(&env).expect("marshal");

    let result = wasm_open_xwing_envelope(&hex::encode(&seed), &tampered_json);
    assert!(result.is_err());
}

#[test]
fn test_envelope_tamper_enc() {
    let (seed, pk) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx", 1, "00").expect("seal");

    let mut env = unmarshal_canonical(&json).expect("unmarshal");
    let mut enc_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &env.enc,
    )
    .expect("decode enc");
    enc_bytes[0] ^= 0x01;
    env.enc = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &enc_bytes);
    let tampered_json = marshal_canonical(&env).expect("marshal");

    let result = wasm_open_xwing_envelope(&hex::encode(&seed), &tampered_json);
    assert!(result.is_err());
}

#[test]
fn test_envelope_tamper_key_id() {
    let (seed, pk) = make_keypair();
    let json =
        wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx_original", 1, "00").expect("seal");
    let tampered = json.replace("mbx_original", "mbx_other");
    let result = wasm_open_xwing_envelope(&hex::encode(&seed), &tampered);
    assert!(result.is_err());
}

#[test]
fn test_envelope_tamper_key_epoch() {
    let (seed, pk) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx", 1, "00").expect("seal");
    let tampered = json.replace("\"key_epoch\":1", "\"key_epoch\":2");
    let result = wasm_open_xwing_envelope(&hex::encode(&seed), &tampered);
    assert!(result.is_err());
}

#[test]
fn test_envelope_tamper_nonce() {
    let (seed, pk) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx", 1, "00").expect("seal");

    let mut env = unmarshal_canonical(&json).expect("unmarshal");
    let mut nonce_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &env.nonce,
    )
    .expect("decode nonce");
    nonce_bytes[0] ^= 0x01;
    env.nonce = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes);
    let tampered_json = marshal_canonical(&env).expect("marshal");

    let result = wasm_open_xwing_envelope(&hex::encode(&seed), &tampered_json);
    assert!(result.is_err());
}

#[test]
fn test_envelope_wrong_recipient() {
    let (_seed_a, pk_a) = make_keypair();
    let (seed_b, _pk_b) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk_a), "mbx", 1, "00").expect("seal");
    let result = wasm_open_xwing_envelope(&hex::encode(&seed_b), &json);
    assert!(result.is_err());
}

#[test]
fn test_envelope_empty_plaintext() {
    let (seed, pk) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx", 1, "").expect("seal empty");
    let recovered_hex =
        wasm_open_xwing_envelope(&hex::encode(&seed), &json).expect("open empty");
    assert_eq!(recovered_hex, "");
}

#[test]
fn test_envelope_1mb_plaintext() {
    let (seed, pk) = make_keypair();
    let plaintext = vec![0x42u8; 1024 * 1024];
    let json = wasm_seal_xwing_envelope(
        &hex::encode(&pk),
        "mbx",
        1,
        &hex::encode(&plaintext),
    )
    .expect("seal 1MB");
    let recovered_hex =
        wasm_open_xwing_envelope(&hex::encode(&seed), &json).expect("open 1MB");
    let recovered = hex::decode(&recovered_hex).expect("decode recovered 1MB");
    assert_eq!(recovered, plaintext);
}

#[test]
fn test_envelope_canonical_form() {
    let (_seed, pk) = make_keypair();
    let json = wasm_seal_xwing_envelope(&hex::encode(&pk), "mbx_canon", 1, "abcd").expect("seal");
    let env = unmarshal_canonical(&json).expect("unmarshal canonical");
    assert_eq!(env.v, 1);
    assert_eq!(env.alg, "HPKE-XWing-AES256GCM-v1");
    assert_eq!(env.key_id, "mbx_canon");
    assert_eq!(env.key_epoch, 1);
    assert!(env.sig.is_none());

    let reserialized = marshal_canonical(&env).expect("marshal canonical");
    assert_eq!(json, reserialized);
}
