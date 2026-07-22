import assert from "node:assert/strict";
import test from "node:test";
import {
  canAssignAppRole,
  deriveStaffOnboardingState,
  normalizeStaffPortalEmail,
  validateStaffOnboardingForm,
  type StaffOnboardingFormInput,
  type StaffPortalAccountRecord,
} from "./staff-onboarding";

function buildValidInput(
  overrides: Partial<StaffOnboardingFormInput> = {},
): StaffOnboardingFormInput {
  return {
    fullName: "Taylor Rivera",
    email: " Taylor.Rivera@example.com ",
    appRole: "staff",
    workRole: "host",
    schedulingRuleRole: "host",
    hourlyRate: "18.50",
    minimumShiftsPerWeek: "2",
    targetShiftsPerWeek: "3",
    maximumShiftsPerWeek: "4",
    standardShiftHours: "8",
    contractStartDate: "2026-08-01",
    contractEndDate: "",
    trainingPhase: "phase_1_shadow_only",
    trainingStartedOn: "2026-07-20",
    phaseStartedOn: "2026-07-20",
    targetCompletionOn: "",
    openingTrainingCompletedOn: "",
    closingTrainingCompletedOn: "",
    ...overrides,
  };
}

function buildPortalAccount(
  overrides: Partial<StaffPortalAccountRecord> = {},
): StaffPortalAccountRecord {
  return {
    staffId: "staff-1",
    email: "taylor@example.com",
    normalizedEmail: "taylor@example.com",
    appRole: "staff",
    loginAccessEnabled: true,
    authUserId: null,
    invitationStatus: "not_invited",
    invitationSentAt: null,
    invitationLastError: null,
    lastLinkedAt: null,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
    ...overrides,
  };
}

test("email normalization trims and lowercases", () => {
  assert.equal(
    normalizeStaffPortalEmail("  Person.One@Example.COM "),
    "person.one@example.com",
  );
});

test("manager can only assign staff access while admin can assign all roles", () => {
  assert.equal(canAssignAppRole("manager", "staff"), true);
  assert.equal(canAssignAppRole("manager", "manager"), false);
  assert.equal(canAssignAppRole("admin", "admin"), true);
});

test("valid onboarding input parses without field errors", () => {
  const result = validateStaffOnboardingForm(buildValidInput());

  assert.deepEqual(result.fieldErrors, {});
  assert.equal(result.normalizedEmail, "taylor.rivera@example.com");
  assert.equal(result.parsedValues.hourlyRate, 18.5);
  assert.equal(result.parsedValues.minimumShiftsPerWeek, 2);
  assert.equal(result.parsedValues.targetShiftsPerWeek, 3);
  assert.equal(result.parsedValues.maximumShiftsPerWeek, 4);
  assert.equal(result.parsedValues.standardShiftHours, 8);
});

test("invalid weekly shift ordering is rejected", () => {
  const result = validateStaffOnboardingForm(
    buildValidInput({
      minimumShiftsPerWeek: "4",
      targetShiftsPerWeek: "3",
      maximumShiftsPerWeek: "2",
    }),
  );

  assert.equal(
    result.fieldErrors.targetShiftsPerWeek,
    "Target shifts/week must be at least the minimum.",
  );
  assert.equal(
    result.fieldErrors.maximumShiftsPerWeek,
    "Maximum shifts/week must be empty or at least the target.",
  );
});

test("negative hourly rate is rejected", () => {
  const result = validateStaffOnboardingForm(
    buildValidInput({
      hourlyRate: "-1",
    }),
  );

  assert.equal(result.fieldErrors.hourlyRate, "Hourly rate must be 0 or greater.");
});

test("phase 2 requires opening training completion", () => {
  const result = validateStaffOnboardingForm(
    buildValidInput({
      trainingPhase: "phase_2_opening_independent",
      openingTrainingCompletedOn: "",
    }),
  );

  assert.equal(
    result.fieldErrors.openingTrainingCompletedOn,
    "Opening training completion is required for Phase 2.",
  );
});

test("phase 3 requires both opening and closing completion", () => {
  const result = validateStaffOnboardingForm(
    buildValidInput({
      trainingPhase: "phase_3_fully_trained",
      openingTrainingCompletedOn: "",
      closingTrainingCompletedOn: "",
    }),
  );

  assert.equal(
    result.fieldErrors.openingTrainingCompletedOn,
    "Opening training completion is required for Phase 3.",
  );
  assert.equal(
    result.fieldErrors.closingTrainingCompletedOn,
    "Closing training completion is required for Phase 3.",
  );
});

test("missing contract or training keeps onboarding in incomplete setup", () => {
  const result = deriveStaffOnboardingState({
    portalAccount: null,
    authUser: null,
    profileExists: false,
    profileIsActive: false,
    hasActiveContract: false,
    hasTrainingStatus: false,
    schedulingIsActive: false,
  });

  assert.equal(result.status, "incomplete_setup");
  assert.deepEqual(result.issues, [
    "missing_portal_account",
    "missing_active_contract",
    "missing_training_status",
    "inactive_for_scheduling",
  ]);
});

test("portal with no auth user but complete setup is ready to invite", () => {
  const result = deriveStaffOnboardingState({
    portalAccount: buildPortalAccount(),
    authUser: null,
    profileExists: false,
    profileIsActive: false,
    hasActiveContract: true,
    hasTrainingStatus: true,
    schedulingIsActive: true,
  });

  assert.equal(result.status, "ready_to_invite");
  assert.deepEqual(result.issues, ["missing_auth_user"]);
});

test("invitation failure remains retryable instead of appearing active", () => {
  const result = deriveStaffOnboardingState({
    portalAccount: buildPortalAccount({
      invitationStatus: "invitation_failed",
      invitationLastError: "Rate limited",
    }),
    authUser: null,
    profileExists: false,
    profileIsActive: false,
    hasActiveContract: true,
    hasTrainingStatus: true,
    schedulingIsActive: true,
  });

  assert.equal(result.status, "invitation_failed");
});

test("linked but inactive profile is reported as login inactive", () => {
  const result = deriveStaffOnboardingState({
    portalAccount: buildPortalAccount({
      authUserId: "auth-1",
      invitationStatus: "linked_existing_user",
    }),
    authUser: {
      id: "auth-1",
      email: "taylor@example.com",
      emailConfirmedAt: null,
      invitedAt: "2026-07-21T10:00:00.000Z",
      lastSignInAt: null,
      createdAt: "2026-07-21T10:00:00.000Z",
    },
    profileExists: true,
    profileIsActive: false,
    hasActiveContract: true,
    hasTrainingStatus: true,
    schedulingIsActive: true,
  });

  assert.equal(result.status, "login_inactive");
  assert.deepEqual(result.issues, ["inactive_profile"]);
});

test("login-disabled and scheduling-inactive staff are treated as deactivated", () => {
  const result = deriveStaffOnboardingState({
    portalAccount: buildPortalAccount({
      loginAccessEnabled: false,
    }),
    authUser: null,
    profileExists: false,
    profileIsActive: false,
    hasActiveContract: true,
    hasTrainingStatus: true,
    schedulingIsActive: false,
  });

  assert.equal(result.status, "deactivated");
});

test("fully configured linked staff becomes active", () => {
  const result = deriveStaffOnboardingState({
    portalAccount: buildPortalAccount({
      authUserId: "auth-1",
      invitationStatus: "linked_existing_user",
    }),
    authUser: {
      id: "auth-1",
      email: "taylor@example.com",
      emailConfirmedAt: "2026-07-21T10:05:00.000Z",
      invitedAt: "2026-07-21T10:00:00.000Z",
      lastSignInAt: "2026-07-21T10:06:00.000Z",
      createdAt: "2026-07-21T10:00:00.000Z",
    },
    profileExists: true,
    profileIsActive: true,
    hasActiveContract: true,
    hasTrainingStatus: true,
    schedulingIsActive: true,
  });

  assert.equal(result.status, "active");
  assert.deepEqual(result.issues, []);
});
