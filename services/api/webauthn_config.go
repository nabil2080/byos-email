package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WebAuthnUser implements the webauthn.User interface for BYOS account entities.
type WebAuthnUser struct {
	ID          []byte
	Email       string
	DisplayName string
	Credentials []webauthn.Credential
}

func (u *WebAuthnUser) WebAuthnID() []byte {
	return u.ID
}

func (u *WebAuthnUser) WebAuthnName() string {
	return u.Email
}

func (u *WebAuthnUser) WebAuthnDisplayName() string {
	if u.DisplayName != "" {
		return u.DisplayName
	}
	return u.Email
}

func (u *WebAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	return u.Credentials
}

// getWebAuthnConfig resolves the environment-specific Relying Party configuration.
// Local development strictly requires RP ID "localhost" and allowed origins on ports 3000 and 3001.
// Production requires strict HTTPS origins, no wildcard origins, and registered domain RP ID.
func getWebAuthnConfig() (*webauthn.Config, error) {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("BYOS_ENV")))
	rpIDEnv := strings.TrimSpace(os.Getenv("WEBAUTHN_RP_ID"))
	originsEnv := strings.TrimSpace(os.Getenv("WEBAUTHN_ORIGINS"))

	if env == "production" {
		rpID := rpIDEnv
		if rpID == "" {
			rpID = "byos.email"
		}
		if rpID == "localhost" || strings.Contains(rpID, "127.0.0.1") {
			return nil, fmt.Errorf("insecure RP ID disallowed in production: %s", rpID)
		}

		var origins []string
		if originsEnv != "" {
			for _, o := range strings.Split(originsEnv, ",") {
				o = strings.TrimSpace(o)
				if o == "" {
					continue
				}
				if !strings.HasPrefix(o, "https://") {
					return nil, fmt.Errorf("production WebAuthn origin must use HTTPS: %s", o)
				}
				if strings.Contains(o, "*") {
					return nil, fmt.Errorf("wildcard origins not permitted: %s", o)
				}
				origins = append(origins, o)
			}
		}
		if len(origins) == 0 {
			origins = []string{"https://app.byos.email", "https://mail.byos.email"}
		}

		return &webauthn.Config{
			RPDisplayName: "BYOS Secure Email",
			RPID:          rpID,
			RPOrigins:     origins,
			AuthenticatorSelection: protocol.AuthenticatorSelection{
				ResidentKey:      protocol.ResidentKeyRequirementPreferred,
				UserVerification: protocol.VerificationRequired,
			},
			AttestationPreference: protocol.PreferNoAttestation,
		}, nil
	}

	// Local Development / Test Configuration
	rpID := rpIDEnv
	if rpID == "" || rpID == "127.0.0.1" || strings.Contains(rpID, "127.0.0.1") {
		rpID = "localhost"
	}

	origins := []string{"http://localhost:3000", "http://localhost:3001", "http://localhost:5173", "http://localhost:8080"}
	if originsEnv != "" {
		for _, o := range strings.Split(originsEnv, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				origins = append(origins, o)
			}
		}
	}

	return &webauthn.Config{
		RPDisplayName: "BYOS Secure Email (Dev)",
		RPID:          rpID,
		RPOrigins:     origins,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationRequired,
		},
		AttestationPreference: protocol.PreferNoAttestation,
	}, nil
}

// getWebAuthn instantiates the WebAuthn engine with validated configuration.
func getWebAuthn() (*webauthn.WebAuthn, error) {
	cfg, err := getWebAuthnConfig()
	if err != nil {
		return nil, err
	}
	return webauthn.New(cfg)
}

// loadWebAuthnUser loads a user and their registered WebAuthn credentials from the database.
func loadWebAuthnUser(ctx context.Context, conn *pgx.Conn, userID string) (*WebAuthnUser, error) {
	var email, displayName string
	err := conn.QueryRow(ctx, `
		SELECT email, COALESCE(display_name, email)
		FROM users
		WHERE id=$1 AND is_active=true
	`, userID).Scan(&email, &displayName)
	if err != nil {
		return nil, fmt.Errorf("user not found or inactive: %w", err)
	}

	uidParsed, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("invalid user uuid: %w", err)
	}
	userHandle := uidParsed[:]

	rows, err := conn.Query(ctx, `
		SELECT credential_id, public_key, counter, aaguid
		FROM user_passkeys
		WHERE user_id=$1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query passkeys: %w", err)
	}
	defer rows.Close()

	var credentials []webauthn.Credential
	for rows.Next() {
		var credIDStr, pubKeyStr string
		var counter int64
		var aaguid *string
		if err := rows.Scan(&credIDStr, &pubKeyStr, &counter, &aaguid); err != nil {
			continue
		}

		credBytes, err := base64.RawURLEncoding.DecodeString(credIDStr)
		if err != nil {
			credBytes = []byte(credIDStr)
		}

		var cred webauthn.Credential
		if strings.HasPrefix(strings.TrimSpace(pubKeyStr), "{") {
			if err := json.Unmarshal([]byte(pubKeyStr), &cred); err == nil && len(cred.PublicKey) > 0 {
				if len(cred.ID) == 0 {
					cred.ID = credBytes
				}
				cred.Authenticator.SignCount = uint32(counter)
				credentials = append(credentials, cred)
				continue
			}
		}

		// Fallback for raw public key or legacy record
		cred = webauthn.Credential{
			ID:        credBytes,
			PublicKey: []byte(pubKeyStr),
			Authenticator: webauthn.Authenticator{
				SignCount: uint32(counter),
			},
		}
		if aaguid != nil && *aaguid != "" {
			aaguidBytes, _ := hexDecodeString(*aaguid)
			cred.Authenticator.AAGUID = aaguidBytes
		}
		credentials = append(credentials, cred)
	}

	return &WebAuthnUser{
		ID:          userHandle,
		Email:       email,
		DisplayName: displayName,
		Credentials: credentials,
	}, nil
}

// determineEffectiveOrigin inspects the HTTP request to extract the calling origin.
func determineEffectiveOrigin(r *http.Request) string {
	if origin := r.Header.Get("Origin"); origin != "" {
		if u, err := url.Parse(origin); err == nil && u.Scheme != "" && u.Host != "" {
			return fmt.Sprintf("%s://%s", u.Scheme, u.Host)
		}
	}
	return ""
}
