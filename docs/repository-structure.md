# InterAct — Repository Structure

## Project Overview

InterAct is an AI-powered interview practice platform designed to help users prepare for interviews through conversational practice, document-grounded questions, and feedback.

The project follows a modular monolith architecture, with a React frontend and a FastAPI backend.

## Main Components

### Frontend

Location: `frontend/`

Built using React, TypeScript, Vite, and Tailwind CSS.

- `src/api/` — API client and related types.
- `src/auth/` — Authentication context and protected routes.
- `src/call/` — Interview call experience, media, voice and focus-related functionality.
- `src/components/` — Shared UI components.
- `src/lib/` — Shared utilities and helpers.
- `src/pages/` — Application pages.
- `src/test/` — Testing utilities and mocks.

### Backend

Location: `backend/`

Built using FastAPI, Python, SQLAlchemy and PostgreSQL.

- `app/api/` — API endpoints.
- `app/core/` — Configuration, database, authentication and core infrastructure.
- `app/models/` — Database models.
- `app/schemas/` — API schemas.
- `app/services/` — Business logic and application services.
- `alembic/` — Database migrations.
- `tests/` — Backend automated tests.

### Documentation

Location: `docs/`

Contains project documentation, deployment instructions, model selection information and OAuth setup guides.

### Research

Location: `research/`

Contains model comparison data and experiments used during development.

### Database

Location: `dbms/`

Contains SQL queries and database-related material.

## Development and Verification

Frontend verification commands:

- `npm run test` — Run frontend unit and component tests.
- `npm run build` — Type-check and build the frontend.
- `npm run lint` — Run ESLint.

Backend tests are configured with pytest in `backend/pyproject.toml`.

## Architecture Approach

InterAct uses a modular monolith approach. The frontend and backend are separate applications, while backend responsibilities are organized into modules for APIs, models, schemas, core infrastructure and services.

This structure helps maintain separation of responsibilities without introducing unnecessary microservices.