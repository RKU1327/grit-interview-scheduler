"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data on an interval and when the tab regains focus, so
 *  slot availability and statuses do not go stale while a page is open. */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(refresh, seconds * 1000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [router, seconds]);
  return null;
}
