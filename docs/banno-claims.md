# Banno Consumer API: OpenID Connect claims

Researched 2026-10-03 from jackhenry.dev, the OIDC OpenAPI spec embedded in the API reference page, the live Garden FI discovery document, and `Banno/consumer-api-openid-connect-example`.

## TL;DR

- **Claims are not scopes.** You request claims with the OIDC `claims` request parameter, a URL-encoded JSON object keyed by `id_token` and/or `userinfo`. They never go in `scope`.
- Claim names are the full URI with **no `.readonly` suffix**, e.g. `https://api.banno.com/consumer/claim/accounts`.
- Strings like `https://api.banno.com/consumer/claim/*.readonly` **do not exist**. They are not in `scopes_supported` or `claims_supported` in the live discovery document. Scopes use the `https://api.banno.com/consumer/auth/...` namespace instead.
- Restricted claims (`accounts`, `cards`, `customer_identifier`, `tax_id`, ...) are returned only after the FI's back office admin enables them on the External Application in Banno People.

> Repo note: `src/services/auth.service.ts` `SCOPES` currently puts `https://api.banno.com/consumer/claim/{devices,netteller_id,phone_numbers,user_type,customer_identifier,loans,shares}.readonly` into `scope`. Per the sources below, those strings are not valid scopes. Move them, without `.readonly`, into the `claims` param.

## 1. How claims are requested

Sources:
- https://jackhenry.dev/open-api-docs/consumer-api/guides/claimsintheidentitytoken/
- https://jackhenry.dev/authentication-framework/concepts/claims/
- https://jackhenry.dev/authentication-framework/concepts/scopes/
- https://github.com/Banno/consumer-api-openid-connect-example/blob/master/server.js

Verbatim from the claims concept page: "The additional claims must be specifically requested utilizing the claims parameter. ... The claims parameter is constructed as a JSON object which then must be encoded. Claims can be returned in these ways: In the Identity Token / From the UserInfo Endpoint / In both the Identity Token and from the UserInfo Endpoint."

Verbatim from the guide, id_token:
```
https://[CONSUMER_API_ENVIRONMENT]/a/consumer/api/v0/oidc/auth?client_id=[CLIENT_ID]
  &redirect_uri=[REDIRECT_URI]
  &scope=openid
  &response_type=code
  &claims={"id_token":{"https://api.banno.com/consumer/claim/customer_identifier":null}}
```

Verbatim from the guide, userinfo only (keeps PII out of the id_token):
```
  &claims={"userinfo":{"name":null,"address":null,"phone_number":null,"email":null,"https://api.banno.com/consumer/claim/customer_identifier":null}}
```

Official example app (both targets, PKCE):
```js
const claims = {
  given_name: null, family_name: null, name: null, address: null, phone: null, email: null,
  //'https://api.banno.com/consumer/claim/customer_identifier': null,  // restricted, FI must enable
  'https://api.banno.com/consumer/claim/institution_id': null
};
scope: 'openid https://api.banno.com/consumer/auth/offline_access https://api.banno.com/consumer/auth/accounts.readonly https://api.banno.com/consumer/auth/transactions.detail.readonly',
claims: JSON.stringify({ id_token: claims, userinfo: claims })
```

Applied to the claims this project wants:
```js
const claims = {
  'https://api.banno.com/consumer/claim/accounts': null,        // restricted
  'https://api.banno.com/consumer/claim/masked_accounts': null, // public
  'https://api.banno.com/consumer/claim/cards': null,           // restricted
  'https://api.banno.com/consumer/claim/customer_identifier': null, // restricted
  'https://api.banno.com/consumer/claim/phone_numbers': null,
  'https://api.banno.com/consumer/claim/user_type': null,
  'https://api.banno.com/consumer/claim/netteller_id': null,
  'https://api.banno.com/consumer/claim/institution_id': null,
  'https://api.banno.com/consumer/claim/devices': null,
  name: null, email: null, phone_number: null, address: null, birthdate: null,
}
params.set('claims', JSON.stringify({ id_token: claims, userinfo: claims })) // URLSearchParams encodes it
```

### Scopes (OIDC standard), from the concepts/scopes page

- `openid` (required) "Starts an OpenID Connect flow which will return an Identity Token".
- `address`, `email`, `phone`, `profile` (optional) "Adds the user's ... claim to the Identity Token".
- `profile` covers name, family_name, given_name, middle_name, preferred_username, picture, and locale.

### Banno-specific scope, from the openidconnectoauth page

- `https://api.banno.com/consumer/auth/offline_access`: "Used to request a Refresh Token". Live discovery also lists plain `offline_access`.

### API scopes (live discovery `scopes_supported`, partial)

These authorize API calls. They do not add claims.
- `https://api.banno.com/consumer/auth/accounts.readonly`
- `https://api.banno.com/consumer/auth/accounts.unmaskednumber.readonly`
- `https://api.banno.com/consumer/auth/user.readonly`
- `https://api.banno.com/consumer/auth/user.profile.readonly`
- `https://api.banno.com/consumer/auth/transactions.detail.readonly`
- `https://api.banno.com/consumer/auth/documents.readonly`
- `https://api.banno.com/consumer/auth/devices.readonly`
- `https://api.banno.com/consumer/auth/cardcontrols.readonly`

## 2. Claims and shapes

Sources:
- https://jackhenry.dev/open-api-docs/authentication-framework/overview/openidconnectoauth/
- https://jackhenry.dev/open-api-docs/consumer-api/api-reference/v0/oauth-and-openid-connect/details/ (embedded `oidc-provider.swagger.yaml`, `userInfo` schema)
- https://jackhenry.dev/open-api-docs/authentication-framework/guides/mapcustomeridentitiestoexistingsystemids/

### Publicly available claims (verbatim list)

Any client can request these.
```
https://api.banno.com/consumer/claim/cash_management_user - Cash Management user
https://api.banno.com/consumer/claim/cash_management_user_id - Cash Management user ID
https://api.banno.com/consumer/claim/devices - Authorized device information
https://api.banno.com/consumer/claim/fi_routing_number - Institution routing number
https://api.banno.com/consumer/claim/institution_assets - Institution assets
https://api.banno.com/consumer/claim/institution_details - Institution details
https://api.banno.com/consumer/claim/institution_id - Unique identifier for the institution
https://api.banno.com/consumer/claim/masked_accounts - Accounts with masked account numbers
https://api.banno.com/consumer/claim/netteller_id - NetTeller ID - Banks
https://api.banno.com/consumer/claim/phone_numbers - Home, mobile, and work phone numbers
https://api.banno.com/consumer/claim/theme_data - Theme data
https://api.banno.com/consumer/claim/user_type - User type
```

### Restricted claims (verbatim list)

"An app must specifically be configured to be allowed to request and obtain them."
```
https://api.banno.com/consumer/claim/accounts - Accounts with full account numbers
https://api.banno.com/consumer/claim/cards - Debit and credit cards with full unmasked card numbers
https://api.banno.com/consumer/claim/customer_identifier - Unique customer identifier (CIF or Member Number)
https://api.banno.com/consumer/claim/external_loans - External loan records - Credit Unions
https://api.banno.com/consumer/claim/external_tracking_records - SymXchange external tracking records
https://api.banno.com/consumer/claim/id_documents - Identification documents information - Credit Unions
https://api.banno.com/consumer/claim/loans - Loan records - Credit Unions
https://api.banno.com/consumer/claim/shares - Share records - Credit Unions
https://api.banno.com/consumer/claim/tax_id - User's tax ID or social security number
```

The live discovery document also lists claims with no public docs: `alt_given_name`, `bsl_token`, `cif`, `configuration_values`, `custom_jxchange_wa_ace_data`, `esi_bsl_token`, `ipay_common_login_id`, `ipay_subscriber_id`, `jxchange_customer_data`, `loan_cross_accounts`, `member_number`, `organization_id`, `pcid`, `share_cross_accounts`, and `tracking_info`. All are under `https://api.banno.com/consumer/claim/`. Standard claims listed there: `sub, family_name, given_name, middle_name, name, nickname, picture, preferred_username, email, address, phone_number, acr, sid, auth_time, iss, birthdate`.

### Documented example values

- `customer_identifier`: a string. Bank CIF example `"DAA0086"`, credit union member number example `"321758"`.
- `tax_id`: a string, example `"207003900"`.
- Standard claims, verbatim from the guide:
```json
{
  "sub": "e58dc9d6-0acb-4770-b719-93fe675f652b",
  "name": "Riley Doe",
  "address": { "locality": "Cedar Falls", "postal_code": "000050613", "region": "IA", "street_address": "123 Banno St." },
  "phone_number": "5558675309",
  "email": "rileydoe@jackhenry.dev",
  "https://api.banno.com/consumer/claim/customer_identifier": "DAA0086"
}
```
- `userInfo` schema (OpenAPI spec) fields:
  - `sub`, `institution_id`, `department` (nullable), `title` (nullable)
  - `family_name`, `given_name`, `middle_name` (nullable), `name`
  - `picture`, `preferred_username`, `email`, `phone_number`
  - `address {locality, postal_code, region, street_address}`
- The example app README also shows `birthdate` (`"1951-03-02"`), `locale`, and `sid`.

### UNVERIFIED: JSON shapes of `accounts`, `masked_accounts`, `cards`, `phone_numbers`, `devices`, `user_type`, `netteller_id`, `institution_details`

None of the jackhenry.dev pages, the embedded OIDC spec, the Banno example repo, or GitHub code search documents a payload or schema for these claims. Get the real shape by capturing a decoded id_token or `/oidc/me` response from Garden FI, e.g. with this repo's localhost `/claims` inspector. Do not trust guessed field names.

## 3. Enabling restricted claims

Sources:
- https://jackhenry.dev/open-api-docs/consumer-api/overview/configuration/
- https://jackhenry.dev/open-api-docs/authentication-framework/guides/mapcustomeridentitiestoexistingsystemids/
- https://jackhenry.dev/open-api-docs/troubleshooting/

Verbatim from the configuration page:
> "The Restricted Claims contain potentially sensitive data about the user. To request and obtain these claims, the External Application must be specifically configured to allow them. ... The back office administrator at your financial institution can do this for you in the External applications section of Banno People. If you are developing using a Jack Henry test environment, you will not have access to Banno People. In this case, Jack Henry is the acting administrator of the financial institution and you will have to contact us for any Banno People operations."

Verbatim from the mapping guide: "merely adding that claim to the authorization request is not sufficient to add that claim to the Identity Token."

Verbatim from the troubleshooting page: "Claims enable extra data properties in the id_token and responses from the user info endpoint, and must be configured via your external application."

The External Application's "Scopes" section is a separate allowlist of OAuth scopes.

UNVERIFIED: the exact UI labels or checkboxes in Banno People. Those are in the Banno Knowledge "External application configuration" article, which requires a login. It is also unverified whether a restricted claim that is not enabled is silently omitted or returns an error. Docs only say it won't be in the token.

## 4. Endpoints

Sources: the embedded `oidc-provider.swagger.yaml` on the details page, plus live discovery at https://digital.garden-fi.com/a/consumer/api/v0/oidc/.well-known/openid-configuration

All paths are on the FI host, e.g. `https://digital.garden-fi.com`.

| Purpose | Path |
|---|---|
| Discovery | `/a/consumer/api/v0/oidc/.well-known/openid-configuration` (verified live; the spec writes it as `/.well-known/openid-configuration` relative to the issuer) |
| Issuer | `https://{host}/a/consumer/api/v0/oidc` |
| Authorize | `/a/consumer/api/v0/oidc/auth` |
| Token | `/a/consumer/api/v0/oidc/token` |
| UserInfo | `/a/consumer/api/v0/oidc/me` (GET, `Authorization: Bearer <access_token>`) |
| JWKS | `/a/consumer/api/v0/oidc/jwks` |
| PAR | `/a/consumer/api/v0/oidc/request` |
| Revocation | `/a/consumer/api/v0/oidc/token/revocation` |
| Introspection | `/a/consumer/api/v0/oidc/token/introspection` |
| Logout | `/a/consumer/api/v0/oidc/logout` |

Live discovery facts:
- `claims_parameter_supported: true`
- `response_types_supported: [code, none]`
- `code_challenge_methods_supported: [S256]`
- `token_endpoint_auth_methods_supported: [client_secret_basic, client_secret_post, private_key_jwt]`
- `request_parameter_supported: false`
- `grant_types_supported: [authorization_code, refresh_token, urn:ietf:params:oauth:grant-type:token-exchange]`
- `acr_values_supported: https://api.banno.com/consumer/security-level/{standard,enhanced,high,restricted}`
- id_token and userinfo signing: `ES256, PS256, RS256`

Note: the swagger example `configResponse` is stale (`claims_parameter_supported: false`, `scopes_supported: [openid, banno, email, phone]`). The live document wins.
