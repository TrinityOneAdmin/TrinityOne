// Browser bundle: expose the pure double-entry ledger + persistence store as window.FinanceLedger,
// for the steward console (stew-books.jsx). Same code the node test-suite proves — just IIFE-wrapped.
export * from './finance-ledger.mjs';
export * from './finance-store.mjs';
export * from './finance-import.mjs';
