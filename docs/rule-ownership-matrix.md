# Rule Ownership Matrix

| Rule category | Planner behaviour | Validator behaviour | Supabase behaviour | UI behaviour |
| --- | --- | --- | --- | --- |
| Active staff | Use only active staff as eligible candidates | Block inactive or unknown staff assignments | Reject publish when assignment references inactive or invalid staff | Show inactive staff as unavailable for manual edits |
| Active contract | Use only staff with valid contracts in period scope | Block assignments without an active contract | Enforce publish protection when no valid contract exists | Surface contract gaps for manager review |
| Weekly minimum | Prioritize meeting weekly minimums before soft goals | Block publish without valid exception | Final publish gate must respect minimums and approved exceptions | Show under-minimum staff and collect exception decisions |
| Weekly maximum | Avoid exceeding weekly maximum unless exception exists | Block over-maximum schedules without approval | Reject publish without approved exception metadata | Warn manager and capture approval if needed |
| Above-target consent | Use above-target capacity only when consent or allowance exists | Block or warn per consent rules | Enforce final publish requirements for consent or exception | Show consent context and exception requests |
| Availability | Never assign unavailable staff | Block unavailable assignments | Reject publish when availability is violated unless override path exists | Prevent or warn on unavailable drag-and-drop/manual edits |
| Mandatory coverage | Cover required mandatory shifts first | Block underfilled mandatory shifts | Final publish gate blocks missing mandatory coverage | Highlight uncovered mandatory shifts |
| Same-day duplicates | Avoid assigning same person twice on one date | Block duplicate same-day assignments | Reject publish for duplicate-date assignments | Prevent duplicate manual edits |
| Evening-to-next-morning | Avoid rest-rule violations in planning | Block next-morning conflicts | Reject publish on rest-rule violations | Show rest conflict warnings in review |
| Training phase rules | Respect phase-based eligibility and pairing needs | Block invalid trainee coverage | Enforce publish protection for invalid training assignments | Explain why trainees can or cannot cover |
| Consecutive-day limits | Avoid hard-limit breaches and optimize soft patterns | Block hard breaches and warn on soft ones | Enforce hard consecutive-day rule at publish | Surface fatigue-pattern review items |
| Full weekends | Avoid by default when alternatives exist | Warn or require review depending on policy | Optionally require exception metadata before publish | Show weekend burden and collect approvals |
| Weekly targets | Optimize toward targets after minimums | Warn on target imbalance | Do not block publish unless converted into hard policy | Show target progress and fairness context |
| Fragmentation | Prefer cleaner work blocks | Warn on fragmented patterns | No direct enforcement | Present manager-facing pattern review |
| Budget | Stay within budget unless approval exists | Block or warn according to budget policy | Final publish gate should enforce budget approvals | Show budget pressure and exception decisions |
| External wildcard support | Suggest only as manager review candidate | Never treat as normal auto-assignment unless staff exists | Reject publish for unknown external assignees | Present external support as manual follow-up only |
