package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// IsDevelopment reports whether BYOS_ENV is explicitly set to "development".
// Any other value (including unset/empty, "production", "staging", "test")
// returns false to enforce fail-closed behavior.
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

// IsCookieSecure reports whether session cookies must have the Secure attribute set.
// It returns true if BYOS_COOKIE_SECURE is explicitly true, or if BYOS_ENV is not "development" (fail-closed).
func IsCookieSecure() bool {
	if ParseBoolEnv(os.Getenv("BYOS_COOKIE_SECURE")) {
		return true
	}
	return !IsDevelopment()
}

// ValidateStartupEnv validates environment configuration for admin-api.
// Fails closed if development-only features (such as BYOS_DEV_MODE) are enabled
// in non-development environments, or if required secrets/URLs are missing.
func ValidateStartupEnv() error {
	if ParseBoolEnv(os.Getenv("BYOS_DEV_MODE")) && !IsDevelopment() {
		return fmt.Errorf("BYOS_DEV_MODE cannot be enabled when BYOS_ENV is not 'development'")
	}

	if !IsDevelopment() {
		dbURL := strings.TrimSpace(os.Getenv("SUPPORT_DB_URL"))
		if dbURL == "" {
			return fmt.Errorf("SUPPORT_DB_URL is required in non-development environments")
		}
	}

	return nil
}

// GetSupportDatabaseURL returns the support database connection string or an error if misconfigured.
// In development mode, falls back to the default local development database credentials.
// In non-development mode, requires SUPPORT_DB_URL to be explicitly configured.
func GetSupportDatabaseURL() (string, error) {
	connStr := strings.TrimSpace(os.Getenv("SUPPORT_DB_URL"))
	if connStr != "" {
		return connStr, nil
	}
	if IsDevelopment() {
		return "postgres://role_support_agent:support_crm_password@localhost:5432/byos", nil
	}
	return "", fmt.Errorf("SUPPORT_DB_URL is required in non-development environments")
}
