import { register } from 'node:module';

/** Installs the resolver hook, then the check script runs as a normal module. */
register('./resolve-hook.mjs', import.meta.url);
