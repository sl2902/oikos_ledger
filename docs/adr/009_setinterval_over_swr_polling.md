# ADR 009: setInterval over SWR for Upload Status Polling

## Status
Accepted

## Context
The upload modal needs to poll the upload status API every
second and transition to "complete" state when Lambda finishes.
Initial implementation used SWR with refreshInterval. Multiple
issues arose:

1. SWR fires onSuccess via React's render cycle. When Lambda
   completes very fast (<3s), the status jumps from "pending"
   to "complete" before the component has rendered in "polling"
   phase. The useEffect dependency array checks state.phase
   which hasn't updated yet due to React batching.

2. setActiveUploadId(null) called to stop polling would unmount
   the SWR hook before React committed the state update to
   "complete", preventing the auto-close effect from firing.

Multiple fixes attempted: onSuccess callback, dependency array
changes, setTimeout wrapping, ref-based phase tracking — all
failed due to fundamental React render cycle timing issues.

## Decision
Replace SWR polling entirely with plain setInterval + fetch.
setInterval fires independently of React's render cycle.
fetch returns data synchronously within the interval callback.
State updates fire immediately without dependency array
race conditions.

## Implementation
- setInterval started in handleSubmit after upload ID received
- Polls every 1 second
- On terminal status: clearInterval, setState, stop timer
- Stored in pollIntervalRef so handleCancel can clear it
- No SWR involvement in upload status polling

## Consequences
- Upload modal auto-closes reliably regardless of Lambda speed
- Cancel protection works correctly (409 → show success)
- No SWR cache interference
- Slightly more code than SWR approach but deterministic
