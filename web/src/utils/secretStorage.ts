const encoder = new TextEncoder();

const SECRET_PREFIX = 'hivemindSecret:';
const KEY_STORAGE = 'hivemindSecretKey';

function toBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(payload: string): Uint8Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getCryptoKey(): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || typeof window.crypto === 'undefined' || !window.crypto.subtle) {
    return null;
  }

  const existing = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_STORAGE) : null;
  const keyMaterial = existing
    ? fromBase64(existing)
    : (() => {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(KEY_STORAGE, toBase64(bytes));
        }
        return bytes;
      })();

  return crypto.subtle.importKey('raw', keyMaterial.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function saveSecret(key: string, value: string) {
  if (typeof localStorage === 'undefined') return;
  const cryptoKey = await getCryptoKey();
  if (!cryptoKey) return;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = encoder.encode(value);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, cryptoKey, encoded);
  const payload = {
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher))
  };

  localStorage.setItem(`${SECRET_PREFIX}${key}`, JSON.stringify(payload));
}

export async function loadSecret(key: string): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null;
  const cryptoKey = await getCryptoKey();
  if (!cryptoKey) return null;

  const raw = localStorage.getItem(`${SECRET_PREFIX}${key}`);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as { iv: string; data: string };
    const iv = fromBase64(payload.iv);
    const data = fromBase64(payload.data);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      cryptoKey,
      data.buffer as ArrayBuffer
    );
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.warn('Unable to decrypt secret', error);
    return null;
  }
}

export function clearSecret(key: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(`${SECRET_PREFIX}${key}`);
}
