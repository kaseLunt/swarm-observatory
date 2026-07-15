// Type surface for runIndex.mjs — the generator that OWNS public/runs/index.json. Declared so the
// publication suite's byte-identity gate can import serializeIndex under the strict TS programs
// (the .mjs itself stays plain JS: it is also executed directly by node via sync-contract.mjs).
export function buildIndex(): unknown
export function serializeIndex(index?: unknown): string
