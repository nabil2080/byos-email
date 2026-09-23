use byos_crypto_core::{
    derive_signing_key, unwrap_signing_seed, wasm_derive_signing_seed, wasm_sign_with_seed,
    wasm_signing_public_key_from_seed, wasm_unwrap_signing_seed, wasm_verify_signature,
    wasm_wrap_signing_seed, wrap_signing_seed,
};

#[test]
fn test_round_trip_wrap_unwrap() {
    let root = [0x42u8; 32];
    let mailbox_id = [0x24u8; 16];
    let epoch = 1;

    let sk = derive_signing_key(&root, &mailbox_id, epoch).expect("derive key");
    let seed = sk.to_bytes();

    let wrapped = wrap_signing_seed(&root, &seed, &mailbox_id).expect("wrap seed");
    let unwrapped = unwrap_signing_seed(&root, &wrapped, &mailbox_id).expect("unwrap seed");

    assert_eq!(seed, unwrapped);

    // Also test WASM functions round trip
    let root_hex = hex::encode(root);
    let mb_hex = hex::encode(mailbox_id);
    let seed_hex = wasm_derive_signing_seed(&root_hex, &mb_hex, epoch).expect("wasm derive seed");
    assert_eq!(seed_hex, hex::encode(seed));

    let wasm_wrapped =
        wasm_wrap_signing_seed(&root_hex, &seed_hex, &mb_hex).expect("wasm wrap");
    let wasm_unwrapped =
        wasm_unwrap_signing_seed(&root_hex, &wasm_wrapped, &mb_hex).expect("wasm unwrap");
    assert_eq!(seed_hex, wasm_unwrapped);
}

#[test]
fn test_derive_signing_seed_deterministic() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let epoch = 1;

    let seed1 = wasm_derive_signing_seed(root_hex, mb_hex, epoch).expect("seed 1");
    let seed2 = wasm_derive_signing_seed(root_hex, mb_hex, epoch).expect("seed 2");

    assert_eq!(seed1, seed2);
}

#[test]
fn test_derive_different_mailbox() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb1_hex = "11111111111111111111111111111111";
    let mb2_hex = "22222222222222222222222222222222";
    let epoch = 1;

    let seed1 = wasm_derive_signing_seed(root_hex, mb1_hex, epoch).expect("seed 1");
    let seed2 = wasm_derive_signing_seed(root_hex, mb2_hex, epoch).expect("seed 2");

    assert_ne!(seed1, seed2);
}

#[test]
fn test_derive_different_epoch() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";

    let seed_epoch1 = wasm_derive_signing_seed(root_hex, mb_hex, 1).expect("epoch 1");
    let seed_epoch2 = wasm_derive_signing_seed(root_hex, mb_hex, 2).expect("epoch 2");

    assert_ne!(seed_epoch1, seed_epoch2);
}

#[test]
fn test_sign_and_verify_with_seed() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let seed_hex = wasm_derive_signing_seed(root_hex, mb_hex, 1).expect("seed");
    let pub_key_hex = wasm_signing_public_key_from_seed(&seed_hex).expect("pubkey");

    let aad_hex = hex::encode(b"authenticated-additional-data");
    let ct_hex = hex::encode(b"sample-aes-gcm-ciphertext");

    let sig_hex = wasm_sign_with_seed(&seed_hex, &aad_hex, &ct_hex).expect("sign");
    let is_valid = wasm_verify_signature(&pub_key_hex, &aad_hex, &ct_hex, &sig_hex).expect("verify");
    assert!(is_valid);
}

#[test]
fn test_tamper_aad() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let seed_hex = wasm_derive_signing_seed(root_hex, mb_hex, 1).expect("seed");
    let pub_key_hex = wasm_signing_public_key_from_seed(&seed_hex).expect("pubkey");

    let aad_hex = hex::encode(b"authenticated-additional-data");
    let ct_hex = hex::encode(b"sample-aes-gcm-ciphertext");
    let sig_hex = wasm_sign_with_seed(&seed_hex, &aad_hex, &ct_hex).expect("sign");

    let tampered_aad_hex = hex::encode(b"tampered-additional-data");
    let is_valid = wasm_verify_signature(&pub_key_hex, &tampered_aad_hex, &ct_hex, &sig_hex)
        .expect("verify should return Ok(false)");
    assert!(!is_valid);
}

#[test]
fn test_tamper_ciphertext() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let seed_hex = wasm_derive_signing_seed(root_hex, mb_hex, 1).expect("seed");
    let pub_key_hex = wasm_signing_public_key_from_seed(&seed_hex).expect("pubkey");

    let aad_hex = hex::encode(b"authenticated-additional-data");
    let ct_hex = hex::encode(b"sample-aes-gcm-ciphertext");
    let sig_hex = wasm_sign_with_seed(&seed_hex, &aad_hex, &ct_hex).expect("sign");

    let tampered_ct_hex = hex::encode(b"tampered-ciphertext-data!");
    let is_valid = wasm_verify_signature(&pub_key_hex, &aad_hex, &tampered_ct_hex, &sig_hex)
        .expect("verify should return Ok(false)");
    assert!(!is_valid);
}

#[test]
fn test_rfc_8032_vector() {
    // RFC 8032 Section 7.1 Test 1:
    let seed_hex = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    let expected_pubkey_hex = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

    let derived_pubkey_hex =
        wasm_signing_public_key_from_seed(seed_hex).expect("derive pubkey from RFC seed");

    assert_eq!(derived_pubkey_hex, expected_pubkey_hex);
}
