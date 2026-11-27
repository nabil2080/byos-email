package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// IsDevelopment reports whether BYOS_ENV is explicitly set to "development".
// Any other value (production, staging, test, unset, empty, unknown)
// defaults strictly to fail-closed behavior.
func IsDevelopment() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("BYOS_ENV"))) == "development"
}

// ParseBoolEnv parses a boolean environment variable string using standard rules.
// It accepts "1", "t", "T", "true", "TRUE", "True", "yes", "YES" as true;
// and "0", "f", "F", "false", "FALSE", "False", "no", "NO", empty, unset, or invalid values as false.
func ParseBoolEnv(val string) bool {
	v := strings.TrimSpace(val)
	if b, err := strconv.ParseBool(v); err == nil {
		return b
	}
	return strings.EqualFold(v, "yes")
}

// IsDevMode reports whether BYOS_DEV_MODE is enabled AND the environment is development.
// If BYOS_ENV is not development, IsDevMode always returns false.
func IsDevMode() bool {
	return IsDevelopment() && ParseBoolEnv(os.Getenv("BYOS_DEV_MODE"))
}

// IsLegacyAuthEnabled reports whether legacy X-User-Id header auth is enabled.
// It is strictly restricted to development environments.
func IsLegacyAuthEnabled() bool {
	return IsDevelopment() && ParseBoolEnv(os.Getenv("BYOS_LEGACY_AUTH_ENABLED"))
}

// IsCookieSecure reports whether session cookies must have the Secure attribute set.
// It returns true if BYOS_COOKIE_SECURE is explicitly true, or if BYOS_ENV is not "development" (fail-closed).
func IsCookieSecure() bool {
	if ParseBoolEnv(os.Getenv("BYOS_COOKIE_SECURE")) {
		return true
	}
	return !IsDevelopment()
}

// GetDatabaseURL returns the active database connection string.
// In development, if unset, it falls back to the default local PostgreSQL connection string.
// In all other environments (production, staging, unset, empty), it fails closed if DATABASE_URL is not set.
func GetDatabaseURL() (string, error) {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn != "" {
		return dsn, nil
	}
	if IsDevelopment() {
		return "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable", nil
	}
	return "", fmt.Errorf("DATABASE_URL is required in non-development environments")
}

// getDatabaseDSN returns the active database DSN or an empty string if misconfigured.
// Using this helper ensures that non-development environments without DATABASE_URL
// fail immediately at connection time instead of silently falling back to dev credentials.
func getDatabaseDSN() string {
	dsn, err := GetDatabaseURL()
	if err != nil {
		return ""
	}
	return dsn
}

// ValidateStartupEnv verifies startup invariants and fail-closed security rules for Core API.
// It aborts startup if development conveniences or legacy authentication are enabled outside
// of development, or if required database configurations or proxy CIDRs are missing/invalid.
func ValidateStartupEnv() error {
	isDev := IsDevelopment()

	if ParseBoolEnv(os.Getenv("BYOS_DEV_MODE")) && !isDev {
		return fmt.Errorf("BYOS_DEV_MODE cannot be enabled when BYOS_ENV is not 'development'")
	}

	if ParseBoolEnv(os.Getenv("BYOS_LEGACY_AUTH_ENABLED")) && !isDev {
		return fmt.Errorf("BYOS_LEGACY_AUTH_ENABLED cannot be enabled when BYOS_ENV is not 'development'")
	}

	if !isDev {
		if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
			return fmt.Errorf("DATABASE_URL is required in non-development environments")
		}
	}

	// Validate trusted proxies configuration if provided
	if trustedProxies := strings.TrimSpace(os.Getenv("BYOS_TRUSTED_PROXIES")); trustedProxies != "" {
		if _, err := ParseTrustedProxies(trustedProxies); err != nil {
			return fmt.Errorf("invalid BYOS_TRUSTED_PROXIES configuration: %w", err)
		}
	}

	return nil
}
