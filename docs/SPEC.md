1. Biosecurity Micro-Triage & Logistics Autobalancer 

The 2026 Context: With active multi-country viral outbreaks (like the late-2026 Ebola resurgence in central Africa) and the constant threat of novel pathogens, traditional supply chain responses are too slow, often resulting in medical hoarding in safe zones and shortages in hot zones.
The Prediction: Ingest local mobility data (cell tower density, transit tap-ins), municipal wastewater pathogen metrics, and NLP analysis of local emergency room wait times to predict micro-outbreak expansion zones 48–72 hours before clinical testing confirms a spike.
The Decision: The agent integrates directly with hospital and pharmacy ERP (Enterprise Resource Planning) systems. When a zip code crosses the critical threshold, it autonomously executes inventory transfers—re-routing PPE, antivirals, or vaccines from predicted safe zones to the predicted hot zone. Simultaneously, it sends API calls to ride-share platforms to temporarily disable "pooled" rides in the affected perimeter.
Data Sources: Biobot Analytics (wastewater APIs), Google/Apple mobility data, and mock hospital ERP inventory databases.

Yes, this project is completely buildable in a 25-hour hackathon, provided you scope it aggressively as a proof-of-concept / functional prototype rather than a production-ready medical platform.
In a hackathon setting, the biggest traps are trying to integrate real enterprise systems (like actual hospital SAP/Epic ERPs or live municipal wastewater pipelines) or getting bogged down building a complex front-end. If you lean into mock data, modular API services, and a killer system architecture presentation, you can have a working end-to-end demo.
Here is a breakdown of why it works, the core architecture to build, and a strict 25-hour execution blueprint to win.
Why It’s Feasible (and High-Impact)
The Core Logic is Just a Scoring Algorithm: You don't need machine learning trained on terabytes of real-time data to win a hackathon. A weighted risk-scoring formula combining wastewater viral load + mobility drop/spike + ER wait-time spikes will easily simulate the predictive layer.
APIs Keep It Lightweight: You can mock the Biobot Analytics API and mobility data with simple JSON files or synthetic Python data generators.
The "Demo Factor" is Massive: Judges love agents that take autonomous real-world actions (e.g., triggering a simulated logistics reroute or showing a live map of inventory shifting from a safe zone to a hot zone).
The 25-Hour Hackathon Execution Blueprint
Phase 1: Scope & Architecture (Hours 0–3)
Do not write code yet. Define the MVP.
Frontend: A single-page dashboard (Next.js or Streamlit) showing a city map (e.g., Leaflet.js or Mapbox) with zip codes color-coded by risk level, plus a live event log showing the agent's autonomous decisions.
Backend: Python (FastAPI or Flask) acting as the orchestration agent.
Database: SQLite or simple in-memory JSON to track mock hospital/pharmacy inventory levels across different zip codes.
Phase 2: Data Simulation & Ingestion (Hours 3–8)
Since real-time wastewater and mobility APIs won't be accessible or populated for your exact demo scenario within 24 hours, build a synthetic data generator script:
Wastewater (Biobot Mock): JSON payload returning viral copies/mL for 5 specific zip codes over the last 7 days. Make one zip code spike exponentially.
Mobility Mock: JSON payload showing percentage changes in transit tap-ins or cell density.
ER Wait Times Mock: Simple integers representing average wait times (e.g., Zone A: 45 mins, Zone B: 3 hours).
Phase 3: The Triage & Prediction Engine (Hours 8–14)
Build a simple scoring function in Python that runs every few seconds or on a button click:


RiskScore=(w1WastewaterLoad)+(w2ERWaitTimeDelta)-(w3MobilityOutflow)
When a zip code’s score crosses a defined threshold (>85), it triggers an Autobalancer Event.
Phase 4: Autonomous Action & ERP/API Integration (Hours 14–20)
Inventory Rerouting: Write an endpoint that queries your mock hospital ERP database, finds a neighboring zip code with surplus PPE/antivirals, and moves inventory records from Warehouse A to Warehouse B.
Ride-Share API Mock: Simulate an API call to a rideshare service (like Uber/Lyft developer APIs, or just a mock webhook logger) that prints: [API MOCK] Disabling pooled rides in Zip Code 90210 due to biosecurity containment protocol.
Display these actions in real-time on your dashboard event log.
Phase 5: Polish, Deck, & Demo Prep (Hours 20–25)
The "Magic Button": Add a button on the UI that lets judges manually inject a "spike" into a clean zip code so they can watch the agent instantly recalculate risk, shift inventory, and log the decision live.
Slide Deck: Focus on the 2026 Context (Ebola/novel pathogen resurgence), the systemic failure of reactive supply chains, and how proactive micro-triage saves lives and prevents panic hoarding.
Pro-Tips to Win
Don't touch real medical or enterprise software: Emphasize that your mock ERP schema mirrors HL7/FHIR standards or standard medical supply schemas.
Focus on the "Autonomous Agent" narrative: Judges want to see an agent that acts without human bottlenecking. Highlight the automated decision loop: Detect  Predict  Transfer  Contain.


TECHNICAL SPECIFICATION 
1. System Architecture & Component Interaction
The architecture consists of five core layers:
[ Data Ingestion & Telemetry Simulator ]
                  │
                  ▼
   [ Fast In-Memory State / Database ] (SQLite / Redis)
                  │
                  ▼
       [ Predictive Risk Engine ] (Rolling Window Math Engine)
                  │
                  ▼
  [ LLM Orchestration & Reasoning Layer ] (Gemini 1.5)
                  │
                  ▼
     [ Logistics & Dispatch Executor ] ──► [ Real-Time Dashboard UI ]

Data Ingestion & Simulation Layer: Ingests three distinct time-series telemetry streams (wastewater viral copy counts, emergency room wait times, and mobile/cell-density transit indicators).
State & Persistence Layer: Stores regional metadata, historical 14-day telemetry logs, and current hospital inventory stocks.
Predictive Risk Engine: Continuously runs a rolling mathematical formula over incoming telemetry to calculate a normalized risk score (0.0--100.0) for every monitored zone.
LLM Orchestration Layer: Triggers when a zone breaches the risk threshold (80.0). Passes regional inventory data and risk velocity metrics to the model to generate a structured decision directive.
Logistics & Dispatch Executor: Receives the decision directive, updates inventory balances across facilities, and logs compliance and containment events.
2. Data Schemas (Entities & Attributes)
A. Regional Metadata (zip_codes)
zip_code (Primary Key, String): Unique geographical postal code identifier.
zone_name (String): Human-readable region or neighborhood name.
latitude / longitude (Floats): Spatial coordinates for map plotting.
population (Integer): Total resident population density base.
B. Health & Mobility Telemetry Logs (telemetry_logs)
log_id (Primary Key, Integer): Sequential log entry ID.
timestamp (DateTime): Time of telemetry recording.
zip_code (Foreign Key, String): Linked region.
wastewater_copies_per_l (Float): Pathogen viral genome copies per liter (Biobot-style metric).
er_avg_wait_mins (Float): Rolling average emergency room wait time in minutes.
mobility_density_score (Float): Relative transit/cell-tower crowd density index (0.0--100.0).
C. Medical Inventory & Facilities (hospital_inventories)
facility_id (Primary Key, String): Facility identifier (FHIR/HL7 style).
zip_code (Foreign Key, String): Location zone.
facility_name (String): Name of hospital or supply hub.
ppe_units (Integer): Available protective equipment inventory.
antiviral_doses (Integer): Stock of therapeutic antiviral doses.
vaccine_doses (Integer): Available prophylactic vaccine units.
3. Mathematical Risk-Scoring Engine
The core predictive metric evaluates rolling 3-day trajectories (t=3days) across normalized health and mobility signals:

RiskScore(z)=w1Wt+w2Et+w3Mdensity
Parameter Weights & Normalization
W (Wastewater Velocity): Percentage change in viral genome copies per liter relative to the baseline 3 days prior. Weight: w1=0.50
E (ER Wait Time Velocity): Absolute delta in average emergency room wait times in minutes over 3 days. Weight: w2=0.35
Mdensity (Mobility Index): Normalized 0.0--1.0 value representing transit tap-ins and cell-tower density. Weight: w3=0.15
Output Bounds: Score is strictly clamped between 0.0 (Safe) and 100.0 (Critical Outbreak Hotspot).
4. Operational Workflow & Decision Protocol
Continuous Monitoring: Telemetry logs stream into the backend. The mathematical engine recalculates the composite Risk Score every minute.
Threshold Breach: When a zip code's Risk Score reaches or exceeds 80.0, the system flags the zone as CRITICAL.
Context Assembly: The backend queries nearby zip codes (donor zones with Risk Scores <40.0) and gathers current medical inventory levels.
Agent Reasoning: The prompt engine passes this context to Gemini 1.5. The model evaluates supply deficits and emits a structured decision object containing:
Target Outbreak Zone: Zone requiring immediate reinforcement.
Donor Facility: Recommended donor site with surplus supplies.
Transfer Allocation: Specific quantity of PPE, antivirals, or vaccines to move.
Containment Directives: Suggested non-pharmaceutical interventions (e.g., suspending rideshare pooling in the perimeter).
Execution & Inventory Shift: The executor mutates the inventory balances (subtracts from donor, adds to recipient) and broadcasts the event log to the frontend.
5. System Interface & API Contract Specification
Endpoint A: Map & Zone Status (GET /api/v1/map-status)
Purpose: Serves real-time spatial state to the dashboard map.
Payload Contents: Array of zones containing coordinates, latest telemetry metrics, computed risk scores, and current status flags (SAFE, ELEVATED, CRITICAL).
Endpoint B: Outbreak Injection / Simulation (POST /api/v1/trigger-outbreak)
Purpose: Simulation hook for demonstration.
Payload Contents: Target zip_code, wastewater viral multiplier (e.g., 4.5), and ER wait time add-on minutes.
Endpoint C: Autobalance Execution (POST /api/v1/execute-autobalance)
Purpose: Applies the LLM recommendation to the database state.
Payload Contents: Donor facility ID, target facility ID, transferred item counts, and containment directive text.
6. Frontend Dashboard Visual Layout
Header Controls: Application title, status indicator, and prominent "Simulate Pathogen Spike" trigger button.
Primary View (Map Canvas): Spatial map rendering monitored zones as color-coded pins/polygons based on live risk scores (Green 40, Yellow 41--79, Red 80).
Side Panel (Event Stream & Directives): Live scrolling event feed showing real-time alerts and structured decision logs generated by the agent.
Bottom Panel (Inventory Metrics): Comparative bar charts showing real-time inventory balances across facilities before and after automated reallocations.




NHS England Regions
England has 36 Integrated Care Boards from 1 April 2026, across seven NHS regions.
Source: [ONS April 2026 names and codes](https://geoportal.statistics.gov.uk/datasets/integrated-care-boards-april-2026-names-and-codes-in-en/explore).
The current demo roster and approximate metadata are in [engine/zones.csv](../engine/zones.csv).
North East and Yorkshire (4 ICBs)
Sub-areas: North East and North Cumbria; Humber and North Yorkshire; South Yorkshire; West Yorkshire.
North West (3 ICBs)
Sub-areas: Cheshire and Merseyside; Greater Manchester; Lancashire and South Cumbria.
Midlands (11 ICBs)
Sub-areas: Birmingham and Solihull; Black Country; Coventry and Warwickshire; Derby and Derbyshire; Herefordshire and Worcestershire; Leicester, Leicestershire and Rutland; Lincolnshire; Northamptonshire; Nottingham and Nottinghamshire; Shropshire, Telford and Wrekin; Staffordshire and Stoke-on-Trent.
East of England (3 ICBs)
Sub-areas: Central East; Essex; Norfolk and Suffolk.
London (4 ICBs)
Sub-areas: West and North London; North East London; South East London; South West London.
South East (4 ICBs)
Sub-areas: Thames Valley; Hampshire and Isle of Wight; Kent and Medway; Surrey and Sussex.
South West (7 ICBs)
Sub-areas: Bath and North East Somerset, Swindon and Wiltshire; Bristol, North Somerset and South Gloucestershire; Cornwall and the Isles of Scilly; Devon; Dorset; Gloucestershire; Somerset.

NHS Scotland
Managed through 14 regional NHS Health Boards (such as NHS Greater Glasgow and Clyde, NHS Lothian, NHS Grampian) alongside 31 Health and Social Care Integration Partnerships. [1]

NHS Wales
Managed through 7 Local Health Boards (such as Cardiff and Vale, Swansea Bay, Betsi Cadwaladr) alongside NHS Wales Collaborative agencies. [1, 2]

