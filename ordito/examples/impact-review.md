# Review change impact from the model

This walkthrough uses declarations from the Specsplice examples. You can follow it with the model alone.

## Payment contract in the built-in example

1. From Home choose **Explore Purchase Example**, then select **Confirm Purchase → Checkout Structure** in the sidebar.
2. Select **Request Payment**. In its properties, follow **Request Payment → Payment: implements contract**. The contract opens in **Element Details** because it has no placement in a diagram.
3. Choose **Show Change Impact**. The contract is in scope. **Request Payment**, **Payment Service**, **Confirm Order**, **Checkout** and **Customer** are potential dependents. Each item shows a declared reference and its distance from the contract.
4. The report lists the owner context **Confirm Purchase** separately from the potential dependents. The diagrams to review include **Checkout Structure**, **Payment Outcome** and **Cancellation Flow**. **Cancellation Flow** shows the same **Customer** found by the analysis.
5. Open an item or diagram and use **Back** and **Forward** to navigate. **Read Change Impact** opens the same report in the built-in reader. The model stays as saved while you navigate.

**Cart** and **Order** are reachable only through outgoing references. See **Relationships to Review** for their links to in-scope elements. **Recorded Evidence** shows zero code mappings and zero verifications for the built-in example.

## Resource and states in the design example

Open [checkout-designed.ordito.json](checkout-designed.ordito.json), select **Order** in **Checkout Structure** and choose **Show Change Impact**. The scope includes the resource and its states. Declared references lead back to the controller, interface and actor. You can open **Checkout Structure** and **Order States** from the report.

Flow actions and order states have distinct identities. The report follows declared model references and includes only the views reached by those references. Check the code separately for dependencies beyond the available model references.

## Documents with recorded evidence

If a document contains `codeMappings` or `verifications`, **Inspect Recorded Evidence** shows the file, symbol and revision, plus every recorded outcome with its criterion, evidence and revision. You can distinguish criteria with no records from criteria with mixed outcomes. A pass applies to the revision in its record. Check revision and recency explicitly when comparing records. The test runner verifies these cases with separate synthetic fixtures.
