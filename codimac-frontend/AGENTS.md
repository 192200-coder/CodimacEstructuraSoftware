# CODIMAC

Angular + TypeScript logistics application with an Express API and PostgreSQL (Neon-compatible).

## Development

- `pnpm dev` serves the Angular application on port 8443.
- `pnpm build` creates the production browser bundle.
- `pnpm typecheck` runs Angular's strict template and TypeScript compilation.
- `pnpm test` runs the domain and application tests with Vitest.
- Start `..\codimac-backend` with `pnpm dev` before using remote application data.

## Project structure

- `src/main.ts` - Angular browser bootstrap.
- `src/app/app.component.ts` - role-level application composition.
- `src/app/core/` - application state, role types, authentication and API services.
- `src/app/layout/` - responsive shell and reusable dialogs.
- `src/app/shared/` - reusable visual components, including icons and status badges.
- `src/app/features/dispatcher/` - dispatcher dashboard, orders, inventory, clients, routes and history.
- `src/app/features/admin/` - administration screens.
- `src/app/features/driver/` - mobile-first driver route and delivery workflow.
- `src/app/features/client/` - public delivery tracking.
- `src/app/features/access/` - sign-in and access-denied screens.
- `src/dominio/`, `src/aplicacion/`, `src/adaptadores/` - framework-independent business rules, use cases and adapters.
- `src/lib/codimac-api.ts` - JWT session and REST client for the CODIMAC API.
- `..\codimac-backend\` - Express backend, PostgreSQL migrations and demo seed.
- `src/index.css` - global design system and responsive styling.

## Conventions

- Keep Angular components standalone and group them by business feature.
- Keep domain rules independent of Angular, HTTP, and database providers.
- Keep server-side role checks and transactional business rules authoritative.
- Keep all user-facing text in Peruvian Spanish; use `America/Lima`, soles, and kilometers.
- Preserve accessible labels and visible text for every status; do not rely on color alone.
- Driver views are mobile-first and delivery actions must not advance before API success.
