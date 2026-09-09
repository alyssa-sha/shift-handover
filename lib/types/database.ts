/**
 * Hand-written to match supabase/migrations/0001_init.sql.
 *
 * Generating this with the Supabase CLI needs `supabase login` and a linked
 * project; at this size hand-writing is faster and keeps the schema and the
 * types reviewable in the same diff. If you change 0001_init.sql, change this
 * file in the same commit.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "operator" | "supervisor";
export type LogSeverity = "info" | "warning" | "critical";
export type HandoverStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved";
export type ReviewDecision = "approved" | "changes_requested";
export type NotificationKind = "handover_published" | "revision_requested";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: UserRole;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role: UserRole;
          created_at?: string;
        };
        // `role` is immutable for end users; the profiles_before_update
        // trigger rejects a change to it when auth.uid() is set.
        Update: {
          full_name?: string;
        };
        Relationships: [];
      };
      shifts: {
        Row: {
          id: string;
          location: string;
          name: string;
          starts_at: string;
          ends_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          location: string;
          name: string;
          starts_at: string;
          ends_at: string;
          created_at?: string;
        };
        Update: {
          location?: string;
          name?: string;
          starts_at?: string;
          ends_at?: string;
        };
        Relationships: [];
      };
      shift_assignments: {
        Row: {
          id: string;
          shift_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          shift_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      log_entries: {
        Row: {
          id: string;
          shift_id: string;
          author_id: string;
          severity: LogSeverity;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          author_id: string;
          severity: LogSeverity;
          content: string;
          created_at?: string;
        };
        Update: {
          severity?: LogSeverity;
          content?: string;
        };
        Relationships: [];
      };
      handovers: {
        Row: {
          id: string;
          shift_id: string;
          author_id: string;
          content: string;
          status: HandoverStatus;
          ai_assisted: boolean;
          submitted_at: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          author_id: string;
          content?: string;
          status?: HandoverStatus;
          ai_assisted?: boolean;
          submitted_at?: string | null;
          created_at?: string;
        };
        // shift_id and author_id are immutable (handovers_before_update).
        Update: {
          content?: string;
          status?: HandoverStatus;
          ai_assisted?: boolean;
          submitted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
      handover_reviews: {
        Row: {
          id: string;
          handover_id: string;
          reviewer_id: string;
          decision: ReviewDecision;
          feedback: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          handover_id: string;
          reviewer_id: string;
          decision: ReviewDecision;
          feedback?: string | null;
          created_at?: string;
        };
        // Append-only: no update or delete policy exists (FR-7.5).
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          handover_id: string | null;
          kind: NotificationKind;
          message: string;
          read_at: string | null;
          created_at: string;
        };
        // Trigger-inserted only; there is no client insert policy (FR-8.2).
        Insert: never;
        Update: {
          read_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      auth_role: {
        Args: Record<string, never>;
        Returns: UserRole;
      };
      is_assigned: {
        Args: { target_shift: string };
        Returns: boolean;
      };
      handover_shift: {
        Args: { target_handover: string };
        Returns: string;
      };
      shift_handover_open: {
        Args: { target_shift: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      log_severity: LogSeverity;
      handover_status: HandoverStatus;
      review_decision: ReviewDecision;
      notification_kind: NotificationKind;
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Profile = Tables<"profiles">;
export type Shift = Tables<"shifts">;
export type ShiftAssignment = Tables<"shift_assignments">;
export type LogEntry = Tables<"log_entries">;
export type Handover = Tables<"handovers">;
export type HandoverReview = Tables<"handover_reviews">;
export type Notification = Tables<"notifications">;
