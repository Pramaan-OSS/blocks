/**
 * Which billing customer the signed-in person is. Replace this body with your own lookup: from
 * your user record, return the customer id you saved when they subscribed. Return undefined for
 * anyone who isn't signed in or has no billing customer.
 *
 * The browser never sends a customer id, so a visitor can only ever see and manage their own plan.
 */
export async function billingCustomerFor(request: Request): Promise<string | undefined> {
  // Demo and tests only: with the fake on, a cookie picks the customer (default: the demo customer).
  if (process.env.PRAMAAN_FAKE === "1") {
    const cookie = /(?:^|;\s*)pramaan_customer=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
    return cookie ? decodeURIComponent(cookie) : "cus_FAKE0001";
  }
  return undefined;
}
