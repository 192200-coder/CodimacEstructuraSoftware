# Implementation Guide

> Historical analysis from the React-to-Angular phase. Its assumption that the
> Supabase backend is frozen was superseded by the Neon/Express backend task.
> For the current system, use `../../../../docs/arquitectura.md` and
> `../../../../../codimac-backend/README.md`; artifact paths and contracts below
> are not current implementation instructions.

This index is not the full contract. Do not implement from this file alone; follow the artifact paths below.

## Global artifacts

- `unit_graph.yaml`
  - Who reads: all implementation workers.
  - Use for: the current runtime boundary and source entrypoints.
  - How to consume: find `codimac_web_app`; `source_anchors` document React behavior but do not determine rewrite scope.
- `migration_boundary.yaml`
  - Who reads: all implementation workers.
  - Use for: Angular frontend scope and untouched backend/domain boundaries.
  - How to consume: follow `must_rewrite`; preserve `copy_as_is` sources and the stated implementation rule.
- `wire_contracts.yaml`
  - Who reads: workers implementing authentication, order, route, stop, and tracking access.
  - Use for: existing Supabase Auth/Edge API request and response contracts.
  - How to read: filter rows where `unit == codimac_web_app`.
- `shared_modules.yaml`
  - Who reads: all implementation workers.
  - Use for: cross-unit shared modules. The current graph has one UI unit and no qualifying rows.
- `cross_unit_state.yaml`
  - Who reads: workers changing cross-unit state. No paired cross-unit flows were found in this SPA boundary.
- `seams.yaml`
  - Who reads: workers touching backend integration.
  - Use for: the frozen Supabase API and database boundary.
  - How to read: keep the API/migrations frozen; the current wire protocol remains REST/Supabase Auth.

## Unit: `codimac_web_app`

- External trigger: browser loads `/`; role and section changes are internal SPA navigation.
- Must read:
  - `units/codimac_web_app/behavior.yaml` — observable role workflows, state transitions, side effects, and errors to preserve.
  - `units/codimac_web_app/bindings.yaml` — current bootstrap, persistence, and Supabase integration.
  - `units/codimac_web_app/unit_decomposition.yaml` — candidate feature splits only; `commit: false` means these are not pre-decided target modules.
- Relevant global rows:
  - `wire_contracts.yaml` rows with `unit: codimac_web_app`.
  - `shared_modules.yaml` rows where `used_by_units` includes `codimac_web_app` (none currently).
  - `cross_unit_state.yaml` flows where either endpoint is `codimac_web_app` (none currently).
  - `seams.yaml` cuts touching `codimac_web_app`.
- Before DONE report: artifacts read, preserved behaviors, unresolved/deferred contracts, and build/test/runtime evidence.
