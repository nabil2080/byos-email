use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use byos_crypto_core::{
    canonical_bundle_hash, encrypt_message, encrypt_outbound, hpke_seal, AAD_VERSION, ENCRYPTION_VERSION,
};
use serde::{Deserialize, Serialize};
use std::{env, net::SocketAddr};
use uuid::Uuid;

#[derive(Clone, Default)]
struct AppState;

#[derive(Deserialize)]
struct EncryptRequest {
    mailbox_id: String,
    message_seq: u64,
    mailbox_public_key: String,
    plaintext: String,
    storage_object_id: String,
    mailbox_sk_version: u32,
}

#[derive(Serialize)]
struct EncryptResponse {
    ciphertext: String,
    content_key_hpke_wrapped: String,
    encryption_iv: String,
    bundle_hash: String,
    encryption_version: u32,
    aad_version: u8,
}


#[derive(Deserialize)]
struct EncryptOutboundRequest {
    outbound_delivery_pk: String,
    mailbox_id: String,
    outbox_seq: u64,
    plaintext: String,
}

#[derive(Serialize)]
struct EncryptOutboundResponse {
    encrypted_message: String,
    send_token_hpke_wrapped: String,
    encryption_iv: String,
    encryption_version: u32,
    aad_version: u8,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    implementation: &'static str,
}

type ApiResult<T> = Result<Json<T>, (StatusCode, String)>;

#[tokio::main]
async fn main() {
    let port = env::var("CRYPTO_WORKER_PORT").unwrap_or_else(|_| "8084".to_owned());
    let addr: SocketAddr = format!("0.0.0.0:{port}")
        .parse()
        .expect("CRYPTO_WORKER_PORT must be a valid TCP port");

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/encrypt", post(encrypt))
        .route("/v1/encrypt-outbound", post(encrypt_outbound_handler))
        .route("/v1/outbound/decrypt", post(decrypt_outbound_handler))
        .with_state(AppState);

    println!("BYOS native crypto worker using Rust crypto core on {addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind crypto worker");
    axum::serve(listener, app)
        .await
        .expect("serve crypto worker");
}

async fn health(State(_state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        service: "crypto-worker",
        implementation: "byos-crypto-core-native",
    })
}

async fn encrypt(
    State(_state): State<AppState>,
    Json(request): Json<EncryptRequest>,
) -> ApiResult<EncryptResponse> {
    let mailbox_id = parse_mailbox_id(&request.mailbox_id)?;
    let mailbox_public_key = decode_fixed_32(&request.mailbox_public_key, "mailbox_public_key")?;
    let plaintext = decode(&request.plaintext, "plaintext")?;

    if request.storage_object_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "storage_object_id is required".to_owned(),
        ));
    }

    let (content_key, ciphertext, iv, aad) =
        encrypt_message(&mailbox_id, request.message_seq, &plaintext).map_err(crypto_error)?;
    let content_key_hpke_wrapped =
        hpke_seal(&mailbox_public_key, &content_key, &aad).map_err(crypto_error)?;
    let bundle_hash = canonical_bundle_hash(
        request.storage_object_id.as_bytes(),
        &ciphertext,
        &content_key_hpke_wrapped,
        ENCRYPTION_VERSION,
        request.mailbox_sk_version,
        &iv,
        AAD_VERSION,
    );

    Ok(Json(EncryptResponse {
        ciphertext: BASE64.encode(ciphertext),
        content_key_hpke_wrapped: BASE64.encode(content_key_hpke_wrapped),
        encryption_iv: BASE64.encode(iv),
        bundle_hash: BASE64.encode(bundle_hash),
        encryption_version: ENCRYPTION_VERSION,
        aad_version: AAD_VERSION,
    }))
}

#[derive(Deserialize)]
struct DecryptOutboundRequest {
    outbound_delivery_sk: String,
    send_token_wrapped: String,
    mailbox_id: String,
    message_seq: u64,
    ciphertext: String,
}

#[derive(Serialize)]
struct DecryptOutboundResponse {
    plaintext: String,
}

async fn decrypt_outbound_handler(
    State(_state): State<AppState>,
    Json(request): Json<DecryptOutboundRequest>,
) -> ApiResult<DecryptOutboundResponse> {
    let sk = decode_fixed_32(&request.outbound_delivery_sk, "outbound_delivery_sk")?;
    let send_token_wrapped = decode(&request.send_token_wrapped, "send_token_wrapped")?;
    let mailbox_id = parse_mailbox_id(&request.mailbox_id)?;
    let ciphertext = decode(&request.ciphertext, "ciphertext")?;

    let plaintext = byos_crypto_core::decrypt_outbound(
        &sk,
        &send_token_wrapped,
        &mailbox_id,
        request.message_seq,
        &ciphertext,
    )
    .map_err(crypto_error)?;

    Ok(Json(DecryptOutboundResponse {
        plaintext: BASE64.encode(plaintext),
    }))
}


async fn encrypt_outbound_handler(
    State(_state): State<AppState>,
    Json(request): Json<EncryptOutboundRequest>,
) -> ApiResult<EncryptOutboundResponse> {
    let pk = decode_fixed_32(&request.outbound_delivery_pk, "outbound_delivery_pk")?;
    let mailbox_id = parse_mailbox_id(&request.mailbox_id)?;
    let plaintext = decode(&request.plaintext, "plaintext")?;

    let (ciphertext, send_token_wrapped, iv, _aad, _content_key) =
        encrypt_outbound(&pk, &mailbox_id, request.outbox_seq, &plaintext).map_err(crypto_error)?;

    Ok(Json(EncryptOutboundResponse {
        encrypted_message: BASE64.encode(ciphertext),
        send_token_hpke_wrapped: BASE64.encode(send_token_wrapped),
        encryption_iv: BASE64.encode(iv),
        encryption_version: ENCRYPTION_VERSION,
        aad_version: AAD_VERSION,
    }))
}

fn parse_mailbox_id(value: &str) -> Result<[u8; 16], (StatusCode, String)> {
    Uuid::parse_str(value).map(Uuid::into_bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "mailbox_id must be a UUID".to_owned(),
        )
    })
}

fn decode(value: &str, field: &str) -> Result<Vec<u8>, (StatusCode, String)> {
    BASE64
        .decode(value)
        .map_err(|_| (StatusCode::BAD_REQUEST, format!("{field} must be base64")))
}

fn decode_fixed_32(value: &str, field: &str) -> Result<[u8; 32], (StatusCode, String)> {
    let bytes = decode(value, field)?;
    bytes.try_into().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("{field} must decode to 32 bytes"),
        )
    })
}

fn crypto_error(error: byos_crypto_core::CryptoError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}