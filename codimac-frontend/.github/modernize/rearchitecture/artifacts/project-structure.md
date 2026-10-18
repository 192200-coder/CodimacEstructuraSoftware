# Project structure

The current workspace contains two sibling applications:

- `codimac-frontend/`: Angular standalone frontend.
- `codimac-backend/`: Express + TypeScript REST API backed by PostgreSQL and
  designed for Neon.

The frontend keeps domain and application rules under `src/dominio/`,
`src/aplicacion/`, and `src/adaptadores/`; Angular role-specific screens live
under `src/app/features/`. It calls the backend through `src/lib/codimac-api.ts`.

The backend separates HTTP modules in `codimac-backend/src/modules/`, JWT and
request validation under `src/http/`, and connection, migrations, and seed
under `src/db/`. Database workflows use transactions for order/stock and
delivery/route integrity.

The legacy Supabase functions, credentials, and migration have been removed.
Current setup and API descriptions are maintained in
`../../../../../codimac-backend/README.md` and `../../../../docs/arquitectura.md`.
