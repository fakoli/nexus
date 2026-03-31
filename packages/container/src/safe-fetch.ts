/**
 * safeFetch — fetch wrapper that blocks SSRF via HTTP redirects.
 *
 * Uses redirect: "manual" and validates the Location header hostname
 * against the SSRF block list before following a single redirect hop.
 */
import { isBlockedHostname } from "./oci-auth.js";
import { OciSsrfBlockedError } from "./oci-client.js";

export interface SafeFetchOptions extends Omit<RequestInit, "redirect"> {
  /** Extra headers to send; merged with options.headers. */
  headers?: Record<string, string>;
}

/**
 * Performs a fetch that never follows redirects to internal/private addresses.
 * At most one redirect hop is followed (the redirect target itself is fetched
 * without further redirection to keep behaviour predictable).
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const res = await fetch(url, { ...options, redirect: "manual" });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) return res; // no Location — return redirect response as-is

    const redirectUrl = new URL(location, url);
    if (isBlockedHostname(redirectUrl.hostname)) {
      throw new OciSsrfBlockedError(
        `Redirect to blocked address: ${redirectUrl.hostname}`,
      );
    }

    // Follow the single redirect hop (no further redirects)
    return fetch(redirectUrl.toString(), { ...options, redirect: "manual" });
  }

  return res;
}
