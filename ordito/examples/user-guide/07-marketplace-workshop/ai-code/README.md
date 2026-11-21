# Marketplace Checkout and Returns

This module is the starter codebase for L17 of the Specsplice user guide. Copy the `ai-code` folder, open a terminal in the copy and run `npm test` with Node.js 24 to run the five tests. In Specsplice choose **Import Codebase** and select the same folder. Review the proposed diagrams for **Checkout** and **Returns**, then follow the evidence back to the source files and tests.

Both features work with the same **Order**. **Checkout** calculates the total in cents and records the order only after the simulated payment is approved. **Returns** looks up the stored order and checks a 30-day return window. The sample uses synthetic data and an in-memory store.
