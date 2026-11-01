-- 064_support_ticketing_system.sql
-- BYOS Support Platform Phase 01: Core Ticketing System
-- Shared database foundation for Customer Help Desk and Internal Support CRM

-- 1. Support Agents Table
CREATE TABLE IF NOT EXISTS support_agents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text UNIQUE NOT NULL,
    display_name text NOT NULL,
    role         text NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'senior_agent', 'admin')),
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 2. Support Tickets Table
CREATE TABLE IF NOT EXISTS support_tickets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number      text UNIQUE NOT NULL,
    customer_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    org_id             uuid REFERENCES organizations(id) ON DELETE SET NULL,
    subject            text NOT NULL,
    product_area       text NOT NULL DEFAULT 'other' CHECK (product_area IN ('mail', 'account', 'security', 'domains', 'storage', 'calendar', 'org_mgmt', 'billing', 'bug_report', 'feature_request', 'other')),
    category           text NOT NULL DEFAULT 'general',
    priority           text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'pending_customer', 'in_progress', 'resolved', 'closed')),
    assigned_agent_id  uuid REFERENCES support_agents(id) ON DELETE SET NULL,
    first_response_at  timestamptz,
    resolved_at        timestamptz,
    closed_at          timestamptz,
    last_activity_at   timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 3. Support Ticket Messages Table
CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_type text NOT NULL CHECK (author_type IN ('customer', 'agent', 'system')),
    author_id   uuid NOT NULL,
    author_name text NOT NULL,
    body        text NOT NULL,
    visibility  text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Indexes for Query Optimization
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets(customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_org ON support_tickets(org_id, created_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, priority, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_visibility ON support_ticket_messages(ticket_id, visibility, created_at ASC);

-- 5. Seed Default Staff Agents (if none exist)
INSERT INTO support_agents (id, email, display_name, role, is_active)
VALUES 
    ('11111111-2222-3333-4444-555555555501', 'sarah.support@byos.local', 'Sarah Chen (Tier 2)', 'senior_agent', true),
    ('11111111-2222-3333-4444-555555555502', 'marcus.support@byos.local', 'Marcus Vance (Support)', 'agent', true)
ON CONFLICT (email) DO UPDATE SET is_active = true;

-- 6. Grant Least-Privilege Access to role_support_agent
-- role_support_agent is used by services/admin-api
GRANT SELECT, INSERT, UPDATE ON support_tickets TO role_support_agent;
GRANT SELECT, INSERT ON support_ticket_messages TO role_support_agent;
GRANT SELECT, INSERT, UPDATE ON support_agents TO role_support_agent;
