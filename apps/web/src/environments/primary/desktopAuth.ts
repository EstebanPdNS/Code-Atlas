let desktopBearerTokenPromise: Promise<string> | null = null;
let desktopBearerTokenRejected = false;

export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const bridge = window.desktopBridge;
  if (!bridge) {
    return Promise.resolve(null);
  }

  if (desktopBearerTokenPromise === null) {
    // The desktop caches the token too, so a rejected one must be replaced there.
    const refresh = desktopBearerTokenRejected;
    desktopBearerTokenRejected = false;
    desktopBearerTokenPromise = bridge
      .getLocalEnvironmentBearerToken(refresh ? { refresh: true } : undefined)
      .catch((error) => {
        desktopBearerTokenPromise = null;
        desktopBearerTokenRejected ||= refresh;
        throw error;
      });
  }
  return desktopBearerTokenPromise;
}

export function invalidateDesktopPrimaryBearerToken(): void {
  desktopBearerTokenPromise = null;
  desktopBearerTokenRejected = true;
}

export function __resetDesktopPrimaryAuthForTests(): void {
  desktopBearerTokenPromise = null;
  desktopBearerTokenRejected = false;
}
