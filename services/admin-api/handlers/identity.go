package handlers

import (
	"context"
	"os"
)

// ContextKey defines a custom context key type for agent identity.
type ContextKey string

const (
	// AgentIdentityContextKey is the context key for authenticated agent identity.
	AgentIdentityContextKey ContextKey = "byos_agent_identity"
)

// AgentIdentity models the authenticated internal actor verified by server middleware.
type AgentIdentity struct {
	ActorID  string
	Email    string
	Role     string
	AuthType string // "mock", "cookie", "token"
}

// ContextWithAgentIdentity attaches an authenticated AgentIdentity to the context.
func ContextWithAgentIdentity(ctx context.Context, id AgentIdentity) context.Context {
	return context.WithValue(ctx, AgentIdentityContextKey, id)
}

// GetAgentIdentity retrieves the authenticated AgentIdentity from context.
func GetAgentIdentity(ctx context.Context) (AgentIdentity, bool) {
	id, ok := ctx.Value(AgentIdentityContextKey).(AgentIdentity)
	return id, ok
}

// IsDevModeEnabled checks if development mode is active.
func IsDevModeEnabled() bool {
	env := os.Getenv("BYOS_ENV")
	devMode := os.Getenv("BYOS_DEV_MODE")
	return (env == "development" || env == "") && (devMode == "true" || devMode == "1")
}
