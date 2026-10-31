.PHONY: clean-test-data test-api test-webmail smoke help test-crypto

clean-test-data:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./clean-test-data.ps1

test-api:
	cd services/api && go test ./... -count=1

test-webmail:
	cd apps/webmail && npm run typecheck && npm test -- --run

smoke:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/smoke.ps1

test-crypto:
	docker run --rm -v $(CURDIR):/workspace -w /workspace rustlang/rust:nightly-slim cargo test --manifest-path packages/crypto-core/Cargo.toml

help:
	@echo "BYOS Development Targets:"
	@echo "  clean-test-data : Wipes all test-generated state and restores seed accounts"
	@echo "  test-api        : Runs Go API test suite"
	@echo "  test-webmail    : Runs Webmail TypeScript check and tests"
	@echo "  test-crypto     : Runs Rust/Wasm cryptographic test suites via container"
	@echo "  smoke           : Runs full end-to-end browser smoke test suite"
