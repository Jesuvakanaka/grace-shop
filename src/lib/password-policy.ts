export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordChangeInput {
  username: string;
  currentPassword?: unknown;
  newPassword?: unknown;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Pure validation for a password change. No I/O; the route checks the current password hash. */
export function validatePasswordChange({ username, currentPassword, newPassword }: PasswordChangeInput): ValidationResult {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return { ok: false, error: 'Current password is required' };
  }
  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return { ok: false, error: 'New password is required' };
  }
  if (newPassword.trim().length === 0) {
    return { ok: false, error: 'New password cannot be blank' };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (newPassword.trim().toLowerCase() === username.trim().toLowerCase()) {
    return { ok: false, error: 'New password must not be the same as your username' };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: 'New password must be different from the current password' };
  }
  return { ok: true };
}
