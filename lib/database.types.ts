
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "alert_settings": {
                  Row: {
                    "email_alerts": boolean,"last_sent_at": string | null,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email_alerts"?: boolean,"last_sent_at"?: string | null,"owner_id"?: string
                  }
                  Update: {
                    "email_alerts"?: boolean,"last_sent_at"?: string | null,"owner_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"apps": {
                  Row: {
                    "android_package": string | null,"asc_app_id": string | null,"color": string,"contact": string,"created_at": string,"description": string,"id": string,"ios_app_id": string | null,"ios_attest_env": string,"key": string,"name": string,"owner_id": string,"proof_mode": string,"slug": string,"store_url": string,"synced_at": string,"webhook_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "android_package"?: string | null,"asc_app_id"?: string | null,"color"?: string,"contact"?: string,"created_at"?: string,"description"?: string,"id"?: string,"ios_app_id"?: string | null,"ios_attest_env"?: string,"key": string,"name": string,"owner_id"?: string,"proof_mode"?: string,"slug": string,"store_url"?: string,"synced_at"?: string,"webhook_url"?: string | null
                  }
                  Update: {
                    "android_package"?: string | null,"asc_app_id"?: string | null,"color"?: string,"contact"?: string,"created_at"?: string,"description"?: string,"id"?: string,"ios_app_id"?: string | null,"ios_attest_env"?: string,"key"?: string,"name"?: string,"owner_id"?: string,"proof_mode"?: string,"slug"?: string,"store_url"?: string,"synced_at"?: string,"webhook_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"asc_connections": {
                  Row: {
                    "created_at": string,"issuer_id": string,"key_id": string,"last_error": string | null,"last_sync_at": string | null,"owner_id": string,"secret_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"issuer_id": string,"key_id": string,"last_error"?: string | null,"last_sync_at"?: string | null,"owner_id"?: string,"secret_id": string
                  }
                  Update: {
                    "created_at"?: string,"issuer_id"?: string,"key_id"?: string,"last_error"?: string | null,"last_sync_at"?: string | null,"owner_id"?: string,"secret_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"attest_challenges": {
                  Row: {
                    "app_id": string,"challenge": string,"device_tag": string,"expires_at": string,"used": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"challenge": string,"device_tag": string,"expires_at": string,"used"?: boolean
                  }
                  Update: {
                    "app_id"?: string,"challenge"?: string,"device_tag"?: string,"expires_at"?: string,"used"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "attest_challenges_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"attest_keys": {
                  Row: {
                    "app_id": string,"counter": number,"created_at": string,"device_tag": string,"key_id": string,"public_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"counter"?: number,"created_at"?: string,"device_tag": string,"key_id": string,"public_key": string
                  }
                  Update: {
                    "app_id"?: string,"counter"?: number,"created_at"?: string,"device_tag"?: string,"key_id"?: string,"public_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attest_keys_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"bug_reports": {
                  Row: {
                    "app_id": string,"body": string,"created_at": string,"device": string,"id": string,"reporter_name": string,"reporter_tag": string,"resolved": boolean,"screenshot_path": string | null,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"body": string,"created_at"?: string,"device"?: string,"id"?: string,"reporter_name": string,"reporter_tag": string,"resolved"?: boolean,"screenshot_path"?: string | null,"version": string
                  }
                  Update: {
                    "app_id"?: string,"body"?: string,"created_at"?: string,"device"?: string,"id"?: string,"reporter_name"?: string,"reporter_tag"?: string,"resolved"?: boolean,"screenshot_path"?: string | null,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bug_reports_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "author_name": string,"author_tag": string | null,"body": string,"created_at": string,"deleted": boolean,"down_count": number,"hidden": boolean,"id": string,"is_dev": boolean,"parent_id": string | null,"release_id": string,"up_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_name": string,"author_tag"?: string | null,"body": string,"created_at"?: string,"deleted"?: boolean,"down_count"?: number,"hidden"?: boolean,"id"?: string,"is_dev"?: boolean,"parent_id"?: string | null,"release_id": string,"up_count"?: number
                  }
                  Update: {
                    "author_name"?: string,"author_tag"?: string | null,"body"?: string,"created_at"?: string,"deleted"?: boolean,"down_count"?: number,"hidden"?: boolean,"id"?: string,"is_dev"?: boolean,"parent_id"?: string | null,"release_id"?: string,"up_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_release_id_fkey"
      columns: ["release_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id"]
    }
                  ]
                },"installs": {
                  Row: {
                    "app_id": string,"blocked_tags": (string)[],"device_tag": string,"guidelines_accepted_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"blocked_tags"?: (string)[],"device_tag": string,"guidelines_accepted_at"?: string | null
                  }
                  Update: {
                    "app_id"?: string,"blocked_tags"?: (string)[],"device_tag"?: string,"guidelines_accepted_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "installs_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"play_connections": {
                  Row: {
                    "client_email": string,"created_at": string,"owner_id": string,"secret_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_email": string,"created_at"?: string,"owner_id"?: string,"secret_id": string
                  }
                  Update: {
                    "client_email"?: string,"created_at"?: string,"owner_id"?: string,"secret_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "bucket": string,"hits": number,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"hits"?: number,"window_start": string
                  }
                  Update: {
                    "bucket"?: string,"hits"?: number,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"releases": {
                  Row: {
                    "app_id": string,"created_at": string,"down_count": number,"id": string,"notes": string,"published": boolean,"release_date": string,"source": string,"translations": NonNullable<Json>,"up_count": number,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"created_at"?: string,"down_count"?: number,"id"?: string,"notes"?: string,"published"?: boolean,"release_date"?: string,"source"?: string,"translations"?: NonNullable<Json>,"up_count"?: number,"version": string
                  }
                  Update: {
                    "app_id"?: string,"created_at"?: string,"down_count"?: number,"id"?: string,"notes"?: string,"published"?: boolean,"release_date"?: string,"source"?: string,"translations"?: NonNullable<Json>,"up_count"?: number,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "releases_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "comment_id": string,"created_at": string,"id": string,"reason": string,"reporter_tag": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_id": string,"created_at"?: string,"id"?: string,"reason"?: string,"reporter_tag": string
                  }
                  Update: {
                    "comment_id"?: string,"created_at"?: string,"id"?: string,"reason"?: string,"reporter_tag"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    }
                  ]
                },"votes": {
                  Row: {
                    "comment_id": string | null,"id": number,"release_id": string | null,"value": number,"voter_tag": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_id"?: string | null,"id"?: never,"release_id"?: string | null,"value": number,"voter_tag": string
                  }
                  Update: {
                    "comment_id"?: string | null,"id"?: never,"release_id"?: string | null,"value"?: number,"voter_tag"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "votes_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "votes_release_id_fkey"
      columns: ["release_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "asc_private_key":
{ Args: { "p_owner": string }; Returns: string
                           },
"asc_save_key":
{ Args: { "p_issuer": string,"p_key_id": string,"p_owner": string,"p_private_key": string }; Returns: undefined
                           },
"play_save_key":
{ Args: { "p_client_email": string,"p_json": string,"p_owner": string }; Returns: undefined
                           },
"play_service_account":
{ Args: { "p_owner": string }; Returns: string
                           },
"rate_limit_hit":
{ Args: { "p_bucket": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
