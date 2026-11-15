# Banno PowerOn execution — findings (GETTRACKING / account tracking type 83)

Goal: read Symitar account-level tracking records (type 83) for a member and surface
them. The `BANNO.GETTRACKING.V1.POW` specfile returns that data. This documents what we
proved about reaching it, and why the obvious path is blocked.

Tested against `https://my.greatnwfcu.com` (Great NorthWest FCU, Symitar/Episys core).

## Endpoint

`POST /a/power-ons/api/generic/execute` — the endpoint the Banno web app uses to run
consumer-feature PowerOns (M2M transfers, overdraft opt-in, loan payoff, etc.).

Observed body schema (not the GitHub JSON-contract shape):
```json
{ "rgState": "...", "powerOnFileName": "BANNO.X.V1.POW",
  "userDefinedStrings": [{ "id": 1, "value": "..." }],
  "userDefinedNumbers": [], "rgSession": 1 }
```
- Params go as `userDefinedStrings` / `userDefinedNumbers` with explicit `{id, value}`
  (maps to SymXchange `RGUserChr ID=.. Value=..`), NOT a positional `userChrList` array.
  The GitHub `banno-powerons` JSON contracts show `userChrList`/`userNumList`; the live
  endpoint rejected that with `Missing required field at 'userDefinedStrings[0].id'`.

## Authentication

- **First-party browser session cookie only.** The Banno web app attaches no bearer
  token to any `/a/...` call (grep of the live `main` bundle: 0 `Authorization`, 0
  `Bearer`, 0 `setRequestHeader`); same-origin `fetch` sends the session cookie.
- Our OAuth access token (consumer External Application, client/aud `f127f7c8-...`) →
  **403 Forbidden** server-side. There is **no** power-ons scope in the OIDC discovery
  document. So a third-party OAuth plugin cannot call this endpoint at all.
- From the logged-in browser console (same-origin, cookie) the endpoint authenticates:
  it gets past 403 to body/name validation.

## The real blocker: Banno maintains a feature allowlist

`powerOnFileName` is validated against Banno's own list of **configured consumer-feature
PowerOns**, not your core's SymXchange Custom Specfile slots.

Oracle: a valid name fails on the body (`Invalid value for: body ... userDefinedStrings`),
an invalid name fails on the name (`Invalid PowerOn file name`). Results from the
logged-in browser session:

| PowerOn | Accepted? |
|---|---|
| BANNO.M2MTRANSFERS.V3.POW | yes |
| BANNO.CDRENEW.V1.POW | yes |
| BANNO.CHECK.WITHDRAW.V2.POW | yes |
| BANNO.LOAN.PAYOFF.V2.POW | yes |
| BANNO.LOANPAYMENT.SKIP.V2.POW | yes |
| BANNO.NEWSUBCREATE.V3.POW | yes |
| BANNO.ODTOPTIN.V2.POW | yes |
| BANNO.CHANGE.ADDR.V1.POW (feature, not enabled here) | **no** |
| BANNO.DATABASE.CHECK.V1.POW (real repo PowerOn, utility) | **no** |
| BANNO.GETTRACKING.V1.POW (+ 5 name variants) | **no** |

Every accepted name is a consumer feature with a LinkType enabled at this CU. The
rejected ones are utility or not-enabled PowerOns. `DATABASE.CHECK` is the proof the gate
is feature-config, not spelling or core state: it is a correctly named repo PowerOn and is
still rejected.

**Decisive confirmation:** two custom PowerOns installed and loaded specifically to test
(`bannoGetJson`, `bannoTest` — valid names, loaded on the core, SymX refreshed twice) both
return `Invalid PowerOn file name`. A freshly installed, correctly loaded custom specfile
is rejected by `generic/execute`. So Banno's allowlist is a Banno-side registry of
configured consumer features; it does not track core registration. There is no
self-service / core-side way to make a custom PowerOn callable through this endpoint.

Confirmed NOT the cause: filename spelling/version/suffix (tested variants), the Custom
Specfile slot (GETTRACKING is loaded there), SymXchange device refresh (done repeatedly),
request body format, auth (session cookie works for allowed names).

There is also no `POWER_TRACKING` LinkType and no tracking bundle in the Banno web app
(only `POWER_*` types for the enabled features; `merchant-tracking` is unrelated spending
analytics). No account-tracking endpoint exists in the v0 Consumer API, and the
`external_tracking_records` / `tracking_info` / `configuration_values` claims came back
empty/null.

## Options to actually get type-83 data

1. **Banno support case** — have Banno configure `BANNO.GETTRACKING.V1.POW` as a callable
   consumer feature (with a LinkType), the same way M2M/overdraft were set up, or expose a
   tracking claim/endpoint. This table is the evidence for that case.
2. **SymXchange `executePowerOn`** (PowerOnService WSDL) server-to-server — runs any
   installed specfile directly, bypassing Banno's allowlist. Needs direct SymXchange
   access provisioned (currently routed only through Banno for this CU), i.e. also a JHA
   request. Credential types: AccountNumber / HomeBanking (scope to the member) vs
   Administrative.

Neither is a code change in this repo; both require access only Jack Henry can grant.
