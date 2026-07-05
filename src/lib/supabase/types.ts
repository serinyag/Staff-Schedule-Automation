export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole = "admin" | "manager" | "staff";
export type WorkRole = "manager" | "core_team" | "host";
export type TrainingPhase =
  | "phase_1_shadow_only"
  | "phase_2_opening_independent"
  | "phase_3_fully_trained";
export type ShiftType = "morning" | "day" | "evening";
export type SchedulePeriodStatus =
  | "collecting_availability"
  | "drafting"
  | "published"
  | "locked";
export type AvailabilitySubmissionStatus = "draft" | "submitted";
export type BudgetScope = "role" | "staff";
export type AssignmentStatus = "assigned" | "cancelled";
export type ScheduleAssignmentLifecycle = "draft" | "published";
export type ScheduleGenerationRunStatus =
  | "queued"
  | "analyzing_availability"
  | "planning"
  | "fairness_review"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled";
export type TrainingEventType =
  | "shadow_shift"
  | "opening_training"
  | "closing_training"
  | "phase_change";

export type ProfileRow = {
  id: string;
  app_role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffMemberRow = {
  id: string;
  profile_id: string | null;
  full_name: string;
  work_role: WorkRole;
  scheduling_rule_role: WorkRole;
  hourly_rate: number | null;
  is_active: boolean;
  is_wildcard_fill_in: boolean;
  is_initial_training_mentor: boolean;
  default_weekly_budget_shifts: number | null;
  created_at: string;
  updated_at: string;
};

export type EmploymentContractRow = {
  id: string;
  staff_id: string;
  start_date: string;
  end_date: string | null;
  min_shifts_per_week: number;
  target_shifts_per_week: number;
  max_shifts_per_week: number | null;
  standard_shift_hours: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffTrainingStatusRow = {
  staff_id: string;
  phase: TrainingPhase;
  training_started_on: string;
  target_completion_on: string | null;
  phase_started_on: string;
  fully_trained_on: string | null;
  updated_by: string | null;
  notes: string | null;
  updated_at: string;
};

export type SchedulePeriodRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  availability_deadline: string | null;
  status: SchedulePeriodStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AvailabilitySubmissionRow = {
  id: string;
  period_id: string;
  staff_id: string;
  status: AvailabilitySubmissionStatus;
  willing_to_work_above_target: boolean;
  max_extra_shifts_for_period: number | null;
  submitted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AvailabilityDayRow = {
  id: string;
  submission_id: string;
  available_date: string;
  morning: boolean;
  day: boolean;
  evening: boolean;
  created_at: string;
  updated_at: string;
};

export type ShiftRow = {
  id: string;
  period_id: string;
  shift_date: string;
  shift_type: ShiftType;
  start_time: string;
  end_time: string;
  required_count: number;
  is_optional: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftAssignmentRow = {
  id: string;
  shift_id: string;
  staff_id: string;
  status: AssignmentStatus;
  lifecycle: ScheduleAssignmentLifecycle;
  generation_run_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  manager_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleBudgetRow = {
  id: string;
  period_id: string;
  scope: BudgetScope;
  work_role: WorkRole | null;
  staff_id: string | null;
  max_shifts: number;
  weekly_reference: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleGenerationRunRow = {
  id: string;
  period_id: string;
  status: ScheduleGenerationRunStatus;
  initiated_by: string;
  started_at: string;
  completed_at: string | null;
  failed_at: string | null;
  failure_message: string | null;
  current_stage: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type SchedulingSettingsRow = {
  singleton: boolean;
  holiday_streak_days: number;
  default_soft_max_consecutive_days: number;
  default_hard_max_consecutive_days: number;
  min_days_off_per_week_high_commitment: number;
  high_commitment_threshold_shifts_per_week: number;
  block_evening_to_next_morning: boolean;
  initial_mentor_shift_count: number;
  min_morning_coverage: number;
  min_evening_coverage: number;
  updated_at: string;
};

export type AvailabilityUnavailableStreakRow = {
  staff_id: string;
  period_id: string;
  streak_start: string;
  streak_end: string;
  streak_days: number;
};

export type DynamicViewRow = {
  [key: string]: Json | undefined;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          app_role?: AppRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      staff_members: {
        Row: StaffMemberRow;
        Insert: {
          id?: string;
          profile_id?: string | null;
          full_name: string;
          work_role: WorkRole;
          scheduling_rule_role: WorkRole;
          hourly_rate?: number | null;
          is_active?: boolean;
          is_wildcard_fill_in?: boolean;
          is_initial_training_mentor?: boolean;
          default_weekly_budget_shifts?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<StaffMemberRow>;
        Relationships: [];
      };
      employment_contracts: {
        Row: EmploymentContractRow;
        Insert: {
          id?: string;
          staff_id: string;
          start_date: string;
          end_date?: string | null;
          min_shifts_per_week: number;
          target_shifts_per_week: number;
          max_shifts_per_week?: number | null;
          standard_shift_hours?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<EmploymentContractRow>;
        Relationships: [];
      };
      staff_training_status: {
        Row: StaffTrainingStatusRow;
        Insert: {
          staff_id: string;
          phase?: TrainingPhase;
          training_started_on?: string;
          target_completion_on?: string | null;
          phase_started_on?: string;
          fully_trained_on?: string | null;
          updated_by?: string | null;
          notes?: string | null;
          updated_at?: string;
        };
        Update: Partial<StaffTrainingStatusRow>;
        Relationships: [];
      };
      schedule_periods: {
        Row: SchedulePeriodRow;
        Insert: {
          id?: string;
          name: string;
          start_date: string;
          end_date: string;
          availability_deadline?: string | null;
          status?: SchedulePeriodStatus;
          published_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<SchedulePeriodRow>;
        Relationships: [];
      };
      availability_submissions: {
        Row: AvailabilitySubmissionRow;
        Insert: {
          id?: string;
          period_id: string;
          staff_id: string;
          status?: AvailabilitySubmissionStatus;
          willing_to_work_above_target?: boolean;
          max_extra_shifts_for_period?: number | null;
          submitted_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<AvailabilitySubmissionRow>;
        Relationships: [];
      };
      availability_days: {
        Row: AvailabilityDayRow;
        Insert: {
          id?: string;
          submission_id: string;
          available_date: string;
          morning?: boolean;
          day?: boolean;
          evening?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<AvailabilityDayRow>;
        Relationships: [];
      };
      shifts: {
        Row: ShiftRow;
        Insert: {
          id?: string;
          period_id: string;
          shift_date: string;
          shift_type: ShiftType;
          start_time: string;
          end_time: string;
          required_count?: number;
          is_optional?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ShiftRow>;
        Relationships: [];
      };
      shift_assignments: {
        Row: ShiftAssignmentRow;
        Insert: {
          id?: string;
          shift_id: string;
          staff_id: string;
          status?: AssignmentStatus;
          lifecycle?: ScheduleAssignmentLifecycle;
          generation_run_id?: string | null;
          assigned_by?: string | null;
          assigned_at?: string | null;
          manager_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ShiftAssignmentRow>;
        Relationships: [];
      };
      schedule_budgets: {
        Row: ScheduleBudgetRow;
        Insert: {
          id?: string;
          period_id: string;
          scope: BudgetScope;
          work_role?: WorkRole | null;
          staff_id?: string | null;
          max_shifts: number;
          weekly_reference?: number | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ScheduleBudgetRow>;
        Relationships: [];
      };
      schedule_generation_runs: {
        Row: ScheduleGenerationRunRow;
        Insert: {
          id?: string;
          period_id: string;
          status?: ScheduleGenerationRunStatus;
          initiated_by: string;
          started_at?: string;
          completed_at?: string | null;
          failed_at?: string | null;
          failure_message?: string | null;
          current_stage?: string;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ScheduleGenerationRunRow>;
        Relationships: [];
      };
      scheduling_settings: {
        Row: SchedulingSettingsRow;
        Insert: {
          singleton?: boolean;
          holiday_streak_days?: number;
          default_soft_max_consecutive_days?: number;
          default_hard_max_consecutive_days?: number;
          min_days_off_per_week_high_commitment?: number;
          high_commitment_threshold_shifts_per_week?: number;
          block_evening_to_next_morning?: boolean;
          initial_mentor_shift_count?: number;
          min_morning_coverage?: number;
          min_evening_coverage?: number;
          updated_at?: string;
        };
        Update: Partial<SchedulingSettingsRow>;
        Relationships: [];
      };
    };
    Views: {
      availability_unavailable_streaks: {
        Row: AvailabilityUnavailableStreakRow;
        Relationships: [];
      };
      daily_coverage_status: {
        Row: DynamicViewRow;
        Relationships: [];
      };
      contract_period_progress: {
        Row: DynamicViewRow;
        Relationships: [];
      };
      period_budget_usage: {
        Row: DynamicViewRow;
        Relationships: [];
      };
    };
    Functions: {
      update_staff_admin_record: {
        Args: {
          p_staff_id: string;
          p_work_role: WorkRole;
          p_scheduling_rule_role: WorkRole;
          p_hourly_rate: number | null;
          p_is_active: boolean;
          p_min_shifts_per_week: number;
          p_target_shifts_per_week: number;
          p_max_shifts_per_week: number | null;
          p_training_phase: TrainingPhase | null;
        };
        Returns: undefined;
      };
      submit_staff_availability: {
        Args: {
          p_period_id: string;
          p_status: AvailabilitySubmissionStatus;
          p_willing_to_work_above_target?: boolean;
          p_max_extra_shifts_for_period?: number | null;
          p_daily_availability?: Json;
        };
        Returns: string;
      };
      queue_schedule_generation_run: {
        Args: {
          p_period_id: string;
        };
        Returns: string;
      };
      publish_schedule_period: {
        Args: {
          p_period_id: string;
        };
        Returns: undefined;
      };
      validate_schedule_period: {
        Args: {
          p_period_id: string;
        };
        Returns: Json;
      };
      assignment_blockers: {
        Args: {
          p_staff_id: string;
          p_shift_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      app_role: AppRole;
      work_role: WorkRole;
      training_phase: TrainingPhase;
      shift_type: ShiftType;
      schedule_period_status: SchedulePeriodStatus;
      availability_submission_status: AvailabilitySubmissionStatus;
      budget_scope: BudgetScope;
      assignment_status: AssignmentStatus;
      schedule_assignment_lifecycle: ScheduleAssignmentLifecycle;
      schedule_generation_run_status: ScheduleGenerationRunStatus;
      training_event_type: TrainingEventType;
    };
    CompositeTypes: Record<string, never>;
  };
};
