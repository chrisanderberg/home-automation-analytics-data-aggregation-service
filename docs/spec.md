<!--
spec.md — Source of Truth (Project-Independent)

How to use this file (for LLMs and humans):
- This document defines the canonical domain concepts, invariants, and intended
  interpretation of data for this family of projects.
- Treat this as the authoritative spec. Do not invent new rules that contradict
  it.
- If an implementation decision conflicts with this document, update this
  document first (or explicitly mark the point as TBD here), then implement.
- If something is marked TBD, keep it parameterized/configurable in code and do
  not hardcode a policy.

Scope:
- Project-independent concepts only (controls, models/responsibility, clocks,
  bucketing, counting rules, dense data layout, KDE/CTMC interpretation, data
  lifecycle intent, conceptual persistence model).
- No framework-, database-, transport-, or deployment-specific APIs.

Output expectations when implementing from this spec:
- Prefer small, testable units with acceptance tests derived from invariants.
- Document any additional assumptions as TBD additions to this file.
-->

# Manual: Controls, Aggregation, and Analytics

This document defines project-independent core concepts for systems that:
1) expose user-adjustable controls,
2) aggregate measurement data about those controls over time, and
3) infer user preferences as a function of time using multiple clock
   representations.

The three areas above are conceptually distinct layers:
- User Control / Interaction Layer
- Data Aggregation Layer
- Analytics / Inference Layer

Implementations may include all layers or only a subset (for example,
aggregation + analytics without a custom dashboard UI).

## System decomposition

### Control / Interaction Layer (what the system controls)
- Defines controls as discrete state variables that can be inspected and changed.
- Defines automation models that change control state over time.
- Defines the notion of “user-initiated” vs “automated” state changes.
- Produces state changes that become inputs to aggregation.

### Aggregation Layer (what gets measured and stored)
- Buckets time-of-week per clock (5 clocks, 2016 buckets/week per clock).
- Records:
  - holding times per state (milliseconds), and
  - user-initiated transition counts between states (frequencies),
  keyed by (control, model, clock, bucket) and partitioned by seasonal windows.
- Stores aggregated sufficient statistics in a dense format suitable for
  numerical analysis.

### Analytics / Inference Layer (what gets inferred)
- Smooths sparse bucketed data using KDE over cyclic time-of-week.
- Builds CTMCs and computes stationary distributions as preference estimates.
- Compares clocks as alternative time coordinate systems (experiment framing;
  evaluation metric: TBD).
- Compares models for the same control and expects convergence of inferred
  preferences across models (core hypothesis).

## Core invariants

### Controls and responsibility
- The system models user-adjustable home-automation settings as controls.
- Controls are limited to settings that can be explicitly inspected and changed.
  Implicit signals such as motion detection are out of scope.
- Each control has an active automation model responsible for automation.
- Control state may be changed by the active automation model and by direct user
  action.
- Direct user action does not change which model is active. The model remains
  responsible for automation and may still change the state after a user action.
- Control state changes can originate from any client (dashboard UI, Node-RED,
  etc.) and are treated equivalently by the system.

### Time bucketing and clocks
- Time is analyzed by time-of-week, broken into 5-minute buckets.
- There are 2016 buckets per week per clock (7 days × 24 hours × 12 buckets/hour).
- The system uses exactly five clocks, always computed in parallel:
  1) UTC
  2) Local time
  3) Mean solar time
  4) Apparent solar time
  5) Unequal hours
- For each measurement event, aggregation is performed across all five clocks.
  Aggregation is not designed to operate in a single-clock mode.

### Measurement semantics
- Holding time is measured in real elapsed milliseconds and split across all
  overlapped time-of-week buckets, per clock.
- Only transitions initiated by a human user are recorded as transitions.
- Automated state changes performed by automation models are not recorded as
  transitions.
- If data integrity fails (e.g., missing/invalid timestamps, broken attribution,
  or other integrity failures), affected data is discarded rather than ingested.

### Data lifecycle intent
- Seasonal variation is preserved using rolling quarters Q1–Q4 (retention/rollover
  details: TBD).
- Quarter windows are UTC-defined calendar quarters:
  - Q1: January–March
  - Q2: April–June
  - Q3: July–September
  - Q4: October–December
  Quarter boundaries are defined in UTC calendar time (variable-length quarters
  are expected).

---

# Part I — Control / Interaction Layer

## Controls

Controls represent system state that can be set automatically by automation
models and can also be changed directly by the user through a UI or other client.

Controls are limited to settings that can be explicitly inspected and changed,
as opposed to implicit signals such as motion detection.

### Control categories

#### 1) Discrete controls (radio buttons)
- A discrete control has a finite set of labeled options and can be represented
  in the UI using radio buttons.
- Number of states: N, where 2 <= N <= 10.
- Examples:
  - On / Off (N = 2)
  - Mode: Off / Auto / Low / Medium / High (N = 5)
  - Scene selector with up to 10 scenes (N <= 10)

#### 2) Slider controls (6-state sliders)
- A slider control may be represented in the UI as a continuous slider but is
  discretized into exactly 6 states for modeling and analytics.
- Number of states: N = 6:
  - State 0: minimum value (e.g., DIM)
  - States 1–4: transition states (quartiles)
  - State 5: maximum value (e.g., BRIGHT)

### Common properties (all controls)
- Each control has a unique identifier (`controlId`).
- Each control has a finite set of discrete states.
- Each control has a current discrete state:
  - Discrete/radio controls: integer in 0..N-1 (where 2 <= N <= 10)
  - Slider controls: integer in 0..5
- Each control has an active automation model responsible for automation.
- Control state may be changed by:
  - the currently active automation model, and/or
  - a direct user action (manual intervention).
- Manual intervention does not change which model is active. The model remains
  responsible for automation and may still change the state after a user action.
- Control state changes can originate from any client (dashboard UI, Node-RED,
  etc.) and are treated equivalently by the system.

## Models and responsibility

Each control can be driven by one of multiple automation models over time.

- A model defines how the automated system would set or update the state of a
  control over time.
- At any given moment, exactly one model is considered the active automation
  model for a control.
- A user can manually change the control state at any time. The active model
  does not change when the user intervenes.
- The active model remains responsible for automation and may also change the
  state after a user action. However, transitions are only recorded when a human
  user is responsible for the state change (definition of “user-initiated”: TBD).

---

# Part II — Aggregation Layer

## Conceptual persistence model (implementation-agnostic)

This system can be implemented using many persistence technologies. Regardless of
storage choice, two conceptual data entities must exist.

### Control metadata entity (conceptual)
Stores the metadata needed to interpret a control’s states:

- controlId
- control type (discrete/radio vs slider)
- numStates (2..10; slider typically 6)
- optional state labels (up to 10)

### Aggregated sufficient statistics entity (conceptual)
Stores dense aggregated sufficient statistics partitioned by seasonal windows.

Conceptual key:
- controlId
- model identifier
- quarter window key (UTC calendar quarter)
- payload: dense numeric data (see “Dense aggregated data layout”)

This entity represents sufficient statistics, not raw events.

## The five clocks

### Definitions

#### 1) Local time (statutory/civil time)
- Time shown by ordinary clocks in a given location: time defined by statute.
- Tied to:
  - the chosen time zone (offset from UTC), and
  - daylight saving time rules (if applicable).
- Key property: it can jump (DST “spring forward” / “fall back”) and is a
  social/legal convention rather than an astronomical one.

#### 2) UTC (Coordinated Universal Time)
- A global time standard used for coordination.
- Uniform 24-hour clock independent of location and time zones.
- Key property: treated as continuous and monotonic for everyday use.

#### 3) Mean solar time
- A 24-hour clock synchronized to the Sun’s average (mean) position for a given
  location.
- Historically used before standardized time zones as location-specific solar
  clock time.
- Key property: depends on longitude (east/west position).

#### 4) Apparent solar time
- Solar time based on the Sun’s actual apparent position in the sky.
- Historically, what an actual sundial yields.
- Key property: differs from mean solar time by the equation of time.

Relationship to (3):
- Apparent solar time = mean solar time + (equation of time adjustment)

#### 5) Unequal hours (temporal hours)
- A clock where the “hours” are not fixed-length minutes.
- Definition:
  - 6:00 a.m. is always sunrise
  - 6:00 p.m. is always sunset
- Daytime is mapped to 12 equal “day hours,” nighttime to 12 equal “night hours.”
- Key property: the length of an “hour” varies with date and latitude.

### Utility (summary)
- Local time: aligns with human schedules and conventional automations.
- UTC: stable baseline for logging and comparison; avoids DST ambiguity.
- Mean solar: stable sun-aligned representation based on longitude.
- Apparent solar: aligns with true solar position and ambient light conditions.
- Unequal hours: sunrise/sunset anchored representation that remains seasonally aligned.

## Time-of-week bucketing (per clock)

Time is analyzed by time-of-week, broken into 5-minute buckets.

- Buckets per day: 24 hours × 12 = 288
- Buckets per week: 7 × 288 = 2,016
- Each bucket corresponds to a time-of-week label such as:
  - Monday 00:00–00:05
  - Monday 00:05–00:10
  - ...
  - Sunday 23:55–24:00

Bucketing is computed separately for each clock, producing five parallel
time-of-week coordinate systems.

### Time-of-day view (derived from time-of-week)
Analytics can also be viewed by time-of-day.

This is computed on demand by aggregating time-of-week buckets across days:
- A time-of-day bucket corresponds to the same 5-minute position within the day.
- For a given time-of-day bucket, sum the corresponding 7 time-of-week buckets
  (one from each day of the week).

### Bucket boundaries and irregular mappings
All clocks use the same bucket labels (5 minutes × 2016/week), but the mapping
from real timestamps into those labels differs by clock:

- UTC: buckets are uniform and continuous.
- Local time: DST can create discontinuities:
  - when clocks move forward, some local-time labels do not occur,
  - when clocks move backward, some local-time labels occur twice.
  Real timestamps remain unambiguous; the local-time mapping can repeat or skip
  labels while still using 5-minute buckets.
- Mean solar time: buckets are 5-minute labels in mean solar time, derived from
  longitude.
- Apparent solar time: buckets are 5-minute labels in apparent solar time; the
  equation-of-time adjustment varies across the year, so bucket boundaries drift
  relative to UTC/local time.
- Unequal hours: bucket labels represent “5 minutes” of unequal-hour time (1/12
  of an hour on that clock), so real elapsed time per bucket varies with date and
  latitude.

### Undefined time-of-day cases (solar clocks)
Some solar-clock mappings can become undefined in special geographic/seasonal
cases:

- Unequal hours requires both a sunrise and sunset. When the sun does not rise or
  does not set (e.g., polar day/night at some latitudes and seasons), unequal-hours
  time-of-day is considered undefined.
- At exactly the poles, mean solar time and apparent solar time can also be
  treated as undefined.

When a clock’s time-of-day is undefined, data is not counted for that clock.
When time-of-day becomes defined again, counting resumes.

## Fundamental data operations (aggregation inputs)

Aggregation is built from two fundamental operations:

### 1) Count holding times
- Input: start timestamp, end timestamp, and the held state.
- Interpretation: the control remained in a given state over a time window.
- For each clock, the holding interval is mapped onto time-of-week buckets and
  elapsed milliseconds are split across all buckets the interval overlaps.

This operation uses two timestamps and one state.

### 2) Count user-initiated transitions
- Input: a timestamp, a start state, and an end state.
- Interpretation: a human user changed the control from one state to another at
  an instant in time.
- For each clock, the timestamp is mapped to the time-of-week bucket containing
  that timestamp, and the transition count for that bucket is incremented.

This operation uses one timestamp and two states.

## Aggregated sufficient statistics

The aggregation layer stores sufficient statistics: the minimal numerical
summaries required for downstream analytics (KDE, CTMC, stationary distribution).

Per (control, model, clock, time-of-week bucket), the following are accumulated:

1) Holding time per state (milliseconds)
2) User-initiated transition counts between states (frequencies)

These sufficient statistics may be stored per seasonal window (rolling quarters).

## Dense aggregated data layout (canonical)

Aggregated sufficient statistics are treated as dense numeric arrays rather than
sparse maps.

Rationale:
- Buckets form a fixed lattice (2016/week × 5 clocks).
- “Missing data” is semantically equivalent to zero, not “key absent.”
- KDE and CTMC operations are vector- and matrix-oriented and benefit from dense,
  aligned representations.
- Clock comparisons require aligned arrays across all clocks and buckets.

Implementations SHOULD provide an abstraction that maps semantic access
(clock, bucket, state, transition) to a contiguous numeric storage layout.

### Canonical time-of-week bucket indexing

Time-of-week buckets are indexed as integers `b` in the range 0..2015.

- The week starts on Monday.
- Day-of-week indices are:
  - Monday = 0
  - Tuesday = 1
  - Wednesday = 2
  - Thursday = 3
  - Friday = 4
  - Saturday = 5
  - Sunday = 6

Within a given day, 5-minute buckets are indexed 0..287.

Given:
- `dayIndex` in 0..6
- `hour` in 0..23
- `minute` in 0..59

Define:
- `bucketWithinDay = hour * 12 + floor(minute / 5)` (range 0..287)
- `b = dayIndex * 288 + bucketWithinDay` (range 0..2015)

### Canonical clock ordering within each bucket group
Each bucket group contains exactly 10080 values, ordered by clock:

- Clock 0: UTC (2016 buckets)
- Clock 1: Local time (2016 buckets)
- Clock 2: Mean solar time (2016 buckets)
- Clock 3: Apparent solar time (2016 buckets)
- Clock 4: Unequal hours (2016 buckets)

Total per group:
- B = 2016 buckets
- C = 5 clocks
- G = B × C = 10080 values

### Canonical blob structure per control/model/window

Let N be the number of states for the control.

Values are stored in this order:

1) Holding times (milliseconds), grouped by state:
   - holding times for state 0: G values
   - holding times for state 1: G values
   - ...
   - holding times for state N-1: G values

2) Transition counts, grouped by (fromState, toState) with fromState != toState:
   - (0 → 1), (0 → 2), ..., (0 → N-1)
   - (1 → 0), (1 → 2), ..., (1 → N-1)
   - ...
   - (N-1 → 0), (N-1 → 1), ..., (N-1 → N-2)

Self-transitions (i → i) are not stored.
This matches CTMC construction where diagonal terms are derived rather than
directly counted.

Total number of stored values:
- holding groups: N × G
- transition groups: N × (N-1) × G
- total: (N + N(N-1)) × G = N^2 × G

All stored values are unsigned integers (holding times in milliseconds;
transition counts). The exact binary encoding (bit width, byte order) is an
implementation detail—each implementation uses its native unsigned integer
representation for the runtime and storage it targets.

### Canonical index math (zero-based)

Constants:
- B = 2016
- C = 5
- G = B × C = 10080
- N = numStates

Clock index c:
- 0 = UTC
- 1 = Local time
- 2 = Mean solar time
- 3 = Apparent solar time
- 4 = Unequal hours

Bucket index b:
- b ∈ [0, 2015]

#### Holding time index
Inputs:
- state s ∈ [0, N-1]
- clock c ∈ [0, 4]
- bucket b ∈ [0, 2015]

Index:
- holdIndex(s, c, b) = (s × G) + (c × B) + b

#### Transition group index (from, to)
Inputs:
- from ∈ [0, N-1]
- to ∈ [0, N-1], to != from

Define:
- offsetWithinFromBlock(from, to) =
  - if to < from: to
  - else: to - 1

Then:
- transGroupIndex(from, to) = (from × (N - 1)) + offsetWithinFromBlock(from, to)

#### Transition count index
Inputs:
- from ∈ [0, N-1]
- to ∈ [0, N-1], to != from
- clock c ∈ [0, 4]
- bucket b ∈ [0, 2015]

Index:
- transIndex(from, to, c, b) =
  (N × G) + (transGroupIndex(from, to) × G) + (c × B) + b

---

# Part III — Analytics / Inference Layer

## Core hypothesis (models vs user preference)

Core hypothesis:
- Total time-in-state (holding time) largely reflects what the automation model
  is doing (its behavior/policy), in the sense that it reflects what the system
  actually did while that model was active/responsible.
- The stationary distribution of the inferred CTMC is intended to reflect what
  the user actually prefers during that time-of-week bucket, because it is
  informed by user correction dynamics rather than just occupancy.

If this hypothesis holds:
- Different models for the same control may show different raw holding-time
  profiles.
- Stationary distributions computed per model should converge toward the same
  underlying user preference for a given (clock, time).

## Kernel density estimation (temporal smoothing)

Individual 5-minute time-of-week buckets may contain limited data. KDE is used to
smooth statistics across neighboring time buckets.

KDE is applied along the time-of-week axis, independently for each clock,
control, and model.

### Why KDE is used
1) Statistical robustness:
- Adjacent time buckets are likely to reflect similar preferences.
- Smoothing reduces noise and avoids overfitting to sparse bucket counts.

2) Continuous-time estimation:
- Although data is stored in discrete buckets, preference is not inherently
  discrete.
- KDE allows estimation at arbitrary times (e.g., exactly 03:00) and near bucket
  boundaries.

Time-of-week is treated as a continuous cyclic variable.

### Sparse data handling (TBD)
Options include:
- Using a kernel with nonzero weight over the full weekly cycle.
- Using a damping/regularization approach (prior mass) to avoid degenerate
  estimates when transitions are rare.

Bandwidth and damping behavior are TBD and should be parameterized.

## Continuous Time Markov Chain model and stationary distribution

Within each (clock, time), the control is modeled as a continuous time Markov
chain (CTMC) whose states are the control’s discrete states.

The CTMC can be analyzed:
1) Per model (model-specific sufficient statistics)
2) Aggregated across models (summed sufficient statistics)

The stationary distribution is treated as the estimate of underlying user
preference for that (clock, time), subject to the core hypothesis above.

## Clocks as an experiment (schedule A/B test)

The five clocks are alternative time coordinate systems. Measuring and inferring
preferences under all five is an experiment to determine which representation
best correlates with inferred user preference. Evaluation objective/metric is TBD.

---

# Data lifecycle

## Data quality (discarding bad data)
If something goes wrong (e.g., missing/invalid timestamps, broken attribution, or
other integrity failures), affected data is discarded rather than ingested into
aggregates.

## Quarter windows (UTC calendar quarters)

Quarter windows are defined as UTC calendar quarters:

- Q1: January–March
- Q2: April–June
- Q3: July–September
- Q4: October–December

Quarter windows are variable-length and may include leap days. This is expected.

Implementations may represent quarter windows as:
- `(utcYear, quarterNumber)` pairs, or
- a single integer `quarterIndex`, where:
  - `quarterIndex = (utcYear - 1970) * 4 + (quarterNumber - 1)`

The quarter window definition is independent of the five clocks; clocks are used
for time-of-week bucketing within a selected window.

## Accumulation model (rolling quarters)
Some clock effects require a full year to observe (e.g., mean vs apparent solar
differences, DST vs non-DST patterns). Seasonal variation is preserved using
rolling windows with 4 quarters per year (Q1–Q4). Retention/rollover details are
TBD.

---

# Concrete example (attribution and counting)

Example scenario (single control, single active model):
- Control: 6-state slider (states 0..5).
- Active model: “Unequal-hours sunset schedule.”
- The model sets the control to state 5 earlier in the day.
- At 18:02, the user changes the state from 5 to 2.

Counting behavior:
- The holding interval before the user action is recorded as elapsed milliseconds
  in state 5 and is split across all overlapped buckets (per clock).
- The state change at 18:02 is counted as a user-initiated transition 5 → 2 in
  the bucket containing 18:02 (per clock).
- All holding time and the user transition are attributed to the active model
  (since the model remains active before and after the user action).