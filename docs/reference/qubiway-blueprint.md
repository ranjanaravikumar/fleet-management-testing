Could not get FontBBox from font descriptor because None cannot be parsed as 4 floats
Could not get FontBBox from font descriptor because None cannot be parsed as 4 floats
Could not get FontBBox from font descriptor because None cannot be parsed as 4 floats
Could not get FontBBox from font descriptor because None cannot be parsed as 4 floats
Could not get FontBBox from font descriptor because None cannot be parsed as 4 floats
Could not get FontBBox from font descriptor because None cannot be parsed as 4 floats
Transportation Management System (TMS) Blueprint

Functional Workﬂow & Persona Dashboard Speciﬁcations

1. Persona Roles & Core Dashboards

⚙ Admin (The System Governor & Auditor)

The Admin ensures the entire ecosystem runs smoothly, securely, and compliantly. They
act as the regulatory gatekeeper for network access and the ﬁnal auditor for all ﬁnancial
data before billing packets are ﬁnalized.

●  Core Responsibilities: User onboarding, contract rate management, ﬁnal invoice

auditing, dispute resolution, and system conﬁgurations.

●  Dashboard Capabilities & Monitoring Views:

○  Onboarding Queue: Approvals workﬂow for newly registered Shippers and
Carriers awaiting credit checks, DOT authority validation, and insurance
audits.

○  System Health Monitor: Aggregate metrics showing active load volume,

network-wide margin splits, and platform transactional health.

○  Financial Audit Console: Completed shipments with uploaded PODs
awaiting automated match veriﬁcation and manual approval before
invoice locking.

○  Dispute & Claims Flag: High-priority workspace tracking loads marked

with freight damage (OS&D), missing paperwork, or contested detention
fees.

○  Global Settings Control Panel: Matrix managing user roles, platform fee

adjustments, and system API conﬁgurations.

📦 Shipper (The Customer / Load Owner)

The Shipper is the paying customer who owns the physical commodities. Their primary
objective is to book lanes cost-effectively, monitor transit safety, and process clean
ﬁnancial invoicing.

●  Core Responsibilities: Launching new load requests, specifying trailer

requirements, updating scheduling windows, and approving audited invoices.

●  Dashboard Capabilities & Monitoring Views:

○  Load Creation Form: Dynamic entry screen specifying origins,

destinations, dimensional sizes, hazmat ﬂags, and scheduling dates.
○  Active Shipments Live Map: Regional map layout plotting GPS track paths

for all current freight assets moving in their network.

○  Milestone & Tracking Feed: Real-time event log pushing updates like

"Driver at Origin," "In Transit," or "Arrived at Consignee."

○  Billing Ledger: Open invoices pending accounts payable approval,

historical spend graphs, and PDF statement archives.

○  Performance Metrics Analytics: Vendor scorecards charting carrier
on-time pickup/delivery percentages and average costs per mile.

🚛 Carrier (The Transport Provider Company)

The Carrier represents corporate trucking operations. They focus on securing proﬁtable
lanes to optimize asset capacity, monitoring company revenues, and keeping their ﬂeet
compliant.

●  Core Responsibilities: Reviewing market lanes, accepting or negotiating

contracts, monitoring company margins, and processing initial billing ﬁles.

●  Dashboard Capabilities & Monitoring Views:

○  Load Board Feed: Available shipments matching their trailer proﬁles,

geographic locations, and target pricing tolerances.

○  Fleet Utilization Overview: High-level roster charting active trucks

categorized by status: Loaded, Deadheading, Empty, or Out-of-Service.
○  Financial Pipeline Tracker: Dynamic counter totaling unbilled deliveries,

aging accounts receivable, and accrued accessorial payouts.

○  Compliance & Safety Monitor: Real-time summary tracking ﬂeet safety

scores, vehicle maintenance windows, and driver Hours of Service (HOS)
summaries.

📡 Dispatcher (The Operational Coordinator)

The Dispatcher executes daily operations for the Carrier. They manage asset logistics
on a granular level, pair speciﬁc trucks to orders, and troubleshoot live-transit delays.

●  Core Responsibilities: Driver matching, routing optimization, active trip

monitoring, in-transit problem solving, and document ingestion.

●  Dashboard Capabilities & Monitoring Views:

○  Driver Assignment Grid: Drag-and-drop workﬂow layout to pair accepted

freight contracts with available drivers based on proximity and HOS limits.

○  Live Logistics Track Map: Interactive ﬂeet map with dynamic ETAs

color-coded to ﬂag structural delays (Green for Ahead/On-Time, Red for
Delayed).

○  Exception Alerts Feed: Critical notiﬁcation system prioritizing

breakdowns, weather delays, missed appointments, or distress ﬂags.
○  Direct Communication Hub: In-app messenger providing direct text and

document channels to active drivers on the road.

○  Document Document Quality Check: Ingestion interface to review

driver-submitted POD images for signature clarity and legibility before
routing to the Admin.

📱 Driver (The Physical Executioner)

The Driver operates via a mobile application. Their interface is designed for
high-contrast visibility and distraction-free operation, tracking only the immediate route
tasking, safety instructions, and paper capture tools.

●  Core Responsibilities: Managing duty cycles, executing safe travel, providing
on-site cargo counts, and scanning signed pickup/delivery conﬁrmations.

●  Dashboard Capabilities & Monitoring Views:

○  Today's Manifest View: Stripped-down list highlighting pick/drop details,

warehouse telephone lines, gate codes, and appointment hours.

○  Status Toggle Ribbon: Oversized, touch-friendly buttons for easy recording

of progress milestones (e.g., "Departing Hub," "At Dock," "Unloaded").
○  Commercial Safe Navigation: Turn-by-turn routing calculating paths

around low clearance zones, weight-restricted bridges, and truck-approved
state routes.

○  Document Scanner: Computer-vision edge matching camera tool that

crops, straightens, and enhances uploaded pictures of signed BOLs and
PODs.

○  Earnings Ledger: High-transparency tracker documenting historical trip

payouts, fuel bonus incentives, and approved standby detention
compensation.

2. End-to-End Freight Lifecycle Workﬂow

Phase 1: System Onboarding & User Setup

●  Admin audits and approves the Shipper’s corporate credit limits to activate

booking tools.

●  Admin evaluates the Carrier's active operating authority, safety ratings, and

insurance coverages to greenlight them for the network.

●  Admin sets global security proﬁles and user permissions for Dispatchers and

Drivers.

Phase 2: Load Booking & Tender

●  Shipper submits a new shipment listing into the system, locking in lane specs,

item requirements, and appointment targets.

●  Admin reviews the rate calculations against internal pricing matrices, conﬁrms

pricing logic, and publishes the load to the Carrier network.

●  Carrier reviews the matching listing on their load board, validates their ﬂeet

availability, and digitally accepts the load contract.

Phase 3: Dispatching & Driver Assignment

●  Dispatcher receives the secured contract in their management console and

evaluates local asset availability.

●  Dispatcher assigns the route to an eligible Driver and pushes the full pickup

numbers and manifest details to the driver app.

●  Driver logs into their mobile dashboard, reviews the facility rules, appointment

times, and structural constraints, and signs off on the route.

Phase 4: Pickup & In-Transit Tracking

●  Driver selects "In Transit to Pickup" inside the application, alerting the warehouse

via background GPS coordinates.

●  Driver arrives at the origin, and the Shipper validates driver authorization tokens,

loads the truck, and signs the digital Bill of Lading (BOL).

●  Driver counts the physical pallets, ensures binding straps are secure, and

advances their system status to "Loaded / In Transit."

●  Dispatcher tracks live telemetry breadcrumbs, monitors scheduling milestones,

and intervenes via the dashboard if traﬃc anomalies threaten the ETA.

Phase 5: Delivery & Proof of Delivery (POD)

●  Driver pulls into the ﬁnal destination facility and switches their application status

to "Arrived at Consignee."

●  Driver completes unloading procedures and obtains a formal validation signature

from the receiver on the terminal paperwork.

●  Driver utilizes the application camera to take a clean image scan of the signed

paperwork, turning the ﬁle into a Proof of Delivery (POD).

●  Driver logs "Delivered / Empty" inside the app, clearing their queue and preparing

their truck for the next dispatch loop.

Phase 6: Invoicing, Financial Auditing, & Settlement

●  Dispatcher audits the submitted POD scan for clarity, veriﬁes that no product

damage logs exist, and pushes the load ﬁle to the billing phase.

●  Carrier generates the ﬁnal billing ﬁle, attaching agreed base line rates alongside

any documented accessory charges (like lumper fees or yard detention).
●  Admin initiates a ﬁnal systemic audit of the billing package against the digital

tracking history, original contract ﬁles, and POD signatures.

●  Admin auto-compiles the checked invoice package and transmits a clean digital

payment request directly to the customer.

●  Shipper receives the approved, veriﬁed invoice packet from the Admin, reconciles
it against internal accounting ledgers, and transmits the ﬁnal bank settlement.


