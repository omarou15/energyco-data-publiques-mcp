const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`TIMEOUT après ${timeoutMs}ms : ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
