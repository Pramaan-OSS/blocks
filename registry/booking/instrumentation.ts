/** Merge register() into an existing instrumentation file if your app already has one. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnPublicIpSetup } = await import("@/lib/pramaan/public-guard");
    warnPublicIpSetup();
  }
  if (!process.env.PRAMAAN_BOOKING_HOST?.trim()) {
    console.warn("Booking setup: set PRAMAAN_BOOKING_HOST to the calendar owner's reference. Public booking is disabled until it is set.");
  }
}
