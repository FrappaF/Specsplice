# Marketplace Codebase

This is a standalone JavaScript project for Node.js 24. **Checkout** and **Returns** use the same order store. The HTTP server listens on `127.0.0.1`, simulates payment outcomes and records events in a local in-memory outbox. Orders and events start empty on every restart.

## Run the sample and tests

Open a terminal in `08-marketplace-codebase` and run these commands with Node.js 24. The project uses only built-in Node.js modules.

```sh
npm test
npm start
```

The tests cover quantity limits, totals in cents, rejected payments, duplicate orders, the return window and the HTTP flow with events. The server prints its local address and listens on port `3080` by default. If that port is in use, set the `PORT` environment variable before starting it.

Try these requests in a second terminal.

```sh
curl -sS -X POST http://127.0.0.1:3080/checkout -H 'Content-Type: application/json' -d '{"orderId":"order-1","quantity":2,"unitPriceCents":1250,"approved":true}'
curl -sS http://127.0.0.1:3080/orders/order-1
curl -sS -X POST http://127.0.0.1:3080/orders/order-1/return
curl -sS http://127.0.0.1:3080/events
```

The checkout confirms a `2500`-cent order. The return responds with the same ID, sets the status to `returned` and reports `2500` cents as the simulated refund. The final response contains `order.confirmed` followed by `order.returned`. Sending the return again produces `409` with `already-returned`. A return is still valid exactly 30 days after the purchase was confirmed. Stop the server with `Ctrl+C`.

## Import into Specsplice

1. Copy the `08-marketplace-codebase` folder to a new location. From Home, choose **Import Codebase** and select the copy.
2. Choose **Structure and Available Semantic Analysis**. When **Source Inventory Ready** appears, look for the declarations below and open their source files.
3. If you have configured a provider, you can choose **Explore Architecture**. Check that the proposed views distinguish **Checkout** and **Returns**, use a single identity for **Order** and link each behavior to its source. You can apply the diagrams to the copy from the review.

| Evidence | Source to open |
| --- | --- |
| HTTP entry point, routing and composition with one store and one outbox | `src/main.mjs` and `createMarketplaceServer` in `src/server.mjs` |
| Integer quantity from 1 to 10, safe arithmetic in cents and the rejection branch | `checkout` in `src/checkout.mjs` and `authorizePayment` in `src/payments.mjs` |
| The **Order** record and the transition from `confirmed` to `returned` | `createOrderStore` in `src/orders.mjs` |
| Lookup of the same order, the 30-day limit and duplicate return prevention | `returnOrder` in `src/returns.mjs` |
| Ordered local publication and verification of the HTTP flow | `createOutbox` in `src/outbox.mjs` and `test/marketplace.test.mjs` |

During review, look for the HTTP boundary, the two flows and the branches for rejection or expiration. Describe the outbox as local memory. The sample models payments, storage and events entirely in-process.
