/**
 * The geometry primitives now live in `packages/geometry`, shared with
 * `apps/marker`. This re-export keeps PDS's existing `@/geometry` import sites
 * working unchanged — import from `@repo/geometry` directly in new code.
 */
export * from '@repo/geometry';
