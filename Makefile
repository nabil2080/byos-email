.PHONY: clean-test-data test-api test-webmail smoke help

clean-test-data:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./clean-test-data.ps1

test-api:
	cd services/api && go test ./... -count=1

test-webmail:
	cd apps/webmail && npm run typecheck && npm test -- --run

smoke:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./smoke.ps1

help:
	@echo "BYOS Development Targets:"
	@echo "  clean-test-data : Wipes all test-generated state and restores seed accounts"
	@echo "  test-api        : Runs Go API test suite"
	@echo "  test-webmail    : Runs Webmail TypeScript check and tests"
	@echo "  smoke           : Runs full end-to-end browser smoke test suite"
