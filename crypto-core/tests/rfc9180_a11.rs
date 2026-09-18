use crypto_core::hpke::*;

#[test]
fn test_rfc9180_vector_a11() {
    let sk_em_hex = "52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736";
    let pk_rm_hex = "3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d";
    let sk_rm_hex = "4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8";
    let expected_enc_hex = "37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431";
    let expected_ss_hex = "fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc";
    let expected_secret_hex = "12fff91991e93b48de37e7daddb52981084bd8aa64289c3788471d9a9712f397";

    let sk_em: [u8; 32] = hex::decode(sk_em_hex).unwrap().try_into().unwrap();
    let pk_rm: [u8; 32] = hex::decode(pk_rm_hex).unwrap().try_into().unwrap();
    let sk_rm: [u8; 32] = hex::decode(sk_rm_hex).unwrap().try_into().unwrap();

    // 1. Encapsulate with known ephemeral private key sk_em
    let (enc, shared_secret) = encapsulate_x25519_with_key(&sk_em, &pk_rm).unwrap();
    assert_eq!(hex::encode(enc), expected_enc_hex);
    assert_eq!(hex::encode(shared_secret), expected_ss_hex);

    // 2. Decapsulate with recipient private key sk_rm
    let decap_ss = decapsulate_x25519(&sk_rm, &enc).unwrap();
    assert_eq!(hex::encode(decap_ss), expected_ss_hex);

    // 3. RFC 9180 Section 5.1 secret derivation:
    // suite_id = "HPKE" || 0x0020 (DHKEM X25519) || 0x0001 (HKDF-SHA256) || 0x0001 (AES-128-GCM)
    let suite_id_vector = &[0x48, 0x50, 0x4b, 0x45, 0x00, 0x20, 0x00, 0x01, 0x00, 0x01];
    let secret = labeled_extract(Some(&shared_secret), "secret", None, suite_id_vector);
    assert_eq!(hex::encode(secret), expected_secret_hex);
}

#[test]
fn test_rfc9180_vector_a12_key_schedule() {
    let shared_secret_hex = "fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc";
    let shared_secret = hex::decode(shared_secret_hex).unwrap();

    // suite_id = "HPKE" || 0x0020 (DHKEM X25519) || 0x0001 (HKDF-SHA256) || 0x0001 (AES-128-GCM)
    let suite_id = &[b'H', b'P', b'K', b'E', 0x00, 0x20, 0x00, 0x01, 0x00, 0x01];

    // 1. Secret derivation per RFC 9180 §5.1:
    let secret = labeled_extract(Some(&shared_secret), "secret", None, suite_id);
    let expected_secret_hex = "12fff91991e93b48de37e7daddb52981084bd8aa64289c3788471d9a9712f397";
    assert_eq!(hex::encode(secret), expected_secret_hex);

    // 2. Key schedule context per RFC 9180 §5.1 for Appendix A.1.1 (Base Mode, info = "Ode on a Grecian Urn"):
    let info = b"Ode on a Grecian Urn";
    let psk_id_hash = labeled_extract(None, "psk_id_hash", None, suite_id);
    let info_hash = labeled_extract(None, "info_hash", Some(info), suite_id);

    let mut ks_context = Vec::new();
    ks_context.push(0x00);
    ks_context.extend_from_slice(&psk_id_hash);
    ks_context.extend_from_slice(&info_hash);

    // 3. AEAD key (16 bytes for AES-128-GCM)
    let key = labeled_expand(&secret, "key", Some(&ks_context), 16, suite_id);
    let expected_key_hex = "4531685d41d65f03dc48f6b8302c05b0";
    assert_eq!(hex::encode(key), expected_key_hex);

    // 4. Base nonce (12 bytes)
    let base_nonce = labeled_expand(&secret, "base_nonce", Some(&ks_context), 12, suite_id);
    let expected_nonce_hex = "56d890e5accaaf011cff4b7d";
    assert_eq!(hex::encode(base_nonce), expected_nonce_hex);
}
