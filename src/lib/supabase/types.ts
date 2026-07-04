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
    };
    Views: Record<string, never>;
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
    };
    Enums: {
      app_role: AppRole;
      work_role: WorkRole;
      training_phase: TrainingPhase;
    };
    CompositeTypes: Record<string, never>;
  };
};
