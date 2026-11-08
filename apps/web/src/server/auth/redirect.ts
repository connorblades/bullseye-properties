/** Accept only an application path, never a host, protocol or authority. */
export function signInDestination(next: string | null, origin: string): URL {
  const fallback = new URL('/dashboard', origin);
  if (!next?.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) {
    return fallback;
  }
  try {
    const destination = new URL(next, origin);
    return destination.origin === origin ? destination : fallback;
  } catch {
    return fallback;
  }
}
