use crypto_core::envelope::marshal_canonical;
use crypto_core::hpke::{generate_key_pair_x25519, seal_x25519_deterministic};
use crypto_core::{decrypt_envelope_bytes, load_private_key, ALG_X25519};

#[test]
fn test_decrypt_envelope_via_public_api() {
    // Simulate the flow JS will use:
    // 1. Generate a key pair
    let (priv_key, pub_key) = generate_key_pair_x25519();
    let eph_priv = [0x42u8; 32];
    let nonce = [0x24u8; 12];
    let plaintext = b"Simulated JS client envelope decryption test.";

    // 2. Encrypt a message (using seal_x25519_deterministic)
    let env = seal_x25519_deterministic(
        &pub_key,
        &eph_priv,
        plaintext,
        &nonce,
        "mbx_smoke_test",
        1,
    )
    .expect("seal failed");

    // 3. Serialize envelope to canonical JSON
    let canonical_bytes = marshal_canonical(&env).expect("marshal failed");
    let json_str = std::str::from_utf8(&canonical_bytes).expect("utf8 failed");

    // 4. Load private key through public API (slice inputs, no hex)
    let key_handle = load_private_key(&priv_key, ALG_X25519).expect("load_private_key failed");
    assert_eq!(key_handle.algorithm(), ALG_X25519);

    // 5. Decrypt envelope
    // Note: On native targets, js_sys::Uint8Array panics because there is no JS runtime.
    // decrypt_envelope_bytes executes the exact same unmarshaling, validation,
    // and decryption pipeline as decrypt_envelope before converting to Uint8Array.
    let decrypted = decrypt_envelope_bytes(json_str, &key_handle).expect("decryption failed");

    // 6. Assert plaintext matches
    assert_eq!(decrypted, plaintext);

    // 7. Verify drop_key completes cleanly
    crypto_core::drop_key(key_handle);
}
