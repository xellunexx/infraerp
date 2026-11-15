# Build: IN-HOUSE CONSTRUCTION OPERATIONS & PROJECT SYNCHRONIZATION PLATFORM

## 1. Product vision

Build a fully functional, internal business operations application for a construction and installation company.

This is NOT a generic CRM, task manager, Kanban board or project-management template.

It is an interconnected operational platform that manages the complete lifecycle of a construction project, from the first customer inquiry and commercial offer through contract formation, technical preparation, procurement, logistics, execution, financial tracking and final completion.

The platform must function as a single source of truth for the entire organization.

**Core principle: ENTER INFORMATION ONCE. SYNCHRONIZE EVERYWHERE.**

Every department must have its own dedicated workspace, permissions and responsibilities, while sharing the same underlying project data.

A change made by one department must automatically update all dependent departments and trigger appropriate notifications or approval requests.

The application should be designed for actual daily business use by employees, not merely for demonstration.

---

## 2. Core architecture

The central component of the entire system is:

### КАРТОН НА ОБЕКТА (КО) — PROJECT MASTER RECORD

Every confirmed project must have one unique Project ID and one continuously updated master record.

The Project Card is the central information hub connecting all operational modules.

It must aggregate:

- Original commercial offer and its revisions.
- Contract and all contractual appendices.
- Contractual quantities and prices (КС).
- Technical specifications.
- Project drawings and explanatory documentation.
- Customer questionnaire.
- Products, materials and quantities.
- Material recipes and consumption norms.
- Required machinery, equipment and tools.
- Linear execution schedule.
- Delivery schedule and deadlines.
- Site access and logistical restrictions.
- Warehouse allocations and material availability.
- Transport and courier information.
- Daily execution progress.
- Photographic documentation.
- Accommodation and parking arrangements.
- Project revenues, costs, payments and financial results.
- Contract amendments and changes.
- Internal communications and decisions.
- Outstanding tasks, warnings and approvals.

All information must be traceable to its originating module.

Do not create isolated copies of the same information in different departments.

---

## 3. Operational modules

Build the following interconnected modules.

### A. ОФЕРТИ — COMMERCIAL OFFERS

Responsible for the commercial preparation and submission of offers.

Functions:

1. Create and manage customer inquiries.
2. Maintain customer information:
   - Company/person name.
   - Contact person.
   - Telephone.
   - Email.
   - Address.
3. Create commercial offers.
4. Manage offer revisions and versions.
5. Maintain product codes, quantities, pricing and technical descriptions.
6. Extract products, quantities and recipes from the offer.
7. Define the logic of individual СМР operations (construction and installation activities).
8. Calculate material requirements and associated costs.
9. Establish the proposed execution logic and preliminary linear schedule.
10. Complete the customer questionnaire.
11. Communicate with customers regarding readiness to commence СМР.

**Critical workflow:**

When an offer is confirmed by the customer:

- Convert the confirmed offer into a contract workflow.
- Preserve the original offer and its version.
- Generate the contractual document and required appendices.
- Transfer all relevant quantities, products, prices, recipes and technical information into the Project Card.
- Notify Contracts, Technical and Management.

The confirmed offer must become the commercial baseline of the project.

### B. ДОГОВОРИ — CONTRACTS

Responsible for formalizing the confirmed offer and maintaining contractual obligations.

Functions:

1. Receive confirmed offers from Commercial.
2. Generate a standard contract unless special conditions have been specified by Management or Commercial.
3. Generate the required appendices:
   - Приложение №1.
   - Приложение №2.
   - Приложение №3.
4. Create the Project Card.
5. Complete customer and logistical questionnaires.
6. Enter contractual delivery and installation deadlines.
7. Define payment deadlines and urgency levels.
8. Identify nearby courier offices and their capabilities, including pallet delivery.
9. Extract products and materials from the offer for procurement planning.
10. Create material and product requests.
11. Communicate with customers concerning contracts, appendices, payments and logistics.
12. Coordinate with Warehouse.
13. Maintain amendments, annexes and force majeure events.

**Critical synchronization rule:**

Any contractual modification must be recorded in the Project Card.

If a modification affects quantities, prices, delivery dates, installation dates or the execution schedule, all affected modules must receive updated information and notifications.

Never silently overwrite an approved contractual version.

Maintain a complete revision history.

### C. ТЕХНИК — TECHNICAL & SITE OPERATIONS

Responsible for preparing, coordinating and monitoring the physical execution of the project.

Functions:

1. Receive the Project Card after creation.
2. Review the project jointly with the Brigadier.
3. Analyze technical requirements and identify inconsistencies.
4. Communicate with Commercial and Management regarding new or modified СМР activities.
5. Validate project execution logic.
6. Request materials, machinery, equipment and tools.
7. Coordinate with Warehouse.
8. Request consumables.
9. Update the Project Card with technical corrections.
10. Visit the construction site.
11. Upload site photographs.
12. Create and maintain paving/flooring layouts (растер на настилките).
13. Modify the linear execution schedule.
14. Record daily execution progress.
15. Coordinate material deliveries and site readiness.
16. Plan machinery and vehicle allocation.
17. Coordinate with Logistics and Warehouse regarding surplus materials, tools and machinery that must return to storage or be transferred to another project.
18. Coordinate with customers concerning access, unloading, storage and delivery arrangements.

**Material consumption intelligence:**

The system should automatically calculate expected material consumption based on:

- Completed quantities of СМР.
- Approved material recipes.
- Established consumption norms.
- Material specifications.
- Project-specific technical adjustments.

Actual warehouse consumption and theoretical consumption must be distinguishable.

Generate alerts when actual consumption exceeds expected consumption or when material requirements are inconsistent with recorded progress.

### D. СЧЕТОВОДСТВО — ACCOUNTING & FINANCIAL CONTROL

Responsible for the financial administration of every project.

Functions:

1. Issue proforma invoices based on information received from Contracts.
2. Arrange worker accommodation.
3. Determine accommodation payment methods.
4. Communicate with workers regarding accommodation and parking.
5. Record all project income and expenditure.
6. Maintain financial indicators in the Project Card.
7. Receive project cost information from Commercial.
8. Record project cost price and financial commitments.
9. Submit payment requests to Management.

**Critical financial synchronization:**

The Project Card must display:

- Contract value.
- Approved offer value.
- Cost price.
- Planned expenses.
- Actual expenses.
- Payments made.
- Payments received.
- Outstanding receivables.
- Outstanding payables.
- Remaining project budget.
- Financial result.

When Technical records completed work, the system must synchronize the corresponding completed quantities with Accounting.

Accounting must be able to reconcile the completed work against the corresponding costs and payments.

Already recorded expenses and payments must not be counted twice.

Keep financial transactions separate from calculated progress-based cost allocations. Any automatic posting must be traceable and subject to the appropriate approval rules.

### E. СКЛАД — WAREHOUSE

Build a dedicated warehouse module integrated with Technical, Contracts and Logistics.

Functions:

- Maintain material and product inventory.
- Maintain machinery, equipment and tools inventory.
- Record incoming and outgoing materials.
- Reserve stock for specific projects.
- Receive requests from Technical and Contracts.
- Confirm availability.
- Track allocated and unallocated quantities.
- Record transfers between projects.
- Record returns from construction sites.
- Track consumables.
- Identify shortages.
- Track inventory movements and responsible employees.

Every stock movement must have a project association when applicable.

Material consumption must be linked to the project and the relevant СМР activity.

### F. ЛОГИСТИКА — LOGISTICS

Build a module coordinating transportation and deliveries.

Functions:

- Plan material deliveries.
- Coordinate delivery dates with the linear schedule.
- Maintain delivery addresses and site access instructions.
- Manage courier information.
- Manage pallet and non-pallet delivery requirements.
- Coordinate unloading equipment and personnel.
- Track delivery status.
- Coordinate vehicle allocation.
- Plan transfers of surplus materials and machinery.
- Notify Technical, Warehouse and Contracts about delivery changes.

Delivery planning must take account of actual site conditions and customer restrictions.

### G. БРИГАДИР — BRIGADIER / SITE TEAM LEADER

Create a practical field-oriented interface.

Functions:

- View assigned projects.
- View the current daily work plan.
- View technical instructions.
- View material and equipment requirements.
- Record completed work.
- Report problems and delays.
- Upload photographs.
- Report material shortages or excess consumption.
- Report additional work requirements.
- Record worker attendance and team allocation where configured.
- Request support from Technical.

The interface must be usable on a mobile phone directly from the construction site.

### H. УПРАВИТЕЛ — MANAGEMENT

Management needs an organization-wide overview and approval center.

Functions:

- View every active project.
- Monitor project progress.
- Monitor financial performance.
- Approve payment requests.
- Approve exceptional expenditures.
- Approve contractual deviations.
- Review additional СМР activities.
- Resolve interdepartmental conflicts.
- Monitor overdue tasks and deadlines.
- Review project risks.
- Reallocate resources.
- View departmental workload and performance.

Management should have a consolidated overview without needing to open every department's workspace individually.

---

## 4. The synchronization engine — THE MOST IMPORTANT COMPONENT

Do not implement synchronization as simple notifications.

Implement a central event-driven workflow engine.

Every meaningful change must generate a structured event.

Examples:

**Offer confirmed**
→ Contracts receives a notification.
→ Contract creation becomes available.
→ Project Card is initialized.
→ Technical receives the project for review.
→ Management can see the new project.

**Contract signed**
→ Contractual baseline becomes active.
→ Delivery deadlines are activated.
→ Procurement requirements become actionable.
→ Technical receives the confirmed scope.

**Material request created**
→ Warehouse checks availability.
→ Logistics receives delivery requirements.
→ Technical sees request status.
→ Management is notified if additional expenditure or approval is required.

**Daily progress recorded**
→ Project completion percentages are recalculated.
→ Material consumption estimates are updated.
→ Accounting receives updated completed quantities.
→ Management dashboard reflects actual progress.
→ Schedule deviations are evaluated.

**Contract amendment approved**
→ Project Card is updated.
→ Relevant quantities and financial baselines are versioned.
→ Linear schedule is recalculated where necessary.
→ Affected departments are notified.

Every event must contain:

- Project ID.
- Event type.
- Originating module.
- Responsible user.
- Timestamp.
- Previous value.
- New value.
- Approval status, where applicable.
- Affected modules.
- Processing status.

Implement reliable event processing, duplicate-event protection and an auditable history.

A notification must never be mistaken for a completed business operation.

---

## 5. Project lifecycle and workflow

Implement the following default lifecycle:

1. Customer inquiry.
2. Customer information collection.
3. Commercial offer preparation.
4. Offer revision and negotiation.
5. Customer confirmation.
6. Contract generation.
7. Contract review and approval.
8. Project Card creation.
9. Technical review by Technical and Brigadier.
10. Site questionnaire and logistical validation.
11. Material and machinery planning.
12. Procurement and warehouse allocation.
13. Linear schedule preparation.
14. Customer readiness confirmation.
15. Project execution.
16. Daily progress reporting.
17. Material consumption tracking.
18. Financial synchronization.
19. Delivery and installation monitoring.
20. Project completion.
21. Financial reconciliation.
22. Project closure and archival.

These stages must be configurable.

Not every project will follow exactly the same sequence. Allow authorized users to introduce exceptions, approval steps and additional activities.

---

## 6. Project Card — detailed interface

The Project Card should be the most important screen in the application.

Create a clear, information-rich project workspace with the following sections:

1. Overview and project status.
2. Customer and contacts.
3. Contract and appendices.
4. Offer and commercial baseline.
5. Technical specifications.
6. Products and material recipes.
7. Site questionnaire.
8. Logistics and deliveries.
9. Warehouse allocations.
10. Machinery and vehicles.
11. Linear execution schedule.
12. Daily progress.
13. Photographs and documentation.
14. Financial overview.
15. Payments and expenses.
16. Accommodation and parking.
17. Changes and amendments.
18. Tasks and approvals.
19. Communication history.
20. Audit trail.

At the top of the card, show:

- Project ID and name.
- Customer.
- Site address.
- Responsible Technical employee.
- Responsible Brigadier.
- Contract value.
- Planned start and completion dates.
- Actual progress.
- Current project status.
- Outstanding critical issues.

Provide a timeline showing every important event.

---

## 7. Cross-department communication

Build a communication system connected to projects and tasks.

Employees should be able to:

- Mention another department or employee.
- Assign tasks.
- Request clarification.
- Attach documents and photographs.
- Discuss specific materials, contract clauses or СМР activities.
- Escalate unresolved issues.
- Track responses.

Communication must remain associated with the relevant project and operational activity.

Avoid creating an isolated chat application that loses the context of business decisions.

A decision affecting the project must be convertible into a recorded task, approval or project change.

---

## 8. Interface and visual direction

Design this as a serious, modern internal business platform.

The interface should feel like a professional enterprise operations system, not a generic SaaS template.

Visual direction:

- Modern, clean and information-dense.
- Professional light and dark themes.
- Strong typography and clear hierarchy.
- Consistent department-specific visual identities.
- Excellent tables and data visualization.
- Clear status indicators.
- Interactive timelines.
- Gantt-style linear schedules.
- Project progress visualization.
- Financial dashboards.
- Responsive mobile field interface.

Create a persistent navigation system with:

- Dashboard.
- Projects.
- Offers.
- Contracts.
- Technical.
- Accounting.
- Warehouse.
- Logistics.
- Brigadier.
- Management.
- Notifications.
- Reports.
- Settings.

The dashboard must be role-aware.

A technician should not see the same operational dashboard as an accountant.

A manager should have a global view.

A brigadier should have a simplified, mobile-first interface.

Do not sacrifice operational clarity for decorative design.

---

## 9. Permissions, accountability and security

Implement role-based access control.

Each employee should have:

- A defined department.
- A defined role.
- Project-specific access where necessary.
- Read/write permissions.
- Approval permissions.
- Restricted financial access where appropriate.

Maintain a complete audit log.

Never silently delete important records.

Use soft deletion, version history and explicit correction procedures.

Critical financial and contractual changes must require authorized approval.

---

## 10. Technical implementation requirements

Build a real, persistent application.

Requirements:

- Proper relational database and normalized data model.
- Unique identifiers for customers, projects, contracts, offers, products and transactions.
- Centralized project data.
- Reliable event-driven synchronization.
- Role-based permissions.
- Document storage and versioning.
- Search across projects, customers, contracts and products.
- Audit logging.
- Background processing for notifications and synchronization.
- Responsive desktop and mobile interfaces.
- Data validation.
- Error handling and recovery.
- Database backups and restoration strategy.

Design the architecture so that additional modules can be added without rebuilding the entire application.

Do not hardcode business rules into individual screens.

Business rules, approval thresholds, notification rules and workflow transitions should be configurable.

---

## 11. Implementation strategy

Do not attempt to build a superficial version of every module simultaneously.

Build in controlled phases.

**PHASE 1 — Foundation**
- Authentication and users.
- Departments and permissions.
- Customer database.
- Offers.
- Contracts.
- Project Card.
- Central project database.
- Core synchronization engine.

**PHASE 2 — Execution**
- Technical module.
- Brigadier interface.
- Linear schedule.
- Daily progress.
- Photographic reporting.
- Material recipes and consumption calculations.

**PHASE 3 — Resources**
- Warehouse.
- Procurement requests.
- Logistics.
- Machinery and vehicle allocation.
- Material transfers and returns.

**PHASE 4 — Financial control**
- Accounting.
- Proforma invoices.
- Income and expenditure.
- Payment requests and approvals.
- Financial synchronization with completed work.

**PHASE 5 — Management intelligence**
- Organization-wide dashboard.
- Project profitability.
- Schedule deviations.
- Resource utilization.
- Departmental workload.
- Alerts and reporting.

Every phase must produce a functional, testable application.

---

## 12. Mandatory development instructions

Before implementation:

1. Understand the complete business workflow described above.
2. Establish the database schema and entity relationships.
3. Identify the central Project Card data model.
4. Map dependencies between departments.
5. Define events and synchronization rules.
6. Define permissions and approval boundaries.
7. Present the architecture and implementation plan.

During implementation:

- Build working functionality, not static mockups.
- Use realistic sample data.
- Ensure all modules operate on shared records.
- Test cross-module synchronization.
- Test concurrent edits.
- Test duplicate events and failed operations.
- Test role permissions.
- Test document versioning.
- Test financial calculations.
- Test mobile usability.

Do not mark a module complete simply because its interface exists.

It is complete only when its underlying operations, database persistence, permissions and integrations work.

Maintain a visible implementation checklist and report unfinished functionality honestly.

## 13. Definition of success

The final application should allow an employee to open a project and immediately understand:

- What was sold?
- What was contractually agreed?
- What must be delivered?
- What materials are required?
- What is available in the warehouse?
- What must be purchased?
- Who is responsible?
- When must each activity happen?
- What has actually been completed?
- What materials have been consumed?
- How much money has been spent?
- How much money has been received?
- What is overdue?
- What has changed?
- What requires attention or approval?

Management must be able to see the actual state of the entire business without collecting information manually from individual employees.

**The ultimate objective: one interconnected operational environment in which Commercial, Contracts, Technical, Accounting, Warehouse, Logistics, Brigadier and Management work on the same reality, with no departmental information silos and no uncontrolled duplication.**