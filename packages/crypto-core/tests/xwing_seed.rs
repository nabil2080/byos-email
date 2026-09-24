use byos_crypto_core::{
    derive_signing_key, derive_xwing_seed, unwrap_xwing_seed, wasm_derive_signing_seed,
    wasm_derive_xwing_seed, wasm_unwrap_xwing_seed, wasm_wrap_xwing_seed,
    wasm_xwing_public_key_from_seed, wrap_xwing_seed,
};

#[test]
fn test_derive_xwing_seed_deterministic() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let epoch = 1;

    let seed1 = wasm_derive_xwing_seed(root_hex, mb_hex, epoch).expect("seed 1");
    let seed2 = wasm_derive_xwing_seed(root_hex, mb_hex, epoch).expect("seed 2");

    assert_eq!(seed1, seed2);
}

#[test]
fn test_derive_xwing_seed_different_mailbox() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb1_hex = "11111111111111111111111111111111";
    let mb2_hex = "22222222222222222222222222222222";
    let epoch = 1;

    let seed1 = wasm_derive_xwing_seed(root_hex, mb1_hex, epoch).expect("seed 1");
    let seed2 = wasm_derive_xwing_seed(root_hex, mb2_hex, epoch).expect("seed 2");

    assert_ne!(seed1, seed2);
}

#[test]
fn test_derive_xwing_seed_different_epoch() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";

    let seed_epoch1 = wasm_derive_xwing_seed(root_hex, mb_hex, 1).expect("epoch 1");
    let seed_epoch2 = wasm_derive_xwing_seed(root_hex, mb_hex, 2).expect("epoch 2");

    assert_ne!(seed_epoch1, seed_epoch2);
}

#[test]
fn test_derive_xwing_seed_different_root() {
    let root1_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let root2_hex = "99887766554433221100ffeeddccbbaa0102030405060708090a0b0c0d0e0f10";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let epoch = 1;

    let seed1 = wasm_derive_xwing_seed(root1_hex, mb_hex, epoch).expect("root 1");
    let seed2 = wasm_derive_xwing_seed(root2_hex, mb_hex, epoch).expect("root 2");

    assert_ne!(seed1, seed2);
}

#[test]
fn test_derive_xwing_seed_domain_separation() {
    let root = [0x5au8; 32];
    let mailbox_id = [0x3bu8; 16];
    let epoch = 1;

    let xwing_seed = derive_xwing_seed(&root, &mailbox_id, epoch).expect("derive xwing seed");
    let signing_key = derive_signing_key(&root, &mailbox_id, epoch).expect("derive signing key");
    let signing_seed = signing_key.to_bytes();

    assert_ne!(xwing_seed, signing_seed);

    // Also verify via WASM functions
    let root_hex = hex::encode(root);
    let mb_hex = hex::encode(mailbox_id);
    let wasm_xwing = wasm_derive_xwing_seed(&root_hex, &mb_hex, epoch).expect("wasm xwing");
    let wasm_signing = wasm_derive_signing_seed(&root_hex, &mb_hex, epoch).expect("wasm signing");

    assert_ne!(wasm_xwing, wasm_signing);
}

#[test]
fn test_xwing_public_key_from_seed_length() {
    let root_hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mb_hex = "aabbccddeeff00112233445566778899";
    let seed_hex = wasm_derive_xwing_seed(root_hex, mb_hex, 1).expect("derive seed");

    let pk_hex = wasm_xwing_public_key_from_seed(&seed_hex).expect("derive pk");
    let pk_bytes = hex::decode(&pk_hex).expect("decode hex");

    // X-Wing public key is 1216 bytes (1184 bytes ML-KEM-768 + 32 bytes X25519)
    assert_eq!(pk_bytes.len(), 1216);
    assert_eq!(pk_hex.len(), 1216 * 2);
}

#[test]
fn test_xwing_seed_wrap_unwrap_roundtrip() {
    let root = [0x42u8; 32];
    let mailbox_id = [0x24u8; 16];
    let epoch = 1;

    let seed = derive_xwing_seed(&root, &mailbox_id, epoch).expect("derive xwing seed");

    let wrapped = wrap_xwing_seed(&root, &seed, &mailbox_id).expect("wrap seed");
    let unwrapped = unwrap_xwing_seed(&root, &wrapped, &mailbox_id).expect("unwrap seed");

    assert_eq!(seed, unwrapped);

    // WASM round trip
    let root_hex = hex::encode(root);
    let mb_hex = hex::encode(mailbox_id);
    let seed_hex = wasm_derive_xwing_seed(&root_hex, &mb_hex, epoch).expect("wasm derive seed");
    assert_eq!(seed_hex, hex::encode(seed));

    let wasm_wrapped =
        wasm_wrap_xwing_seed(&root_hex, &seed_hex, &mb_hex).expect("wasm wrap");
    let wasm_unwrapped =
        wasm_unwrap_xwing_seed(&root_hex, &wasm_wrapped, &mb_hex).expect("wasm unwrap");
    assert_eq!(seed_hex, wasm_unwrapped);
}

#[test]
fn test_xwing_seed_wrap_tamper_fails() {
    let root = [0x42u8; 32];
    let mailbox_id = [0x24u8; 16];
    let wrong_mailbox_id = [0x99u8; 16];
    let epoch = 1;

    let seed = derive_xwing_seed(&root, &mailbox_id, epoch).expect("derive xwing seed");
    let mut wrapped = wrap_xwing_seed(&root, &seed, &mailbox_id).expect("wrap seed");

    // 1. Wrong mailbox AAD fails
    let err_aad = unwrap_xwing_seed(&root, &wrapped, &wrong_mailbox_id);
    assert!(err_aad.is_err());

    // 2. Tampered ciphertext byte fails
    let last_idx = wrapped.len() - 1;
    wrapped[last_idx] ^= 0x01;
    let err_ct = unwrap_xwing_seed(&root, &wrapped, &mailbox_id);
    assert!(err_ct.is_err());

    // 3. Wrong root key fails
    let wrong_root = [0x99u8; 32];
    let err_root = unwrap_xwing_seed(&wrong_root, &wrapped, &mailbox_id);
    assert!(err_root.is_err());

    // 4. Truncated envelope fails
    let err_trunc = unwrap_xwing_seed(&root, &wrapped[..10], &mailbox_id);
    assert!(err_trunc.is_err());
}
