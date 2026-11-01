import { completeFakeConnection } from "@/lib/pramaan/fake";

// Demo only: stands in for the hosted sign-in page. It finishes the sign-in and sends the person
// back to the page that asked for it.
export async function GET(request: Request) {
  if (process.env.PRAMAAN_FAKE !== "1") return new Response(null, { status: 404 });
  const q = new URL(request.url).searchParams;
  const redirect = q.get("redirect");
  if (!q.get("user") || !q.get("app") || !redirect) return new Response("Missing user, app or redirect.", { status: 400 });
  completeFakeConnection(q.get("user")!, q.get("app")!);
  return Response.redirect(redirect, 302);
}
