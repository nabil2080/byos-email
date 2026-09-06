FROM rustlang/rust:nightly-slim AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY packages/crypto-core/Cargo.toml packages/crypto-core/Cargo.toml
COPY packages/crypto-core/src packages/crypto-core/src

RUN cargo build --bin byos-native-crypto-worker --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/byos-native-crypto-worker .

EXPOSE 8084

CMD ["./byos-native-crypto-worker"]