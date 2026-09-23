use byos_crypto_core::{
    build_envelope_aad, marshal_canonical, sign_message, signing_public_key,
    unmarshal_canonical, verify_message_signature, wasm_open_xwing_envelope,
    wasm_seal_xwing_envelope, xwing, CryptoEnvelope, ALG_XWING,
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

#[test]
fn test_cross_language_signed_vector() {
    let out_path = std::path::Path::new("../../crypto/envelope/testdata/envelope_signed_rust.json");

    if out_path.exists() {
        let content = std::fs::read_to_string(out_path).expect("read existing vector");
        let val: serde_json::Value = serde_json::from_str(&content).expect("parse vector json");
        let envelope_json = val["envelope_json"].as_str().expect("envelope_json");
        let sender_pk_hex = val["sender_ed25519_public_key_hex"].as_str().expect("sender_pk");
        let recipient_seed_hex = val["recipient_xwing_seed_hex"].as_str().expect("recipient_seed");
        let plaintext_hex = val["plaintext_hex"].as_str().expect("plaintext_hex");

        // Verify opening in Rust
        let opened_hex = wasm_open_xwing_envelope(recipient_seed_hex, envelope_json).expect("open envelope");
        assert_eq!(opened_hex, plaintext_hex);

        // Verify signature in Rust
        let env = unmarshal_canonical(envelope_json).expect("unmarshal envelope");
        let enc_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &env.enc).expect("decode enc");
        let nonce_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &env.nonce).expect("decode nonce");
        let ct_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &env.ciphertext).expect("decode ct");
        let sig_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, env.sig.as_ref().expect("sig present")).expect("decode sig");

        let mut nonce_arr = [0u8; 12];
        nonce_arr.copy_from_slice(&nonce_bytes);
        let aad = build_envelope_aad(env.v, &env.alg, &env.key_id, env.key_epoch, &enc_bytes, &nonce_arr).expect("build aad");
        let sender_pk = hex::decode(sender_pk_hex).expect("decode sender pk");
        let mut sender_pk_arr = [0u8; 32];
        sender_pk_arr.copy_from_slice(&sender_pk);
        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(&sig_bytes);

        verify_message_signature(&sender_pk_arr, &sig_arr, &aad, &ct_bytes).expect("verify signature");
        return;
    }

    // Generate new vector
    let sender_seed = [0x33u8; 32];
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&sender_seed);
    let sender_pk = signing_public_key(&signing_key);

    let recipient_seed = [0x55u8; 32];
    let recipient_pk = xwing::public_key_from_seed(&recipient_seed).expect("derive X-Wing public key");

    let plaintext = b"Cross-language envelope signature verification test payload";

    let (enc, ss) = xwing::encapsulate(&recipient_pk).expect("encapsulate");
    let aead_key = byos_crypto_core::xwing_hpke::derive_aead_key(&ss).expect("derive aead key");
    let nonce = [0x77u8; 12];
    let key_id = "mbx_recipient_cross_lang";
    let key_epoch = 1u32;

    let aad = build_envelope_aad(1, ALG_XWING, key_id, key_epoch, &enc, &nonce).expect("build aad");
    let ciphertext = byos_crypto_core::aes_gcm_encrypt_with_nonce(&aead_key, &nonce, plaintext, &aad).expect("aes gcm");

    let sig = sign_message(&signing_key, &aad, &ciphertext).expect("sign");

    use base64::Engine;
    let b64 = &base64::engine::general_purpose::STANDARD;

    let env = CryptoEnvelope {
        v: 1,
        alg: ALG_XWING.to_string(),
        key_id: key_id.to_string(),
        key_epoch,
        enc: b64.encode(&enc),
        nonce: b64.encode(&nonce),
        ciphertext: b64.encode(&ciphertext),
        sig: Some(b64.encode(&sig)),
    };

    let canonical_json = marshal_canonical(&env).expect("marshal canonical");

    // Verify self-consistency in Rust
    let opened_hex = wasm_open_xwing_envelope(&hex::encode(&recipient_seed), &canonical_json).expect("open envelope");
    assert_eq!(opened_hex, hex::encode(plaintext));
    verify_message_signature(&sender_pk, &sig, &aad, &ciphertext).expect("verify signature in rust");

    let vector = serde_json::json!({
        "envelope_json": canonical_json,
        "sender_ed25519_public_key_hex": hex::encode(sender_pk),
        "recipient_xwing_public_key_hex": hex::encode(recipient_pk),
        "plaintext_hex": hex::encode(plaintext),
        "recipient_xwing_seed_hex": hex::encode(recipient_seed),
        "_warning": "TEST VECTOR — generated for cross-language verification. Not for production use."
    });

    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(out_path, serde_json::to_string_pretty(&vector).expect("serialize vector"))
        .expect("write vector file");
}

