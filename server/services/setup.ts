// Datos mínimos para que el sistema funcione desde el primer minuto.
import { all, run, scalar, tx } from '../db'
import { getSettings, updateSettings } from './settings'

/**
 * Si no hay cuentas, crea las 3 típicas (Caja, Banco, Mercado Pago) y asocia cada medio
 * de pago a su cuenta (efectivo → Caja, transferencia/tarjetas → Banco, QR → Mercado Pago).
 */
export function ensureBaseData() {
  tx(() => {
    if ((scalar<number>('SELECT COUNT(*) FROM accounts') ?? 0) === 0) {
      run("INSERT INTO accounts (name, kind, notes) VALUES ('Caja (efectivo)', 'efectivo', 'La plata física del local.')")
      run("INSERT INTO accounts (name, kind, notes) VALUES ('Banco', 'banco', 'Cuenta bancaria del negocio.')")
      run("INSERT INTO accounts (name, kind, notes) VALUES ('Mercado Pago', 'billetera', 'Cobros con QR, link de pago y tarjetas por MP.')")
    }
    const accounts = all<{ id: number; kind: string; name: string }>('SELECT id, kind, name FROM accounts WHERE active = 1 ORDER BY id')
    const byKind = (k: string) => accounts.find((a) => a.kind === k)?.id ?? accounts[0]?.id ?? null
    const s = getSettings()
    let changed = false
    const methods = s.payment_methods.map((m) => {
      if (m.account_id && accounts.some((a) => a.id === m.account_id)) return m
      changed = true
      const target =
        m.key === 'efectivo'
          ? byKind('efectivo')
          : m.key === 'mercadopago'
            ? byKind('billetera')
            : byKind('banco')
      return { ...m, account_id: target }
    })
    if (changed) updateSettings({ payment_methods: methods })
  })
}
