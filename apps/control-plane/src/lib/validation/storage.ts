/**
 * Client-side validation mirroring server rules (server is source of truth).
 * Never logs credentials.
 */
export type ValidationResult = { ok: true } | { ok: false; field: string; message: string };

export function validateS3Config(config: Record<string, unknown>): ValidationResult {
  const required = ["endpoint", "bucket", "access_key", "secret_key"] as const;
  for (const k of required) {
    const v = config[k];
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, field: k, message: `Field ${k} must be non-empty string` };
    }
  }
  const allowed = new Set(["endpoint", "bucket", "access_key", "secret_key", "region", "path_style"]);
  for (const k of Object.keys(config)) {
    if (!allowed.has(k)) return { ok: false, field: k, message: `Unknown field: ${k}` };
  }
  if ("region" in config && typeof config["region"] !== "string") {
    return { ok: false, field: "region", message: "Field region must be string" };
  }
  if ("path_style" in config && typeof config["path_style"] !== "boolean") {
    return { ok: false, field: "path_style", message: "Field path_style must be boolean" };
  }
  for (const k of ["endpoint", "bucket", "access_key", "secret_key", "region"] as const) {
    if (k in config && typeof (config as Record<string, unknown>)[k] !== "string") {
      return { ok: false, field: k, message: `Field ${k} must be string` };
    }
  }
  return { ok: true };
}

export function validateMockConfig(config: Record<string, unknown>): ValidationResult {
  const allowed = new Set(["root"]);
  for (const k of Object.keys(config)) {
    if (!allowed.has(k)) return { ok: false, field: k, message: `Unknown field: ${k}` };
  }
  if ("root" in config && typeof config["root"] !== "string") {
    return { ok: false, field: "root", message: "Field root must be string" };
  }
  return { ok: true };
}

export function validateStorageConfig(
  provider: string,
  config: Record<string, unknown>
): ValidationResult {
  if (provider === "s3" || provider === "minio" || provider === "s3_compatible") {
    return validateS3Config(config);
  }
  if (provider === "google_drive_mock") {
    return validateMockConfig(config);
  }
  return { ok: false, field: "provider", message: "Invalid provider" };
}
