import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";

import {
  __resetDesktopPrimaryAuthForTests,
  invalidateDesktopPrimaryBearerToken,
  readDesktopPrimaryBearerToken,
} from "./desktopAuth";

describe("desktop primary auth", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    __resetDesktopPrimaryAuthForTests();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("reuses the main-process bearer token across renderer requests", async () => {
    const getLocalEnvironmentBearerToken = vi.fn().mockResolvedValue("desktop-bearer-token");
    window.desktopBridge = {
      getLocalEnvironmentBearerToken,
    } as unknown as DesktopBridge;

    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
    expect(getLocalEnvironmentBearerToken).toHaveBeenCalledTimes(1);
  });

  it("asks the main process for a fresh token after the host rejects the cached one", async () => {
    const getLocalEnvironmentBearerToken = vi
      .fn()
      .mockResolvedValueOnce("stale-token")
      .mockRejectedValueOnce(new Error("Backend is restarting."))
      .mockResolvedValueOnce("fresh-token");
    window.desktopBridge = {
      getLocalEnvironmentBearerToken,
    } as unknown as DesktopBridge;

    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("stale-token");
    invalidateDesktopPrimaryBearerToken();
    await expect(readDesktopPrimaryBearerToken()).rejects.toThrow("Backend is restarting.");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("fresh-token");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("fresh-token");

    expect(getLocalEnvironmentBearerToken.mock.calls).toEqual([
      [undefined],
      [{ refresh: true }],
      [{ refresh: true }],
    ]);
  });

  it("does not require desktop auth in a browser", async () => {
    await expect(readDesktopPrimaryBearerToken()).resolves.toBeNull();
  });
});
