export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 64;

const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
const COMMON_BASES = new Set([
  "password", "passwordpassword", "qwerty", "qwertyuiop", "letmein",
  "admin", "administrator", "welcome", "iloveyou", "changeme",
  "abc", "abcd", "abcdef", "abcdefgh", "idrmm", "idrmmconstruction",
]);

function predictable(password: string) {
  const letters = password.toLowerCase().replace(/[^a-z]/g, "");
  return COMMON_BASES.has(letters) || /^(.{1,8})\1{2,}$/u.test(password);
}

/** Shared by the forms and every server-side password write. */
export function getPasswordRequirements(password: string) {
  const length = Array.from(password).length;
  return [
    { id: "length", label: "15–64 characters", met: length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH, error: "Use a password between 15 and 64 characters." },
    { id: "uppercase", label: "An uppercase letter (A–Z)", met: /[A-Z]/.test(password), error: "Include at least one uppercase letter (A–Z)." },
    { id: "lowercase", label: "A lowercase letter (a–z)", met: /[a-z]/.test(password), error: "Include at least one lowercase letter (a–z)." },
    { id: "number", label: "A number (0–9)", met: /[0-9]/.test(password), error: "Include at least one number (0–9)." },
    { id: "symbol", label: "A symbol, such as ! @ #", met: Array.from(password).some(char => SYMBOLS.includes(char)), error: "Include at least one symbol, such as !, @, or #." },
    { id: "predictability", label: "Avoid common passwords and repeated patterns", met: !predictable(password), error: "Choose a less predictable password. Avoid common passwords and repeated patterns." },
  ];
}

export function getPasswordError(value: unknown): string | null {
  if (typeof value !== "string" || !value) return "Enter a password.";
  // Reject oversized input before allocating character/byte arrays. Supabase
  // uses bcrypt: never silently truncate a password beyond its 72-byte limit.
  if (value.length > PASSWORD_MAX_LENGTH * 2) return "Use a password between 15 and 64 characters.";
  if (new TextEncoder().encode(value).length > 72) return "Password is too long. Please use fewer characters.";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "Use printable letters, numbers, spaces, and symbols in your password.";
  return getPasswordRequirements(value).find(rule => !rule.met)?.error ?? null;
}

/** Web Crypto only; every generated password satisfies all the same rules. */
export function generateTemporaryPassword(): string {
  const groups = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*_-+?"];
  const all = groups.join("");
  const randomIndex = (limit: number) => {
    const byte = new Uint8Array(1);
    const ceiling = 256 - (256 % limit);
    do { crypto.getRandomValues(byte); } while (byte[0] >= ceiling);
    return byte[0] % limit;
  };
  for (;;) {
    const chars = groups.map(group => group[randomIndex(group.length)]);
    while (chars.length < 20) chars.push(all[randomIndex(all.length)]);
    for (let index = chars.length - 1; index > 0; index--) {
      const other = randomIndex(index + 1);
      [chars[index], chars[other]] = [chars[other], chars[index]];
    }
    const password = chars.join("");
    if (!getPasswordError(password)) return password;
  }
}
