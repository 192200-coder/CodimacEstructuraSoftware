# Technology stack

- **Frontend:** Angular 22 standalone, TypeScript 6, Angular CLI.
- **Backend:** Express 5, TypeScript 5.9, Node.js 20+, JSON REST API.
- **Persistence:** PostgreSQL, compatible with Neon pooled connection strings.
- **Authentication:** bcrypt password hashes and server-signed eight-hour JWTs.
- **Validation and security:** Zod, Helmet, CORS allow-list, and rate limiting.
- **Tests:** Vitest in both frontend and backend workspaces.
- **Runtime configuration:** `../../../../../codimac-backend/.env`, documented
  by its `.env.example`; the database URL is not committed.

See `../../../../../codimac-backend/README.md` for local setup and
`../../../../docs/arquitectura.md` for module boundaries and data-integrity rules.
