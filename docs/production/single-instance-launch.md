# Single-Instance Launch Constraints

This launch configuration assumes one dashboard instance and one facilitator instance on a single chain.

- Invoice PDFs are stored on local disk. Do not deploy behind ephemeral or shared-nothing storage until invoice storage is moved to durable object storage.
- Public API rate limiting is process-local. Do not scale the dashboard horizontally until rate limiting is moved to shared Redis-backed storage.
- Facilitator plan resolution is scoped to production catalog data and a single launch chain. Multi-chain expansion needs an explicit chain-aware resolver contract.
- `FACILITATOR_SECRET` is required on both dashboard and facilitator in production. Treat mismatches as a deployment blocker.
