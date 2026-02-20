# CS Engine Test Case Documentation and Execution Report

## Report Details
- Project: `cs_engine`
- Report date: February 12, 2026
- Test command: `npm test -- --verbose`
- Test framework: Jest (unit-level)
- Latest execution status: **PASS**

## Executive Summary
This report documents the implemented automated test cases for core backend functions and the outcome of the most recent execution. The current suite validates business logic, state-flow behavior, parsing reliability, and embedding pipeline behavior using deterministic unit tests with mocked external dependencies.

All planned test suites executed successfully in the latest run.

- Test suites: **4 passed / 4 total**
- Test cases: **25 passed / 25 total**
- Snapshots: **0**
- Total runtime: **0.391s**

## Test Approach
The testing strategy is focused on isolated and repeatable unit tests.

- Firestore calls are mocked to validate service logic without requiring a live Firebase instance.
- External SDK/API and file libraries are mocked to avoid network and file-system variability.
- Deterministic assertions are used for branch outcomes, validation behavior, and state transitions.
- Negative-path tests are included to verify controlled error handling.

Reusable helper utilities were introduced to standardize Firestore-like snapshot stubs:
- `tests/helpers/firestoreSnapshots.js`

## Detailed Test Coverage

### 1) Booking State Flow Service
- Source under test: `src/services/bookingStateManager.js`
- Test file: `tests/services/bookingStateManager.test.js`
- Total cases: **8**
- Result: **8 passed**

Tested functions and how they were validated:

1. `getState`
- Validation: Confirmed default state is `IDLE` when no state exists.

2. `setState`
- Validation: Confirmed state merge behavior and `updatedAt` persistence.

3. `startBooking`
- Validation: Checked branching behavior with and without reason input:
  - with reason -> advances to `AWAITING_DATE`
  - without reason -> starts at `AWAITING_REASON`

4. `setDate`
- Validation: Confirmed transition to `AWAITING_SLOT` and date persistence.

5. `setTimeSlot`
- Validation: Confirmed transition to `AWAITING_NAME` and slot persistence.

6. `setName`
- Validation: Confirmed transition to `AWAITING_CONFIRM` and name persistence.

7. `clearState`
- Validation: Confirmed stored state is removed and subsequent state resolves to default `IDLE`.

8. `isBookingAction` and `parseButtonAction`
- Validation: Verified all supported button prefixes (`date_`, `slot_`, `confirm_`, `cancel_`, `more_dates_`) and unsupported input behavior.

Execution outcome: **All scenarios passed**.

### 2) Consultant Booking Service
- Source under test: `src/services/consultantService.js`
- Test file: `tests/services/consultantService.test.js`
- Total cases: **6**
- Result: **6 passed**

Tested functions and how they were validated:

1. `getSettings`
- Validation: Mocked missing settings document and verified fallback to expected default configuration.

2. `updateSettings`
- Validation:
  - Provided out-of-range/invalid configuration values.
  - Verified sanitization rules are applied (`bookingType`, min/max numeric bounds).
  - Verified schedule persistence behavior through batch operations.

3. `getAvailableSlots`
- Validation:
  - Mocked schedule + existing booking entries.
  - Verified generated slots remove already-booked time slots.

4. `createBooking`
- Validation:
  - Simulated race/conflict condition where slot becomes unavailable.
  - Verified function returns conflict-safe failure response and does not insert booking.

5. `getBookings`
- Validation:
  - Mocked unordered booking records.
  - Verified descending sort by creation time in returned list.

6. `updateBookingStatus`
- Validation:
  - Confirmed status update payload includes `confirmedAt` and optional `staffNote` for confirmed path.

Execution outcome: **All scenarios passed**.

### 3) Embedding Service
- Source under test: `src/services/embeddingService.js`
- Test file: `tests/services/embeddingService.test.js`
- Total cases: **6**
- Result: **6 passed**

Tested functions and how they were validated:

1. `generateEmbedding` (uninitialized path)
- Validation: Verified explicit error when service is used before initialization.

2. `initialize` + `generateEmbedding` (happy path)
- Validation: Mocked Gemini client response and verified vector extraction.

3. Model fallback behavior
- Validation:
  - Simulated first model `NOT_FOUND`.
  - Verified automatic fallback to secondary configured model and successful embedding output.

4. `processText`
- Validation: Verified chunk processing includes embedding values and metadata creation.

5. `chunkText`
- Validation: Verified oversized input is split into multiple indexed chunks with source metadata.

6. `cosineSimilarity`
- Validation: Verified expected score for valid vectors and safe `0` for mismatched dimensions.

Execution outcome: **All scenarios passed**.

### 4) File Parser Utility
- Source under test: `src/utils/fileParser.js`
- Test file: `tests/utils/fileParser.test.js`
- Total cases: **5**
- Result: **5 passed**

Tested functions and how they were validated:

1. Plain text parsing
- Validation: Verified UTF-8 conversion and trimming behavior.

2. PDF parsing
- Validation: Mocked `pdf-parse` and verified extracted text is returned.

3. Spreadsheet parsing (xlsx/csv)
- Validation: Mocked workbook + sheet conversion and verified merged output includes sheet headers and CSV content.

4. DOCX parsing
- Validation: Mocked `mammoth.extractRawText` and verified extracted value.

5. Unsupported MIME type handling
- Validation: Verified unsupported input throws the expected error.

Execution outcome: **All scenarios passed**.

## Final Execution Evidence
Latest verbose run (February 12, 2026):

- `PASS tests/services/consultantService.test.js`
- `PASS tests/utils/fileParser.test.js`
- `PASS tests/services/embeddingService.test.js`
- `PASS tests/services/bookingStateManager.test.js`

Aggregate result:
- **Test Suites: 4 passed, 4 total**
- **Tests: 25 passed, 25 total**
- **Status: PASSED (100%)**

## Current Quality Status
The implemented test set provides reliable coverage for core service-level business logic and utility parsing behavior. All defined test cases are currently green and executable through the standard project test command.
