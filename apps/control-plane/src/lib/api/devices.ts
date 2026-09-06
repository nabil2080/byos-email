function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface Device {
  id: string;
  device_name: string;
}

/**
 * Enroll a new device.
 * - device_pk: base64-encoded 32-byte X25519 public key (generated client-side).
 * - mailbox_id + wrapped_root_secret: optional; provide to grant the device access
 *   to a specific mailbox immediately. wrapped_root_secret is the root secret
 *   already HPKE-sealed to device_pk on the client; the server never sees it unwrapped.
 */
export async function enrollDevice(params: {
  device_name: string;
  device_pk: string;
  mailbox_id?: string;
  wrapped_root_secret?: string;
}): Promise<Device> {
  const res = await fetch(`${apiBase()}/v1/auth/device-enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Device enroll failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as Device;
}

/**
 * Revoke a device by ID. The caller must own the device.
 * Revocation removes the device row and marks all mailbox access grants inactive.
 */
export async function revokeDevice(deviceId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/auth/device-revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Device revoke failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}
