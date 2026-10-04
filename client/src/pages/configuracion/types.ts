// Respuestas de la API de Configuración (ver server/routes/settings.ts).
import type { ExpenseNature } from '@shared/constants'

export interface BackupRow {
  file: string
  size: number
  created_at: string
  /** auto | manual | antes-de-restaurar | antes-de-ejemplo | antes-de-borrar… */
  kind: string
  label: string
}

export interface BackupsResponse {
  available: boolean
  message: string | null
  data_dir: string
  db_path: string
  backup_dir: string
  keep: number
  backups: BackupRow[]
}

export interface SystemInfo {
  version: string
  node: string
  platform: string
  in_memory: boolean
  db_path: string
  data_dir: string
  backup_dir: string
  db_size: number
  counts: { table: string; label: string; count: number }[]
  last_backup: BackupRow | null
  backups_count: number
}

export interface CategoryUsageRow {
  name: string
  nature?: ExpenseNature
  expenses: number
  amount: number
  recurring: number
  last_date: string | null
}

export interface CategoryUsage {
  categories: (CategoryUsageRow & { nature: ExpenseNature })[]
  others: CategoryUsageRow[]
}
