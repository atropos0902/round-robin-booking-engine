export async function register(): Promise<void> {
  // Written this way round so the edge build can drop the import.
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
