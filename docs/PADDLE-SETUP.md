# Foundkeep — Paddle sandbox setup

The chosen direction is Paddle for web billing, Apple in-app purchases for iOS, and a shared RevenueCat `pro` entitlement. The owner has created a Paddle account and is starting the first sandbox integration. Foundkeep targets customers outside India; the seller account must still use the owner's actual legal identity and country.

## Current status

- The live Foundkeep website still has the previous, disabled Stripe checkout path.
- The backend's RevenueCat verification currently recognizes the Apple monthly product only. Paddle entitlement recognition, payment-source attribution and web checkout must be added before enabling Paddle purchases in Foundkeep.
- TestFlight 1.0.0 (18) includes RevenueCat's native SDK, but purchases remain unavailable without its provider configuration.
- The sandbox catalog script has local tests. It has **not** run against the owner's account yet; the private sandbox API key is pending.
- No real payment or Paddle-to-RevenueCat fulfillment test has passed yet. Account creation is not production approval.

## 1. Choose the sandbox journey

On Paddle's integration page choose **No, this is my first integration**, then **Integrate in sandbox**.

Create/sign into [Paddle sandbox](https://sandbox-vendors.paddle.com/) using your own email. Paddle's sandbox and production accounts, keys, products and prices are separate. Sandbox does not charge real money and does not require production account verification.

## 2. Let the coding agent create the catalog

In the **sandbox dashboard** open **Developer tools → Authentication → New API key**:

- Name: **Foundkeep sandbox catalog**.
- Permissions: **Products — Read and Write**, **Prices — Read and Write**.
- Paste the key into BB's private `PADDLE_SANDBOX_API_KEY` form, not into chat.

The form writes `/home/pritam/.config/foundkeep/paddle-sandbox.env`. This file is outside the repository and is not loaded by the live backend.

The operator previews and then applies the catalog:

```sh
node scripts/paddle-sandbox.mjs --env-file /home/pritam/.config/foundkeep/paddle-sandbox.env
node scripts/paddle-sandbox.mjs --env-file /home/pritam/.config/foundkeep/paddle-sandbox.env --apply --output /home/pritam/.config/foundkeep/paddle-sandbox-catalog.json
```

The script only calls `sandbox-api.paddle.com`, rejects live keys, and does not print keys or provider error bodies. It reuses a matching existing catalog and stops if existing terms conflict. It does not blindly retry writes after network failures. Its CLI lock prevents concurrent runs using the same credentials file; after a process crash, inspect the catalog and verify no process is running before removing a stale `.catalog.lock` file. Output files are created exclusively, so select a new output filename for subsequent reports or omit `--output`.

Expected catalog:

| Field | Value |
| --- | --- |
| Product | Foundkeep Pro |
| Description | Automatic tags, summaries and connections for your saved collection. Includes 500 processing credits per month and 2 GB of storage. |
| Tax category | SaaS (`saas`); must be enabled in Paddle |
| Price name | Foundkeep Pro Monthly |
| Amount / currency | 5.00 / USD |
| Billing | Recurring, every 1 month |
| Trial | None |
| Quantity | Exactly one |
| Tax calculation | External: applicable tax is added at checkout |

The report includes the non-secret `pro_…` and `pri_…` IDs. RevenueCat imports a Paddle **price** as a product; the `pri_…` identifier is therefore the identifier needed for entitlement verification.

## 3. Connect Paddle to RevenueCat

Keep the catalog key separate from the integration key. Create another sandbox API key named **Foundkeep RevenueCat sandbox**. RevenueCat's current minimum permissions are:

| Permission | Read | Write |
| --- | --- | --- |
| Addresses | Yes | No |
| Adjustments | Yes | No |
| Businesses | Yes | No |
| Client-side tokens | Yes | Yes |
| Customer portal sessions | — | Yes |
| Customers | Yes | No |
| Discounts | Yes | No |
| Notification settings | Yes | Yes |
| Notifications | Yes | No |
| Payment methods | Yes | No |
| Prices | Yes | No |
| Products | Yes | No |
| Subscriptions | Yes | No |
| Transactions | Yes | Yes |

RevenueCat currently instructs users to set this integration key not to expire. Keep it private and rotate it through the provider connection when required. No customer authentication token, notification simulation or report permissions are required.

Then in RevenueCat:

1. Open the existing **Foundkeep** project.
2. Open **Web** and create a **Paddle** configuration for sandbox. Do not choose RevenueCat Billing, which requires Stripe.
3. Paste the integration API key directly into RevenueCat's **Set secret** field and connect to Paddle.
4. Enable automatic purchase tracking. RevenueCat-generated purchase flows will receive Foundkeep's existing opaque `fk_…` identity; do not replace that identity with the customer's email.
5. Import the new Paddle price into **Product catalog → Products**.
6. Attach it to the existing **`pro`** entitlement, alongside **`app.foundkeep.pro.monthly`**.
7. Add the Paddle product to the monthly package of the current **`default`** offering. Keep the Apple product assigned to its App Store app.

If a direct server-created Paddle checkout is used instead of RevenueCat-presented checkout, configure explicit custom-data identity detection as documented by RevenueCat. The identity mapping must match the implementation; automatic anonymous customer IDs alone cannot link a purchase to a Foundkeep account.

For RevenueCat-presented checkout, disable Paddle's abandoned-cart emails: those recovery URLs cannot reopen RevenueCat-created checkouts. Configure the required checkout domain and default payment link for the selected checkout path; `pay.rev.cat` applies to RevenueCat-hosted purchase links, while a self-hosted Web SDK checkout requires `foundkeep.app`.

## 4. Fulfillment and verification gate

Before exposing checkout, implement and test:

- Recognition of the exact Paddle price and store in server-fetched RevenueCat subscriber data; retain Apple product verification.
- One owned `fk_…` identity per Foundkeep account and a shared `pro` entitlement.
- Correct Apple/Paddle management links in the dashboard and mobile app.
- Authenticated RevenueCat webhooks at `https://foundkeep.app/api/billing/webhooks/revenuecat`; always fetch current subscriber state rather than trusting browser checkout success.
- Sandbox access restricted to dedicated test accounts through `REVENUECAT_SANDBOX_ACCOUNT_IDS`, with global sandbox access disabled on production.
- Existing-subscription checks, pending purchase handling, cancellation, refunds, expiry, webhook retries, account switching and account deletion.

Use real sandbox purchases to test the integration. Paddle's webhook simulator events are ignored by RevenueCat and cannot establish that entitlements work. Configure RevenueCat's backend key and webhook authorization using the existing private form described in [REVENUECAT-SETUP.md](REVENUECAT-SETUP.md).

## 5. Move to live after sandbox succeeds

Complete Paddle's seller verification, payout details and checkout-domain approval. Confirm pricing for the USD 5 plan with Paddle (its published pricing page requests contact for products below USD 10). Create/import a separate live catalog, then configure a separate live Paddle connection in the same RevenueCat project. Keep sandbox and live product IDs explicit and separate. Enable live checkout only after a deployment and fulfillment review.

## References

- [RevenueCat Paddle integration, permissions and sandbox setup](https://www.revenuecat.com/docs/web/integrations/paddle)
- [RevenueCat Paddle notification identity mapping](https://www.revenuecat.com/docs/platform-resources/server-notifications/paddle-server-notifications)
- [Paddle API authentication](https://developer.paddle.com/api-reference/about/authentication/)
- [Create a product](https://developer.paddle.com/api-reference/products/create-product/)
- [Create a price](https://developer.paddle.com/api-reference/prices/create-price/)
- [Paddle pricing](https://www.paddle.com/pricing)
