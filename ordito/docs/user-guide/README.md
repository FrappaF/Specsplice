# The Complete Specsplice User Guide

**A tour, a project built from scratch, and a diagram reference.** Edition dated 21 November 2026. This guide uses the current Specsplice name and command labels. The screenshots show the desktop preview released as Ordito `v0.1.0`, where Command Palette entries use the `Ordito:` prefix. [Guide for that preview](https://github.com/FrappaF/Specsplice/blob/v0.1.0/ordito/docs/user-guide/README.md)

Specsplice is a desktop integrated development environment (IDE) for designing software with diagrams, defining contracts and behavior, exploring code, and working with artificial intelligence (AI). Diagrams show who does what, which data they use, and what happens if something fails. In this guide you will build and save a model of an online store and test selected rules locally. Each stage identifies what you can expect from the descriptive model, the generated code, and the verification results.

## How to use this guide

This guide is for software designers and developers who are new to Specsplice. To start, you should be comfortable working with files and folders and understand basic concepts such as data, functions, and conditions. The guide introduces each notation as you need it. L16 and the direct code changes in L20 also require basic JavaScript and terminal skills. See A1 for the tools needed to build Specsplice from source.

Before T1, check that Specsplice starts and that you can write to the folder where you extracted the examples. You will edit and save the model in that copy. If you still need to set up the application, start with A1. The tour and manual modeling require no AI account. To generate and verify code with the local profiles in L12–L15, make sure Node 24.22.1 is available when Specsplice starts. The runner uses it to execute the generated files. The guided simulations in L14–L15 run without a broker. L17–L19 list the prerequisites for AI-assisted tasks.

**Part I is a tour of a ready-made project, Order Shop.** **Part II is the Marketplace lab**, where you build your own model. **Part III is a reference** for choosing and working with a notation. The appendices cover installation, IDE tools, and troubleshooting.

| Goal | Where to start | What you will achieve |
| --- | --- | --- |
| Get oriented on your first visit | A1 if needed, then T1–T5 | Open, read, edit, and reopen Order Shop |
| Design Marketplace | L1–L11, with the diagram reference | Save a model with 18 views, types, a contract, and a decision |
| Verify a rule locally | L12, then reverse in L20 | Verify the 1–10 limit, apply the files, and try undoing the changes |
| Explore other local behaviors | L13–L15, after the concepts in L7 and the review in L12 | Read calls and simulate states and deliveries in separate modules |
| Explore the source code | L16 | Pass seven tests, run the demo, and open a declaration from its source evidence |
| Generate diagrams with AI | L17 | Review the checkout and returns views together and inspect their shared order resource |
| Generate code with AI | L18 | Verify and apply a first implementation to a project that starts with diagrams |
| Update existing source, work in a worktree, or try Sync | L18–L19 | Review changes using a compatible workflow |
| Hand off your work | L21 | Deliver a project that can be reopened, with documented results and open decisions |

Follow L1–L11 in order to create the objects reused in later lessons. You can do the standalone exercises in L13–L15 in any order once you have used the review in L12. L17–L19 are optional for the local exercises.

Allow about half an hour for the tour, depending on how familiar you are with the interface. Plan multiple sessions for the lab. Stop at the checkpoints, save your changes, and pick up where you left off. Each lesson opens with the problem and how you will use the result. Its final check helps you decide when to move on. In your own projects, create the views you need for a decision. The lab covers all of them so you can learn when to use each one.

Extract the [example projects](example-projects.zip) to a folder you can write to. Copy each folder in full, including hidden files. The examples store their model in `.ordito`. Specsplice can also open projects saved in the earlier `.ade` folder. Keep the original archive so you can start again without losing your working copy. **You can complete the exercises using the interface.** Commands, properties, and forms maintain the shared references in the model JSON for you. If Specsplice is not ready to run, complete A1 first.

| Material | How the guide uses it |
| --- | --- |
| `01-visual-workshop` | Tour with eight views covering Confirm Purchase and Returns and Refunds |
| `07-marketplace-workshop/start` | Starting folder for the lab, with no prebuilt model |
| `07-marketplace-workshop/milestones` | Two visual checkpoints to compare with your early work |
| `07-marketplace-workshop/solution` | Complete reference model with 18 views across 16 notations |
| `07-marketplace-workshop/modules` | Executable exercises for quantity rules, interactions, states, and messaging. Each subfolder is a standalone Specsplice project |
| `07-marketplace-workshop/code` | Small JavaScript module to run and import |
| `07-marketplace-workshop/ai-code` | Source and tests for generating the checkout and returns diagrams in L17 |
| `07-marketplace-workshop/modules/ai-generation` | Model and independent cases for generating the first source files in L18 |
| `08-marketplace-codebase` | Standalone source and test project for **Import Codebase** |
| `02` through `06` | The starting points for the advanced labs, available as separate projects |

Bold command and control names match the interface. **Project > Project Settings** means to open the menu with the project name. To open the Command Palette, use `F1`, `Cmd+Shift+P` on macOS, or `Ctrl+Shift+P` on Windows and Linux. You can also search the palette for commands from the menus. In the HTML version, use the contents or search to find a chapter, and click an image to enlarge it.

A **feature** is a product capability, such as checkout. The **model** stores shared definitions and relationships. A **view**, also called a **diagram**, shows one perspective on the model on the **canvas**. A **review** lets you inspect a proposal before applying it. The screenshots help you get oriented. The command names and text feedback let you follow the instructions regardless of color or placement.

## Part I - Tour of Order Shop

Before building Marketplace, explore a store that is already modeled. You will see what each view tells you and which objects the views share. Then you will make and undo a small change so you know how to find and recover your work before starting from scratch.

### T1. Open the store and find the main controls

Start with a working model so you can learn to read its views. In this step you will identify the active project and diagram and find elements without changing them. You will use the same controls to compare checkout and returns in the next steps.

From **Start a Project**, click **Open Project**, select the `01-visual-workshop` folder in the system picker, and confirm. You should see **Order Shop** in the header and **Checkout Structure** as the active diagram.

![The Home screen lets you open, create, or import a project](images/01-home.png)

In this store, a customer can confirm a purchase. An approved payment confirms an order. A declined payment ends the purchase unsuccessfully. The second feature handles return requests and refunds. The 30-day limit is a rule for the exercise.

![The starting point of the tour, with the diagram at the center](images/02-canvas.png)

Use these four controls to switch views, inspect their contents, and bring all the elements into view.

1. Click the **diagram name** to open **Choose Diagram**. Type part of the name if the list is long. You can also click a view that is already visible in the sidebar.
2. Click a **canvas element** to open its properties. Click **Close Properties** to close them.
3. Click **Fit Diagram** to bring the entire view into the frame. Zoom or drag the background to read the diagram.
4. Click the **project name** to return to Home or open another project. You will use the settings later.

**Diagrams** opens and closes the navigation sidebar. **Code** contains code workflows. In the sidebar, **New** contains **Add Feature**, **Add Diagram**, and **Structural Blueprint**. Switching views leaves the model as it was. **Save** appears when you have pending changes. **Model Saved Locally** confirms the model was saved to your computer.

**T1 check.** Open **Choose Diagram** and find the eight views grouped under two features. The picker also includes **Add Diagram** and **Add Feature**. In the sidebar, **Related Diagrams** lists two views from the **Returns and Refunds** feature under the checkout feature. Click outside the picker to close it. If the canvas appears empty, try **Fit Diagram** before creating anything.

### T2. Follow a purchase from four perspectives

Read the same purchase from four perspectives to understand responsibilities, alternatives, messages, and the resulting state. Start with the structure to identify the objects. Then look at behavior, where a call and an order state describe different parts of the purchase. You will use these distinctions when building Marketplace.

Open **Checkout Structure**. Follow the arrows from “Customer” to “Checkout Page,” then “Confirm Order” and “Order.” “Customer” is the customer role. “Checkout Page” represents the store interface, “Confirm Order” coordinates the request, and “Order” is the resource that gets recorded. The store page is modeled as an element within the diagram.

Select the relationship pointing to “Order.” The **Write** relationship “create order” identifies who records the data, and the condition “payment authorized” indicates when to record it. This is a description of the rule. Payment execution and data writes happen in the code. The properties explain the roles without crowding the canvas with labels.

In the sidebar, click **Checkout Flow**. Start at “Request Payment” and follow the alternatives to “Order Confirmed” or “Payment Declined.” This view shows what happens for each outcome.

![The flow shows what happens when payment is approved or declined](images/05-flow.png)

Open **Payment Sequence**. The columns represent participants. The two arrows show the alternative outcomes “confirm order” for an approved payment and “show error” for a declined payment. You will build a more detailed sequence in L7 that includes the authorization call and the subsequent write to “Order.” Next, open **Order States** and find the “Pending,” “Confirmed,” and “Payment Declined” states. The “request payment” action initiates a payment attempt. The “Confirmed” state records its successful outcome.

**T2 check.** Describe the purchase in four sentences. Identify who works together, which outcomes are possible, who calls whom, and how the order changes state. The four views are descriptive. L11–L15 show how to add contracts and executable checks.

### T3. Explore returns and refunds

The return uses an existing order. When you compare the two features, look for “Customer” and “Order” in both and for the new “Return Request” resource in the returns feature. The behavior views show when the return is approved and when the refund is completed.

Click **Returns Structure** in the sidebar under **Related Diagrams** or under **Returns and Refunds**. If the view is off screen, find it using **Choose Diagram** in the header. The request starts with the same “Customer” as in checkout. It goes from “Returns Page” to “Manage Returns,” reads the existing “Order,” and records a new “Return Request.” The return request refers to the original purchase, which remains a separate object.

![The diagram picker shows both features and their four perspectives](images/15-tour-two-features.png)

![Returns reuse Customer and Order and introduce Return Request](images/16-tour-returns.png)

Open the other three views to follow the return from evaluation through completion. The flow shows alternatives, the sequence shows the order being read before the return is recorded, and the state diagram distinguishes an approved request from a refunded one.

| View | What to follow | Question to answer |
| --- | --- | --- |
| Refund Flow | “Evaluate Request,” “Issue Refund,” and “Return Ineligible” | Which condition allows a refund? |
| Return Sequence | The customer request, submission, order lookup, and recording | Which information must already exist before a return is recorded? |
| Return Request States | “Requested,” “Authorized,” “Refunded,” and “Rejected” | When does an approved request become a refunded request? |

Select each arrow in the flow and read its condition. Then look at the transition from “Authorized” to “Refunded.” Approving and completing the refund are separate steps. The model represents the rule agreed for the exercise. It involves no real bank contact or deadline calculation.

**T3 check.** Find a read of “Order” and a write of “Return Request.” Explain why the returns feature can use the existing order resource without creating a separate order for returns.

### T4. Find an element and see its shared identity

You have seen “Order” in two features. Now find it and rename it in a copy of the project. The resource changes across its views, which each keep their own title. Checking the impact of that edit prepares you to make a change in the next step.

Click **Search System** in the sidebar. If the sidebar is closed, reopen it with **Diagrams**. Search for “Order,” check that it has the **Resource** type, note the associated views, and click the result. Specsplice centers and selects the resource in a view. Click it on the canvas to open **Properties**. Search includes unsaved changes and can open details for identities that have no view. Use **Back** and **Forward** to revisit previous locations.

Use **Search System** when you know the name. To explore what belongs to an actor or feature, click **System Map** in the header or sidebar. Clicking an item adds it to the active filters. Use the arrow to open a level and **×** to remove a filter. You can still access internal and shared elements of features connected to the actor. A9 explains navigation, filters, and relationships.

An element retains its identity when you rename or move it. A diagram selects elements and relationships and has its own layout. **Add Existing Element** reuses an identity. **Add Element** creates one. Two objects can have the same name and still have distinct identities.

In your copy, select **Order** and click **Rename** next to the properties heading. Enter “Customer Order” in **Name** and click **Save Changes**. Open **Returns Structure** and find the updated name. Select that resource and choose **Show Change Impact** under **Explore** to see the affected views and references. Click **Undo** to restore the original name. If **Save** is visible, click it to save any pending changes.

**T4 check.** The resource should have the new name in both views before you undo it. The diagram titles “Order States” and “Checkout Structure” and other text containing the word “order” retain their original wording. The renamed element keeps its identity.

### T5. Make your first reversible change

Add an order notification to practice editing the model. Represent it as a component with its own responsibility, then connect it to “Confirm Order” so the request is made when an order is confirmed. Save, undo, redo, and reopen the project to see how Specsplice keeps track of your edits before you start Marketplace.

Work in your copy of Order Shop and open **Checkout Structure**.

1. Click **Add Element**. Enter “Order Notifications” in **Name**, select **Component** in **Element Type**, and click **Create**.
2. Drag the component to an open area. Select **Confirm Order** on the canvas, click **Connect**, and choose **Invocation**.
3. Click **Order Notifications** on the canvas. In **Create Relationship**, enter “sends confirmation” in **Relationship Name** and `confirmed order` in **Condition (Optional)**. Click **Save Changes** to create the relationship or **Cancel** to back out.
4. Select the arrow, check its origin, destination, and text, then close the properties.
5. Click **Save** in the header. If **Update Codebase from Diagrams** appears, choose **Cancel**. For now, save the responsibility in the model. You will implement behavior later.
6. Click **Undo**, then **Redo**, next to **Fit Diagram**. Save the version you want to keep. Open the **Order Shop** menu, choose **Open Project**, select the tour folder again, and check that your saved change is there.

![The properties of Order in Marketplace show Rename and Remove from This Diagram](images/04-properties.png)

To remove an element from the current view, select it and click **Remove from This Diagram** in **Properties**. The panel closes. Use **Undo** next to **Fit Diagram** to restore the element to the view. **Delete Element** under **Manage** removes the shared definition from the system and can affect other references. Check the impact before confirming. Deleting a view preserves its semantic elements. If you switch projects with pending changes, you can save the changes, discard them, or cancel the switch.

**T5 check.** After reopening the project, find the notification and its relationship or confirm they are gone if you chose to undo them. You have finished the tour when you can find a view, read a relationship, reuse an identity, and recover a change.

## Part II - Lab: build Marketplace from scratch

Turn the requirements for a small store into decisions you can verify. Start with users and system boundaries, then model responsibilities, data, and behavior. The views help you prepare contracts. In the local modules, you can test individual rules without building a full online store. Use this order to learn how the views work together, then choose the views you need in your own projects.

### L1. Set up the lab and choose the right folder

Prepare a working folder to build **Marketplace**, a small online store for the lab. You will move from reading an existing project to making your own design decisions, starting from `start` or an empty folder. Use the checkpoints to compare results and the separate modules for the later exercises that run code.

The customer “Customer” buys products and requests returns, which the support team “Support” handles. “External Payments” authorizes payments, “External Carrier” handles delivery, and “Product Catalog” provides context for the data. The lab produces a consistent model and local checks for selected behaviors. There is no running store.

Keep your work, checkpoints, and modules in separate folders. Specsplice opens one project root at a time and saves the model in that folder. Starting with an empty folder lets you see what each step adds.

1. Extract `example-projects.zip` and keep the original archive.
2. Find `07-marketplace-workshop`. Open the subfolder indicated by each lesson. The top-level lab folder contains several projects.
3. To build the project, use `start`, which contains only instructions, or create an empty folder named `my-marketplace` in your file manager. Leave the model from the solution in its own folder.
4. Start Specsplice. If you are looking at a diagram, click **Home** in the **Diagrams** sidebar or choose **Home** from the project menu.

The store has the following rules. Each order line has a quantity from 1 to 10, as an integer. Prices are in cents to avoid implicit rounding. An order has at least one line and is confirmed after payment authorization. A return applies to an existing order and is allowed within 30 days. A coupon is optional in the use case example. Taxes, live payments, security, and business rules for a real shop require further specification.

| Lessons | Folder to open | What you will do |
| --- | --- | --- |
| L2–L11 | Your `my-marketplace` or `start` | Build views and contracts manually |
| Compare after L3 | `milestones/01-boundaries` | Check the first stage without replacing your work |
| Compare after L5 | `milestones/02-data-architecture` | Check the architecture and data model |
| Compare after L10–L11 | `solution` | Review the final reference model |
| L12 | A copy of `modules/quantity` | Define an executable rule and cases, then review, verify, apply, and undo |
| L13–L15 | `modules/interactions`, then `modules/states`, then `modules/messaging` | Complete three separate local exercises |
| L16 | A copy of `code` | Run tests and the demo, then build a source inventory |
| L17 | A copy of `ai-code` | Import code and generate diagrams |
| L18 | A copy of `modules/ai-generation` | Generate and verify a first implementation |
| L19–L20 | The compatible project specified in the lesson and a copy of `modules/quantity` for L20 | Try Sync, reverse, and runtime selection |

The project root is the folder you select in **Open Project** or **Create Project**. Keep your store project in its own folder, separate from the Specsplice clone. **Open Project** opens an existing model. **Create Project** starts a new one. **Import Codebase** analyzes a folder of source files.

Save at the end of each lesson so you can continue later. To compare your work, use **Open Project** on a copy of the checkpoint and then reopen your own folder. Leave the solution in its own project so you can compare it without overwriting your model. Executable modules have their own project roots, where they isolate the behaviors being tested.

### L2. Create the project, features, and first structure diagram

Start with a checkout overview so you can name the responsibilities and data that later views will reuse. The features “Checkout,” “Product Catalog,” and “Returns and Refunds” organize the store’s capabilities. The structure diagram shows who initiates the purchase, who coordinates it, and what gets recorded before you define the boundaries and details.

#### Create and navigate the project

Create the project in the folder you prepared, then create the three features. These groups help you find the checkout, catalog, and returns views in the model. You will define access roles and runtime services separately when needed. Return to the checkout structure diagram to create your starting overview.

1. From Home, click **Create Project**.
2. Enter `Marketplace` in **Name** and click **Save Changes**.
3. Select the folder you prepared in L1 and click **Open**. On macOS, you can also create `my-marketplace` with **New Folder**. Specsplice opens the Marketplace project home.
4. Click **Create First Feature**, enter `Checkout`, and click **Save Changes**. Specsplice opens **Checkout · Structure** and also creates **Checkout · Flow**.
5. Click the view name in the header, choose **Add Feature**, enter `Product Catalog`, and click **Save Changes**.
6. Repeat for `Returns and Refunds`.
7. Open **Checkout · Structure** from the view picker. If the view is visible in **Diagrams**, you can click it directly.

In the lab you will assign most ordinary views to “Checkout” in the creation form. The two returns views will have their own feature. You create C4 views from the blueprint, and they also appear in the system navigation. These groups organize views while the views share the same underlying elements.

#### Add the first six elements

Give the overview six identities to reuse. **Actor** represents who acts, **Application / Container** represents the web shop, **Component** represents internal responsibilities, **Resource** represents the domain result, and **Software System** represents the payment service. These types help later view pickers offer compatible representations. An element’s type is separate from its name.

For each row, click **Add Element**, enter **Name**, and click **Create**. Change **Element Type** if the suggested type differs from the table. The list shows the types available in the current view. Click **Cancel** to close the form.

| Name to enter | Element Type | Responsibility |
| --- | --- | --- |
| Customer | Actor | Requests a purchase |
| Web shop | Application / Container | The store’s web application |
| Checkout | Component | Coordinates confirmation |
| Order | Resource | The recorded domain result |
| External Payments | Software System | The external payment authorization service |
| Returns Handling | Component | Looks up the purchase to handle the return |

You will mark “External Payments” as external in L3. For now, create it with the **Software System** type. If an element ends up outside the frame, click **Fit Diagram** to locate it before adding anything else.

#### Create a relationship from start to finish

Connect the elements to show how the customer enters the shop and how checkout, payment authorization, and recording follow. Start with “Customer” and “Web shop” to learn the full form. Then repeat the process for the other relationships.

1. Click **Customer** on the canvas and click **Connect**.
2. If **Relationship Type** appears, choose **Communication**. When only one type is compatible, Specsplice highlights the destinations immediately.
3. Click **Web shop** among the highlighted destinations.
4. Enter `browses` in **Relationship Name**, leave **Condition (Optional)** blank, and click **Save Changes**.

If the source is already selected, start with **Connect**. **Connect Selection** in the properties opens a form with the type, destination, name, and condition on one screen.

Repeat the process for the four rows below. Enter a condition only where shown.

| Source | Relationship Type | Destination | Relationship Name | Condition |
| --- | --- | --- | --- | --- |
| Web shop | Invocation | Checkout | submits purchase | Blank |
| Checkout | Invocation | External Payments | authorizes payment | Blank |
| Checkout | Write | Order | records order | payment authorized |
| Returns Handling | Dependency | Checkout | looks up purchase | Blank |

**Communication** describes access to the shop, **Invocation** a request, and **Write** a data record. The **Write** condition describes recording the order after approval. You will execute and verify rules in later exercises. **Dependency** states what “Returns Handling” uses. Call order can be described separately.

**Reuse elements and relationships separately.** **Add Existing Element** adds the element to the view. For an ordinary view, include both endpoints, then choose **Diagram > Contents > Add Existing Relationship** and select the relationship. A C4 view can already include compatible relationships between visible elements, so check the canvas first. In a sequence diagram use **Add Existing Message**. **Connect** creates a new relationship in the system.

#### Rename, arrange, and save

Name the view so you can find it among the diagrams you will create later. Arrange elements and labels so you can see the responsibilities without opening each set of properties. Save and reopen the project to check that the first stage is in the correct root.

If the properties are open, click **Close Properties**. Open **Diagram** and click **Rename** next to the title. Enter `01 Responsibilities Overview` and click **Save Changes**. Check the new name in the header.

Open **Diagram** and click **Arrange** next to the title. Choose **Balanced**, then click **Fit Diagram**. Drag elements to make the flow clearer. To show all the labels, choose **Diagram > Layout and Display > Show Relationship Labels**.

Click **Save** in the header. If **Update Codebase from Diagrams** appears, choose **Cancel**. **Model Saved Locally** confirms the model was saved.

**L2 check.** Return to Home, choose **Open Project**, and reopen the same folder. You should see three features, six elements in the overview, and five relationships. The other automatically created views may be empty. Continue with the overview you created.

### L3. Define the context and user goals

The L2 overview names the first responsibilities. Now define the Marketplace boundary and the goals of “Customer” and “Support.” The context view shows the system you are designing and the external services it uses. The use cases capture what actors need the shop to do. In L4, you will divide the inside of the system into parts that support those goals.

#### Open Structural Blueprint

Structural Blueprint stores shared declarations such as boundaries, ownership, and contracts. Use it to assign these properties to existing objects and review the draft before you update the model.

Click **Structural Blueprint** in the header. On the left, choose an area and a task, such as **Structure > C4 View Subject and Context**. In the middle, select an item in **Configuration** to edit it, or use the task’s creation button. Fill in the fields in the same panel. You can switch configurations or tasks and return to the draft changes later.

At the bottom, **Review** shows the draft changes. Click a configuration name to return to its panel. **Apply to Model** applies all valid configurations to the model. Click **Save** in the header to keep them in the project. **Cancel Creation** discards the new configuration you are working on, and **Discard Draft** clears all draft changes. Use **Back to Diagram** or **Back to Workspace** to return to the canvas. Contextual actions from the properties open a task for that object. In L12, **Apply to Project** writes the source files from a code review.

#### Create the system and set its scope

Add “Marketplace” as a **Software System** to represent the product boundary. The project name identifies the project. The separate system element identifies the subject of the context view. Set the scope first because the context view needs a governed system as its subject. Reuse “Customer” and “External Payments” from L2 to retain the same references, then add the missing external carrier and support role.

In the overview, click **Add Element**, enter **Name**, select **Software System** in **Element Type**, and click **Create**. Use this process to create **Marketplace** and **External Carrier**. For **Support**, use **Actor** in the same form. “Customer” and “External Payments” are already present.

Open **Structural Blueprint > Structure > System Scope or Container Responsibility**. Select **Marketplace** in **Configuration** and **Governed System** in **Scope**. Use the same picker to select **External Payments** and **External Carrier** in turn, setting **External System** for each. Click **Apply to Model**. “Marketplace” is the system you are designing, and the other systems provide external services.

#### Create the C4 context view

C4 models architecture at several levels, from the system and its context down to its applications and components. Use the context view to see who uses Marketplace and which external services it depends on. L4 will show the internal structure. The subject identifies the system you are looking at. The context declares its external dependencies, and the visible elements are the identities the diagram displays. Keep the subject visible so you can see the boundary.

1. In **Structure > C4 View Subject and Context**, click **New C4 View**.
2. In **View Identity**, enter `02 C4 Marketplace Context` in **View Name**, choose **L1 · System Context** in **C4 Level**, and choose **Marketplace** in **View Subject**. If Marketplace is missing, check that it is a **Software System** with **Governed System** scope.
3. In **View Contents**, select **Context** and **Visible** for “Customer,” “Support,” “External Payments,” and “External Carrier.” “Marketplace” is visible as the subject. Use **Filter Elements** to find an item. Changing the filter preserves your selections.
4. Check **View Preview**, click **Apply to Model**, then click **Open Diagram** in the view’s panel.

![Structural Blueprint shows Marketplace as the subject and four context dependencies](images/33-blueprint-choose.png)

Complete the context view with the exchanges that cross the boundary. In **Create Relationship**, choose **Communication** in **Relationship Type**, select a source and destination, and enter the name. Leave **Condition (Optional)** blank and click **Save Changes**. Connect “Customer” to “Marketplace” with “makes purchases and requests returns,” “Support” to “Marketplace” with “handles requests,” “Marketplace” to “External Payments” with “authorizes payments and issues refunds,” and “Marketplace” to “External Carrier” with “requests delivery.” Reuse any relationship that is already visible.

If an existing project shows **Draft Needs Correction** for the C4 boundary, reopen **C4 View Subject and Context**, choose the view in **Configuration**, and check **C4 Level** and **View Subject**. The panel automatically includes the subject among the visible elements. Click **Apply to Model** and save.

#### Create a use case diagram and add existing elements

The context view shows the system boundary. Use cases show what actors want the system to do. The customer wants to confirm a purchase and request a return. Support helps handle requests. In the lab, you will model these goals before assigning responsibilities to containers in L4. You will distinguish the actors’ goals, the required payment authorization, and the optional coupon. Later flows, contracts, and cases will build on them.

Open **Add Diagram**. In **Create Diagram**, enter `12 Use Cases` in **Name**, choose **Use Case** in **Diagram Type** and **Checkout** in **Choose Feature**. Click **Create** to open the view.

On the canvas, click **Add Existing Element**, search for “Customer,” and choose the **Actor** row. Repeat for “Support” and the **Software System** named “Marketplace.” The view reuses each element’s existing identity.

Reuse the actors and “Marketplace” from the context view so the goals refer to the same identities and boundary. With **Add Element**, choose **Use Case** in **Element Type** and create **Confirm Purchase**, **Authorize Payment**, **Request Return**, and **Apply Coupon**. Associations show who participates in a goal. **Include** declares required behavior, and **Extend** adds behavior under a condition. Create the relationships in the table.

| Source | Type | Destination | Name | Condition |
| --- | --- | --- | --- | --- |
| Customer | Association | Confirm Purchase | starts | Blank |
| Customer | Association | Request Return | requests | Blank |
| Support | Association | Request Return | handles | Blank |
| Confirm Purchase | Include | Authorize Payment | include | Blank |
| Apply Coupon | Extend | Confirm Purchase | extend | coupon provided |

Assign the four use cases to “Marketplace” to declare which system owns them. Open **Structural Blueprint > Structure > Architectural or Lifecycle Owner**. In **Configuration**, choose **Confirm Purchase**, then select **Marketplace** in **Architectural Owner**. Expand **Assign the Same Owner to More Elements** and select **Authorize Payment**, **Request Return**, and **Apply Coupon**. Click **Apply to Model**, then **Back to Diagram**. The visible “Marketplace” element marks the boundary for its use cases. Use **Diagram > Arrange > Balanced**, then **Fit Diagram**, to arrange the ovals and keep their names readable.

Use **Include** because confirming a purchase requires payment authorization. Use **Extend** for the optional coupon, pointing from the added behavior to the base case. A purchase can proceed without a coupon and can be confirmed after authorization. You will model authorization in the flows later. The coupon is an example of an optional extension. Use cases describe goals and dependencies. The activity and sequence diagrams will describe the order of steps.

**L3 check.** Save the model. In the context view you should see one governed system, two actors, and two external systems. In the use case diagram, find the customer’s two goals and the optional coupon. Compare your work with the `milestones/01-boundaries` checkpoint.

### L4. Build the C4 container and component views

With the boundary and goals in place, divide Marketplace into applications, data storage, and messaging, then detail the API service. The container view shows which parts communicate. The component view distributes the responsibilities within the API. Set ownership and roles first so the views show the same system at two levels of detail.

#### Create the containers and assign roles

The web shop handles presentation, the API handles application rules, the archive stores data, and the broker distributes events. Each role describes what the container does, and the “Marketplace” owner declares that it belongs to the product. These decisions define the architecture shown in the container view. The services remain design elements in this exercise.

Return to the overview. With **Add Element**, create **Marketplace API**, **Marketplace Store**, and **Event Broker**, choosing **Application / Container** in **Element Type**. “Web shop” already exists. “Marketplace API” is the service that receives requests from the store.

Open **Structural Blueprint > Structure > System Scope or Container Responsibility**. Choose a container in **Configuration** and fill in **Description** and **Container Role**. Use the picker to move to the next container. After editing all four configurations, click **Apply to Model**.

| Container | Description to enter | Container Role |
| --- | --- | --- |
| Web shop | Store web interface | Web Client |
| Marketplace API | Confirms purchases and handles returns | Service |
| Marketplace Store | Stores orders and products | Data Store |
| Event Broker | Distributes events | Messaging |

Assign **Marketplace** as the architectural owner for the four containers. Open **Architectural or Lifecycle Owner**, choose **Web shop** in **Configuration**, and select **Marketplace** in **Architectural Owner**. Expand **Assign the Same Owner to More Elements** and select **Marketplace API**, **Marketplace Store**, and **Event Broker**. Click **Apply to Model**. Check that all four have the intended owner before creating the view.

#### Create and open the container view

Now show how the containers communicate. Keep “Marketplace” as the boundary and “Customer” as the entry point. The containers show how a request reaches the service, data store, and event broker. The view uses the applications already defined in the model.

Return to **C4 View Subject and Context** and click **New C4 View**. Choose **L2 · Containers**, set the subject to “Marketplace,” and name the view `03 C4 Applications and Data`. Select **Context** for “Customer,” and **Visible** for “Customer” and the four containers. “Marketplace” is already visible. Click **Apply to Model**, then **Open Diagram**.

Keep the existing “browses” relationship from “Customer” to “Web shop.” Create **Communication** relationships from “Web shop” to “Marketplace API” named “sends orders,” from “Marketplace API” to “Marketplace Store” named “reads and writes,” and from “Marketplace API” to “Event Broker” named “publishes events.” Leave all conditions blank. You may also see the “Customer” to “Marketplace” relationship from the context view because both views share the model.

After choosing the endpoints, set the protocol to record how you expect the parts to communicate. Select an arrow and click **Edit Cardinalities and Protocol** in the relationship properties. Fill in **Protocol / Transport**, leave the multiplicity and member fields blank, and click **Save Changes**. Use the values in the table.

| Relationship | Protocol / Transport |
| --- | --- |
| Customer to Web shop | HTTPS |
| Web shop to Marketplace API | HTTPS / JSON |
| Marketplace API to Marketplace Store | SQL |
| Marketplace API to Event Broker | Declared messaging |

The relationship name describes its purpose. The protocol records how the parts are expected to communicate. Leave the first four fields blank because the view describes communication protocols. HTTPS/JSON and SQL are design choices. “Declared messaging” leaves the broker transport open. The labels capture design intent and leave implementation and connection tests for later.

To select an arrow, click its line or label. Check its source and destination in the properties before editing it.

#### Build the components before the contract

Break down “Marketplace API” to show who coordinates purchases, records results, handles returns, and manages availability. Assign the components to the API before including them in its C4 view, since the owner defines the boundary. The contract will identify the agreement offered by “Checkout.” You will define its signature and data in L11.

Return to the overview. With **Add Element**, create **Outcome Log** and **Inventory** as **Component** elements. “Checkout” and “Returns Handling” already exist. In **Architectural or Lifecycle Owner**, choose **Checkout** in **Configuration** and **Marketplace API** in **Architectural Owner**. Under **Assign the Same Owner to More Elements**, select **Outcome Log**, **Returns Handling**, and **Inventory**, then click **Apply to Model**. “Inventory” represents the application’s responsibility for availability. “Marketplace Store” represents persistence.

This view focuses on the four components inside the API. From **C4 View Subject and Context**, click **New C4 View** and select **L3 · Components**. Set the subject to “Marketplace API” and the name to `04 C4 API Components`. Leave the **Context** column blank. Select **Visible** for “Checkout,” “Outcome Log,” “Returns Handling,” and “Inventory.” “Marketplace API” is already visible. Click **Apply to Model**, then **Open Diagram**.

Add the contract that you will use in L11 to formalize what “Checkout” offers. In the C4 view, click **Add Element**, enter **Checkout Contract**, choose **Contract** in **Element Type**, and click **Create**. Specsplice places it under “Marketplace API,” the subject of this view.

Add **Communication** from “Checkout” to “Outcome Log” named “records outcome,” **Implementation** from “Checkout” to “Checkout Contract” named “exposes contract,” and **Dependency** from “Checkout” to “Inventory” named “requests availability.” Reuse the existing “looks up purchase” relationship from “Returns Handling” to “Checkout.” The C4 view offers compatible architectural relationships. The L7 sequence will show calls.

**L4 check.** Save and click **Fit Diagram**. Each container has “Marketplace” as its owner and a declared role. The four components belong to the API. “Checkout Contract” is the API contract provided by “Checkout.” Drag a card to adjust the layout. Use the ownership form to change the declared structure.

### L5. Define entities, columns, and references with forms

The C4 views assign responsibilities and identify storage. Now define the data that checkout and returns need. Use an entity–relationship diagram to describe its meaning and relationships, then design tables and keys in the physical schema. Keeping these levels separate lets you discuss the rule that a return refers to an existing order before choosing how to store the reference.

#### Create the ERD and its entities

Start with the domain entities for customer, order, order line, product, and return. Define attributes and relationships you can understand before choosing their tables. Use the data to check the responsibilities you have designed. For example, checkout needs the quantity and price of each line item.

An entity–relationship diagram (ERD) represents data entities and their relationships. From the diagram picker, choose **Add Diagram**. In **Create Diagram**, enter `05 Entities and Cardinality` in **Name**, choose **Entity–Relationship** in **Diagram Type**, choose **Checkout** in **Choose Feature**, and click **Create**. Use **Add Element**, choose **Entity** in **Element Type**, and create “Customer,” “Order,” “Order Line,” “Product,” and “Return.”

Use **Add Element** to define these domain entities. The “Customer” actor represents who acts, and the “Order” resource represents the object involved in the flow. The ERD entities define their data attributes and relationships. Use **Add Existing Element** to reuse an entity in another data diagram.

#### Add an attribute from start to finish

Attributes specify the data each entity holds. The `customerId` attribute is a text identifier for the customer. Use **No Key** here. Physical keys belong in the database schema.

1. Select the **Customer** card and click **Edit Attributes and Technology** in **Properties**.
2. Click **Add Attribute** under **Attributes and Methods**.
3. Enter `customerId` in **Member Name** and `string` in **Type or Method Signature**. Keep **Attribute / Column**, **No Key**, and **Required Field** at their defaults. Choose **Non-null Value** in **Nullability (Independent of Presence)**.
4. Click **Add Attribute** again to add `email` as shown in the table. Click **Save Changes** to apply both attributes.

The card shows `customerId: string` and `email: string`. To correct a member, reopen **Edit Attributes and Technology**, edit the existing row, and click **Save Changes**.

In this lesson, the type field holds a descriptive declaration. Enter `string` for text and `integer` for whole numbers. You will create shared types for the contracts in L11.

Identifiers let data refer to objects. Quantities and amounts describe what was purchased and how much it costs. Add the members for each entity together in one form. Use **Attribute / Column**, **No Key**, **Required Field**, and **Non-null Value** for every member.

| Entity | Member names and types to add |
| --- | --- |
| Customer | `customerId: string`, `email: string` |
| Order | `orderId: string`, `totalCents: integer` |
| Order Line | `quantity: integer`, `unitPriceCents: integer` |
| Product | `sku: string`, `priceCents: integer` |
| Return | `returnId: string`, `reason: string` |

**Required Field** says that the field must be present. **Non-null Value** says that it must have a value other than `null`. Use both so that every order has a total you can use.

#### Draw relationships and set cardinalities

With the objects and attributes in place, specify how many instances can be linked. The name “contains” tells you the order contains lines, and a cardinality tells you whether it can be empty. Set these rules before creating physical references. Leave the column fields blank for relationships between domain entities.

Create the four **Association** relationships using the steps from L2, leaving **Condition (Optional)** blank. Select each relationship and open **Edit Cardinalities and Protocol**. Enter **Source Multiplicity** and **Target Multiplicity** as shown. Leave the member and protocol fields blank and click **Save Changes**.

| Source | Destination | Relationship Name | Source Multiplicity | Target Multiplicity |
| --- | --- | --- | --- | --- |
| Customer | Order | performs | `1` | `0..*` |
| Order | Order Line | contains | `1` | `1..*` |
| Order Line | Product | refers to | `0..*` | `1` |
| Return | Order | refers to | `0..*` | `1` |

In “Customer” `1` to “Order” `0..*`, a customer can have zero purchases and every order belongs to one customer. In “Order” to “Order Line,” `1..*` requires at least one line. Read both directions. Cardinalities declare allowed relationships between instances.

#### Create the physical schema

Now design how the data will be stored. A **Table** has columns, keys, and physical references. Create tables as separate elements from the domain **Entity** elements. The lesson produces a database design. Creating the database and implementing the full set of domain constraints are separate tasks.

With **Add Diagram**, create `06 Proposed Data Schema`. Choose **Database Schema** in **Diagram Type** and **Checkout** in **Choose Feature**. Create the five **Table** elements listed below. On each table, open **Edit Attributes and Technology** and click **Add Attribute** for each column before clicking **Save Changes**. Set **Key Kind** from the table, keep **Required Field**, and choose **Non-null Value**.

| Table | Columns with name, type, and Key Kind |
| --- | --- |
| customers | `id` (string, Primary Key), `email` (string, Unique Key) |
| orders | `id` (string, Primary Key), `customer_id` (string, Foreign Key), `total_cents` (integer, No Key) |
| order_lines | `id` (string, Primary Key), `order_id` (string, Foreign Key), `product_id` (string, Foreign Key), `quantity` (integer, No Key) |
| products | `id` (string, Primary Key), `sku` (string, Unique Key), `price_cents` (integer, No Key) |
| returns | `id` (string, Primary Key), `order_id` (string, Foreign Key), `reason` (string, No Key) |

In this schema, the primary key identifies a row, the unique keys make email addresses and SKUs distinct, and foreign keys connect rows. Specify the target column for each foreign key. Create an **Association** from **orders** to **customers**, name it `customer_id`, and leave the condition blank. Select the relationship, open **Edit Cardinalities and Protocol**, fill in the fields below, and click **Save Changes**.

| Form field | Value |
| --- | --- |
| Source Multiplicity | `0..*` |
| Target Multiplicity | `1` |
| Source Attribute / Column | `customer_id` |
| Target Attribute / Column | `id` |
| Protocol / Transport | Blank |

Type each member name without a table prefix such as `orders.` or `customers.`. The relationship already identifies both tables. If the member is missing, correct the name or create the column first so the reference points to a real field.

Complete the remaining references. An order line identifies its order and product, and a return identifies its order. For the following three relationships, use `0..*` for **Source Multiplicity**, `1` for **Target Multiplicity**, and `id` for **Target Attribute / Column**. Leave the protocol blank.

| Source | Destination | Relationship Name and Source Attribute / Column |
| --- | --- | --- |
| order_lines | orders | order_id |
| order_lines | products | product_id |
| returns | orders | order_id |

The **Foreign Key** role identifies the reference column. The relationship specifies which record must exist at the other end. Together they express rules such as a return needing an existing order.

**L5 check.** Save and reopen the project. The ERD has five entities, ten attributes, and four associations. The database schema has five tables, fifteen columns, and four references. Compare your work with `milestones/02-data-architecture`. You should now have a schema design ready to discuss. Set up mappings from domain types to columns after creating the shared types in L11.

### L6. Build class, component, and package diagrams

Use UML (Unified Modeling Language) to describe software types and how they work together. The class diagram shows types and operations. The component diagram shows who provides each contract. The package diagram shows dependency direction between logical groups. Compare these decisions about the code with the architecture and data you have defined.

#### Describe types and methods in the class diagram

Define “Order” as a type with attributes and a confirmation operation, “CheckoutService” as a service, and “OrderRepository” as a persistence contract. The “Order” resource identifies the object involved in the application responsibilities, and the “Order” entity describes its domain data. A separate **Class** element lets you define methods on the software type.

With **Add Diagram**, create `11 Classes and Repositories`. Choose **Class** in **Diagram Type** and **Checkout** in **Choose Feature**. With **Add Element**, create **Order** and **CheckoutService** as **Class** and **OrderRepository** as **Interface Contract**.

Select **Order** and open **Edit Attributes and Technology**. Use **Add Attribute** to add `orderId: string` and `totalCents: integer` as in L5, with **No Key**, **Required Field**, and **Non-null Value**.

In the same form, click **Add Method**. Enter `confirm` in **Member Name** and `string` in **Type or Method Signature**. Keep **Required Field** and choose **Non-null Value**. **Key Kind** is disabled for methods. Click **Save Changes**. The card shows `confirm(): string`.

Repeat for the `submit` method of “CheckoutService” and the `save` method of “OrderRepository,” each with a descriptive `string` result. The names distinguish submitting a request to the service from persisting data through the contract. These signatures describe selected operations. L11 defines a fuller contract with typed inputs and results.

Create two **Dependency** relationships with blank conditions. Name the relationship from “CheckoutService” to “Order” “validates and confirms” and the relationship from “CheckoutService” to “OrderRepository” “uses contract.” The members describe the types for an implementation to follow.

#### Reuse contracts in the UML component diagram

Connect “OrderRepository” to the component that provides it. Review “Checkout Contract,” which “Checkout” already exposes. Reuse interfaces, components, and relationships so they refer to the same objects in the class, C4, and UML component diagrams. You will be able to see a contract change wherever the contract appears.

With **Add Diagram**, create `13 Components and Interfaces`. Choose **UML Component** in **Diagram Type** and **Checkout** in **Choose Feature**. On the canvas, use **Add Existing Element** to add “Checkout,” “Checkout Contract,” “Outcome Log,” and “OrderRepository.” Check the types in the picker, especially **Component** for “Checkout” and **Interface Contract** for “OrderRepository.”

Add the existing relationships after including their endpoints. Open **Diagram > Contents > Add Existing Relationship** and choose **Checkout → Checkout Contract: exposes contract**. Repeat for **Checkout → Outcome Log: records outcome**. Then create a new **Implementation** relationship from “Outcome Log” to “OrderRepository,” name it “provides persistence,” and leave the condition blank. The view should show three links. Reusing a relationship preserves its identity and details. Use **Connect** to create a new one.

![Contents has separate commands for reusing elements and relationships](images/32-reuse-relationship.png)

#### Show logical layers in a package diagram

Group the responsibilities into domain, application, and adapter packages to discuss dependencies before organizing source files. The domain contains the rules you want to preserve. The application coordinates the user goals, and the adapters connect external details. Use separate **Package** elements to model these logical groups before creating the source layout.

With **Add Diagram**, create `14 Application Modules`. Choose **Package** in **Diagram Type** and **Checkout** in **Choose Feature**. Create three **Package** elements named “Domain,” “Application,” and “Adapter.” Create three **Dependency** relationships with blank conditions. Connect “Application” to “Domain” with “uses rules,” “Adapter” to “Domain” with “implements contracts,” and “Adapter” to “Application” with “connects external systems.” During implementation, compare the direction of dependencies in the code with the model.

**L6 check.** Save. The class and UML component diagrams share the “OrderRepository” interface, so edits to it should appear in both. In the package diagram, dependencies point towards the domain. The classes, components, and packages keep separate identities because they represent different parts of the design.

### L7. Model checkout flow, sequence, and states

With responsibilities and data in place, describe what happens during checkout. Use the activity diagram for steps and alternatives, the sequence diagram to assign calls to participants, and the state diagram to describe the order after each outcome. You can create these views in any order. In this lesson, read them in that order to compare what each one shows.

#### Describe actions and alternatives in an activity diagram

Reuse the flow that Specsplice created with the checkout feature. Validate the cart before requesting payment. Model unavailable stock and declined payment separately so you can see the two reasons an order may be rejected.

Open **Checkout · Flow** in the diagram picker. Open **Diagram** and click **Rename** next to the title. Enter `08 Checkout Flow`.

For each item, click **Add Element**, enter the name, choose **Element Type**, and click **Create**.

| Type | Names to create |
| --- | --- |
| Start | Start |
| Action | Validate Cart, Request Payment, Confirm Order, Decline Order |
| Decision | Inventory Available? |
| End | End |

Connect the nodes with **Control Flow** to describe steps and alternatives. In **Create Relationship**, use **Relationship Name** to name the step and **Condition (Optional)** to say when it applies. Click **Save Changes** after each relationship.

| Source | Destination | Relationship Name | Condition |
| --- | --- | --- | --- |
| Start | Validate Cart | starts | Blank |
| Validate Cart | Inventory Available? | checks | Blank |
| Inventory Available? | Request Payment | continue | available |
| Inventory Available? | Decline Order | declines | unavailable |
| Request Payment | Confirm Order | confirms | payment authorized |
| Request Payment | Decline Order | declines | payment declined |
| Confirm Order | End | ends | Blank |
| Decline Order | End | ends | Blank |

Click **Fit Diagram** and follow both outcomes. The conditions describe the intended behavior. This exercise uses a model of payment approval and refusal.

#### Select participants and messages for a sequence

After defining the possible paths, assign calls to the responsibilities from L2. Reuse “Customer” as an **Actor**, “Checkout” as a **Component**, “External Payments” as a **Software System**, and “Order” as a **Resource**. These are the objects that request, coordinate, authorize, and receive the order record. Entities and classes with the same names belong to other views of the design. Add messages separately to set their order while preserving shared relationships.

With **Add Diagram**, create `07 Checkout Sequence`. Choose **Sequence Diagram** in **Diagram Type** and **Checkout** in **Choose Feature**. On the canvas, use **Add Existing Element** to add “Customer” (**Actor**), “Checkout” (**Component**), “External Payments” (**Software System**), and “Order” (**Resource**) in that order.

The picker may also list the **Entity** elements “Customer” and “Order” from L5. Check the type of each row before confirming. The sequence may initially show **No messages**. Add participants first, then select the messages to show.

1. Select **Customer** and click **Connect**. If **Relationship Type** appears, choose **Invocation**. Click **Checkout** among the highlighted destinations. Enter `confirms purchase`, leave **Condition (Optional)** blank, and click **Save Changes**. This is the first message.
2. Open **Diagram > Contents > Add Existing Message**. Choose the **Invocation** named **Checkout → External Payments: authorizes payment** to reuse the existing relationship.
3. Use **Add Existing Message** again and choose the **Write** named **Checkout → Order: records order**. The message keeps the condition “payment authorized.”

You should see three messages in this order. First, “Customer” calls “Checkout.” Next, “Checkout” calls “External Payments.” Finally, “Checkout” writes to “Order.” Authorization must precede the conditional order write. The participants keep their shared identities. To change the order of calls, edit the sequence. Moving the cards changes their layout.

#### Choose the resource for a state diagram

Describe what state the order is in after the payment attempt. Use the shared “Order” resource from the structure and sequence diagrams. Its states will be “Pending,” “Confirmed,” and “Declined.”

Open **Add Diagram** and enter `09 Order States` in **Name**. Select **State Diagram** in **Diagram Type**, **Checkout** in **Choose Feature**, and **Order** in **Resource Whose State Is Represented**. Click **Create**.

The canvas includes “Order” and the **Add State** button. Use it to create **Pending**, **Confirmed**, and **Declined**. Keep “Order” as the resource for each state and click **Create**.

Select **Pending** and click **Connect**. The view uses **Transition** and highlights the available destination states. Click **Confirmed**, enter `Payment Authorized` in **Relationship Name** and `positive outcome` in **Condition (Optional)**, then click **Save Changes**. Repeat from “Pending” to “Declined,” using the name `Payment Declined` and condition `negative outcome`.

**L7 check.** Save. The activity diagram has seven nodes and eight **Control Flow** relationships. The sequence has four participants and three messages in the stated order. The state diagram has one resource, three states, and two transitions. These views describe the behavior. The modules in L13–L14 cover executable interactions and lifecycles.

### L8. Build the returns views and check reuse

A return reads a recorded order and creates a separate request. Reuse “Customer” and “Order” in the returns feature, then add the responsibilities that coordinate the return. This lets you check that checkout and returns refer to the same data and that approval and refund remain identifiable steps.

#### Reuse the feature’s structure diagram

Use the structure diagram that Specsplice created with the feature to show the new and shared responsibilities. Open **Returns and Refunds · Structure** and use **Diagram > Rename** next to the title to name it `Returns - Shared Responsibilities`. Use **Add Existing Element** to add “Customer” as an **Actor** and “Order” as a **Resource**. For each row below, click **Add Element**, fill in **Name**, choose **Element Type**, and click **Create**.

| Name | Element Type |
| --- | --- |
| Returns Page | Interface |
| Return Coordination | Controller |
| Return Request | Resource |

The **Interface** represents a page of the store, and **Interface Contract** is the contract type you used in L6. The C4 **Component** named “Returns Handling” represents the application responsibility. The **Controller** named “Return Coordination” shows how that responsibility coordinates a return in more detail.

Open **Structural Blueprint > Structure > Architectural or Lifecycle Owner**. Choose **Return Coordination** in **Configuration**, select **Marketplace API** in **Architectural Owner**, and click **Apply to Model**. In this lab, the controller and “Returns Handling” belong to the same container.

Connect the request, controller, and resources to show which data is read and which data is recorded. Leave the conditions blank in this structure. The next flow describes how timing affects the result. Create the four relationships below.

| Source | Type | Destination | Name |
| --- | --- | --- | --- |
| Customer | Invocation | Returns Page | requests return |
| Returns Page | Invocation | Return Coordination | sends request |
| Return Coordination | Read | Order | checks purchase |
| Return Coordination | Write | Return Request | records return |

“Return Coordination” reads the order and records the return request. “Order” remains shared with “Checkout.”

#### Complete the refund flow

The structure shows who handles returns and what data they use. The flow shows when to refund or decline the request. Open **Returns and Refunds · Flow** and use **Diagram > Rename** to name it `Returns - Eligibility and Refunds`. Create **Evaluate Return**, **Issue Refund**, and **Decline Request**, with **Action** in **Element Type**. Connect “Evaluate Return” to “Issue Refund” with **Control Flow**, the name `authorizes`, and the condition `within 30 days`. Connect “Evaluate Return” to “Decline Request” with **Control Flow**, the name `declines`, and the condition `return window expired`.

#### Check change impact and shared identity

“Order” appears in both features. Return to the returns structure, select **Order**, and click **Show Change Impact** under **Explore** in the properties. Review the affected references and views, then click **Back** in the project navigation. Select “Order” again if the properties are closed. Click **Rename** next to the properties heading, enter `Customer Order`, and click **Save Changes**. Open the checkout overview and check that the same resource has the new name. Click **Undo** on the canvas to restore the original name, then click **Save** if changes are pending.

**L8 check.** The name “Order” is restored in both views. Both features still refer to the same order resource. The return request is a new resource, and the controller details the “Returns Handling” responsibility. The flow has two alternatives with explicit conditions.

### L9. Design deployment and network connections

The application architecture gives you the components needed to plan where software and data will run and how they will communicate. Reuse those components in both views. The Deployment view records placement, while the Network view records boundaries and protocols. Architectural ownership stays with the components in the model.

#### Place components on deployment hosts

Use **Add Diagram** to create `10 Proposed Local Deployment`. Select **Deployment** in **Diagram Type** and **Checkout** in **Choose Feature**.

Use **Add Element** to create **Web Host**, **API Host**, and **Data Host** as **Deployment Node** elements, then create **Web bundle** and **API ESM** as **Artifact** elements. ESM is the JavaScript module format used in the example. From the canvas, choose **Add Existing Element** and include **Marketplace API** and **Marketplace Store**. Deployment and C4 now reference the same containers.

Create four **Hosts** relationships to declare where each component or artifact belongs. Leave the condition blank for each relationship.

| Host | Hosted element | Name |
| --- | --- | --- |
| Web Host | Web bundle | hosts |
| API Host | API ESM | hosts |
| API Host | Marketplace API | hosts |
| Data Host | Marketplace Store | hosts |

Select each host and choose **Edit Attributes and Technology** in **Properties**. Enter `Processo locale progettato` in **Technology** and `Didattico locale` in **Environment**, then select **Save Changes**. These fields describe the planned local setting in the example.

#### Declare network connections

Use the Network view to describe how the client, API, and data store communicate. Use **Add Diagram** to create `16 Proposed Connections`. Select **Network / Infrastructure** in **Diagram Type** and **Checkout** in **Choose Feature**. Use **Add Element** to create **Client Network** and **Backend Network** as **Network Node** elements. Use **Add Existing Element** to include **Web shop**, **Marketplace API**, and **Marketplace Store**.

Create the three **Communication** relationships in the table and leave their conditions blank. For each relationship, open **Edit Cardinalities and Protocol**, fill in **Protocol / Transport**, and select **Save Changes**. Leave multiplicities and members blank. The protocols distinguish web access, API calls, and persistence.

| Source | Target | Name | Protocol / Transport |
| --- | --- | --- | --- |
| Client Network | Web shop | web access | HTTPS 443 |
| Client Network | Backend Network | application boundary | HTTPS 443 |
| Backend Network | Marketplace API | API | HTTPS / JSON |

Reuse the fourth connection through **Diagram > Contents > Add Existing Relationship** and select **Marketplace API → Marketplace Store: reads and writes**. The existing relationship brings its SQL protocol with it. Check that the Network view contains four relationships. Both views now share one definition of how the API communicates with the data store.

Check the grouping in the Deployment view. If you need more space, try **Diagram > Arrange > Balanced** and **Fit Diagram**. If groups still overlap, drag **API ESM** next to **Marketplace API** and move them away from **Marketplace Store** and **Web bundle**. Each **Hosts** relationship determines which items belong to its group.

Save and select **Fit Diagram**. Deployment shows where the parts are intended to run, and Network shows how they are intended to connect. Treat both diagrams as design records. Running processes, opening ports, and testing connectivity require a deployment environment.

### L10. Trace the data and check all diagram types

Follow the purchase data through the model. **Customer** submits a request, the catalog supplies prices and availability, and the process records the order and returns the outcome. Use the Data Flow view to review inputs and outputs before you formalize the contract in L11.

Use **Add Diagram** to create `15 Checkout Data`. Select **Data Flow** in **Diagram Type** and **Checkout** in **Choose Feature**.

Use **Add Existing Element** to include **Customer**, which has the **Actor** type. Use **Add Element** to create **Process Order** as a **Process** and **Order Data** and **Catalog Data** as **Data Store** elements. The process represents data handling, and the stores represent data retention.

Name each connection after the data it transfers. This lets you check that **Process Order** receives the data it needs, stores the order data, and returns an outcome to **Customer**. Create four **Data Flow** relationships with **Condition** left blank.

| Source | Target | Data transferred |
| --- | --- | --- |
| Customer | Process Order | checkout data |
| Catalog Data | Process Order | prices and availability |
| Process Order | Order Data | confirmed order |
| Process Order | Customer | checkout outcome |

Choose **Diagram > Arrange > Balanced**, select **Fit Diagram**, and save. The labels on the arrows show what passes between elements.

The two automatically created views for **Product Catalog** are still empty. To match the 18 views in the reference project, open each empty view and select **Diagram > Manage Diagram > Delete Diagram**. Check the name in the confirmation and select **Delete**. Use **Undo** to recover a view you just deleted.

To return the overview to the six responsibilities from L2, select these eight detail cards one at a time: **Marketplace**, **External Carrier**, **Support**, **Marketplace API**, **Marketplace Store**, **Event Broker**, **Outcome Log**, and **Inventory**. For each card, select **Remove from This Diagram** in **Properties**. The pane closes, and the element remains available in its other views. Arrange the remaining cards and select **Fit Diagram**.

Save and reopen the project root to check that your work persists. Use the table to find any missing perspective before adding contracts. The numbers identify the views. You may create them in the order the lessons require.

| Diagram type | View in the reference project | Lesson |
| --- | --- | --- |
| Structure | 01 Responsibilities Overview | L2 |
| C4 System Context | 02 C4 Marketplace Context | L3 |
| C4 Container | 03 C4 Applications and Data | L4 |
| C4 Component | 04 C4 API Components | L4 |
| ERD | 05 Entities and Cardinality | L5 |
| Database Schema | 06 Proposed Data Schema | L5 |
| Sequence | 07 Checkout Sequence | L7 |
| Activity / Flowchart | 08 Checkout Flow | L7 |
| State Machine | 09 Order States | L7 |
| Deployment | 10 Proposed Local Deployment | L9 |
| Class | 11 Classes and Repositories | L6 |
| Use Case | 12 Use Cases | L3 |
| UML Component | 13 Components and Interfaces | L6 |
| Package | 14 Application Modules | L6 |
| Data Flow | 15 Checkout Data | L10 |
| Network / Infrastructure | 16 Proposed Connections | L9 |

The 16 views above and the two **Returns** views give you **18 views in 16 diagram types**. Open each view from the selector and inspect its elements and at least one relevant relationship. If you kept the two empty **Product Catalog** views, they also appear.

**Consistency check for L10.** Check that **Customer** and **Order** are reused in compatible views and that entities, tables, and classes remain distinct. Each relationship should connect the intended elements, each condition should specify a clear outcome, and ownership should follow the boundaries of the model. Check the details in the text view. Arrange the cards so the diagram is easy to read.

### L11. Define types, a contract, and an architecture decision

Use the checkout views to identify the callers and provider, then specify the agreement between them. The signature defines the exchanged types, results, and errors. The provider and field mapping connect the agreement to the architecture and persistence. Record the decision to use cents so later implementations can follow it.

#### Create the shared types in dependency order

Open **Structural Blueprint > Data and Operations > Shared Types**. For each row, select **New Shared Type**, fill in **Type Name** and **Type Kind**, and complete the remaining fields. Work in the listed order. Valid draft definitions become available as you create the next type. When all seven types are ready, select **Apply to Model**.

| Type Name | Type Kind | Additional fields |
| --- | --- | --- |
| Text | Primitive | Enter `string` in **Primitive Defined by the Profile** |
| Integer | Primitive | Enter `integer` in **Primitive Defined by the Profile** |
| Order Line | Record | Add `productId` and `quantity` as shown in the next table |
| Order Lines | Collection | Choose **Order Line** in **Item Type** |
| Order Data | Record | Add `orderId` and `rows` as shown in the next table |
| Checkout Outcome | Enumeration | Enter `confirmed` in the first row of **Enumeration Values**. Select **Add Value** and enter `declined` in the second row |
| Input Error | Record | Leave **Fields** blank. The operation declares the error code |

On each record card, select **Add Field** for each field in the table. Fill in **Name** and **Type**, keep **Required** selected, and set **Nullability** to **Non-null Value**. **Required** controls whether the field must be present. **Nullability** controls the values it can hold.

| Record | Field name | Type |
| --- | --- | --- |
| Order Line | productId | Text |
| Order Line | quantity | Integer |
| Order Data | orderId | Text |
| Order Data | rows | Order Lines |

Complete **Order Line** before you create the **Order Lines** collection, then add `rows`. A required collection field can still contain an empty collection. Add the requirement for at least one row as a contract precondition.

#### Add the checkout operation

Use the shared types in the **submitCheckout** signature. **Checkout Contract** owns the operation and **Checkout** provides the contract. The input specifies what the caller sends, the result specifies what the caller receives, and the error identifies invalid input.

1. Open **Data and Operations > Shared Operations** and select **New Shared Operation**.
2. On the **Signature** tab, enter `submitCheckout` in **Operation Name** and select **Checkout Contract** in **Operation Owner**.
3. Select **Add Input**. Enter `order` for the name and choose **Order Data** for the type. Keep **Required** and **Non-null Value**.
4. Select **Add Result**. Enter `outcome` for the name and choose **Checkout Outcome** for the type. Keep **Required** and **Non-null Value**.
5. Select **Add Error**. Enter `INPUT_INVALID` in **Error Code** and `Missing or invalid order` in **Description**, then choose **Input Error** in **Declared Type**.

![The Signature tab showing submitCheckout, the owning contract, and the input and result](images/06-operation.png)

Complete the rules in the same configuration. The precondition requires a populated order. The stock criterion gives you a requirement to verify when you implement the operation. Use the following values to match the reference project.

| Path from the operation | Value |
| --- | --- |
| Behavior Rules > Add Precondition | The order contains at least one line |
| Behavior Rules > Add Postcondition | The outcome is recorded |
| Access and Acceptance > Add Criterion | **Given** Inventory is available. **When** The customer confirms. **Then** The inventory is reserved once |

Check the signature, rules, and criterion in **Review**, then select **Apply to Model**. L12 uses a predicate to formalize an executable rule.

#### Expose the contract and set its provider

Add the operation to the interface offered to callers. Open **Data and Operations > Interfaces and Invariants** and select **Add Contract Definition**. Choose **Checkout Contract** in **Contract or Interface Element**, enter `1` in **Contract Version**, and select **submitCheckout** in **Declared Operations**. Leave **Descriptive Invariants** blank and select **Apply to Model**. If the operation is missing, check that **Checkout Contract** owns it.

Open **Connections > Provided or Required Interface** and select **Add Interface to Element**. Choose **Checkout** in **Element**, **Checkout Contract** in **Declared Contract or Interface**, and **Provided** in **Direction**. Select **Apply to Model**. This assignment lets validation identify the provider alongside the **Implementation** relationship.

Use the **Connections** group to configure required interfaces, consumer–provider connections, and transports when your design needs them. Resolve a diagnostic by declaring the actual connection or contract. A production payment service requires its own contracts and policies.

#### Map the order field and connect the catalog

Map the shared `orderId` field to its storage column. Open **Technology > Domain Field Mapping** and select **Add Field Mapping**. Choose **Order Data · orderId** in **Domain Field** and **orders · id** in **Physical Column or Class Attribute**, then select **Apply to Model**.

Open **Structure > Feature Memberships** and choose **Inventory** in **Configuration**. Select **Product Catalog**, keep **Checkout** selected, and select **Apply to Model**. Stock is now visible in both features, and **Marketplace API** is its architectural owner.

#### Record the architecture decision

An architecture decision record (ADR) captures a choice and its rationale. Explain why the design uses cents so that someone changing the types or implementation can assess the consequences. Recording the decision after the contract lets you connect its rationale to the responsibilities and types you already identified.

Open **Decisions > Project Architecture Decisions** and select **New Architecture Decision**. Fill in these fields on the **Record** tab.

| Field | Lab value |
| --- | --- |
| Decision Number | ADR-001 |
| Decision Title | Amounts in Cents |
| Context | Prices and totals must be comparable without implicit rounding |
| Decision | Use integer amounts in cents for prices and totals |
| Decision Status | Proposed |
| Consequences | Select **Add Consequence** and enter “Display currency only in the user interface”. Select it again and enter “Validate amounts in the domain” |
| Applicable Scope | Select only **Checkout** and **Outcome Log** to link the decision to confirmation and to recording the outcome |

Select **Apply to Model**. To read the decision again, choose **ADR-001 · Amounts in Cents** in **Configuration**. **Record** shows its rationale, status, and scope. **Constraints** contains structured constraints. Keep the status **Proposed** for the lab.

Save and reopen Marketplace, then check that all shared definitions are available. Resolve any **Draft Needs Correction** message or missing type before continuing. If a draft blocks the canvas, use **Search System** to select the element and correct its ownership in **Structural Blueprint**.

**L11 checkpoint.** Locate the seven types, operation input, result, and error, version 1 of the contract, **Checkout** as the provider, the field mapping, and **ADR-001**. The final reference project contains these records. Generation diagnostics may still request adapters, implementations, or design decisions before this descriptive model can back an executable application.

### L12. Implement and verify the quantity limit

The final rule accepts integer quantities from 1 through 10. First, verify the template that accepts positive integers and try applying and undoing its generated changes. Then add the upper bound and check the boundary values in a second review.

#### Start from the quantity template

Use a standalone module to verify one rule independently of the rest of Marketplace. Open the supplied `07-marketplace-workshop/modules/quantity` folder to start immediately, or create an empty project and run **Specsplice: Add Pure Quantity Feature** from the command palette to reproduce the setup. The command creates the feature, types, `validateQuantity` operation, predicate, and initial cases. Save the model. The **Domain** node shows the context of the rule.

The template requires **quantity greater than zero** and uses a safe integer type. With this rule, `two` produces a type error, while 0 is a valid integer that fails the condition.

#### Edit the predicate in the form

From the **Order Quantity** project menu, choose **Project Settings > Executable Behavior > Edit Pure Predicate**. Select **validateQuantity**, the existing precondition, and **Precondition · Inputs Only**. Select **Next** after each choice. **Precondition · Inputs Only** uses the inputs. **Postcondition · Inputs and Outputs** can also use the results.

Use **Add Value** for references and literals, **Combine Values** for compatible operators, and **Choose Result and Save** to set the result. The predicate answers whether the quantity is allowed, so the builder only offers boolean expressions as final results.

To try the builder, add a **Quantity** literal and enter `2` directly. For text, type the words. For booleans and enumerations, choose an option. Numeric operators include addition, subtraction, multiplication, division, and remainder within the supported subset of safe integers. You can test field presence and null values separately, combine conditions, and use `count`, `any`, and `every` on supported collections.

Select **Cancel** to discard the test literal. When you edit the limit, compose a condition and choose the result to use. **Clear Detached Expression** clears the working copy. The saved predicate stays in place until you apply the edit.

#### Write two independent cases

Set expected results from the business rule before running verification. A bug shared by the rule and the implementation could pass the derived cases. An input of zero and a text input test different paths through the rule and its type check.

In **Project Settings > Executable Behavior**, find **Cases and Simulation** and open **Independent Business Expectations > Add Predicate Test Case**. The quantity module has one predicate and one criterion, which appear in **Independent Case Name**. If the project has several predicates or criteria, choose the relevant ones. Enter the case name and select **OK**, choose how to supply the input, confirm the value with **OK**, and select the expected result. Create both cases in the table.

| Name | Input option | Value | Expected result |
| --- | --- | --- | --- |
| Zero Quantity | Value for quantity | 0 | Not Satisfied |
| Non-numeric Text | Different Value Type, then Text | two | Input Type Error |

![The independent case name field and its OK button](images/07-input.png)

Enter a unique, nonempty name. The integer input enforces its type. To test an invalid type deliberately, choose **Different Value Type**. **Absent** and **Null** let you model those negative cases. Standard forms limit choices to values allowed by the contract.

Select an existing case to open **Edit Inputs**, **Edit Expected Result**, or **Delete Case**. Editing an input preserves its expected result until you change the expectation yourself. Deletion requires confirmation. Choose **Keep Case** to retain the case. Canceling or confirming an unchanged form keeps the current revision. Edit the input and the expectation separately so the test retains the result you chose to check.

Available results include **Satisfied**, **Not Satisfied**, **Indeterminate**, **Input Type Error**, **Division by Zero**, and **Nonintegral Result or Integer Overflow**. Choose the result based on the business rule and the expression type. Define it independently of the result the program returns.

#### Prepare, verify, apply, and undo

Review the proposed behavior and files before writing them to the project. Verification checks the behavior against the declared expectations. Applying the proposal writes the approved files, and undoing it lets you restore the previous files while keeping the model.

1. Save the model and open **Code > Review and Verification > Prepare Model to Code Review**.
2. Review the planned behavior and files. Specsplice prepares a local proposal. The template profile uses deterministic generation and makes zero AI calls.
3. Select **Run Real Verification**. Confirm local execution if Specsplice prompts you.
4. Check the current status. With the eight initial cases and the two you added, the verified exercise shows **10 Derived Cases** and **10 Independent Cases**.
5. With the current review verified, read the list of files and select **Apply to Project**. Wait for **Applied Locally**.
6. Inspect the files through **Files** or in the terminal. If needed, reopen the review through **Code > Review Changes**. Select **Undo Local Changes** and check for **Local Changes Undone**. Confirm application or undo if Specsplice opens a dialog.

In **Restricted Mode**, Specsplice may ask you to trust the folder before preparing the review. Verify that the path points to your copy of the lab module, then select **Trust Folder & Continue**.

![The review shows the proposal, successful verification, and local application](images/08-verification.png)

The initial template proposal creates a module, its test, `package.json`, and `.gitignore`. Specsplice assigns the module name. Keep the generated name and contents for this exercise. Verification covers the formal rule and the expectations supplied to the runner. Testing a complete storefront requires an end-to-end test.

If you change the model, criteria, or relevant sources after review, prepare a new one through **Code > Review Changes > Prepare New Review**. Application requires a passing verification for the current revision. Specsplice blocks undo if it would overwrite later manual edits. Compare the files and preserve your work before trying again.

#### Add an inclusive upper bound of ten

Use a copy of the quantity module so you can compare it with the original. Update the rule to accept integers from 1 through 10. Test both boundaries and the values just outside the range. Expected results are **Not Satisfied** for 0 and 11, and **Satisfied** for 1 and 10.

1. Open **Edit Pure Predicate**. Select **validateQuantity**, the existing precondition, and **Precondition · Inputs Only**. The limit applies to the input before the operation runs.
2. In **Add Value > Add Typed Literal > Quantity**, enter `10`, the inclusive maximum for Marketplace.
3. In **Combine Values > Add Comparison**, choose `quantity`, then the literal `10` and **≤**. This includes 10.
4. In **Combine Values > Add Boolean Logic > All True**, select `quantity > 0` first, then the condition for quantity less than or equal to 10. **All True** requires both conditions. The upper bound on its own would still allow zero and negative values.
5. In **Choose Result and Save**, select the result that begins with **and(** and includes both conditions. Select **Next**, check **Review Your Changes**, and select **Apply Changes**. Choose **Save** in the Specsplice toolbar to save the model.
6. Add the independent case **Limit 10** with input 10 and expected result **Satisfied**. Add **Over Limit 11** with input 11 and expected result **Not Satisfied**.
7. Open **Structural Blueprint > Data and Operations > Shared Operations**. Choose **validateQuantity** in **Configuration**, then open **Access and Acceptance**. Change **Then** in the existing criterion to “Only values from 1 to 10 satisfy the precondition”. Keep **Given** and **When**. Select **Apply to Model** and **Save**. The edit preserves the criterion and its associated cases. Go back to **Independent Business Expectations** and use **Edit Expected Result** to set the expected result for input **9007199254740991** to **Not Satisfied**. The other initial expectations still apply.
8. Prepare a new review and rerun verification. After completing all of L12, this version gives you **12 independent cases** and **12 derived cases**. If **Code** shows **Review Changes**, open it and choose **Prepare New Review**. Read the combined rule and the results, then apply the proposal if you want to keep it. The new business rule explains why the maximum-safe-integer case now has a different expected result.

To compare your result, use **Open Project** to open `07-marketplace-workshop/modules/quantity/limit-solution` from the archive. It contains the completed predicate and all **12 independent cases**. These include the eight initial cases and **Zero Quantity**, **Non-numeric Text**, **Limit 10**, and **Over Limit 11**.

Move a card to confirm that a layout change leaves the predicate intact. The code and verification need to be regenerated when the behavior changes. To complete the exercise, explain why 11 fails and identify the files that the proposal applies.

**L12 checkpoint.** Record the chosen limit and the cases for 0, 1, 10, 11, and the incorrect input type. Confirm that the maximum safe integer now has **Not Satisfied** as its expected result. You should have used the visual builder, reviewed and verified a proposal, applied it locally, and tried undo on the template.

### L13. Define the checkout calls

The Marketplace sequence diagram describes the order of calls. This module adds arguments, replies, and errors so you can verify how **Checkout**, **Payments**, and **Orders** work together with simulated replies.

Open `07-marketplace-workshop/modules/interactions` and choose **Checkout and Payment**. Scroll vertically to follow the complete flow. The main interaction calls **Payments**, evaluates an alternative, can call the persistence sub-interaction, and handles an optional notification.

![The executable sequence showing calls, guards, and frames](images/12-interactions.png)

On the canvas, choose **Diagram > Contents > Edit Executable Interaction** to open **Interaction · checkout**. Explore the hierarchy of messages, frames, and branches to see what determines the payment branch and when persistence occurs. For each call, declare the sender, the recipient that owns the operation, the arguments, whether the call is synchronous or asynchronous, the reply, the deadline for receiving the reply, and the correlation used to match requests with replies. Include the relevant results and errors.

| Construct | Use |
| --- | --- |
| alt | Choose one branch based on guards. The `else` branch handles the remaining outcomes |
| opt | Run the body when its condition holds |
| loop | Repeat with a guard, counter, and explicit maximum |
| par | Start concurrent local branches and wait for the specified join |
| critical | Protect a local resource using a consistent lock order |
| ref | Call a sub-interaction with an explicit contract and revision |

When an argument needs the result of an earlier call, refer to that particular occurrence. A reply is available within its valid branch and call scope. Repeated calls produce results with distinct identities. The engine rejects cycles between sub-interactions and incompatible lock orders.

To extend coverage, declare collaborator replies and the expected call order before verification. This lets the checks catch a missing or premature call. The supplied project covers approved payments, alternatives, notification, and errors. Open **Independent Business Expectations** to add an interaction case. Choose the criterion and enter the inputs, simulated replies, delays, expected completion or failure, output, and call order. Verification uses the supplied reply data.

**Exercise.** Prepare a review through **Code > Prepare Model to Code Review**. If prompted for trust, check that the path points to your copy of `interactions` and select **Trust Folder & Continue**. Choose **Run Real Verification** and confirm that **seven derived cases and seven independent cases** pass. Scroll to **Optional · Guard: notify** on the canvas to read the guard and the call from **Checkout** to **Notifications**. To inspect the fields, open **Edit Executable Interaction**, select **opt**, choose **Next**, then **Open Child Steps** and **Next**. The **notify** entry is the message in the optional branch. Select **Cancel** to leave the module as supplied. To write your own case, use **Independent Business Expectations > Author Independent Interaction Case** and supply inputs, simulated replies, and the expected order.

**Apply this to Marketplace.** In this exercise, **Payments** stands for **External Payments**, **Orders** records the **Order**, and **Notifications** sends a notification. Explore the supplied identities and expectations first, then carry the contracts your design needs into your specification. The Marketplace reference diagram describes the workflow, and this module supplies an executable contract for checking it.

**L13 checkpoint.** Identify a call, its simulated reply, an alternative branch, and an independent criterion. A passing test verifies the declared behavior with the simulated replies. A real payment needs its own integration test.

### L14. Simulate the order lifecycle

Use events and states to check which moves are allowed, whether a failure leaves the order in its previous state, and how duplicate deliveries are handled. The simulation records those decisions in its trace.

#### State machines

Open `07-marketplace-workshop/modules/states`. **Checkout Lifecycle** has three states, **Draft**, **Paid**, and **Cancelled**. The module extends the descriptive Marketplace state view with an executable contract that declares initialization, events, entry, exit, and do actions, guards, priorities, and ordered effects.

Start with a successful payment so you have a trace to compare with a failure and a repeated delivery. From the **Order Shop - States** project menu in the top bar, choose **Project Settings > Executable Behavior > Simulate State Machine**. Select **checkout.paid**. **State Simulation.txt** opens in the editor. The report shows **Paid**, an accepted event, and the transition from **Draft** to **Paid**. The trace shows guard evaluation, cancellation of the do activity, exit, effect, entry, and commit.

![The state simulation report showing the execution phases and final state](images/10-states.png)

To check other outcomes, select **Checkout Lifecycle** in the editor tab bar. **Project Settings** reopens with **Executable Behavior** expanded. Choose **Simulate State Machine** again and try `checkout.failed-charge`. Check that the machine stays in **Draft** and reports the `denied` error. Try `checkout.dedup-reopen` next. It should report **Paid** and three event outcomes, `accepted`, `duplicate`, and `rejected` with `deliveryConflict`. After reading the report, select **Checkout Lifecycle** and choose **Back to Diagram** to return to the canvas.

Read the traces before editing the machine. In **Project Settings > Executable Behavior**, choose **Edit Executable State Machine** and select **Checkout 1** to open the definition. Declare the architectural and lifecycle owners, one initial state, any final states, events with typed payloads, internal or external transitions, guards, priorities, and actions. These declarations identify which order each action applies to and when it can change state. Actions call specific revisions of interactions. Internal and external self-transitions follow different entry and exit paths.

Write the expected trace before you simulate a variation. In independent cases, declare the initial input, events, action replies, event outcomes such as accepted, rejected, duplicate, or failed, and the expected transition, error, and final state. Include quiescence and checkpoint expectations when relevant. The profile supports flat state machines. Composite states and orthogonal regions are outside its scope. The simulation runs the supplied scenario locally.

**Apply this to Marketplace.** Compare **Draft**, **Paid**, and **Cancelled** with **Pending**, **Confirmed**, and **Declined**. Cancellation and payment rejection may require different transitions. Decide which lifecycle and events your application needs before using the module in a real system.

### L15. Simulate message publication and delivery

After defining order transitions, explore how events reach other participants. A queue assigns work to a consumer. A topic delivers the same event to multiple subscriptions. The local simulation shows deliveries, retries, and duplicates before you choose a messaging infrastructure.

Open `07-marketplace-workshop/modules/messaging` and choose **Order Shop - Messaging > Project Settings > Executable Behavior**. Open **Edit Messaging Topology**, select **checkout.messaging**, and choose **Next** to inspect the contracts, channels, producers, consumers, and policies. The topology has a queue producer and a topic producer. Its subscriptions include `workers`, `billing`, and `analytics`. Select **Cancel** to leave the topology as supplied.

Use a **queue** to assign a job to one of several competing consumers, as in the `workers` exercise. Use a **topic** to fan out the same event to different subscriptions, such as `billing` and `analytics`. Message contracts have a name and version, a record payload, and fields for identity, routing, and correlation. An acknowledgement confirms processing. Backoff sets the wait between attempts. The dead-letter queue collects messages the policy can no longer deliver. Declare the wait, attempt limit, capacity, deduplication, and idempotency so that error handling can be verified.

Start with a publication and a successful delivery. The two observations give you a reference for testing retries and other policies later.

#### Run the local simulation without a broker

1. In **Project Settings > Executable Behavior**, open **Simulate Messaging**. The module opens the `checkout.messaging` topology. If several topologies are available, choose the one to simulate. Select **Next** after each choice or value.
2. Choose **Publish Message**, keep the logical time at `0`, and choose the **publish.queue** producer to assign work to a worker.
3. Enter `guide-order-1` for the message identity, `42` for `orderId`, and `checkout-42` for `correlationId`. The identity identifies the message, the order ID identifies the domain object, and the correlation ID links it to the checkout.
4. Choose **Deliver to Worker** with time `0`, subscription **workers**, worker `A`, and **Handler Succeeds**. This tests a successful delivery on the first attempt.
5. Choose **Finish Scenario**, select **Next**, and check **Review Simulation Scenario**. Select **Run Simulation** to run the local scenario.

Under **Simulation Result · Zero AI Calls · No Network**, check the **guide-order-1** row for **Publication Observation** and the **workers:A:guide-order-1:1:ok** row for **Worker Delivery Observation**. The summary shows zero rejections and zero dead letters. Select a row to close the result when finished.

![The simulated message result showing one publication and one delivery](images/11-messages.png)

After the successful case, change one outcome at a time and compare the observations. To test retry and backoff, select **Handler Fails** and use logical times that follow the policy. To check fan-out, choose **publish.topic** and different subscriptions. The supplied independent cases cover competing consumers, fan-out, deduplication, idempotency, exhausted retries, and incompatible contracts. Run them from the profile review.

The simulation runs locally, with zero network calls. Set up and manage a real NATS broker separately, and use an integration test to verify delivery on external infrastructure.

**Apply this to Marketplace.** Use the broker design from L4 as context and use this module to verify a local policy. Describe an `OrderConfirmed` event with an identity, `orderId`, and correlation information, then decide who publishes it and who consumes it. A live service requires its own implementation, configuration, credentials, and integration tests.

### L16. Run the JavaScript module and import it

Compare the model with a small executable JavaScript module. The tests and demo establish its initial behavior, and the import connects declarations to their source files. Use that evidence to distinguish what a function does from later proposals about the project's architecture.

**Open a copy of `07-marketplace-workshop/code`**. This separate example contains `src/orders.mjs`, a demo, and seven tests. It requires no dependency installation. The module uses prices in cents, positive integer quantities, and `confirmed` or `declined` outcomes.

Run the tests and demo on a clean copy to establish a baseline for the changes in L18. Use your system terminal, or open the copy of `code` in the IDE to use the integrated terminal. If **Restricted Mode** appears, inspect the folder contents and choose **Trust** for this copy only. From the project menu, choose **Project Settings > Developer Tools > Terminal**.

Run `pwd` on macOS or Linux, or `Get-Location` in PowerShell, to verify that the terminal is in `code`. If needed, use `cd` with the quoted path to your copy. The lab was verified with Node 24.22.1 and npm. If you use `nvm` and already have that version installed, select it with `nvm use 24.22.1`. Then run both commands.

```sh
npm test
npm start
```

All seven tests should pass, and the demo should print `{ status: 'confirmed', totalCents: 2500 }`. The demo uses two units at 1,250 cents each and an approved payment. The total of 2,500 and the `confirmed` outcome are your baseline for the exercise.

#### Import the code locally

Build the inventory to navigate from `validateQuantity` to its declaration. If you already imported the copy to open the integrated terminal, resume at step 3. Semantic resolution adds available JavaScript and TypeScript links. **Structure Only** gives you a structural inventory.

1. From the home screen, choose **Import Codebase** and select `07-marketplace-workshop/code`.
2. Choose **Structure and Available Semantic Analysis** to include available JavaScript and TypeScript resolution, or **Structure Only** for the structural inventory.
3. Wait for **Ready to explore**. Importing reads the source files without installing dependencies or running the application.
4. On **Explore Your Codebase**, click **Inspect Code Evidence** to browse the local inventory.
5. Select **validateQuantity**, marked **Extracted declaration** and linked to `src/orders.mjs`. The declaration is visible in this example. In a longer list, enter the name in the search field. Verify in the editor that the function accepts positive integers.
6. Click the **Create Diagrams: code** editor tab to return to the exploration view.

![The local inventory is ready before architectural exploration begins](images/13-import.png)

![The evidence view identifies declarations, static references, and definitions](images/14-evidence.png)

The inventory gives you evidence from the source files. In the current incremental exploration workflow, **Explore Architecture** starts the AI workflow in L17. You can inspect the evidence and continue manual modeling in a visual project without an AI account.

#### Check coverage, scope, and versions

Check language coverage and resolution before interpreting the results. An inventory entry may only have partial analysis. The importer provides 16 profiles for JavaScript, TypeScript, TSX, Python, Java, C#, C, C++, Go, Rust, PHP, Ruby, Swift, Dart, Kotlin, and Scala. Built-in semantic resolution covers JavaScript, TypeScript, and TSX. Matching SCIP bundles can add data from other supported indexers. Static references show source-level connections. Use runtime evidence to verify that a call occurred.

In the evidence list, click **Open Full Analysis Details** to open the read-only **Source Analysis.json** report. Inspect the inventory, revisions, diagnostics, and analysis producers. Check whether files were analyzed, partially analyzed, unsupported, or unclassified. Partial analysis can leave dependencies unresolved.

Before starting AI exploration, limit the inventory to the relevant sources and documents. From **Create Diagrams: code**, click **Open Quick Access**, search for `>Configure Import Scope`, and choose **Configure Import Scope**.

1. In **Include Source Paths**, enter `src/**, test/**, package.json, REQUIREMENTS.md` and press Enter.
2. In **Exclude Source Paths**, enter `.vscode/**` and press Enter. The `.gitignore` and `.orditoignore` rules still apply.
3. In **Source Inventory Preview**, review the included, excluded, and analyzed files. Click **Apply Source Inventory**. Specsplice saves a new analysis snapshot. Use its evidence in subsequent searches.

Model and index versions support recovery and comparison. Restoring a historical index changes the index only. If evidence is stale, refresh the analysis or open the current file without using the old source range.

**L16 checkpoint.** Verify that all seven tests pass in `code` and that the inventory contains the declarations. Open `validateQuantity` from the evidence list and confirm that the original module accepts positive integers. You can use this copy for the update exercise in L18. Open a separate copy of `ai-code` to explore both features in L17.


### L17. Generate checkout and returns diagrams

Start with a codebase that supports two recognizable capabilities and use the diagrams to examine their shared **Order** contract. Compare each proposal with the source before applying it. This exercise requires a configured AI account and an available model. You can also run the tests, inspect the local inventory, and continue to L20 without an AI account.

#### Connect a provider and start generation

1. Copy `07-marketplace-workshop/ai-code`. Open a terminal in the copy and run `npm test` with Node 24. All five tests should pass. They include cases where an approved purchase makes an order available for returns and where the thirtieth day is still within the return window.
2. From the home screen, choose **Import Codebase** and select your copy of `ai-code`. Choose **Structure and Available Semantic Analysis** and wait for **Ready to explore**. You can follow declarations back to their source files before generation, as in L16.
3. In the project menu, open **AI Settings**, then **Account and Model**. Click **Connect Claude Code or Codex** and follow the provider's sign-in steps. If the CLI is already authenticated, use **Choose Model and CLI**. After signing in, select **Refresh Account and Models** and set the model in **Choose Diagram Model**. If the model is absent from the catalog, choose **Enter Exact Model ID** and enter an ID your provider supports.
4. Reopen the import tab and click **Explore Architecture**. Review the folder, source scope, and model, then confirm with **Generate Diagrams** to start processing.

![AI settings for the connection, model, and budgets](images/09-ai-settings.png)

If you see **The Selected Diagram Model Is Not Available in Codex Chat** for a model that your authenticated Codex CLI can access, use **Refresh Account and Models**. If the chat catalog still omits it, reopen **Connect Claude Code or Codex > Codex > Choose Model and CLI** and enter the absolute path to the CLI in **Original CLI Executable**. Check the ID in **Choose Diagram Model** and resume from the import tab with **Continue Generation** or **Explore Architecture**.

Use **AI Requests > Configure AI Request Budget** to set the number of CLI calls for structured operations. To increase the exploration budget after opening the session, use **Diagram Generation > Add Exploration Budget**. Activity details show Specsplice tool calls, retrieved data, and elapsed time separately from any provider-reported measurements. **Advanced · Model Benchmarks** runs a benchmark with its own limits.

#### Follow progress and test resuming

Specsplice identifies the features first, then plans and verifies views one feature at a time. It saves validated drafts so later features can inspect them and reuse existing element and relationship IDs. The main view shows the current phase and, when available, the feature or diagram. Open **Activity Details** to inspect the session, then close it to return to the progress view.

![Purchase generation progress with Activity Details closed, rendered from the Ordito preview component in Chromium](images/34-ai-diagram-progress.png)

Once a draft is complete, try **Stop Generation**. Note the feature in progress and choose **Continue Generation**. The validated draft should remain available, and work should resume from the first incomplete step. If the session needs a decision, read **Clarification Needed** and use **Answer and Continue**. If the budget runs out, Specsplice indicates when you need to increase it.

#### Review and apply the proposed views

1. When generation finishes, open **Review All Changes**. Find the **Checkout** and **Returns** views and read any exclusions. Open **Change Details, Sources and Diagnostics** to inspect the changes and their source evidence. The names, view counts, and notations depend on the evidence and the proposal.
2. Check that **Checkout** writes **Order** after simulated approval and that **Returns** reads the same order. Follow references to `src/checkout.mjs`, `src/returns.mjs`, `src/orders.mjs`, and the tests. Check the relevant code branch and test to see when each source-level connection takes effect.
3. Check the conditions and limits. Returns distinguish between a missing order and an expired return window. The sample uses an in-memory store and takes the approval outcome as input. Record gaps such as missing evidence about payments, databases, or deployment. Model descriptive state views manually in this workflow.
4. When the proposal reflects the code, choose **Apply All Changes** and confirm. Specsplice applies the drafts together to the local model. Open the views from the diagram picker and check the result. If the model or evidence changes, refresh the review before applying.

In applied views, use **Add Element** to create an element and **Add Existing Element** to reuse one. In a generated sequence or activity diagram, edit the shared scenario with **Add Message**, **Add Step**, or **Diagram > Contents > Edit Scenario**. You can change participants, steps, conditions, branches, and ordering constraints. Linked views reflect the edits and retain the same IDs. Save the model before starting **Update Codebase from Diagrams**. An update from source can refresh the evidence and flag conflicts with manual scenario edits.

**L17 checkpoint.** From the project menu, choose **Open Project** and reopen your copy of `ai-code`. Find **Order** in both applicable views and confirm that they refer to the same identity. Record the five test results, one source reference per feature, and the result of the resume exercise. If you completed the inventory only, record that result.

To repeat the import on a standalone project similar to Marketplace, copy `08-marketplace-codebase` and choose **Import Codebase** for that folder. Start with the checkout and returns sources, the shared order store, and the local events. See `README.md` for the evidence to look for and the commands for running the tests.


### L18. Generate code from diagrams

This standalone exercise starts with a checkout and returns model in a folder that has no source files or Git repository. Choose a stack, prepare one feature at a time, and verify that the code behaves as specified by the diagrams and test cases. You need Node.js 24.22.1 and an AI account with a model configured as in L17. Make Node available on the `PATH` or set `ORDITO_NODE_EXECUTABLE` before starting Specsplice. You can use this folder even if you skipped L17.

#### Build the first implementation

1. Copy `07-marketplace-workshop/modules/ai-generation`, including `.ordito`. In Specsplice, choose **Open Project** and select the copy. You should see **Marketplace · Checkout and Returns**. Open **Checkout · Structure**, **Returns · Structure**, and **Marketplace · Dependencies**. Both features use the same **Order** resource, and **Returns** depends on its contract.
2. Open **Code > Prepare Code from Diagrams**. In the **Choose Stack** step of **Generate Code from Diagrams**, choose **JavaScript · Node.js 24.22.1 · No Framework**. The exercise profile uses local functions and JSON data and needs no dependencies.
3. In **Select Features**, choose **Checkout** and **Returns**. You can leave **Implementation Notes** blank. In **Independent Verification Cases**, leave the field blank and choose **Next** to use the seven cases included in the copy. In your own projects, provide cases you have written to compare their expected outcomes with the generated code.
4. In **Review Code Generation**, check the profile, features, and destination. Confirm with **Prepare Code Changes**. Specsplice stages files and advances once the current feature is complete. If generation stops, use **Resume Generation**. If a domain decision blocks progress, answer the clarification and resume.
5. Open **Review AI Code Changes**. The review shows the local destination and stack beneath the verification status. Each feature lists its diagrams, acceptance criteria, and changed files. Use **Open Diff** beside a file to read the proposed changes. **Checkout** produces an order with an ID and a total in cents. **Returns** receives a record in the same format and checks how many days have elapsed.
6. Use **Run Verification** to run the independent cases included in `.ordito`. Check **Verification Cases** for both features and expand **Verification Output** if a run provides additional details. When verification passes, click **Apply to Project** to write the files to the copy. If you changed the model, criteria, or affected files during review, prepare or verify the proposal again when prompted. After applying, run `npm test` in the copy to check the same cases, or use **Undo Local Changes** to restore the project files.

You can also start this workflow from the command palette with **Specsplice: Prepare Reviewed Code from Diagrams**. If a session is already in progress, the command opens its status or saved review. If an edit makes the review stale, choose **Prepare New Code Changes** from the Code page to work from the current model.

![Code review with the selected profile and Apply to Project available after verification, rendered from the Ordito preview component in Chromium](images/35-ai-code-review.png)

| Independent case | Expected result in the review |
| --- | --- |
| Approved purchase of two units at 1,250 cents each | Order `order-1`, total of 2,500 cents, outcome `confirmed` |
| Unapproved purchase or quantity above 10 | `declined` or `invalid-input`, with no order |
| Return of `order-1` after 30 or 31 days | `accepted` with 2,500 cents, or `outside-window` from day 31 |
| Return with a missing order | `unknown-order` |

**L18 checkpoint.** Check the seven independent cases and the destination before applying. Verify afterward that Specsplice created modules for both features and that you can trace each one to the reviewed contracts. These tests describe the local behavior of this sample.

#### Update an existing codebase

With compatible Node.js ESM modules, you can prepare another proposal after updating the model and cases. Open **Code** in the same copy, check the destination, and inspect the diff before applying.

To practice an update from diagrams, use a copy of `code` from L16. Prepare a view that includes quantity validation using the generation workflow from L17. In the view, select the element that represents `validateQuantity` and open **Manage > Edit Description**. Specify that the function returns `true` for safe integers from 1 to 10, `false` for other safe integers, and throws `TypeError` for decimals or strings. Click **Save Changes**, then **Save**.

If **Update Codebase from Diagrams** appears after you save, choose it. You can also start the workflow from **Code** or search for `>Specsplice: Update Codebase from Diagrams` in **Open Quick Access**. Review the saved changes the provider will receive, then start the update. Read the result, compare the files in your copy, and run `npm test` and `npm start` again. Check 0, 1, 10, 11, and a non-integer in the tests. If a diagram still shows the old rule, use **Update Diagrams from Codebase** and review the updated proposal as in L17.

#### Implement a feature in a worktree

A worktree lets you inspect and verify proposed files before applying them to the main folder. This workflow requires a compatible legacy model, a linked Git codebase with at least one commit and a clean working tree, a feature with recognized acceptance criteria, and a configured provider. To verify executable behavior in v4 and v5 projects, use **Prepare Model to Code Review** from L12.

If you have the Specsplice sources from A1, make an independent copy of the original sample codebase and name it `legacy-code`. Copy the example file `ordito/examples/checkout.ordito.json` from the Specsplice sources into that folder without editing it. From the home screen, choose **Start a Project > Examples and Model Files > Open Model** and open the copied file. The model includes **Confirm Purchase**, a feature with defined criteria.

From the project menu, choose **Show IDE**. If the copy has no Git repository, open **Source Control** and choose **Initialize Repository**. Select **Stage All Changes**, enter a commit message such as “Add sample project baseline,” and click **Commit**. Configure your Git identity first if prompted. In **Source Control**, verify that the commit exists and the working tree is clean. The sample codebase already excludes the `.ordito` working folder from Git.

After the initial commit, prepare a model and code snapshot. Click **Open Quick Access**, search for `>Specsplice: Update Diagrams from Codebase`, and select it. If prompted, check the path to your copy and choose **Trust Folder & Continue**. Once the inventory is ready, cancel **Generate Diagrams**. If the earlier message composer appears, close it before sending a message. Specsplice retains the initial snapshot. If you created the baseline before initializing Git and see **Source manifest changed**, use Sync in L19 to realign it.

In the compatible project, click **Open Quick Access**, search for `>Specsplice: Implement Feature`, and select **Confirm Purchase** for this example. Enter the change in **Requested Behavior** and press Enter. Choose the files to share, `src/orders.mjs` and `test/orders.test.mjs` in this example, and click **OK**. Read **Review Implementation Context**, then choose **Send Context to Codex** or the corresponding control for your provider. Review the plan and questions. With the **Plan and Implementation** budget, answer any clarifications and click **Generate in Worktree**.

Specsplice prepares the changes in a separate worktree. Read the diff tabs and **Implementation Review.md**, then return to the model tab and open **Code > Implementation Worktree**. Click **Run Tests** and confirm **Run Tests**. After verification, return to the model tab, click **Apply Verified Changes** in the same pane, and confirm **Apply Changes**. Check the diff for the main folder in **Source Control**.

If the pane is unavailable, search in **Open Quick Access** for `>Specsplice: Verify Implementation` to run verification and `>Specsplice: Apply Verified Implementation` after the tests pass. Both commands show the same confirmation as the pane.

Availability depends on recognized feature criteria and a supported format. Shared operation criteria and legacy feature criteria have separate requirements. For a guided local exercise, follow the executable workflow in L12. An imported copy of the original code module still needs the worktree prerequisites above.

**Resume Implementation** reopens a saved review. **Recover Interrupted Implementation** handles an interrupted transaction. Undo restores previous file contents only when it can preserve subsequent manual changes. If a test run is canceled or interrupted, rerun it successfully before applying. A Git worktree provides a separate working folder. Set up operating-system isolation and install any required dependencies separately.

Keep the file diff and test results when you hand off the update branch. Check compatibility for the worktree and for Sync independently.


### L19. Reconcile the model and source code with Sync

After independent changes to the model and source files, Sync compares both with a common baseline to identify differences and conflicts. Use that comparison to agree on what to preserve before continuing. This workflow requires a compatible project that already has an adapter and baseline.

**Advanced exercise for compatible legacy projects.** Sync requires a supported format and adapter, a linked codebase, model-to-code mappings, and a valid common baseline. A new assisted proposal also requires an AI account. To see a local preview, use the `legacy-code` copy and set up the baseline as described in L18. If you imported your copy in L16 using the incremental v5 workflow, continue to L20.

To try Sync after the worktree exercise, make a second clean copy of the sample and prepare its baseline. If **Review Sync Context** rejects a source file, check whether it came from **Apply** in the worktree workflow. This build excludes files hard-linked to the journal from Sync.

Use Sync when both the model and source have changed. Compare the **common baseline, current model, and current source** to distinguish changes on each side and identify conflicts. Check the format and adapter requirements before proceeding.

In the linked legacy project, open **Code** and click **Sync Project** under **Recovery and Synchronization**. In **Sync Preview**, review the local summary of files, symbols, dependencies, views, and conflicts. For an assisted proposal, open **Review Sync Context**, select the relevant files, and confirm. Check the context, then click **Request Sync Proposal**.

A proposal can contain targeted model edits and replacements anchored in the text of existing files. Review **Sync Proposal.md**, the diff in **Inspect Code Changes**, and any prompts in **Questions and Validation**. Use **Answer Sync Questions** to respond and prepare a new proposal. **Apply Sync** appears once the proposal passes the required checks. When the proposal is empty, for example after a commit that leaves the sources unchanged, **Apply Sync** records a common snapshot from the current model and sources.

When the same contract changes on both sides, compare all three versions and choose the intended behavior. Confirm rename mappings only when they refer to the same identity. Use the baseline to tell a deliberate change from a value that stayed the same. Resolve the underlying conflict before accepting the review.

Run the project's tests and build after applying Sync. **Undo Last Sync** restores the model and source files when the saved versions are still valid. Use **Recover Sync** to recover an interrupted operation. Restoring a historical model or index snapshot changes only the model or index.

The current text-based Sync edits existing files. Structural profiles handle file creation, moves, and deletion where supported. Specsplice can reuse a cached proposal without another call when the same context is still valid.

**L19 checkpoint.** In a compatible project with a baseline, make an actual change, refresh the analysis, compare the new limit with the model, and review the proposal. Keep the previous decision until the conflict is resolved. Use **Sync Project** to reconcile project artifacts and Git's sync command to exchange commits with a remote.


### L20. Reverse changes, switch runtimes, and prepare follow-up work

After the first implementation, a source or runtime change can alter the agreed behavior. Use reverse mapping to compare the code with the model and rerun the same independent cases to assess the change. Tasks and continuous preparation carry decisions into later reviews.

#### Map changes from code back to the model

Direct code edits can conflict with an agreed rule. Reverse mapping proposes a corresponding model change, and independent cases show whether that change is acceptable. In this exercise, deliberately lowering the maximum from 10 to 9 should fail **Limit 10** (Limit 10). The failure shows that the proposal violates a requirement that is still in force.

**Use Open Project to return to your copy of the quantity module from L12.** If you finished with Undo, prepare a new review, run **Run Real Verification**, and choose **Apply to Project**. Reverse mapping needs the generated files in this folder. Use the L12 review to create them before proceeding.

1. If Explorer is closed, open **Project Settings > Developer Tools > Files** from the project menu. Expand `src` and open the `predicate-…mjs` file generated by the L12 review.
2. Find the literal used as the limit in the `<=` comparison. In the example, it is `const v3=10;`. Scroll horizontally if necessary. Change only `10` to `9`, keep the metadata comment intact, and choose **File > Save**.
3. Return to the Specsplice tab. From the project menu, open **Project Settings > Executable Behavior > Code and Context > Reverse Model Behavior from Code**.
4. In **Code to Model**, check for `quantity ≤ 9` and click **Run Real Verification**. Confirm if prompted. Wait for **Real Verification Failed · Application Blocked** and expand **Verification Output**. In the 24-case variant, 23 pass and **Limit 10** fails. **Apply to Project** stays disabled.
5. Keep the original expected result. Return to the file, restore the literal `10`, and save.
6. Run **Reverse Model Behavior from Code** again. When the file and model agree, Specsplice shows **Model Behavior Is Aligned · No Proposal · No AI Calls**. Open **Project Settings > Developer Tools > Terminal** in your copy of `quantity`, check the working folder, and select Node 24.22.1. Run `node --test test/*.test.mjs` to check the **12 independent tests** generated in the project. The Specsplice review also runs 12 derived cases.

To accept a different limit in a real project, record the business decision, update the criterion and expected outcomes, and run verification again.

Reverse mapping covers supported subsets of predicates, interactions, states, and messaging. A change outside the supported grammar can yield a partial mapping and block Apply. Specsplice preserves existing architecture decision records, annotations, and contracts during reversal.

If you need to reorganize generated files, use the managed source move actions to preserve supported references. These actions allow supported nested paths and update the corresponding links. Review collisions and identities before confirming. Keep a single authoritative copy of each managed artifact.

#### Choose Node or Bun

Consider a runtime change once you have verified behavior to preserve. In **Project Settings > Model and Architecture**, use **Choose Runtime and Review Stack Plan**. The current profiles are Node ESM and Bun ESM with versions specified by Specsplice. This lab uses Node 24.22.1. The Bun profile needs Bun 1.3.2 available when Specsplice starts.

The plan covers implementation, dependencies, storage, data, tests, deployment, and rollback. Run the same independent cases to verify that changing the runtime preserves the business behavior. Resolve incompatible architecture decision constraints. Install Bun and handle any live database or broker migration separately.

#### Tasks, clarifications, and continuous preparation

Open **Project Settings > Model and Architecture > Tasks and Clarifications**. Choose **Create Task**, select `validateQuantity`, and enter “Verify integer quantities from 1 to 10 using independent cases.” Click **Next** after each choice or field. Check **Review Your Changes**, click **Apply Changes**, and save. Reopen the task and choose **Add Clarification**. Record the question “What is the maximum inclusive value?” and the answer “10. The case for 11 must show Not Satisfied.” Apply and save the clarification. The next review includes this decision.

In **Code > Automatic Preparation**, click **Start or Stop Continuous Preparation** and enter a budget such as `1`. If prompted, click **Enable Preparation**. The job prepares reviews once semantic changes settle. Layout changes, zoom, and selection leave the attempt count unchanged. Check the job count and status. To suspend preparation, choose **Start or Stop Continuous Preparation** again and verify **Paused**. Switching projects also stops the current job.

You review, verify, and publish these proposals manually. If the budget runs out or Specsplice restarts, explicitly choose when to resume preparation.

**L20 checkpoint.** Identify which edits change the model and which change only the layout. Confirm the configured profile matches the available runtime, then review a prepared proposal before applying it. Check the availability of Bun, your provider, or an external connection when a workflow requires one.


### L21. Hand off the project

After saving the views, decisions, and local evidence, prepare a handoff that lets someone else trace a purchase and a return.

Reopen Marketplace and use navigation and search to find **Customer**, **Order**, purchase confirmation, and the return request. If a colleague is available, ask them to follow the same path independently and record their feedback.

Collect the entire Marketplace folder, including `.ordito`, the relevant modules, and a summary of test evidence and pending decisions. Reopen the copy with **Open Project** and check its references. Leave out caches, credentials, and provider history. You can commit or publish the project separately.

| Deliverable | How to demonstrate it |
| --- | --- |
| Saved model that reopens | Close the project, reopen it, and find a view for each notation |
| Two linked features with shared identities | Follow **Order** from purchase to return and check change impact |
| Readable architecture | Identify the context, containers, components, packages, and deployment |
| Consistent data | Check cardinalities, keys, and mappings among distinct identities |
| Verified quantity behavior | Current review, independent cases, and local Apply and Undo |
| Explicit interactions and policies | Cases, state traces, and the messaging scenario |
| Links to source code | Files opened from code evidence and results of the code tests |
| AI evidence where applicable | Scope, review, diff, and verification results, or a note that the exercise was skipped |

For the editor, terminal, Git, debugging, and accessibility, see A2–A7.

## Part III - Atlas of 16 diagrams

Use this atlas to choose a view for a design question or to refine a diagram that serves several purposes. D0 helps you choose a notation. The chapters that follow explain the choices you made with forms during the lab. Go straight to the view you need.

### D0. Choose a perspective and read the symbols

Each design question calls for a perspective. Use a view to tell readers what matters, read elements, arrows, and conditions in the context of the notation, and reuse model elements by identity. Record details in properties and contracts when the canvas alone leaves room for interpretation.

Clarify the question and the audience before you add a view. Start with the table, then use the corresponding chapter to learn the symbols, the procedure, and the scope. Create the views that serve your feature.

| Design question | View | Chapter |
| --- | --- | --- |
| Who collaborates, and what is each party responsible for? | Structure | D1 |
| What is the product boundary, how is the product divided, and what is inside an application? | C4 Context, Container, and Component, in increasing detail | D2–D4 |
| What data exists, and how will it be stored? | ERD for domain entities and Database Schema for tables and keys | D5–D6 |
| Who calls whom, and in what order? | Sequence | D7 |
| What steps and alternatives lead to an outcome? | Activity / Flowchart | D8 |
| What events change a resource's state? | State Machine | D9 |
| Where do the parts run, and how do they communicate? | Deployment for hosts and Network for connections and protocols | D10, D16 |
| How do I organize types, contracts, and modules? | Class, UML Component, and Package, depending on the level | D11, D13–D14 |
| What goal does an actor achieve? | Use Case | D12 |
| What data enters, changes, and goes into storage? | Data Flow | D15 |

C4 describes architecture at several levels of detail. UML (Unified Modeling Language) provides notations including class and use case diagrams. ERD stands for Entity–Relationship Diagram. The chapters below describe the notation subsets Specsplice supports.

#### Create a view in the editor

1. Open the project root where you want to save the view. Click the diagram name and choose **Add Diagram**. In Marketplace, select the feature requested by the form. Use **Checkout** for general views and **Returns and Refunds** for the dedicated returns views. Specsplice places each diagram under the capability it describes. For a C4 view with a subject, use step 3.
2. In **Create Diagram**, fill in **Name** and select a notation under **Diagram Type**. Use **Choose Feature** when the view needs a feature, then click **Create**.
3. For **C4**, follow L3. Open **Structural Blueprint > Structure > C4 View Subject and Context**, click **New C4 View**, and set the name, level, subject, context, and visibility. Click **Apply to Model** to create the view and **Open Diagram** to open it. L1 is Context, L2 is Container, and L3 is Component. Specsplice keeps the subject visible. L4 Contract scopes a Class view to a contract.
4. For **State Diagram**, also select **Resource Whose State Is Represented** in the creation form. The states describe the lifecycle of that resource. For other diagram types, use **Add Element** for new objects and **Add Existing Element** to reuse objects already defined.
5. To include an existing relationship, add both endpoints and use **Diagram > Contents > Add Existing Relationship**. For a sequence use **Add Existing Message**, and for a state diagram use **Add Existing Transition**. To create a new relationship, specify the endpoints, type, and name in **Create Relationship**. Fill in **Condition (Optional)** where applicable and click **Save Changes**. In a sequence, include messages in the declared order.
6. Complete the properties, boundaries, and details. Save and reopen the diagram to check that your changes persist. Use **Read Diagram** or the accessible view to read details the canvas summarizes, such as conditions, members, and protocols.

To correct a C4 view, open it and select **Diagram > Contents > Edit Visible Elements** or **Edit Context Dependencies**. Both actions are also available in **Diagram Options**. Review your selections in the Blueprint and click **Apply to Model**. **Filter Elements** searches by name, type, or owner. **Context** declares dependencies external to the subject. **Visible** selects the elements shown on the diagram. To show a context dependency, also select **Visible**.

If a C4 view shows **Draft Needs Correction**, open **Structural Blueprint > Structure > C4 View Subject and Context** and choose the view under **Configuration**. **subjectAndScopeRequired** indicates a missing scope, and **subjectNotVisible** indicates that the subject is missing from the diagram. Set the level and subject to restore the scope and its visibility. Click **Apply to Model** and save.

#### Shared element vocabulary

Read the type on the element card, since colors and shapes are visual aids. Specsplice's diagrams use a subset of the original notation conventions. Each picker shows types compatible with the view. Use this table to understand the full vocabulary and select the types that fit the view.

| Element | Meaning and scope |
| --- | --- |
| Feature | Project capability such as **Returns**. It groups related perspectives. |
| Actor | Role that interacts with the system, such as **Customer**. One actor can represent many people in the same role. |
| System | System within your control or an external system. Its scope defines whether it falls within the design or is a dependency. |
| Container | Deployable application, client, service, store, or messaging infrastructure. The C4 meaning covers these roles regardless of packaging technology. |
| Component | Internal responsibility, such as **Checkout**. Containment identifies its application. |
| Resource | Domain object with identity, contracts, or a lifecycle, such as **Order**. Its mapping to a physical table is a separate design choice. |
| UI View / Interface | Product interface such as **Returns Page**. It is an element you can place on a diagram. |
| Controller | Coordination of requests or behavior. The implementation can take different forms depending on the framework. |
| Contract | Shared contract definition that can connect to its provider and operations. |
| Interface Contract | Interface with members or operations, such as a provider contract. |
| Action | Activity, usually named with a verb, that represents something happening. |
| State | Stable condition of a resource, usually named with a noun or adjective. |
| Entity | Logical data concept with attributes. It can exist independently of a physical table. |
| Table | Designed physical structure with declared columns, keys, and constraints. |
| Class | Software type with attributes and methods. Use Component for a unit of architectural responsibility. |
| Package | Logical, non-deployable module or layer that organizes software dependencies. |
| Deployment Node | Environment or node that hosts applications or artifacts. |
| Artifact | Deployable output such as a bundle or module. |
| Network Node | Connection point or boundary in a designed network. |
| Use Case | Goal or capability from an actor's perspective. One goal can span multiple screens. |
| Process | Data transformation in a Data Flow view. |
| Data Store | Store from a data or infrastructure perspective. It may be logical and independent of a particular DBMS. |
| Decision | Point where a flow branches according to conditions. Label outgoing branches to clarify the alternatives. |
| Start | Entry point to an activity flow. |
| End | Declared endpoint of an activity flow. |

#### Read a relationship

**Invocation** points from caller to recipient. **Read/Write** points from the reader or writer to the resource. **Dependency** points from the dependent to what it uses. **Transition** links a source state to a target state. **Control Flow** orders the path between activities. **Data Flow** represents a named transfer of data. **Communication** represents an architectural or network exchange and may name a protocol. **Hosts** points from the node to what it hosts.

**Association** expresses a structural relationship. Multiplicities at the two endpoints specify how many participants may be involved. **Composition** and **Aggregation** qualify a whole-part relationship. **Inheritance** points from the specialized type to the general type, and **Implementation** points from the implementation to the contract. See D12 for **Include/Extend**. Use the Blueprint to specify port and operation bindings, and consult source or test evidence for runtime behavior.

A **text condition** describes when a relationship applies. An **executable guard** is a typed expression in the relevant contract. A **protocol** declares how parties intend to communicate. A **cardinality** specifies the number of instances the design permits. Consult runtime evidence for observed connections and instance counts.

### D1. Structure – Map responsibilities

A Structure diagram shows the path into a feature, the responsibilities that collaborate, and the result they produce. Use relationship types to distinguish a call, data access, and a structural dependency.

#### When to use it

Use Structure for an initial feature map or a system overview. It helps at the start of a project and when onboarding someone to a codebase. Pick one scope and stay at a consistent level of detail. An overview that includes every function, table, and file soon becomes hard to read.

In the reference project, open **01 Responsibilities Overview**. The customer (**Customer**) uses **Web shop**, which sends the purchase to **Checkout**. Checkout requests authorization and records **Order**. **Returns Handling** depends on Checkout to look up the purchase. Use this view to see responsibilities and Sequence to see the order of calls.

![Structure diagram showing people, applications, responsibilities, and a resource](images/atlas-01.png)

#### Elements and details

| Common element | Role in the diagram |
| --- | --- |
| Actor | Role that initiates or uses the capability. **Customer** retains its identity across features. |
| Component / Controller | Responsibility or coordinator. Choose a name that describes what it does. |
| Resource | Domain object with an identity. **Order**, its screen, and its table each have a different role. |
| Interface / View | Interaction point such as a page or system interface. |
| System / Container | External context or application, as needed for the overview. |
| Contract and other compatible types | Include details when they clarify responsibilities and constraints. |

Use an element's description to explain what it does, and containment to declare where it belongs. Names and proximity on the canvas can be ambiguous. Use contracts to specify inputs, outputs, conditions, and errors when callers and providers need a precise agreement. The advanced picker categories contain types for less common cases.

#### Relationships, construction, and checks

Use **Invocation** for requests, **Read/Write** for access to a resource, and **Dependency** for structural use. In the Marketplace overview, recording the order is a **Write** with payment authorization as its condition. Name a dependency for what it uses so the label communicates its role without implying an undeclared temporal order.

Follow D0 to create a Structure view. Add **Customer**, **Web shop**, **Checkout**, and **Order**. Connect the main path, then add payment and returns. This order gives readers an entry point, coordinator, and result before you expand the context. You can construct the same relationships in any order. Reuse existing identities so names and details stay shared. Add a Sequence diagram for call order or a C4 Context diagram for the product boundary.

**Check.** A new reader can identify the entry point, the coordinator, and the result. Each arrow has a clear meaning, each identity appears once per view, and any changes in level are explicit. When you intend to remove a shared responsibility from this view, use the view-level removal action to keep its model identity available elsewhere.

### D2. C4 System Context – Define the product boundary

A System Context diagram identifies the product in scope, its users, and the external systems it depends on. Agree on that boundary before discussing technical details.

#### When to use it

Use Context with stakeholders and new team members, or when discussing scope. The C4 reference places a single system at the center of its environment. [C4 System Context](https://c4model.com/diagrams/system-context)

Open **02 C4 Marketplace Context**. **Marketplace** is the system in scope. **Customer** and **Support** are roles, and **External Payments** and **External Carrier** are external systems. The view shows the store's responsibilities and where its control ends.

![C4 Context diagram showing Marketplace, its users, and external systems](images/atlas-02.png)

#### Elements

| Element | Meaning and details |
| --- | --- |
| Subject system | The single system at the center of the analysis. Its name and description identify the product. |
| Actor | A human role or other party that uses the system. **Customer** and **Support** pursue different goals. |
| External Software System | System outside the design's control, such as the payment and delivery services in Marketplace. |
| Declared context | External identities included in the view's scope. They retain their existing owners. |

Keep the Context view at system and actor level. Use the System type's scope to distinguish internal and external systems, and set the subject through the Blueprint. The context setting describes a dependency. Authorization to generate or modify external systems is separate.

#### Relationships and how to build the view

Use **Communication** or **Dependency** with a name that explains the relationship, such as **authorizes payments and issues refunds** (authorizes and refunds) or **requests delivery** (requests delivery). Point the relationship from the party that uses or requests the other system. When parties communicate in both directions, name the responsibilities and add the relevant relationships explicitly.

Create the Context from **C4 View Subject and Context > New C4 View** as in L3 and D0. Select L1, set **Marketplace** as the subject, and name the view. In **View Contents**, select and show the four context elements. Create any missing actors or systems first. Click **Apply to Model** and **Open Diagram**, add the relationships, and save.

**Check.** There is one product boundary, readers can distinguish actors from systems, and internal components belong at a deeper level. See D3 for the parts of Marketplace and D16 for network topology. Consult runtime evidence for observed traffic.

### D3. C4 Container – Map applications and stores

A Container diagram divides the product into applications, services, and data stores. Use it to declare their responsibilities, ownership, and planned communications. Use Deployment for the hosts that run them.

#### When to use it

Use this view to discuss deployable responsibilities, technology, and the boundaries between clients, services, and persistence. A C4 container is an application or data store and can use any packaging technology. [C4 Container](https://c4model.com/diagrams/container)

In **03 C4 Applications and Data**, the **Marketplace** system contains **Web shop**, **Marketplace API**, **Marketplace Store**, and **Event Broker**. **Customer** remains external context. These are design choices for the example. Use runtime evidence to identify processes actually running on a host.

![C4 Container diagram showing applications and data stores inside the system boundary](images/atlas-03.png)

#### Elements

| Element | Use |
| --- | --- |
| Subject system / boundary | The system that owns the containers. Set it to be visible in the configuration. |
| Application / Container | Web or mobile app, service, store, or messaging infrastructure. Declare the relevant responsibilities and runtime. |
| Data Store | Declared store. Reuse an existing store element when it represents the same identity. |
| Resource | Domain resource allowed by the picker. Include it when it clarifies a dependency. |
| Actor / External Software System | Context that uses or is used by the applications. Keep its external scope. |

Declare ownership in the Blueprint to assign internal parts to **Marketplace** and distinguish them from external dependencies across views. Dragging items inside a boundary affects the layout. Declare technology and environment based on known information or explicit design decisions.

#### Relationships, construction, and checks

Marketplace declares HTTPS from **Customer** to **Web shop**, HTTPS / JSON from the web app to the API, SQL from the API to the store, and publishing to the broker. The arrow name describes the intent. The protocol describes the planned means of communication. For a structural dependency, leave protocols and ports unspecified unless you know them.

In the Blueprint, assign the four containers to **Marketplace** using **Architectural or Lifecycle Owner** and complete their roles as in L4. Create an L2 C4 view with **Marketplace** as subject and **Customer** as context. Make **Customer** and the four containers visible. Specsplice shows the subject automatically. Click **Apply to Model** and **Open Diagram**, then connect the elements to declare their integrations. See D4 for API components and D10 for deployment.

**Check.** Each container has a responsibility and an owner. Application and host are distinct model elements, and each data store has a single identity. Installation, provisioning, communication, and migration require separate execution.

### D4. C4 Component – Show the inside of an application

A Component diagram identifies the responsibilities inside an application and the contracts they offer. Use the container subject and its context to tell internal components from external dependencies.

#### When to use it

Use C4 Component when you need more detail than an application-level view provides about responsibilities, dependencies, or contracts. Choose the applications where this level of detail helps readers. [C4 Component](https://c4model.com/diagrams/component)

Open **04 C4 API Components**. **Marketplace API** is the subject. **Checkout**, **Outcome Log**, **Returns Handling**, and **Inventory** are internal responsibilities. **Inventory** manages availability at the application level. **Marketplace Store** provides persistence. **Checkout Contract** also belongs to **Marketplace API**, and **Checkout** provides it. Check the declared owner and binding in the Blueprint.

![C4 Component diagram showing API responsibilities and the contract Checkout provides](images/atlas-04.png)

#### Elements and ownership

| Element | How to read it |
| --- | --- |
| Subject container | Application whose internals the view shows, here **Marketplace API**. |
| Component | Internal responsibility such as **Checkout** and **Outcome Log**. |
| Controller | Internal coordination when that role is more precise than Component. |
| Resource | Domain object needed for this level of detail. It retains its model type. |
| Contract / Interface Contract | Shared contract or interface. Complete operations and types in the Blueprint. |
| Context Container and other compatible dependencies | Items outside the subject. Declare them as context and keep their existing architectural owners. |

The solution defines version 1 of **Checkout Contract** and records **Checkout** as its provider in the Blueprint (L11). This gives the contract an explicit provider and lets checks read the signature it offers. The dependency on **Inventory** expresses a structural relationship. Declare any operation bindings separately.

#### Relationships and construction

The **requests availability** Dependency connects **Checkout** to **Inventory**. The **records outcome** Communication connects Checkout to **Outcome Log**. Implementation shows that Checkout exposes **Checkout Contract**, and **Returns Handling** depends on Checkout. To check compatibility between operations, declare ports, types, and bindings.

In the Blueprint, assign the components to **Marketplace API** using **Architectural or Lifecycle Owner**, as in L4. Create a level L3 C4 view and select **Marketplace API** as the subject. Set **Context** and **Visible** for the scope you want to show, then click **Apply to Model** and **Open Diagram**. Save and check the boundary in the textual view too.

**Check.** Components keep their roles regardless of how you arrange them, and external dependencies stay outside the system in scope. Use UML Component (D13) when you need to discuss interfaces across modules.

### D5. ERD – Describe entities, attributes, and cardinalities

An ERD gives the team a shared understanding of the data. Identify the concepts that have their own identity, the attributes that describe them, and the number of objects that each relationship allows.

#### When to use it

Use an ERD to agree on the domain before choosing table names and database details. It helps when the same word means different things to different readers. An order, an order line, and a return request each have their own identity and constraints.

Open **05 Entities and Cardinality**. **Customer**, **Order**, **Order Line**, **Product**, and **Return** show the essential attributes. The lab ERD is a logical view of the domain. See D6 for the designed physical schema.

![ERD showing logical entities, attributes, and cardinalities](images/atlas-05.png)

#### Elements and members

| Element or detail | Meaning |
| --- | --- |
| Entity | Logical concept with an identity, such as **Product**. Use consistent singular names. |
| Resource | Domain resource compatible with the notation. Reuse it when it represents the same object. |
| Attribute | Data that describes the entity. For example, quantity belongs to **Order Line**. |
| Type | The domain of a value. A string and an integer have different types even when both appear as “42”. |
| Presence and nullability | Whether a field is required and whether its value may be null are separate settings. |

Represent a property's value as an attribute. Use a separate entity for an order line, which has its own quantity and price. That makes the constraints on lines explicit for each **Order**.

#### Relationships and cardinalities

An **Association** names a structural relationship. The notation also supports whole-part relationships where appropriate. Use explicit associations in the lab. **1** means exactly one. **0..1** means zero or one. **0..\*** means zero or more. **1..\*** means one or more. The number beside an entity tells you how many instances of that entity can relate to an object at the other end.

“Customer 1 - Order 0..\*” means each order has one customer and each customer can have multiple orders. “Order Line 0..\* - Product 1” means each line refers to one product and a product can appear in multiple lines. The relationship from **Return** to **Order** records the return's dependence on the purchase.

Create the entities and add members in their properties. Once the identities and attributes are clear, connect the entities and set the cardinalities.

**Check.** Read each association in both directions. For the customer and order association, determine both how many orders a customer can have and how many customers an order can belong to. Mark undecided rules as open. Cardinalities express the model's constraints. Use the physical schema and database checks to see how those constraints apply to stored records. See D6.

### D6. Database Schema – Design tables and constraints

A database schema shows how domain concepts are stored. Use it to define tables, columns, and keys, identify the targets of references, and map domain fields to designed columns.

#### When to use it

Use this view after clarifying the domain or while reading existing schema definitions and migrations. Record whether your schema is a proposal or backed by source evidence. Marketplace is an SQL design exercise. It uses no deployed DBMS.

Open **06 Proposed Data Schema**. The tables `customers`, `orders`, `order_lines`, `products`, and `returns` have their own identities. The five related logical entities are separate model elements.

![Database Schema diagram showing columns, keys, and references](images/atlas-06.png)

#### Elements and columns

| Element or detail | How to use it |
| --- | --- |
| Table | Designed physical table. Follow the project's naming conventions. |
| Column and type | Stored field and value domain. Declaring `total_cents` as an integer documents the chosen monetary unit. |
| Primary key (PK) | Identifies a row in the table. The diagram records that role. |
| Foreign key (FK) | Reference column. Also specify the target column. |
| Unique | Declared uniqueness constraint, such as on `sku`. The primary key remains a separate setting. |
| Field Presence / Nullability | Whether the field is required and whether it accepts null are separate settings. |
| Data Store / Resource | Compatible context store or resource. A store can act as an optional boundary. |

Edit members with **Edit Attributes and Technology**. Declare column types as in L5, then use the shared types and mappings in L11 to connect persistence to the contract. An explicit mapping keeps the relationship to the domain visible when storage changes. Use a specific technology value when the DBMS is known.

#### References and construction

Associations between tables identify their endpoint columns. `orders.customer_id` points to `customers.id`. `order_lines.order_id` points to `orders.id`, `order_lines.product_id` to `products.id`, and `returns.order_id` to `orders.id`. Select the relationship and open **Edit Cardinalities and Protocol**. Complete **Source Multiplicity**, **Target Multiplicity**, **Source Attribute / Column**, **Target Attribute / Column**, and **Protocol / Transport** in order, pressing Enter after each field. For the four references, use `0..*` and `1`. Enter the source column name, then `id`, omitting table prefixes. Leave the protocol blank. To document a complete foreign key, set both column fields even when the arrow is already named `customer_id`. See L5 for the full procedure.

Build tables and columns first so associations can point to existing columns. After renaming a member, check that the reference still points to the intended column. Use explicit mappings to relate the domain's `orderId` to `orders.id`. You can then follow that relationship even when names and representations differ. Entities, tables, and classes each retain their own identities.

**Check.** The diagram shows four valid references, identifiable primary keys, explicit nullability, and clear units. Use project migrations and integration tests to verify that the active database enforces the constraints.

### D7. Sequence – Order interactions between participants

The order of interactions can affect the outcome of a purchase. A Sequence diagram identifies who sends and receives each request, the conditions under which it occurs, and the order of messages that use your existing model elements.

#### When to use it

Use Sequence for a purchase confirmation, return request, or specific error case. It helps when the point at which a read, write, or response occurs affects the outcome.

Open **07 Checkout Sequence**. **Customer** requests confirmation from **Checkout**. Checkout invokes **External Payments** and then writes **Order** when authorized. The diagram focuses on coordination and simplifies the web channel. Use production traces for measured timing.

![Descriptive sequence diagram with three ordered messages](images/atlas-07.png)

#### Elements and messages

| Element | Meaning |
| --- | --- |
| Participant | Identity that sends or receives a message, such as an actor, responsibility, compatible interface, or resource. |
| Lifeline | Column that identifies a participant throughout the scenario. |
| Message | Interaction with a source, destination, type, and name. Its position in the sequence is its declared local order. |
| Read / Write | Access to a resource. Read retrieves data and Write updates it. |
| Condition | Declared precondition for the message. Specify a typed guard when you need an executable condition. |
| Occurrence / frame, in compatible models | Distinct event or behavioral group. Repeated calls can produce different results. |

Reuse participants with **Add Existing Element** and relationships with **Add Existing Message** to preserve their responsibilities and conditions. Select a participant and use **Move Participant Left** or **Move Participant Right** in its properties to arrange the columns. In those properties, open **Sequence Message Options** for the relevant relationship and use **Move Message Earlier** or **Move Message Later** to set its order. Use these commands to change message order and the canvas to adjust layout. Save and check the textual reading to confirm that authorization precedes the order write.

#### Descriptive and executable sequences

The v5 descriptive model uses occurrences to distinguish calls, alternatives, and declared ordering constraints. In the executable L13 exercise, each call declares its operation, arguments, synchronization, results, errors, and simulated response. Frames such as alt, opt, loop, par, critical, and ref each have contracts and limits. Add a formal guard when you need to verify a branch.

Create the view, reuse the four participants, include the three messages, and order them explicitly. Represent a negative case as its own scenario or use a suitable alternative structure so confirmation and rejection are recognizable as different outcomes. Indicate which order is declared and which remains open.

**Check.** You can read each arrow aloud with its sender, recipient, content, and condition. Read the declared order from top to bottom. Use measured traces to determine elapsed time. Use Activity for decisions independent of participants and State Machine for the order's persistent state.

### D8. Activity / Flowchart – Show steps and alternatives

An Activity diagram describes how inputs lead to possible outcomes, including failures. It shows where the path branches and which conditions select each outcome.

#### When to use it

Activity / Flowchart is one notation in Specsplice. Use it to discuss a procedure across roles, find missing outcomes, and establish what comes before what. You can design the flow before choosing its classes and services.

Open **08 Checkout Flow** to follow validation, availability checks, payment, confirmation or rejection, and the end of the flow. The tour's shorter refund flow applies the same principle. Each alternative needs a clear meaning.

![Activity diagram showing the entry point, actions, decision, and outcomes](images/atlas-08.png)

#### Elements

| Element | Naming and meaning |
| --- | --- |
| Start | Procedure entry point, such as **Start**. Describe its trigger. |
| Action | Step named with a verb, such as **Validate Cart** or **Request Payment**. Reserve **Pagato** for a state. |
| Decision | Question or choice such as **Inventory Available?**. Label each outgoing branch with the condition that permits it. |
| End | Declared outcome or endpoint. Give each negative path an intentional outcome. |
| Compatible responsibilities and resources | Context for who performs an action or which data it uses. Keep the main flow legible. |
| Control Flow | Relationship that takes the path from one step or decision to the next. |

Give arrows clear conditions such as “available” or “unavailable”, and “authorized” or “rejected”. Each label should identify which branch applies. If conditions can overlap, specify priorities or exclusivity in the relevant contract.

#### Construction and checks

Start with the main path from **Start** to **End** so its entry and outcome are easy to see. Then add the availability decision and rejection branch. Connect both payment outcomes so each reaches a conclusion. This order helps you check completeness. The editor also supports creating steps in a different order. Use the textual reading to follow relationships even where arrows cross. Arrange nodes for readability and declare executable expressions or ordering separately.

Use the profile constructs in L13 for verifiable alternatives, concurrency, repetition, and nested interactions. Declare fork/join or timing semantics explicitly when you need them.

**Check.** Each branch reaches an intentional outcome, actions and states have distinct names, and a reader can evaluate the decision conditions. Add a Sequence diagram to show who sends each message, or a State Machine to show the resource's stable condition after a step.

### D9. State Machine – Track a resource's lifecycle

Some actions are valid only at certain stages of an order's lifecycle. A State Machine gives each resource an explicit set of states and shows the events and conditions that move it between them.

#### When to use it

Use State Machine for orders, return requests, reservations, and other objects whose available actions depend on their state. It helps you identify illegal transitions and distinguish attempts, authorizations, and completions.

Open **09 Order States**. The **Order** resource has the states **Pending**, **Confirmed**, and **Declined**. The tour's **Return Request** has its own lifecycle with **Requested**, **Authorized**, **Refunded**, and **Rejected**.

![Descriptive State Machine showing a resource, states, and transitions](images/atlas-09.png)

#### Elements and details

| Element or detail | Meaning |
| --- | --- |
| Resource / lifecycle owner | Object whose lifecycle you are describing. Declare it explicitly. |
| State | Condition of the object, such as **Confirmed**. Use an action such as **Confirm Order** for the step that leads to it. |
| Transition | Move from one state to another, with a relevant event or condition. |
| Event | Occurrence that can trigger the transition. Use a typed payload in the executable profile. |
| Guard | Condition that allows the transition. Describe it in text or use a formal expression in an executable contract. |
| Actions and errors | Effects associated with a transition or lifecycle in the forms and profiles that support them. |

In the descriptive diagram, states are children of the resource. An executable contract declares the initial state, final states, events, priorities, internal and external transitions, and entry, exit, and do actions. An internal self-transition keeps the state active. An external self-transition exits and re-enters it.

#### Construction and verification

Create the State Machine and choose **Order**. Use **Add State** for states in its lifecycle. Connect transitions and name each event and outcome to show what enables the change and where it leads. To verify whether an event is accepted or rejected, define the executable contract with **Edit Executable State Machine** and use the cases in L14. **Simulate State Machine** reports the phases and final state for comparison with the expected results.

**Check.** Every state belongs to the intended lifecycle. Returning a confirmed order to waiting requires a declared event, and the negative case has a path. The current profile supports flat machines with one active state at a time. Composite states and orthogonal regions require a different execution model. For retries and delivery behavior, make the messaging policy explicit. Use live order data if you need to observe actual state changes.

### D10. Deployment – Place software and data

A Deployment diagram shows which nodes host applications, data, and artifacts. Give each part of the system a planned location, then identify the environment that runs or stores it.

#### When to use it

Use Deployment to discuss placement, such as separating the web application and API, locating persistence, setting environment boundaries, or distributing artifacts. Use C4 Container to describe application responsibilities and Deployment to locate them on hosts.

Open **10 Proposed Local Deployment**. **Web Host** hosts **Web bundle**. **API Host** hosts **API ESM** and **Marketplace API**. **Data Host** hosts **Marketplace Store**. The title identifies the example as a designed local deployment.

![Deployment diagram showing host nodes and the parts they host](images/atlas-10.png)

#### Elements and properties

| Element | Meaning and details |
| --- | --- |
| Deployment Node | Declared machine, process, environment, or execution node. Describe what it represents in the project. |
| Artifact | Deployable output, such as a bundle or ESM module. The application has its own architectural responsibility. |
| Container / application | Hosted part of the system. Reuse the architectural identity when it represents the same application. |
| Compatible store or resource | Data or persistence service assigned to the relevant node. |
| Environment and technology | Declared properties. Record a production environment or cloud service when you have a design decision or supporting evidence. |
| Hosts | Relationship from the host to what it hosts. It describes placement. |

Look in the Architecture, Data, and Infrastructure picker categories for less common types. Represent a database that persists data with the relevant service or store role. Add a separate Artifact for its deployable output when useful.

#### Construction and checks

Define the hosts, add existing artifacts and applications, and connect them with **Hosts**. Every part now has a planned environment for running or storing it. Set the environment and technology in its properties to distinguish the lab's local deployment from a production proposal. Declare architectural ownership independently of **Hosts**. Belonging to the API and running on **API Host** describe different aspects of the same part. Drag cards to adjust the layout and use model properties or relationships to update the design.

**Check.** For every application, you can point to the planned location and distinguish the node, software, and data. Label the diagram as a design or record the evidence for an observed deployment. Use your deployment tools to start services, provision infrastructure, and discover running components. See Network (D16) for protocols and communication boundaries.

### D11. Class – Describe software types, members, and relationships

A Class diagram specifies the software types that implement a design and the attributes and methods each type owns. It also shows interfaces, dependencies, and inheritance at the software level.

#### When to use it

Use Class to explain a rich domain, a particular interface, or a collaboration between a few types. Select the types that matter to the design decision.

Open **11 Classes and Repositories**. `CheckoutService` depends on `Order` and `OrderRepository`. `Order` contains `orderId`, `totalCents`, and `confirm`. The interface exposes `save`. The method's text result illustrates the design. Define typed inputs and results in the Blueprint for a complete executable contract.

![Class diagram showing types, attributes, methods, and an interface](images/atlas-11.png)

#### Elements and compartments

| Element or detail | Meaning |
| --- | --- |
| Class | Concrete or designed software type, named separately from any domain instance. |
| Interface Contract | Contract that an implementation can provide. Reuse the same object in UML Component. |
| Attribute | Data belonging to the type. Specify its name, type, presence, and nullability. |
| Method | Operation exposed by the type. Declare its name and type or signature, and select the Method role. |
| Technology and environment | Declared context for the representation. Use the project source to see the implementation. |

Use **Edit Attributes and Technology** to add or remove members. To correct a member, select it in the list and choose **Edit Member**. Choose the Attribute or Method role as appropriate. Methods can share a name when their signatures differ. Specsplice rejects duplicate signatures. In the lab, enter `confirm`, `submit`, and `save` as names. The canvas adds the parentheses.

#### Relationships

**Association** declares a structural link, and **Dependency** indicates use. **Inheritance** points from the specialized class to the general type. **Implementation** points from the implementation to the interface. **Composition** describes a strong whole-part relationship tied to lifecycle. **Aggregation** describes a weaker whole-part relationship. Choose by meaning and use multiplicities to specify how many objects can participate.

Create the two classes and the interface, add their data and operations, and use dependencies to show which types they use. Compare `Order` in this view with the entity and table. They describe separate modeling levels. Use explicit mappings when readers need to follow the correspondence, even if the names look similar.

**Check.** Each member belongs to the intended type, the relationships distinguish dependency from inheritance, and signatures are readable. Use the import and evidence workflow in L16 to compare the description with the project source and method implementations.

### D12. Use Case – Identify actor goals

A Use Case diagram shows what each actor can achieve and which system owns those capabilities. It distinguishes behaviors that are always part of a goal from additions that apply only under specific conditions.

#### When to use it

Use Use Case to agree on functional scope with users and stakeholders before designing screens. **Request Return** (request a return) expresses a user goal. Modal layout belongs in the interface design.

Open **12 Use Cases**. **Customer** can confirm a purchase and request a return, and **Support** handles returns. Purchase confirmation includes payment authorization. Applying a coupon extends confirmation only when a coupon is present. The coupon is an optional design example.

![Use Case diagram showing actors, goals, and include and extend relationships](images/atlas-12.png)

#### Elements

| Element | Use |
| --- | --- |
| Actor | Role involved in reaching the goal. One person can play several roles. |
| Use Case | Capability with an outcome for the actor. Name it with a verb and an object. |
| Software System / boundary | System that owns the use cases. Its scope distinguishes internal from external elements. |
| Association | Actor's participation in a use case. Use Activity or Sequence to show execution order. |
| Include | Points from the base use case to the behavior it always includes. |
| Extend | Points from the additional behavior to the base use case. Declare the extension condition. |

**Marketplace** owns the use cases. The actors remain external to the product boundary even when their cards are nearby. If the diagram omits the boundary card, check containment in the properties or textual reading.

#### Procedure and arrow direction

Add the two existing actors and the four use cases. Associate **Customer** with **Confirm Purchase** and **Request Return**, and associate **Support** with **Request Return**. Draw **Include** from **Confirm Purchase** to **Authorize Payment**, since authorization is required. Draw **Extend** from **Apply Coupon** to **Confirm Purchase** and use **coupon provided** as its condition. The direction identifies which behavior extends the base use case.

Specsplice centers names in ovals that resize to fit the text. After an edit, use **Diagram > Arrange** and **Fit Diagram** to arrange the view. **Include** and **Extend** show required and optional behavior. Activity and Sequence describe the order of steps. Contracts and Given/When/Then cases specify verifiable requirements.

**Check.** Every use case represents a goal with an actor or a clear functional relationship. Keep internal implementation steps in the views where they belong. Describe exceptions in the use case or a related flow.

### D13. UML Component – Describe responsibilities and contracts

Components collaborate through shared contracts. Use this view to show who provides each interface, who uses it, and where the Blueprint records the formal binding.

#### When to use it

Use this view to discuss substitutability, public contracts, and dependencies between modules. It complements C4 Component, which details the internals of one subject container.

Open **13 Components and Interfaces**. **Checkout** exposes **Checkout Contract**, and **Outcome Log** provides `OrderRepository`. This is the same interface used in the Class view.

![UML Component diagram showing implementations and shared contracts](images/atlas-13.png)

#### Elements and bindings

| Element | Role in the view |
| --- | --- |
| Component | Unit of responsibility with an interface boundary. |
| Contract | Shared contract definition, such as **Checkout Contract**. |
| Interface Contract | Interface with operations or members, such as `OrderRepository`. |
| Application / Container | Application context when it helps place components. |
| Ports and operations in the Blueprint | Required and provided interfaces and their actual bindings. Declare these alongside any relationships shown on the canvas. |

Use Specsplice's notation symbols on the canvas. In the Blueprint, complete the inputs, results, errors, effects, permissions, and criteria for the relevant operations (L11). Consumers need these details as well as the interface name.

#### Relationships and checks

**Implementation** points from the component to the contract it provides. **Dependency** shows who uses a contract or another responsibility. The **provides persistence** relationship describes the intended role of **Outcome Log**. Use implementation evidence and compatibility checks to verify the adapter, types, and policies.

Create the view and add the four existing identities. Use **Diagram > Contents > Add Existing Relationship** to include the Implementation from **Checkout** to **Checkout Contract** and the Communication from Checkout to **Outcome Log**, preserving their definitions. Then create the Implementation from **Outcome Log** to `OrderRepository`. To check consumer and provider compatibility, declare each required and provided interface in the Blueprint and specify how their operations and types correspond. Check diagnostics before review for missing or incompatible declarations.

**Check.** The contract belongs to the intended provider, providers and consumers are identifiable, and the Interface Contract is separate from the **Checkout Page** screen. If you change a shared signature, open **Show Change Impact** and check which consumers must adapt. Run the generation readiness checks separately from saving the diagram.

### D14. Package – Organize modules and dependency direction

A Package diagram groups software into modules or layers and shows the direction of dependencies. Use it to check what each group relies on and to spot dependency cycles.

#### When to use it

Use Package to discuss layers, organizational boundaries, and dependency direction. You can use it to organize a single application, with all its packages deployed together.

Open **14 Application Modules**. **Application** uses rules from **Domain**. **Adapter** implements domain contracts and connects to application use cases. The lab places domain rules at the center and has the adapters depend on them.

![Package diagram showing three logical groups and their declared dependencies](images/atlas-14.png)

#### Elements and boundaries

| Element or detail | Meaning |
| --- | --- |
| Package | Logical, non-deployable module, namespace, or layer. Name the grouping you use. |
| Description | Responsibility, scope, and criteria for grouping the contents. |
| Containment | Declared organizational relationship with other elements. Set this in the model. |
| Dependency | Use of another group. It points from the dependent group to the group it uses. |

The picker for this notation offers **Package**. Use it for logical groups so their types carry the intended meaning. Connect **Domain** to a source folder such as `domain` through an explicit mapping or relevant evidence.

#### Construction and reading

Create three packages with **Add Element**. Connect **Application** to **Domain** with **uses rules** (uses rules), **Adapter** to **Domain** with **implements contracts** (implements contracts), and **Adapter** to **Application** with **connects external systems** (connects external systems). This direction keeps external details dependent on the store's rules and the domain independent of a particular adapter. Name each arrow for the reason the dependency exists. If a dependency runs in both directions, check whether there is a cycle or whether a group covers too much.

An architectural decision record can state a rule about dependencies. Use compiler or project checks to enforce it and source analysis to find a cycle in the implementation. A cycle in the diagram shows what the model declares.

**Check.** You can explain what belongs in a package and what belongs in a service. Every dependency has a reason and the core is identifiable. Use Class for internal types, UML Component for contracts, and C4 Container for deployable applications.

### D15. Data Flow – Trace data, transformations, and stores

A Data Flow diagram follows information from its inputs through transformations to its destination. Name what each arrow carries and use Sequence or Activity to describe the order of actions.

#### When to use it

Use Data Flow to trace sensitive data, order records, price sources, or process results. It helps when a call diagram shows many interactions and readers need to know what information passes through the system.

Open **15 Checkout Data**. **Customer** provides **checkout data**. **Process Order** reads prices and availability from **Catalog Data**, writes the confirmed order to **Order Data**, and returns the outcome to **Customer**. The arrows between the customer and the process carry different data and point in different directions.

![Data Flow diagram showing inputs, a transformation, stores, and the result](images/atlas-15.png)

#### Elements

| Element | Meaning |
| --- | --- |
| Actor / Software System | External source or destination of data in the selected perspective. |
| Process | Transformation with inputs and outputs, such as **Process Order**. |
| Data Store | Logical store that the system reads or writes. Physical tables can be specified separately. |
| Resource | Compatible domain object that helps clarify the data shown. |
| Data Flow | Named transfer from a source to a destination. |

Name the data on the arrows, such as **checkout data** (purchase data), **prices and availability** (prices and availability), or **confirmed order** (confirmed order). The process name should explain what transformation it performs.

#### Construction and checks

Add the existing **Customer** along with the process and two stores. Connect the input and result first to show what **Process Order** transforms. Then add the catalog read and order write to show where data comes from and where it goes. You can create the relationships in a different order. To detail **Process Order**, create a second view with smaller transformations and keep the same inputs and outputs recognizable so readers can compare the two views.

Use Sequence or Activity for temporal order and operational evidence to confirm that a real connection took place. Declare payload types, presence, and constraints in the contracts.

**Check.** Each process has meaningful inputs and outputs, catalog data is distinct from order data, and labels identify the data being transferred. See Database Schema for tables and foreign keys, or Network for network protocols.

### D16. Network / Infrastructure – Show connections and boundaries

A Network diagram shows which nodes and applications can communicate across boundaries and which protocols they use. Record the provenance of each connection and use Deployment for the software's placement.

#### When to use it

Use this view to discuss intended reachability, service exposure, and infrastructure separation. Identify which details come from observed configuration and which are design decisions.

Open **16 Proposed Connections**. **Client Network** reaches **Web shop** and the **Backend Network** boundary. The back end exposes **Marketplace API**, which communicates with **Marketplace Store**. HTTPS on port 443 and SQL are declarations in the example's planned topology.

![Network diagram showing nodes, applications, and declared protocols](images/atlas-16.png)

#### Elements and details

| Element | Use |
| --- | --- |
| Network Node | Network node or boundary, such as **Backend Network**. Describe whether it is a zone, network, or conceptual endpoint. |
| Deployment Node | Host or other execution node when the connection requires that level of detail. |
| Application / Container | Service, client, or store that communicates. Reuse identities from other views. |
| Software System | Internal or external system involved in the connection. |
| Protocol and environment | Declared means and context of communication. Include the version or port if known. |
| Communication | Directional relationship with an intent and protocol. Enforce firewall rules in the relevant infrastructure. |

Add a cloud node, CDN, VPC, or remote database when the design or evidence calls for it. Leave unknown details open. A network boundary shows where communication passes, and a container shows which application participates.

#### Procedure and checks

Create the two **Network Node** elements to identify network boundaries and add the existing **Web shop**, **Marketplace API**, and **Marketplace Store**. Connect the endpoints with **Communication** and enter the protocols through **Edit Cardinalities and Protocol** so readers can identify which parts communicate and by what means. Mark the topology as planned in its description. If you import an existing configuration, retain the evidence and observed scope so readers can distinguish recorded facts from decisions still to implement.

**Check.** Each relationship identifies which parts communicate and how. Unknown ports remain open, and evidence supports any security or availability claims. See Deployment for artifact placement and C4 for product responsibilities. Provisioning, discovery, security testing, and deployment are separate operations.

## Practical reference

Use these sections to set up your environment, inspect source files, run a check, or recover from an error. The IDE tools help you check things that a diagram alone cannot establish. Set them up as you need them.

### A1. Install and start Specsplice

Follow this section before T1 if you need to build and start Specsplice. You can set up an AI account or configure workspace trust later, when an exercise calls for it.

If the desktop app is already running, go to T1. To try the published preview, choose the archive for your platform and follow its first-launch instructions. To start a current build from source, install Git, Python 3, native build tools, and the Node version pinned in `.nvmrc`. This edition uses **24.22.1**. The Bun executable profile requires Bun. [Desktop preview releases](https://github.com/FrappaF/Specsplice/releases)

#### macOS and Linux

Build the Specsplice revision that contains the lab updates and AI workflows covered by this guide. Use the clone for Specsplice itself and separate copies of the Marketplace and Order Shop projects. Close the development instance before updating dependencies or rebuilding. With `nvm` installed, run `nvm install` to install the Node version in `.nvmrc` and `nvm use` to select it in your shell.

```sh
git clone https://github.com/FrappaF/Specsplice.git
cd Specsplice
nvm install
nvm use
npm run ordito:setup
./ordito/scripts/dev.sh
```

`ordito:setup` prepares dependencies, the client, local engines, extensions, and Electron. The first launch needs a network connection to download artifacts. For subsequent launches, run `nvm use` and `./ordito/scripts/dev.sh`. You can pass a project folder path to the launch command.

Install the build tools and desktop libraries before setup so Specsplice can build its native dependencies. On macOS, check your tools with `xcode-select -p`, `xcrun --find clang`, and `python3 --version`. If the Command Line Tools are missing, run `xcode-select --install` and complete the installation. Debian and Ubuntu require `build-essential`, `pkg-config`, `libx11-dev`, `libxkbfile-dev`, `libkrb5-dev`, `libsecret-1-dev`, `libgtk-3-dev`, `libgbm-dev`, `libnss3`, `libasound2-dev`, and `xvfb`. Headless tests also require `xauth`. Package names can vary by distribution. The online development guide also covers the Windows prerequisites and launching with `scripts\code.bat`. [Development guide](https://github.com/FrappaF/Specsplice/blob/main/ordito/docs/fork-development.md#from-a-clean-clone)

When you update the clone to a newer revision, select its pinned Node version and run `npm run ordito:setup` again to rebuild changed sources. Check the revision listed at the start of this guide when comparing its instructions with a newer interface. Type checks and repository test suites are for developing Specsplice itself. You can use the example projects after setup.

#### Accounts and workspace trust

You can draw, save, import source files, simulate cases, and run deterministic profiles without an AI account. Set up the provider required by the action when you want to use chat, interpret an architecture with AI, or prepare an assisted implementation. L17 explains how the connection, model, and budget settings work.

Workspace trust enables actions that can execute code from a folder, such as CLI calls and tests. Use **Manage Workspace Trust** in the Command Palette to check the setting before running those actions. Review each example after extraction before trusting its folder. Imported projects can contain their own executable commands.

### A2. Files, workspaces, editing, and the terminal

Open the IDE tools when you need to connect a model rule to its source file or run code, as in L16 and L20. Use Explorer, the editor, and the terminal for that work, then return to the diagrams to continue modeling.

Open the project menu and choose **Show IDE**, or open **Project Settings > Developer Tools** for **Files**, **Terminal**, **Debug**, and **Git**. **Files** opens the workspace. **Terminal** opens a session at the workspace root. Check the working directory of any active session before running a command. Terminal sessions retain their working directories as you switch projects.

#### Files and workspaces

Use Explorer to organize the source files and materials in your working copy. Use the context menu to create, rename, copy, move, or delete files and folders. Copy a path or reveal the file in your operating system to find the same document outside the IDE. Use Timeline and local history to compare earlier versions. Open a saved workspace to restore its set of folders. Add workspace roots or split the editor to compare multiple files side by side.

Use **Save As** to store a variant in another file and **Save All** to write changes across multiple documents. Configure **Auto Save** to save edits automatically. Match the encoding and line endings to the project's file requirements. Changing them alters the file contents. Use local history to recover individual files and a shared repository to retain versions for the team.

#### Search and edit

Search within the current file to find a passage, search the workspace to find occurrences across files, or go to a symbol's definition to see where it is declared. Use Quick Open when you know the file name.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Open the Command Palette | Cmd+Shift+P or F1 | Ctrl+Shift+P or F1 |
| Save | Cmd+S | Ctrl+S |
| Open a file by name | Cmd+P | Ctrl+P |
| Search the current file | Cmd+F | Ctrl+F |
| Search the workspace | Cmd+Shift+F | Ctrl+Shift+F |
| Undo | Cmd+Z | Ctrl+Z |
| Go to a symbol's definition | F12, if supported by the provider | F12, if supported by the provider |
| Rename a symbol | F2, if supported | F2, if supported |

View and customize bindings in **Keyboard Shortcuts**. When the language supports it, use semantic rename to update the references it recognizes. Text replacement can affect unrelated words, so review the preview and limit the paths involved.

Use multiple cursors, occurrence or column selection, and line editing to apply the same edit in several places. Snippets, comments, and indentation help you write. Folding and word wrap help you read dense files. Use Outline and breadcrumbs to find your place, then follow definitions and references across the source. Completions, refactoring, quick fixes, and formatting depend on the available provider.

JavaScript and TypeScript use the TypeScript language service. HTML, CSS, and JSON have their own web language services. Syntax highlighting and the tools for compiling or debugging are installed separately. This also applies to Python, Java, C/C++, Go, and other recognized languages.

#### Terminal and tasks

In the Marketplace code module, run `npm test` to check the expected behavior and `npm start` to see what the demo returns. L16 explains each command. First check that you are in the `code` folder. Use separate or split terminals for concurrent tasks, rename the sessions, and choose the appropriate shell profile. Search terminal output to review what happened and stop a process when needed. Shell integration, when available, shows commands and their status.

Use a task to run a build or test sequence that the project already defines. Choose **Tasks: Run Task** from the Command Palette to start a recognized script or task. Tasks can have dependencies, run in the background, and report errors through problem matchers. Start tasks explicitly when you intend to execute them. Standard Specsplice imports perform source analysis.

### A3. Git, debugging, and code tests

Use Git to record and share a version, the debugger to investigate an unexpected result, and tests to compare behavior with expected outcomes. These tools complement Specsplice reviews and simulations. Record their results in the L21 handoff.

#### Git

Open **Source Control** and inspect the diff to see what would go into your commit. Stage files or selected hunks that belong to the same change. Write a commit message that describes the change. **Push** publishes commits to the remote when you have an account with permission. Use **Pull** and Git Sync to exchange commits with the remote. Use Specsplice Sync for reconciling the model with the code.

Create or switch branches to separate an experiment from shared work. Use stash to set aside uncommitted changes temporarily. Use history, tags, worktrees, and revision comparisons to locate and compare a starting point. Read the diff before discarding files, restoring a revision, or resolving a conflict so you know which changes you will keep. Git history retains commits. Specsplice Undo follows the reviewed application of changes and its recovery checks.

Full pull request workflows require a provider or additional extensions.

#### Debug code

Open **Run and Debug**. For the JavaScript project, choose a Node configuration or a JavaScript Debug Terminal if available. Set a breakpoint in `calculateTotal`, start `src/demo.mjs`, and use step and continue to inspect `quantity` and `total` as the calculation runs.

The debug adapter determines which breakpoint types are available, including conditional breakpoints and logpoints. The code debugger provides the call stack, variables, watches, and console. Use Specsplice's simulations to inspect supported diagram behavior. The IDE debugger works against the running code.

#### Code tests and Specsplice verification

Use **Testing** to find and run test cases, then open the source and output for a failure. Test discovery and execution require a provider, as do stack traces and coverage. For the Node example, you can also run `npm test` in the terminal.

Project tests check code behavior. An Specsplice independent case supplies an expected result authored separately from the generator. A messaging simulation exercises local deliveries and policies. Profile verification checks a proposal against its defined cases. Choose the check that answers your question. Use a messaging case to check a declared delivery and the module's tests to check the L16 total. Record the checks you ran and any cases you left untested.

### A4. Documents, browser, customization, and integrations

Use these tools when your work calls for documents, a web interface, or an integration. The guide's visual exercises can be completed with the modeling tools and the example projects.

#### Documents and content

Open a Markdown file and use **Markdown: Open Preview** or the side-by-side preview to compare the source with the rendered headings, links, and images. Mermaid diagrams and formulas are available in supported contexts. Use Mermaid to illustrate documentation and the Specsplice model to maintain project identities.

Use notebooks to keep text, code, and results in cells within one document. To run the cells, install a suitable kernel. IPYNB and renderer support lets you view notebooks. Images, audio, video, webviews, and custom editors depend on the available formats and extensions.

#### Browser

Use the browser to try a project's web interface or read online documentation. The integrated browser can open URLs, navigate, search, change zoom, and provide developer and emulation tools for inspecting the result. Actions for sharing a tab, screenshot, or element with an agent depend on the active integration. You can open the result in an external browser when the action is available.

#### Customization and extensions

Use **Preferences: Open Settings (UI)** to open the settings editor, **Color Theme** to change the presentation, and **Keyboard Shortcuts** to configure keys. Choose user settings for your general preferences, workspace or folder settings for one project, and language settings for particular file types. Use separate profiles to keep sets of settings and extensions for different activities.

Open **Extensions** when you need a specific capability such as a debugger or kernel. The view lists built-in and installed extensions and lets you install from VSIX files or manage which extensions are enabled. The available galleries, debuggers, kernels, and online services depend on the distribution. Check the distribution's gallery configuration if you need a particular extension.

Use **Problems**, **Output**, and service logs to track down an issue. Identify whether it came from the model, a parser, the compiler, or an extension.

#### Chat and MCP

Use general chat for requests that span multiple parts of the project and inline chat to work on the open source. Attach files and selections to give the assistant relevant context. The available provider determines the model and modes. Review proposed edits against your intent before accepting or rejecting them. The diagram workflow has its own temporary conversation.

MCP, the Model Context Protocol, connects external tools and data to integrations that support it. Configure a server when its capabilities are relevant to your work. Use the MCP commands to add it, choose user or workspace configuration, inspect status and output, and manage trust and tools. Check which capabilities the configured integration exposes. Some upstream services require additional configuration in Specsplice.

### A5. Accessibility and keyboard navigation

Use the keyboard and textual views to reach objects and read their meaning independently of the canvas layout. Read relationships, conditions, and contracts to check that the model reflects your intent. Adjust themes and workbench settings to suit your needs.

On the canvas, press Tab to focus an element and Enter to select it and inspect its properties. In editable diagrams with a free layout, the arrow keys move the focused node and Shift increases the step. Sequence diagrams follow a declared order. Edit participants and messages from their properties, as in L7. When the canvas background has focus, the arrow keys pan the view. **Shift+F10** opens the context menu for the focused object.

Use **Diagram > Read** and **Accessible View** to inspect elements, relationships, conditions, and contracts without relying on color or layout. If a review is active, the reader presents that review. Contextual help lists the current shortcuts. On macOS, the default shortcuts include Option+F1 for help and Option+F2 for reading.

Press Escape to close the reader and return to your previous context. If you prefer fewer hints, search for Specsplice verbosity in the Settings UI. Light, dark, and high-contrast themes and reduced motion preferences let you adjust the presentation.

Keyboard navigation and automated checks cover the implemented interactions. VoiceOver and NVDA coverage varies by platform. If a control fails to announce its name or state, include the object, action, operating system, and assistive technology in your report.

### A6. Troubleshooting and recovery

When a step gives an unexpected result, use the symptom to identify which prerequisite or setting to check. Begin there before creating more objects, changing expectations, or applying a proposal again. This helps you recover the workflow while keeping the work you already verified.

| Symptom | What to check |
| --- | --- |
| I cannot see my project | In **Open Project**, select the folder containing your copy of the example to load its model. Use the Specsplice clone to build the application and individual source files to inspect code. |
| The canvas looks empty | Use **Fit Diagram** to bring off-screen elements into view, then use **System Map** to search across the whole system. Check for the element before creating another. See A9. |
| I want to use an existing element | **Add Existing Element** reuses the model identity. **Add Element** creates a new definition. |
| I removed a node and can still find it | The node was removed from the view. Consult **Details** or **Impact** to see which other references deleting it from the system would affect. |
| I cannot see the files or terminal | In the project menu choose **Show IDE**, or use **Project Settings > Developer Tools** to read sources or run commands. Return to the canvas when you want to continue modeling. |
| A command is missing | Select the relevant object and notation. Commands depend on the current context, document type, and prerequisites. |
| **Apply to Model** is disabled in **Structural Blueprint** | Open **Review** to find incomplete configuration. If a field requires an object that does not exist, create it before completing the draft. |
| I filled in **Structural Blueprint** and the model is still unchanged | Choose **Apply to Model** to apply the draft, then **Save** to persist the model. |
| A numeric case rejects text | Enter an integer for a standard input. Use **Different Value Type** to test a deliberately invalid type in a negative case. |
| I cannot save a condition | Complete the comparison or logical expression with compatible types so the predicate returns a Boolean result for the condition. |
| I can save the model but cannot generate code | Resolve readiness diagnostics for types, ownership, criteria, bindings, and runtime. They identify the information the selected profile needs. |
| **Apply** is unavailable | Check the current state for an incomplete or stale review, open questions, or verification that is missing or failed. |
| I changed a criterion after running tests | Prepare and verify a fresh review. The previous result applies to the previous rule. |
| The tests were canceled | Run verification again and wait for a completed result. |
| A file blocks **Undo** | Compare the file and preserve subsequent manual edits. Restore the file only if you intend to undo those changes. |
| Import stops at the inventory | **Ready to explore** indicates you can inspect code evidence. To prepare views, choose **Explore Architecture** as in L17. |
| Diagram generation stopped | Open **Activity Details**, find the pending step, and use **Continue Generation** to resume from the checkpoint. |
| Code verification fails | In **AI Code Review**, read **Verification Output** and the feature diff. Use **Repair Failing Features** if available, then verify again before applying. |
| Source evidence is stale | Refresh the analysis to use current sources. The old location may now point to different code. |
| My account is connected and requests still fail | Check the executable, exact model, quota, and provider configuration individually. Each has its own requirements. |
| I ran out of budget | Increase the budget for the specific operation. Structured AI and exploration have separate budgets. |
| I closed chat and cannot see the conversation history | The dialog is temporary. Resume from the persisted plan or drafts to recover completed work, or start a new conversation. |
| **Sync** is unavailable | Check the model format and adapter. Specsplice uses them to recognize supported mappings between model and code. The legacy workflow requires a compatible model and adapter in addition to any v5 exploration. |
| Bun is missing | Install the version required by the profile and make it available at startup. Specsplice runs verification with the selected runtime. |
| I cannot see tests or a debugger | Check for the provider or extension that supplies those actions. For the Node example, run `npm test` in the terminal. |
| I cannot save | Read the error and check the destination, permissions, conflicts, and document state. If appropriate, save a copy to keep your work while you resolve the problem. |

When reporting an issue, include steps to reproduce it, the expected and observed results, the Specsplice version, the operating system, the diagram involved, and a relevant screenshot. A small synthetic project helps isolate the problem. Use **Output** or the log commands in the Command Palette to include the message from the service that failed.

### A7. Capabilities, prerequisites, and guide coverage

Use the first table to identify what a workflow can establish before choosing a more advanced exercise or marking work complete. The second table points to the lesson and its prerequisites.

| Capability | What you can do | Scope |
| --- | --- | --- |
| Modeling | Edit models and work in 16 diagram notations. | Each notation supports a defined subset of its standard. |
| Import | Inventory and analyze source files with supported profiles. | Coverage depends on the language profile. Import inspects sources without executing the application. |
| AI-assisted diagrams | Explore, plan, draft, correct, and review diagrams. | Drafts are based on available source evidence. Confirm runtime calls or deployed infrastructure with separate evidence. |
| Model and code chat | Ask for contextual implementation and tests. | Assistant edits are subject to the integration's capabilities. Deterministic journaling and undo apply where the workflow supports them. |
| Worktree | Review changes separately and run Node tests in the supported workflow. | A worktree separates files and revisions. Operating system isolation requires separate sandboxing. |
| Executable profiles | Formalize predicates, interactions, flat state machines, and messaging. | Execution is limited to the profile's defined constructs. Frameworks, arbitrary bodies, and distributed transactions require separate implementations. |
| Simulation | Exercise declared data, events, and responses. | The simulation uses local inputs. Monitor running services and brokers separately. |
| Reverse and Sync | Review transformations within supported subsets. | Supported mappings bound what Specsplice can recover from changes to the source. |
| Data and runtime | Represent mappings and schemas and create a Node or Bun plan. | Live database migrations and services remain separate operations. |
| Apply | Write reviewed changes locally. | Commit, push, and deployment are separate actions. |

The examples let you practice modeling and use local profiles without adding services. AI configuration, SDKs, external executables, kernels, and debuggers depend on what is installed in your environment.

Use the next table to find the lesson for your task and check what needs to be available. Detailed IDE commands depend on their respective providers. The examples exercise specific combinations of platform, extension, and service.

| Topic | Where to learn it | Availability or prerequisites |
| --- | --- | --- |
| Projects, saving, recovery, identity, navigation, and the map | T1–T5, L2, A6 | Local |
| Elements, relationships, properties, layout, and 16 notations | L2–L10, D0–D16 | Local, with support for the selected view |
| Contracts, types, ownership, ports, mappings, ADRs, and impact | L4–L5, L11 | Valid blueprint plus the readiness information required by the target |
| Predicates, typed inputs, cases, review, publication, and undo | L12 | Local profile and available runtime |
| Descriptive scenarios, views, and executable interactions | L7, L13, D7–D8 | Descriptive data or an explicit executable contract |
| State machines and messaging | L14–L15, D9 | Local simulations, with no broker required |
| Import, scope, evidence, indexes, and versions | L16 | Accessible sources and relevant semantic services |
| AI account, diagram generation, and benchmarks | L17 | In-scope sources, a configured account and model, and an explicit budget |
| First AI-assisted code generation | L18 | Diagrams, independent cases, Node 24.22.1, and a configured model |
| Code updates, worktrees, Sync, and reconciliation | L18–L19 | Relevant root and profile, plus Git, a baseline, and a provider as required by the workflow |
| Reverse, runtime migration, tasks, and continuity | L20 | Supported profile subset and available runtime |
| Files, editing, languages, terminal, and tasks | A2 | Language services and local tools |
| Git, debugging, testing, and coverage | A3 | Git and a remote, a debugger, or a test provider, depending on the action |
| Notebooks, documents, media, and browser | A4 | Relevant format, kernel, or extension |
| Customization, extensions, trust, chat, and MCP | A1, A4 | Account, SDK, and extensions where required |
| Accessibility and presentation | A5 | Keyboard navigation, textual views, and workbench settings |

The screenshots cover the 16 notations used in the solution's 18 views and show the relevant controls. Each assisted workflow lists its prerequisites. Draft names and counts can vary with the evidence retrieved and the model's proposal.

### A8. Glossary and references

Use this glossary to describe what you have designed, reviewed, applied, or verified. A precise description makes it easier to share your results or ask for clarification.

| Term | Meaning |
| --- | --- |
| Model | Shared definitions of elements, relationships, types, and behaviors |
| View or diagram | A perspective on the model with its own notation and layout |
| Identity | Stable reference independent of name and position |
| Feature | System capability or functional area |
| Blueprint | Shared architectural and contractual foundation |
| Ownership | Explicit responsibility of a system, container, component, or lifecycle |
| Contract | Inputs, results, errors, effects, permissions, and applicable criteria |
| Predicate | Pure typed condition with a Boolean result or an allowed indeterminate result |
| Acceptance criterion | Declared business rule, often in Given/When/Then form |
| Independent case | Input and expected result written separately from the generator |
| Evidence | Versioned link to a fact or source range |
| Scenario | Occurrences, conditions, and declared order for a behavior |
| Draft | Proposal awaiting application to the published model |
| Review | Content and differences to inspect before applying changes |
| Baseline | Shared state used to compare model and code |
| Worktree | Separate Git working directory for a code revision |
| Readiness | Completeness and compatibility for a selected target or profile |
| Apply | Local application of reviewed changes |
| Reverse | Bounded reconstruction of supported changes from source |
| Recovery | Controlled resumption of an interrupted operation |
| ADR | Architecture decision record with rationale, status, and history |

This edition covers the **Structural Blueprint** editor, relationship reuse with **Add Existing Relationship**, and the layered **System Map**. The screenshots show where to find the controls. T2 gives the expected results for the four perspectives on a purchase.

The examples are synthetic and come from the Specsplice repository's demo models and the Order Shop lab. They are distributed under the project's MIT license. The package contains example data only, with no accounts, credentials, AI histories, or personal Git repositories.

The following references describe the notations. Consult the forms and scope documented in this guide for the constructs Specsplice supports. [C4 System Context](https://c4model.com/diagrams/system-context) · [C4 Container](https://c4model.com/diagrams/container) · [C4 Component](https://c4model.com/diagrams/component) · [OMG UML 2.5.1 specification](https://www.omg.org/spec/UML/2.5.1)

### A9. System Map layers and cumulative filters

Use System Map to find which elements participate in an activity such as a customer's purchase. Apply filters to narrow the context, then open each level to see its details. You can open a model identity or a view from there.

System Map follows the groups declared in the model and includes elements with no diagram representation.

#### Open the map

Open the same map from the sidebar as you navigate the project, from the button above a diagram, or directly from the Command Palette.

- In the Specsplice sidebar, **Home**, **System Map**, and **Search System** appear in a vertical list at the top. The map remains available when the project is collapsed. Use **New > Structural Blueprint** for structural editing.
- Above a diagram, choose **System Map** next to **Diagrams**.
- In the Command Palette, run **Specsplice: Show System Map**. Open the palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows and Linux.

![System Map with the Customer filter visible in the filter bar](images/17-system-map-overview.png)

#### Read the map

Read the groups to identify who uses the system, which capability you are looking at, and which responsibilities span multiple capabilities. **Actors** appear on the left. The center column shows **Areas**, then the **Features** in the open area, then the **Internal Elements** of the open feature. **Shared Elements** on the right lists elements shared across features or unassigned to any single feature.

Use **Features Without a Declared Area** if the model has no declared areas. The Order Shop example uses this group to keep its features accessible.

| Control | Effect |
| --- | --- |
| Card body | Adds a filter and keeps the current level open. |
| Arrow on the right of the card | Opens the next level down and keeps the filters active. |
| × next to a filter | Removes that single filter. |
| Breadcrumb above the map | Moves up a level and keeps the filters active. |

#### Try filtering by customer and purchase

Select an actor and a feature to isolate what the customer needs to make a purchase. Open the feature details while preserving the context. Add an area filter as well so you can practice removing that filter independently.

1. Open **Order Shop** and choose **System Map**. Select the body of the **Customer** card to focus on capabilities connected to that actor. **Customer** appears in the active filter bar.
2. Select the body of the **Features Without a Declared Area** card. Both the **Customer** and area filters are now active at the top level.
3. Select the arrow on the group card to open it. Select the body of **Confirm Purchase** to focus on purchases in the customer's context.
4. Select the arrow on **Confirm Purchase** to inspect the feature's internal and shared responsibilities. The customer, area, and feature filters stay in the filter bar.
5. Remove the area filter with its **×**. The **Customer** and **Confirm Purchase** filters remain active. Selecting an already filtered card keeps that filter active.

![Three active filters for the customer, area, and feature, with internal elements visible](images/18-system-map-filters.png)

Filters are cumulative. Each criterion narrows the context shared by the active filters. An actor filter retains the internal and shared content of the features linked to that actor. An incompatible combination shows an empty state with all filters still visible. Use a filter's **×** to broaden the results.

#### Search, relationships, and large systems

When you know an object's name, search for it across the whole system, including items on other pages. Select a search result to add a filter and use its arrow, when available, to open the corresponding level. Use **Inspect …** to read the identity's details or use the diagram buttons to see it from another perspective.

Lines summarize declared relationships between the displayed objects. With an actor filter applied, a solid line marks a direct relationship and a dashed line marks a relationship in the feature context. To examine a specific dependency, open **Relationships** to see the original source, target, conditions, and errors. The summary line represents existing relationships.

![Relationships view showing source and target as model identities](images/19-system-map-relationships.png)

Each list has its own pages and counts. Switching the page, level, or tab, or returning from a diagram, preserves filters for the editor session. In a narrow window, the columns stack vertically and the counts and relationship details remain available.

**A9 check.** Add filters for the customer, area, and feature, then open the internal elements using the arrows. Remove one filter with **×** and verify that the other filters stay active.
