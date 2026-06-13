# Oikos Ledger — API Reference

## Conventions

<!-- Base URL, authentication header, error shape, pagination pattern -->

## Endpoints

### POST /api/auth
<!-- Sign in, sign out, session refresh -->

### GET /api/transactions
<!-- Query params: page, limit, start_date, end_date, category_id -->

### GET /api/insights
<!-- Returns precomputed spending breakdowns for the authenticated user -->

### GET /api/recommendations
<!-- Returns ranked recommendations; supports dismiss and save feedback via PATCH -->

### GET /api/macro
<!-- Returns latest macro-economic indicators -->

### POST /api/upload
<!-- Accepts multipart CSV, returns upload_id and Lambda invocation status -->

### POST /api/voice
<!-- Accepts transcribed query string, returns spoken response and structured data payload -->
