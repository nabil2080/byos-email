use base64::prelude::*;
use crypto_core::envelope::*;
use crypto_core::error::CryptoError;

#[test]
fn test_canonical_json_ordering_and_format() {
    let env = CryptoEnvelope {
        alg: ALG_X25519.to_string(),
        ciphertext: BASE64_STANDARD.encode(b"0123456789012345"),
        enc: BASE64_STANDARD.encode(&[0xaa; 32]),
        key_epoch: 1,
        key_id: "test_key_01".to_string(),
        nonce: BASE64_STANDARD.encode(&[0xbb; 12]),
        sig: None,
        v: 1,
    };

    let canonical = marshal_canonical(&env).expect("marshal canonical failed");
    let canon_str = std::str::from_utf8(&canonical).expect("utf8");

    // Exact expected string:
    let expected = format!(
        "{{\"alg\":\"{}\",\"ciphertext\":\"{}\",\"enc\":\"{}\",\"key_epoch\":1,\"key_id\":\"test_key_01\",\"nonce\":\"{}\",\"sig\":null,\"v\":1}}",
        ALG_X25519,
        env.ciphertext,
        env.enc,
        env.nonce
    );

    assert_eq!(canon_str, expected);
}

#[test]
fn test_canonical_json_with_sig() {
    let env = CryptoEnvelope {
        alg: ALG_XWING.to_string(),
        ciphertext: BASE64_STANDARD.encode(b"01234567890123456789"),
        enc: BASE64_STANDARD.encode(&[0xcc; 1120]),
        key_epoch: 42,
        key_id: "xwing_key".to_string(),
        nonce: BASE64_STANDARD.encode(&[0xdd; 12]),
        sig: Some(BASE64_STANDARD.encode(b"sigbytes")),
        v: 1,
    };

    let canonical = marshal_canonical(&env).expect("marshal canonical failed");
    let canon_str = std::str::from_utf8(&canonical).expect("utf8");

    let expected = format!(
        "{{\"alg\":\"{}\",\"ciphertext\":\"{}\",\"enc\":\"{}\",\"key_epoch\":42,\"key_id\":\"xwing_key\",\"nonce\":\"{}\",\"sig\":\"{}\",\"v\":1}}",
        ALG_XWING,
        env.ciphertext,
        env.enc,
        env.nonce,
        env.sig.as_ref().unwrap()
    );

    assert_eq!(canon_str, expected);

    // Round-trip through unmarshal_canonical
    let unmarshaled = unmarshal_canonical(&canonical).expect("unmarshal canonical failed");
    assert_eq!(unmarshaled, env);
}

#[test]
fn test_unmarshal_canonical_rejects_missing_field() {
    // Missing 'sig'
    let json = r#"{"alg":"HPKE-X25519-AES256GCM-v1","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA==","enc":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","key_epoch":1,"key_id":"k1","nonce":"AAAAAAAAAAAAAAAA","v":1}"#;
    assert_eq!(
        unmarshal_canonical(json.as_bytes()).unwrap_err(),
        CryptoError::SerializationError
    );
}

#[test]
fn test_validation_bounds() {
    let mut env = CryptoEnvelope {
        alg: ALG_X25519.to_string(),
        ciphertext: BASE64_STANDARD.encode(b"0123456789012345"),
        enc: BASE64_STANDARD.encode(&[0xaa; 32]),
        key_epoch: 1,
        key_id: "test_key_01".to_string(),
        nonce: BASE64_STANDARD.encode(&[0xbb; 12]),
        sig: None,
        v: 1,
    };

    // Valid passes
    assert!(validate(&env).is_ok());

    // v != 1
    env.v = 2;
    assert_eq!(validate(&env).unwrap_err(), CryptoError::UnsupportedVersion);
    env.v = 1;

    // bad alg
    env.alg = "BAD-ALG".to_string();
    assert_eq!(validate(&env).unwrap_err(), CryptoError::UnsupportedAlgorithm);
    env.alg = ALG_X25519.to_string();

    // epoch 0
    env.key_epoch = 0;
    assert_eq!(validate(&env).unwrap_err(), CryptoError::UnknownKeyEpoch);
    env.key_epoch = 1;

    // empty key_id
    env.key_id = "".to_string();
    assert_eq!(validate(&env).unwrap_err(), CryptoError::SerializationError);
    env.key_id = "k1".to_string();

    // bad base64
    env.nonce = "not-valid-base64!".to_string();
    assert_eq!(validate(&env).unwrap_err(), CryptoError::InvalidBase64);
    env.nonce = BASE64_STANDARD.encode(&[0xbb; 12]);

    // nonce wrong length
    env.nonce = BASE64_STANDARD.encode(&[0xbb; 10]);
    assert_eq!(validate(&env).unwrap_err(), CryptoError::InvalidNonceLength);
    env.nonce = BASE64_STANDARD.encode(&[0xbb; 12]);

    // ciphertext too short (< 16 tag size)
    env.ciphertext = BASE64_STANDARD.encode(b"short");
    assert_eq!(validate(&env).unwrap_err(), CryptoError::SerializationError);
    env.ciphertext = BASE64_STANDARD.encode(b"0123456789012345");

    // enc wrong length for X25519 (should be 32)
    env.enc = BASE64_STANDARD.encode(&[0xaa; 31]);
    assert_eq!(validate(&env).unwrap_err(), CryptoError::InvalidKeyLength);
    env.enc = BASE64_STANDARD.encode(&[0xaa; 32]);

    // For X-Wing, enc must be 1120
    env.alg = ALG_XWING.to_string();
    env.enc = BASE64_STANDARD.encode(&[0xaa; 32]);
    assert_eq!(validate(&env).unwrap_err(), CryptoError::InvalidKeyLength);
    env.enc = BASE64_STANDARD.encode(&[0xaa; 1120]);
    assert!(validate(&env).is_ok());
}

#[test]
fn test_build_aad_layout() {
    let raw_enc = vec![0x11; 32];
    let raw_nonce = vec![0x22; 12];
    let aad = build_aad_raw(1, ALG_X25519, "key_01", 5, &raw_enc, &raw_nonce).unwrap();

    let mut expected = Vec::new();
    expected.push(1u8); // v
    expected.push(ALG_X25519.len() as u8); // alg len
    expected.extend_from_slice(ALG_X25519.as_bytes()); // alg
    expected.push("key_01".len() as u8); // key_id len
    expected.extend_from_slice(b"key_01"); // key_id
    expected.extend_from_slice(&5u32.to_be_bytes()); // epoch
    expected.extend_from_slice(&32u32.to_be_bytes()); // enc len
    expected.extend_from_slice(&raw_enc); // enc
    expected.push(12u8); // nonce len
    expected.extend_from_slice(&raw_nonce); // nonce

    assert_eq!(aad, expected);
}
