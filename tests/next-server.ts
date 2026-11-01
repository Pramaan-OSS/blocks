// Stands in for `next/server` in unit tests: the routes run outside a Next request, where the real
// `connection()` refuses to run. In a real app it marks a route as served per request.
export const connection = async () => {};
