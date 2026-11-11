import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

export const IOSURFACE_WARN_ABOVE = 4000;
export const IOSURFACE_POLL_MS = 60_000;

/** True only for the first count above the threshold. */
export function shouldWarnIosurface(
  alreadyWarned: boolean,
  count: number | null,
): boolean {
  return !alreadyWarned && count !== null && count > IOSURFACE_WARN_ABOVE;
}

/** Polls the IOSurface count once a minute and warns once above the threshold. */
export function useIosurfaceWatch(): void {
  useEffect(() => {
    let alive = true;
    let warned = false;
    let timer = 0;
    const poll = () => {
      void invoke<number | null>("iosurface_usage")
        .then((count) => {
          if (!alive) return;
          if (shouldWarnIosurface(warned, count)) {
            warned = true;
            console.warn(
              `MonoCode holds ${count} IOSurface regions (warning above ${IOSURFACE_WARN_ABOVE}).`,
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          if (alive) timer = window.setTimeout(poll, IOSURFACE_POLL_MS);
        });
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
}
