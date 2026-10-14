# Inventory service

A small Go service that tracks stock levels for the warehouse app.

## Commands

- Build with `make build`.
- Run the tests with `make test` before you open a pull request.

## Conventions

- Keep handlers in `internal/http` and storage code in `internal/store`.
- Return errors with context: `fmt.Errorf("load item %s: %w", id, err)`.
