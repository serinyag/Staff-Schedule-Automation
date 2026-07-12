# n8n Architecture Ownership

n8n owns:

- orchestration
- retries
- run-state transitions
- notifications
- external integrations

n8n does not own:

- permanent assignment scoring
- permanent eligibility logic
- contract interpretation
- fairness optimization
- final rule definitions

The long-term direction is for n8n to coordinate the flow and status changes around the scheduling engine rather than contain the planning engine itself.
