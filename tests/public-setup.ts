import { beforeEach, vi } from "vitest";
import { resetPublicLimits } from "@/lib/pramaan/public-guard";
import { resetBookingState } from "@/lib/pramaan/booking";
beforeEach(() => {
  vi.stubEnv("PRAMAAN_BOOKING_HOST", "user-42");
  vi.stubEnv("PRAMAAN_BOT_CHECK_SECRET", "");
  vi.stubEnv("PRAMAAN_TRUSTED_PROXY_HOPS", "1");
  vi.stubEnv("PRAMAAN_TRUSTED_IP_HEADER", "");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  resetPublicLimits();
  resetBookingState();
});
