function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export async function register(email: string, password: string): Promise<{ id: string; email: string; org_id: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Register failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { id: string; email: string; org_id: string };
}

export async function login(email: string, password: string): Promise<{ id: string; email: string; org_id: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Login failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { id: string; email: string; org_id: string };
}

export async function logout(): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Logout failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}

export async function me(): Promise<{ id: string; email: string; org_id: string; display_name: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/me`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Not authenticated ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { id: string; email: string; org_id: string; display_name: string };
}
