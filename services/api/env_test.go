package main

import (
	"strings"
	"testing"
)

func TestIsDevelopment(t *testing.T) {
	cases := []struct {
		env  string
		want bool
	}{
		{"development", true},
		{"DEVELOPMENT", true},
		{" Development ", true},
		{"production", false},
		{"PRODUCTION", false},
		{"staging", false},
		{"test", false},
		{"dev", false},
		{"", false},
		{"unknown", false},
	}

	for _, tc := range cases {
		t.Run("Env_"+tc.env, func(t *testing.T) {
			t.Setenv("BYOS_ENV", tc.env)
			got := IsDevelopment()
			if got != tc.want {
				t.Errorf("IsDevelopment() for BYOS_ENV=%q: got %v, want %v", tc.env, got, tc.want)
			}
		})
	}
}

func TestValidateStartupEnv_CoreAPI(t *testing.T) {
	validDB := "postgres://byos:secret@db.internal:5432/byos?sslmode=verify-full"

	cases := []struct {
		name       string
		env        string
		devMode    string
		legacyAuth string
		dbURL      string
		proxies    string
		expectErr  bool
		errSubstr  string
	}{
		{
			name:      "dev mode valid default",
			env:       "development",
			dbURL:     "",
			expectErr: false,
		},
		{
			name:       "dev mode with dev conveniences enabled",
			env:        "development",
			devMode:    "1",
			legacyAuth: "1",
			dbURL:      "",
			expectErr:  false,
		},
		{
			name:       "production fails if dev mode enabled",
			env:        "production",
			devMode:    "1",
			legacyAuth: "0",
			dbURL:      validDB,
			expectErr:  true,
			errSubstr:  "BYOS_DEV_MODE cannot be enabled",
		},
		{
			name:       "unset env fails if dev mode enabled",
			env:        "",
			devMode:    "true",
			legacyAuth: "0",
			dbURL:      validDB,
			expectErr:  true,
			errSubstr:  "BYOS_DEV_MODE cannot be enabled",
		},
		{
			name:       "production fails if legacy auth enabled",
			env:        "production",
			devMode:    "0",
			legacyAuth: "true",
			dbURL:      validDB,
			expectErr:  true,
			errSubstr:  "BYOS_LEGACY_AUTH_ENABLED cannot be enabled",
		},
		{
			name:       "unset env fails if legacy auth enabled",
			env:        "",
			devMode:    "0",
			legacyAuth: "1",
			dbURL:      validDB,
			expectErr:  true,
			errSubstr:  "BYOS_LEGACY_AUTH_ENABLED cannot be enabled",
		},
		{
			name:       "staging fails if legacy auth enabled",
			env:        "staging",
			devMode:    "0",
			legacyAuth: "1",
			dbURL:      validDB,
			expectErr:  true,
			errSubstr:  "BYOS_LEGACY_AUTH_ENABLED cannot be enabled",
		},
		{
			name:       "production fails if DATABASE_URL missing",
			env:        "production",
			devMode:    "0",
			legacyAuth: "0",
			dbURL:      "",
			expectErr:  true,
			errSubstr:  "DATABASE_URL is required",
		},
		{
			name:       "unset env fails if DATABASE_URL missing",
			env:        "",
			devMode:    "0",
			legacyAuth: "0",
			dbURL:      "",
			expectErr:  true,
			errSubstr:  "DATABASE_URL is required",
		},
		{
			name:       "production valid config with valid proxy CIDRs",
			env:        "production",
			devMode:    "0",
			legacyAuth: "0",
			dbURL:      validDB,
			proxies:    "127.0.0.1/32,10.0.0.0/8,172.16.0.0/12",
			expectErr:  false,
		},
		{
			name:       "fails on invalid trusted proxy CIDR",
			env:        "production",
			devMode:    "0",
			legacyAuth: "0",
			dbURL:      validDB,
			proxies:    "127.0.0.1/32,not-an-ip-or-cidr",
			expectErr:  true,
			errSubstr:  "invalid BYOS_TRUSTED_PROXIES",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BYOS_ENV", tc.env)
			t.Setenv("BYOS_DEV_MODE", tc.devMode)
			t.Setenv("BYOS_LEGACY_AUTH_ENABLED", tc.legacyAuth)
			t.Setenv("DATABASE_URL", tc.dbURL)
			t.Setenv("BYOS_TRUSTED_PROXIES", tc.proxies)

			err := ValidateStartupEnv()
			if tc.expectErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if tc.errSubstr != "" && !strings.Contains(err.Error(), tc.errSubstr) {
					t.Fatalf("expected error to contain %q, got %q", tc.errSubstr, err.Error())
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
			}
		})
	}
}

func TestGetDatabaseURL(t *testing.T) {
	t.Run("DevelopmentFallback", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "development")
		t.Setenv("DATABASE_URL", "")

		dsn, err := GetDatabaseURL()
		if err != nil {
			t.Fatalf("expected fallback DSN in dev, got error: %v", err)
		}
		if dsn != "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable" {
			t.Fatalf("unexpected fallback DSN: %s", dsn)
		}
	})

	t.Run("ProductionRequiresDATABASE_URL", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "production")
		t.Setenv("DATABASE_URL", "")

		_, err := GetDatabaseURL()
		if err == nil {
			t.Fatal("expected error in production when DATABASE_URL is empty")
		}
	})

	t.Run("UnsetEnvRequiresDATABASE_URL", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "")
		t.Setenv("DATABASE_URL", "")

		_, err := GetDatabaseURL()
		if err == nil {
			t.Fatal("expected error when BYOS_ENV is unset and DATABASE_URL is empty")
		}
	})

	t.Run("ExplicitDATABASE_URLReturned", func(t *testing.T) {
		custom := "postgres://app:secure_prod_pw@pg.prod:5432/byos_prod?sslmode=verify-full"
		t.Setenv("BYOS_ENV", "production")
		t.Setenv("DATABASE_URL", custom)

		dsn, err := GetDatabaseURL()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if dsn != custom {
			t.Fatalf("expected %q, got %q", custom, dsn)
		}
	})
}

func TestBooleanConfigurationConsistency_CoreAPI(t *testing.T) {
	testCases := []struct {
		val      string
		isTruthy bool
	}{
		{"1", true},
		{"true", true},
		{"TRUE", true},
		{"false", false},
		{"0", false},
		{"", false},
		{"invalid", false},
		{"banana", false},
	}

	validDB := "postgres://byos:secret@db.internal:5432/byos?sslmode=verify-full"

	for _, tc := range testCases {
		t.Run("Value_"+tc.val, func(t *testing.T) {
			// 1. Verify ParseBoolEnv
			parsed := ParseBoolEnv(tc.val)
			if parsed != tc.isTruthy {
				t.Errorf("ParseBoolEnv(%q) = %v, want %v", tc.val, parsed, tc.isTruthy)
			}

			// 2. ValidateStartupEnv with BYOS_DEV_MODE outside development
			t.Setenv("BYOS_ENV", "production")
			t.Setenv("BYOS_DEV_MODE", tc.val)
			t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "")
			t.Setenv("DATABASE_URL", validDB)
			errDevMode := ValidateStartupEnv()
			if tc.isTruthy && errDevMode == nil {
				t.Errorf("expected ValidateStartupEnv to fail in production with BYOS_DEV_MODE=%q", tc.val)
			}
			if !tc.isTruthy && errDevMode != nil {
				t.Errorf("expected ValidateStartupEnv to pass in production with non-truthy BYOS_DEV_MODE=%q, got: %v", tc.val, errDevMode)
			}

			// 3. ValidateStartupEnv with BYOS_LEGACY_AUTH_ENABLED outside development
			t.Setenv("BYOS_ENV", "production")
			t.Setenv("BYOS_DEV_MODE", "")
			t.Setenv("BYOS_LEGACY_AUTH_ENABLED", tc.val)
			t.Setenv("DATABASE_URL", validDB)
			errLegacy := ValidateStartupEnv()
			if tc.isTruthy && errLegacy == nil {
				t.Errorf("expected ValidateStartupEnv to fail in production with BYOS_LEGACY_AUTH_ENABLED=%q", tc.val)
			}
			if !tc.isTruthy && errLegacy != nil {
				t.Errorf("expected ValidateStartupEnv to pass in production with non-truthy BYOS_LEGACY_AUTH_ENABLED=%q, got: %v", tc.val, errLegacy)
			}

			// 4. Runtime legacy auth check in production (must NEVER be enabled)
			t.Setenv("BYOS_ENV", "production")
			t.Setenv("BYOS_LEGACY_AUTH_ENABLED", tc.val)
			if isLegacyAuthEnabled() {
				t.Errorf("isLegacyAuthEnabled() must be false in production for value %q", tc.val)
			}

			// 5. Runtime legacy auth check in development (interpretation matches isTruthy)
			t.Setenv("BYOS_ENV", "development")
			t.Setenv("BYOS_LEGACY_AUTH_ENABLED", tc.val)
			if isLegacyAuthEnabled() != tc.isTruthy {
				t.Errorf("isLegacyAuthEnabled() in dev for %q: got %v, want %v", tc.val, isLegacyAuthEnabled(), tc.isTruthy)
			}

			// 6. Runtime IsDevMode check in development
			t.Setenv("BYOS_ENV", "development")
			t.Setenv("BYOS_DEV_MODE", tc.val)
			if IsDevMode() != tc.isTruthy {
				t.Errorf("IsDevMode() in dev for %q: got %v, want %v", tc.val, IsDevMode(), tc.isTruthy)
			}
		})
	}

	t.Run("Unset", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "production")
		t.Setenv("DATABASE_URL", validDB)
		t.Setenv("BYOS_DEV_MODE", "")
		t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "")
		if err := ValidateStartupEnv(); err != nil {
			t.Errorf("expected ValidateStartupEnv to pass in production with unset flags, got: %v", err)
		}

		t.Setenv("BYOS_ENV", "development")
		if isLegacyAuthEnabled() {
			t.Errorf("expected isLegacyAuthEnabled to be false with unset flag in dev")
		}
		if IsDevMode() {
			t.Errorf("expected IsDevMode to be false with unset flag in dev")
		}
	})
}

