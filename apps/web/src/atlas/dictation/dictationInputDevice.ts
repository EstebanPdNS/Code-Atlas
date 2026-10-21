/**
 * Code Atlas: which microphone dictation records from. Kept per device in
 * localStorage; an unplugged choice falls back to the system default because
 * the constraint is `ideal`, not `exact`.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "codeatlas:dictation-input-device";

export function readPreferredInputDeviceId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePreferredInputDeviceId(deviceId: string | null): void {
  try {
    if (deviceId === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    // Storage can be unavailable; dictation then uses the system default.
  }
}

/** Extra getUserMedia audio constraints for the preferred microphone, if any. */
export function preferredInputDeviceConstraint(): { deviceId?: { ideal: string } } {
  const deviceId = readPreferredInputDeviceId();
  return deviceId ? { deviceId: { ideal: deviceId } } : {};
}

export interface InputDevice {
  readonly deviceId: string;
  readonly label: string;
}

/** Microphones the system reports; labels appear once microphone access was granted. */
export function useInputDevices(enabled: boolean): readonly InputDevice[] {
  const [devices, setDevices] = useState<readonly InputDevice[]>([]);
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const load = () =>
      void navigator.mediaDevices.enumerateDevices().then((all) => {
        if (cancelled) return;
        setDevices(
          all
            .filter((device) => device.kind === "audioinput" && device.deviceId !== "default")
            .map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label || `Microphone ${index + 1}`,
            })),
        );
      });
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, [enabled]);
  return devices;
}
