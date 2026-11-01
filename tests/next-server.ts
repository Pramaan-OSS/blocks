// Stands in for `next/server` in unit tests: the routes run outside a Next request, where the real
// `connection()` refuses to run. In a real app it marks a route as served per request.
export const connection = async () => {};

const tasks: (() => void | Promise<void>)[] = [];
export const after = (task: () => void | Promise<void>) => { tasks.push(task); };
export const clearAfter = () => { tasks.length = 0; };
export async function flushAfter() {
  while (tasks.length) await tasks.shift()!();
}
