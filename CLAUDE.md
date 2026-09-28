
# CLAUDE.md — Igloohome IoT PMS

Next.js 16 rules for coding agents (read before writing Next.js code): @AGENTS.md

Current system overview (architecture, flows, rules, status; keep it updated with every change): [docs/ai-context.md](docs/ai-context.md)

## 1. Project Overview

This project explores and develops a PMS-style IoT management platform built around the Igloohome ecosystem.

The primary integration target is the official Igloohome API, with a focus on managing smart locks, Bridges, access credentials, devices, and operational workflows relevant to property management.

The project has access to:

- An actual Igloohome device.
- An Igloohome Bridge device that may connect to multiple IoT devices.
- Igloohome API documentation and account access, subject to available permissions.
- A development environment for API experimentation and dashboard development.

This project is located inside the `iot-pms` directory.

### Project Boundary

This `CLAUDE.md` applies to the `iot-pms` project.

Do not modify files outside this project unless explicitly requested by the user.

Do not assume that sibling projects, such as architecture research or other applications, should be changed as part of this project.

---

## 2. Project Goals

The main goals of this project are:

1. Understand the Igloohome API and its complete capability surface.
2. Explore how Igloohome devices and Bridges can be discovered, managed, and operated.
3. Identify all relevant API capabilities for a PMS-style IoT management platform.
4. Validate documented API behavior through controlled experiments using available accounts and hardware.
5. Discover additional integration opportunities beyond currently known use cases.
6. Build a dashboard that can eventually manage and operate Igloohome devices through a secure and reliable integration.
7. Establish a verified technical foundation before implementing production-shaped workflows.

The research should not be limited to predefined assumptions such as creating or resetting PINs.

Investigate the broader ecosystem and identify capabilities, limitations, and opportunities that may not be immediately obvious.

---

## 3. Core Development Principles

### 3.1 Research Before Implementation

For unfamiliar or insufficiently documented functionality:

1. Research the official documentation.
2. Identify the relevant API capabilities.
3. Verify the available request and response information.
4. Document limitations and unknowns.
5. Define controlled experiments where appropriate.
6. Review the findings.
7. Create an implementation plan.
8. Implement only the approved scope.

Do not begin dashboard implementation based on unverified assumptions.

### 3.2 Evidence-Based Findings

Every research finding must be classified according to its evidence.

Clearly distinguish between:

- Confirmed by official documentation.
- Confirmed through an actual API request.
- Mentioned in official documentation but lacking a complete schema.
- Confirmed through controlled hardware testing.
- Discovered through a third-party source.
- Inferred or hypothesized.
- Not found.
- Blocked by authentication, permissions, documentation access, or hardware limitations.

Never present an inferred capability as an officially supported feature.

Never invent:

- Endpoint paths.
- HTTP methods.
- Request parameters.
- Request bodies.
- Response schemas.
- Authentication requirements.
- API scopes.
- Error codes.
- Device capabilities.
- Bridge behavior.

If information cannot be verified, document it as unknown or unverified.

### 3.3 Official Sources First

Prioritize sources in the following order:

1. Official Igloohome API documentation.
2. Official Igloohome API portal and authenticated documentation.
3. Official Igloohome developer documentation.
4. Official Igloohome support documentation.
5. Official device, Bridge, and accessory manuals.
6. Official changelogs and API release notes.
7. Reputable open-source integrations as secondary evidence.

Third-party sources may help identify areas for investigation, but they must not automatically be treated as authoritative evidence.

Record the source URL and evidence status for relevant findings.

### 3.4 No Premature Architecture

This project is primarily focused on understanding and validating the Igloohome integration.

Do not introduce or implement the following solely because they may be useful in a future architecture:

- NATS.
- Kafka.
- RabbitMQ.
- Saga.
- CQRS.
- Event sourcing.
- Distributed transactions.
- Microservices.
- Other advanced architecture patterns.

These patterns may be discussed as future possibilities when relevant, but they must not be introduced into the research dashboard without an explicit request and a justified requirement.

Prioritize understanding the external integration and validating the actual business workflow first.

---

## 4. Primary Research Starting Point

All comprehensive Igloohome research must begin from the official documentation homepage:

https://docs.igloohome.co/home

The research should systematically explore the documentation from this starting point and follow relevant sections, references, and linked resources.

Do not limit the investigation to endpoints already known by the user.

The research should cover the full documented capability surface, including capabilities that may be useful for future PMS workflows.

If the documentation requires JavaScript, authentication, account access, or permissions that are unavailable, record the limitation clearly.

Do not treat inaccessible documentation or an undiscovered endpoint as proof that the capability does not exist.

---

## 5. Research Scope

### 5.1 Account and Authentication

Investigate:

- Account registration and activation.
- Individual accounts and partner accounts.
- API access configuration.
- Authentication mechanisms.
- Access-token generation and expiration.
- Client ID and client secret requirements.
- API scopes and permissions, if supported.
- Account-level authorization.
- Device-level authorization.
- Multi-user access.
- Delegated access.
- Subscription and billing requirements.
- Customer-account management.
- Account and device linking.
- Ownership and permission boundaries.

Pay particular attention to whether a company or master account can manage other accounts or devices using least-privilege access.

Do not assume that a personal account, partner account, or master account has the same capabilities.

---

### 5.2 Device Discovery and Management

Investigate all documented capabilities related to:

- Listing devices.
- Retrieving device details.
- Identifying device types and models.
- Identifying locks and accessories.
- Device status.
- Battery information.
- Firmware information.
- Device metadata.
- Device ownership.
- Device linking and unlinking.
- Device provisioning.
- Device onboarding.
- Device deletion or removal.
- Device configuration.

For each discovered operation, document when available:

- Operation name.
- HTTP method.
- Endpoint path.
- API version.
- Authentication requirements.
- Required permissions.
- Request parameters.
- Request body.
- Response schema.
- Error behavior.
- Device compatibility.
- Bridge requirements.
- Whether the operation is read-only or mutating.
- Whether the behavior is confirmed.

---

### 5.3 Bridge and Connected IoT Devices

Treat Bridge-related functionality as a high-priority research area.

Investigate:

- What a Bridge represents in the API.
- Whether Bridges can be discovered through the API.
- Whether devices connected to a Bridge can be listed.
- Whether the API can add, register, pair, or link devices.
- Whether pairing must happen through the mobile application.
- Whether Bridge-connected devices can be controlled remotely.
- Whether Bridge operations are synchronous or asynchronous.
- Bridge-proxied jobs.
- Job creation and job-status operations.
- Supported Bridge operations.
- Bridge connectivity and availability.
- Bridge-to-device limits.
- Supported lock and accessory combinations.
- Behavior when a Bridge is offline.
- Behavior when a lock is unreachable.
- Moving a Bridge between accounts.
- Managing multiple Bridges.
- Account-level limitations for Bridge management.

Do not assume that connecting a device to a Bridge automatically enables every API operation.

Verify the exact supported behavior.

---

### 5.4 Credential and PIN Management

Research all documented credential-related operations, including:

- One-time PIN generation.
- Duration PIN generation.
- Recurring PIN generation.
- Permanent PIN generation.
- PIN reset.
- PIN revocation.
- Credential deletion.
- Credential metadata.
- Access names.
- Start and end dates.
- Time zones.
- PIN variance.
- Credential limits.
- Credential status.
- Credential retrieval.
- Credential audit information.
- Credential regeneration.
- Credential expiration.
- Supported credential types by device.

Determine whether each capability is:

- Generated locally.
- Generated by a cloud service.
- Synchronized through a Bridge.
- Applied through Bluetooth.
- Available without a Bridge.
- Available only for specific device types.
- Subject to account or subscription restrictions.

Do not assume that PIN generation, PIN delivery, PIN activation, and PIN revocation are the same operation.

Document their actual lifecycle and limitations.

---

### 5.5 Lock and Access Operations

Investigate capabilities related to:

- Locking.
- Unlocking.
- Opening.
- Remote access.
- Access scheduling.
- Access revocation.
- Lock status.
- Last-known status.
- Activity logs.
- Access events.
- Failed access attempts.
- Battery alerts.
- Maintenance information.
- Remote operation results.

For every operation, investigate whether it requires:

- A Bridge.
- Internet connectivity.
- Bluetooth proximity.
- A particular device model.
- An active API subscription.
- Specific account permissions.
- A specific credential type.

Identify operations that could affect active guest access and classify their operational risk.

---

### 5.6 Webhooks, Events, and Operational Integration

Investigate whether the API supports:

- Webhooks.
- Device status events.
- Credential events.
- Access events.
- Battery notifications.
- Bridge connectivity events.
- Job completion events.
- Polling requirements.
- Event retries.
- Event signatures.
- Event ordering.
- Duplicate event delivery.
- Event replay.
- Rate limits.

Document integration implications for a PMS platform.

Do not assume that the API supports webhooks, asynchronous jobs, or event delivery unless verified.

---

### 5.7 API Limitations, Security, and Safety

Identify:

- Rate limits.
- Device linking limits.
- Account limits.
- Credential limits.
- Supported device models.
- Unsupported operations.
- Permission limitations.
- Subscription requirements.
- API versioning.
- Deprecation policies.
- Error codes.
- Retry guidance.
- Security requirements.
- Audit requirements.
- Operations that could affect real guest access.
- Account and device ownership constraints.

Clearly identify operations that must not be tested on active guest devices.

---

## 6. Hardware Experimentation and Safety

The project has access to actual hardware.

Hardware experiments must be controlled and documented.

### Safety Requirements

- Prefer a dedicated test device and test account.
- Do not experiment with active guest access unless explicitly authorized.
- Do not revoke, reset, or modify credentials that may be used by real guests.
- Do not perform lock or unlock operations on occupied or operational rooms without authorization.
- Confirm the target device before every mutating operation.
- Record the expected side effects before running an experiment.
- Document failed experiments and unexpected behavior.
- Avoid destructive actions unless their impact is understood and explicitly approved.

For each experiment, document:

- Experiment objective.
- Account used.
- Target device.
- Bridge involvement.
- Preconditions.
- Request or action performed.
- Expected result.
- Actual result.
- Evidence.
- Side effects.
- Cleanup steps.
- Follow-up questions.

---

## 7. Research Deliverables

Create structured research artifacts in the existing project structure.

Do not restructure the repository unless explicitly requested.

Use existing files when equivalent research artifacts already exist.

Suggested deliverables:

- `research-summary.md`
- `api-capability-matrix.md`
- `endpoint-inventory.md`
- `device-and-bridge-capabilities.md`
- `credential-capabilities.md`
- `account-and-authentication.md`
- `unknowns-and-access-blockers.md`
- `pms-feature-opportunities.md`
- `research-sources.md`
- `experiments/`

Adapt the exact paths and filenames to the repository's existing conventions.

### Required Research Summary

The research summary must explain:

1. What was investigated.
2. Which sources were used.
3. Confirmed API capabilities.
4. Capabilities confirmed through actual requests.
5. Capabilities confirmed through hardware testing.
6. Unconfirmed capabilities.
7. Documentation or permission blockers.
8. Important API limitations.
9. Potential PMS opportunities.
10. Recommended next experiments.
11. Information required from the user before implementation.

---

## 8. Endpoint Inventory Requirements

For every discovered endpoint or operation, record the following when available:

- Operation name.
- HTTP method.
- Endpoint path.
- API version.
- Source URL.
- Documentation status.
- Authentication requirements.
- Required permissions.
- Request parameters.
- Request body.
- Verified request example.
- Verified response example.
- Error behavior.
- Device compatibility.
- Bridge requirements.
- Side effects.
- Risk level.
- Testability with available hardware.
- Open questions.

Use the following documentation statuses:

- Confirmed by official documentation.
- Confirmed by an actual API request.
- Confirmed through hardware testing.
- Mentioned by official documentation but schema unavailable.
- Discovered from a third-party source.
- Hypothesis requiring validation.
- Not found.
- Blocked by access or permissions.

Only include request and response examples when they are verified.

---

## 9. PMS Feature Discovery

After documenting the API capabilities, identify potential PMS-style features.

Do not implement these features during the research phase.

Classify each proposed feature according to evidence, feasibility, dependencies, and operational risk.

Potential feature areas include:

- Property and site management.
- Device inventory.
- Room and lock mapping.
- Bridge management.
- Device onboarding.
- Device health dashboard.
- Battery monitoring.
- Credential lifecycle management.
- Pre-arrival access provisioning.
- Check-in access activation.
- Check-out access revocation.
- Maintenance access.
- Housekeeping access.
- Vendor access.
- Temporary access.
- Emergency access procedures.
- Access audit trails.
- Credential expiration monitoring.
- Device connectivity monitoring.
- Failed operation monitoring.
- Multi-property operations.
- Role-based administration.
- Customer or partner account management.
- Bulk operations.
- Access policy templates.
- Operational alerts.
- Guest access troubleshooting.

For each proposed feature, explain:

- Which API capability enables it.
- Whether the capability is confirmed or speculative.
- Whether a Bridge is required.
- Whether additional hardware is required.
- Whether additional account permissions are required.
- Whether the feature belongs in the dashboard, application layer, or future architecture work.
- Potential safety and operational risks.
- Important unknowns or blockers.

Be creative when identifying opportunities, but clearly distinguish creative proposals from verified API capabilities.

---

## 10. Dashboard Research Scope

The eventual dashboard should help explore and manage the Igloohome ecosystem.

The dashboard may eventually include capabilities such as:

- Account and API connection status.
- Device inventory.
- Device details.
- Bridge inventory.
- Connected-device relationships.
- Device health.
- Battery information.
- Credential management.
- PIN creation and management.
- Credential expiration.
- Operation history.
- API request and response inspection.
- Error and failure visibility.
- Room-to-device mapping.
- PMS workflow experiments.

During the research phase, do not assume that all of these capabilities can be implemented.

First establish which features are supported by the API, account, device, and Bridge configuration.

Do not build the dashboard before the research findings and capability inventory have been reviewed.

---

## 11. API Security

Protect all sensitive information.

Never commit or expose:

- API credentials.
- Client secrets.
- Access tokens.
- Refresh tokens.
- Private keys.
- Passwords.
- Sensitive device identifiers.
- Guest access credentials.
- Production configuration secrets.

Use environment variables or the project's approved secret-management approach.

Do not place real secrets in documentation, screenshots, logs, test fixtures, or committed source code.

Redact sensitive values in research artifacts and API response examples.

---

## 12. Research and Implementation Workflow

Follow this workflow:

### Phase 1 — Inspect

- Read this `CLAUDE.md`.
- Inspect the existing repository.
- Identify existing research, source files, experiments, and implementation.
- Avoid duplicating existing work.

### Phase 2 — Research

- Start from the official Igloohome documentation homepage.
- Explore the documentation systematically.
- Record sources and evidence.
- Identify capabilities, limitations, and unknowns.
- Do not implement the dashboard.

### Phase 3 — Verify

- Determine which capabilities can be tested with the available account and hardware.
- Define controlled experiments.
- Execute experiments only when authorized and safe.
- Record actual results and side effects.

### Phase 4 — Review

- Produce the research artifacts.
- Summarize confirmed findings and unresolved questions.
- Identify the most valuable PMS opportunities.
- Highlight information required from the user.

### Phase 5 — Plan

Only after the research has been reviewed, create an implementation plan.

The plan must identify:

- Scope.
- Dependencies.
- Verified API capabilities.
- Required permissions.
- Hardware requirements.
- Risks.
- Testing strategy.
- Security considerations.
- Out-of-scope items.

### Phase 6 — Implement

Implement only the approved plan.

Do not silently expand scope or introduce unrelated architecture patterns.

### Phase 7 — Test and Review

- Test API behavior.
- Test error handling.
- Test authorization boundaries.
- Test hardware-related safety conditions.
- Document limitations.
- Review the implementation against the research findings.

---

## 13. Tool and Agent Behavior

When conducting research:

- Inspect existing project files before creating new ones.
- Reuse existing research artifacts where appropriate.
- Avoid unnecessary repository restructuring.
- Prefer official documentation.
- Cite or record sources for important findings.
- Do not invent missing information.
- Explicitly report access blockers.
- Ask for clarification only when a decision cannot be made safely from the available evidence.
- Do not begin implementation prematurely.
- Keep the user informed about major unknowns and risks.

When using a research workflow or command such as `/ecc:research-ops`, follow the requirements in this file and the task-specific research brief.

When using a planning workflow such as `/ecc:plan`, use the reviewed research artifacts as the source of truth for the implementation plan.

---

## 14. Definition of Done — Research Phase

The research phase is complete when:

- The official documentation has been explored systematically from the defined starting point.
- Relevant API capabilities have been inventoried.
- Authentication and account limitations have been investigated.
- Device and Bridge capabilities have been investigated.
- Credential and PIN operations have been investigated.
- Relevant lock and access operations have been investigated.
- API limitations and safety concerns have been documented.
- Confirmed capabilities are separated from hypotheses.
- Documentation and account-access blockers are documented.
- Available hardware experiments have been identified.
- PMS feature opportunities have been classified.
- Research artifacts have been created or updated.
- Findings are ready for user review.
- No dashboard implementation has started without approval.

The goal is not to claim that every possible API behavior has been discovered.

The goal is to produce a comprehensive, evidence-based understanding of the documented ecosystem and clearly identify what still requires verification.