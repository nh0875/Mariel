// Configuración del negocio, guardada como JSON en la tabla settings.
import { all, run, tx } from '../db'
import { DEFAULT_EXPENSE_CATEGORIES, PAYMENT_METHOD_LABELS } from '../../shared/constants'
import type { Settings } from '../../shared/types'
import type { SettingsInput } from '../../shared/schemas'

export function defaultSettings(): Settings {
  return {
    business: {
      name: 'VINOH!',
      tagline: 'Viví el vino',
      owner: '',
      tax_id: '',
      address: '',
      phone: '',
      email: '',
      fiscal_condition: 'monotributo',
    },
    payment_methods: [
      { key: 'efectivo', label: PAYMENT_METHOD_LABELS.efectivo, fee_pct: 0, account_id: null },
      { key: 'transferencia', label: PAYMENT_METHOD_LABELS.transferencia, fee_pct: 0, account_id: null },
      { key: 'debito', label: PAYMENT_METHOD_LABELS.debito, fee_pct: 1.5, account_id: null },
      { key: 'credito', label: PAYMENT_METHOD_LABELS.credito, fee_pct: 3.5, account_id: null },
      { key: 'mercadopago', label: PAYMENT_METHOD_LABELS.mercadopago, fee_pct: 6.29, account_id: null },
      { key: 'otro', label: PAYMENT_METHOD_LABELS.otro, fee_pct: 0, account_id: null },
    ],
    expense_categories: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c })),
    usd_rate: 0,
    usd_rate_date: null,
    pricing: {
      target_margin_pct: 40,
      wholesale_discount_pct: 20,
      iva_pct: 21,
      iibb_pct: 3.5,
    },
    defaults: {
      min_stock: 6,
      units_per_box: 6,
    },
    onboarding: {
      completed: false,
      demo_loaded: false,
    },
  }
}

const OBJECT_KEYS = ['business', 'pricing', 'defaults', 'onboarding'] as const

/** Devuelve la configuración completa (valores guardados + valores por defecto para lo que falte). */
export function getSettings(): Settings {
  const s = defaultSettings() as unknown as Record<string, unknown>
  for (const row of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    if (row.key.startsWith('_')) continue // claves internas (ej. lo que había antes de cargar el ejemplo)
    try {
      const v = JSON.parse(row.value)
      if ((OBJECT_KEYS as readonly string[]).includes(row.key) && v && typeof v === 'object') {
        s[row.key] = { ...(s[row.key] as object), ...v }
      } else {
        s[row.key] = v
      }
    } catch {
      /* valor corrupto: se ignora y queda el default */
    }
  }
  return s as unknown as Settings
}

/** Guarda cambios parciales de configuración. Devuelve la configuración final. */
export function updateSettings(patch: SettingsInput | Partial<Settings>): Settings {
  const current = getSettings() as unknown as Record<string, unknown>
  tx(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const merged =
        (OBJECT_KEYS as readonly string[]).includes(key) && value && typeof value === 'object'
          ? { ...(current[key] as object), ...(value as object) }
          : value
      run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        JSON.stringify(merged),
      ])
    }
  })
  return getSettings()
}

/** % de comisión configurado para un medio de pago. */
export function feePctFor(method: string): number {
  return getSettings().payment_methods.find((m) => m.key === method)?.fee_pct ?? 0
}

/** Cuenta por defecto donde entra/sale la plata de un medio de pago. */
export function accountFor(method: string): number | null {
  return getSettings().payment_methods.find((m) => m.key === method)?.account_id ?? null
}
