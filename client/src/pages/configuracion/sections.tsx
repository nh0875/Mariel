// Secciones de Configuración que se editan y guardan por separado (cada una manda solo sus claves).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  Boxes,
  CircleDollarSign,
  CreditCard,
  DollarSign,
  Landmark,
  Percent,
  Plus,
  QrCode,
  Store,
  Tags,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { AccountWithBalance, ExpenseCategorySetting, PaymentMethodSetting, Settings } from '@shared/types'
import { ACCOUNT_KIND_LABELS, PAYMENT_METHOD_LABELS, type ExpenseNature, type PaymentMethod } from '@shared/constants'
import type { SettingsInput } from '@shared/schemas'
import { today } from '@shared/dates'
import { api } from '@/lib/api'
import { date as fmtDate, int, money, pct, relativeDays, usd } from '@/lib/format'
import { useAccounts, useApi, useApiMutation } from '@/lib/queries'
import {
  Badge,
  Button,
  ChoiceCards,
  DateInput,
  Field,
  InfoTip,
  IntInput,
  Loading,
  MoneyInput,
  NumberInput,
  Select,
  TextInput,
  useConfirm,
} from '@/components/ui'
import { Example, SectionCard, nb, norm, plural, useDraft, useReportDirty } from './parts'
import type { CategoryUsage } from './types'

type OnDirty = (id: string, dirty: boolean) => void

/** Guarda una parte de la configuración y deja la respuesta en la caché al toque (sin esperar el refresco). */
function useSaveSettings(success: string, after?: () => void) {
  const qc = useQueryClient()
  return useApiMutation((patch: SettingsInput) => api.put<Settings>('/settings', patch), {
    success,
    onSuccess: (res) => {
      qc.setQueryData(['/settings', {}], res)
      after?.()
    },
  })
}

// ───────────────────────── Tu negocio ─────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function BusinessSection({ settings, onDirty }: { settings: Settings; onDirty?: OnDirty }) {
  const { draft, update, dirty, reset, saved } = useDraft(settings.business)
  useReportDirty('negocio', dirty, onDirty)
  const save = useSaveSettings('Listo, guardamos los datos de tu negocio', saved)
  if (!draft) return null
  const set = <K extends keyof Settings['business']>(k: K, v: Settings['business'][K]) => update((d) => ({ ...d, [k]: v }))
  const cuitDigits = draft.tax_id.replace(/\D/g, '')
  const errors = {
    name: !draft.name.trim() ? 'Poné el nombre del negocio (aparece en los Excel y comprobantes).' : null,
    email: draft.email.trim() && !EMAIL_RE.test(draft.email.trim()) ? 'Ese email no parece válido (ej: hola@tuvinoteca.com).' : null,
    tax_id: draft.tax_id.trim() && cuitDigits.length !== 11 ? `El CUIT tiene 11 números (escribiste ${cuitDigits.length}). Ej: 20-12345678-9.` : null,
  }
  const error = errors.name ?? errors.email ?? errors.tax_id
  return (
    <SectionCard
      id="negocio"
      icon={Store}
      title="Tu negocio"
      why={
        <>
          El nombre aparece arriba de cada Excel y en los comprobantes; tu nombre lo usamos para saludarte en Inicio. La <b>condición fiscal</b> define cómo leer los montos.
        </>
      }
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onReset={reset}
      onSave={() =>
        save.mutate({
          business: { ...draft, name: draft.name.trim(), tagline: draft.tagline.trim(), owner: draft.owner.trim(), tax_id: draft.tax_id.trim(), email: draft.email.trim() },
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="cfg-name" label="Nombre del negocio" required error={errors.name} hint="Como querés que aparezca en los Excel y comprobantes.">
          <TextInput id="cfg-name" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="Ej: VINOH!" aria-invalid={!!errors.name} />
        </Field>
        <Field htmlFor="cfg-tagline" label="Frase de la marca" hint="La que acompaña al nombre (la «bajada»). Ej: «Viví el vino».">
          <TextInput id="cfg-tagline" value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={200} placeholder="Viví el vino" />
        </Field>
        <Field htmlFor="cfg-owner" label="Dueña o dueño" hint={draft.owner.trim() ? `En Inicio te saludamos: «¡Hola, ${draft.owner.trim().split(' ')[0]}!»` : 'Para saludarte cuando abrís el sistema.'}>
          <TextInput id="cfg-owner" value={draft.owner} onChange={(e) => set('owner', e.target.value)} maxLength={120} placeholder="Ej: Mariel" autoComplete="name" />
        </Field>
        <Field htmlFor="cfg-cuit" label="CUIT" error={errors.tax_id} hint="Opcional. Sale en los comprobantes.">
          <TextInput id="cfg-cuit" value={draft.tax_id} onChange={(e) => set('tax_id', e.target.value)} maxLength={30} placeholder="20-12345678-9" inputMode="numeric" aria-invalid={!!errors.tax_id} />
        </Field>
        <Field htmlFor="cfg-address" label="Dirección" hint="Opcional.">
          <TextInput id="cfg-address" value={draft.address} onChange={(e) => set('address', e.target.value)} maxLength={200} placeholder="Ej: Av. Corrientes 1234, CABA" autoComplete="street-address" />
        </Field>
        <Field htmlFor="cfg-phone" label="Teléfono" hint="Opcional.">
          <TextInput id="cfg-phone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} maxLength={60} placeholder="Ej: 11 5555-0101" inputMode="tel" autoComplete="tel" />
        </Field>
        <Field htmlFor="cfg-email" label="Email" error={errors.email} hint="Opcional." className="sm:col-span-2 lg:col-span-1">
          <TextInput id="cfg-email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} maxLength={120} placeholder="hola@tuvinoteca.com" autoComplete="email" aria-invalid={!!errors.email} />
        </Field>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center gap-1.5">
          <p className="text-[14px] font-bold text-ink">Condición frente a ARCA (ex AFIP)</p>
          <InfoTip term="iva" />
        </div>
        <ChoiceCards
          columns={3}
          value={draft.fiscal_condition}
          onChange={(v) => set('fiscal_condition', v)}
          options={[
            { value: 'monotributo', title: 'Monotributo', description: 'Tus precios son finales, no discriminás IVA.' },
            { value: 'responsable_inscripto', title: 'Responsable inscripto', description: 'Cobrás y pagás IVA; el saldo lo liquida tu contador.' },
            { value: 'otro', title: 'Otro', description: 'Exento u otra situación.' },
          ]}
        />
        <p className="mt-3 rounded-xl border border-sky/40 bg-sky-soft/60 px-3.5 py-2.5 text-[14px] leading-snug text-ink-soft [&_b]:text-ink">
          <b>Sea cual sea tu condición, cargá todos los montos con impuestos incluidos</b>, tal como salen en el ticket o la factura. ¿Por qué? Porque es la plata que efectivamente entra y sale: así la caja
          cierra con el banco y los márgenes son los reales.{' '}
          {draft.fiscal_condition === 'responsable_inscripto' && 'Como sos responsable inscripto, recordá que parte de lo que cobrás es IVA que después pagás: tu contador hace esa cuenta aparte.'}
        </p>
      </div>
    </SectionCard>
  )
}

// ───────────────────────── Medios de pago ─────────────────────────

const METHOD_ICON: Record<PaymentMethod, LucideIcon> = {
  efectivo: Banknote,
  transferencia: ArrowRightLeft,
  debito: CreditCard,
  credito: CreditCard,
  mercadopago: QrCode,
  otro: CircleDollarSign,
}

const METHOD_GRID = 'md:grid-cols-[minmax(0,1.25fr)_112px_minmax(0,1fr)_104px]'

/**
 * Cuenta donde entra la plata de un medio de pago. Muestra solo el nombre de la cuenta (el saldo acá
 * no aporta y cortaba el texto en pantallas chicas). Si la cuenta elegida se desactivó, se avisa.
 */
function AccountNameSelect({ value, onChange, label }: { value: number | null; onChange: (id: number | null) => void; label: string }) {
  const { data: accounts = [] } = useAccounts()
  const current = accounts.find((a) => a.id === value)
  const options = accounts.filter((a) => a.active || a.id === value).map((a) => ({ value: a.id, label: a.active ? a.name : `${a.name} (desactivada)` }))
  return (
    <Select
      value={value ?? ''}
      onChange={(v) => onChange(v ? Number(v) : null)}
      options={options}
      placeholder="Elegí una cuenta…"
      aria-label={`Cuenta donde entra la plata de ${label}`}
      aria-invalid={value == null || (current != null && !current.active)}
    />
  )
}

export function PaymentMethodsSection({ settings, onDirty }: { settings: Settings; onDirty?: OnDirty }) {
  const { draft, update, dirty, reset, saved } = useDraft<PaymentMethodSetting[]>(settings.payment_methods)
  useReportDirty('medios-de-pago', dirty, onDirty)
  const { data: accounts } = useAccounts()
  const save = useSaveSettings('Listo, guardamos los medios de pago', saved)
  if (!draft) return null
  const set = (key: PaymentMethod, patch: Partial<PaymentMethodSetting>) => update((d) => d.map((m) => (m.key === key ? { ...m, ...patch } : m)))
  const badLabel = draft.find((m) => !m.label.trim())
  const badFee = draft.find((m) => !Number.isFinite(m.fee_pct) || m.fee_pct < 0 || m.fee_pct > 50)
  const noAccount = draft.find((m) => m.account_id == null)
  const deadAccount = accounts ? draft.find((m) => m.account_id != null && !accounts.some((a) => a.id === m.account_id && a.active)) : undefined
  const error = badLabel
    ? `Ponele un nombre a «${PAYMENT_METHOD_LABELS[badLabel.key]}».`
    : badFee
      ? `La comisión de «${badFee.label}» tiene que estar entre 0 % y 50 %.`
      : noAccount
        ? `Elegí en qué cuenta entra la plata de «${noAccount.label}».`
        : deadAccount
          ? `La cuenta elegida para «${deadAccount.label}» está desactivada: elegí otra.`
          : null
  const mp = draft.find((m) => m.key === 'mercadopago') ?? draft.find((m) => m.fee_pct > 0)
  const mpFee = mp ? (20000 * mp.fee_pct) / 100 : 0
  return (
    <SectionCard
      id="medios-de-pago"
      icon={CreditCard}
      title={
        <span className="inline-flex items-center gap-1.5">
          Medios de pago y comisiones <InfoTip term="comisiones" />
        </span>
      }
      why={
        <>
          Cada vez que cobrás con tarjeta o Mercado Pago se quedan con un porcentaje. Si lo cargás acá, <b>el sistema descuenta la comisión sola en cada venta</b> y tu ganancia es la real. La cuenta
          elegida es donde entra la plata cuando cobrás con ese medio.
        </>
      }
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onReset={reset}
      onSave={() => save.mutate({ payment_methods: draft.map((m) => ({ ...m, label: m.label.trim(), fee_pct: Math.round(m.fee_pct * 100) / 100 })) })}
    >
      <div className={`hidden gap-3 px-1.5 pb-2 md:grid ${METHOD_GRID}`}>
        <span className="vh-label pl-[46px]">Cómo lo llamás</span>
        <span className="vh-label">Comisión</span>
        <span className="vh-label">Entra en la cuenta</span>
        <span className="vh-label pr-2 text-right">De $ 10.000 quedan</span>
      </div>
      <ul className="space-y-3 md:space-y-2">
        {draft.map((m) => {
          const Icon = METHOD_ICON[m.key]
          const net = 10000 * (1 - (m.fee_pct || 0) / 100)
          return (
            <li key={m.key} className={`grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl border border-line p-3 md:items-center md:gap-y-0 md:rounded-xl md:border-0 md:bg-cream/50 md:p-1.5 ${METHOD_GRID}`}>
              <div className="col-span-2 flex min-w-0 items-center gap-2.5 md:col-span-1">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-soft text-sky-deep" aria-hidden>
                  <Icon size={18} />
                </span>
                <TextInput value={m.label} onChange={(e) => set(m.key, { label: e.target.value })} maxLength={60} aria-label={`Nombre de ${PAYMENT_METHOD_LABELS[m.key]}`} aria-invalid={!m.label.trim()} />
              </div>
              <label className="flex min-w-0 flex-col gap-1 md:block">
                <span className="text-[12.5px] font-bold text-ink-soft md:hidden">Comisión</span>
                <NumberInput value={m.fee_pct} onChange={(v) => set(m.key, { fee_pct: v ?? 0 })} decimals={2} suffix="%" aria-label={`Comisión de ${m.label}`} aria-invalid={m.fee_pct < 0 || m.fee_pct > 50} />
              </label>
              <p className="flex min-w-0 flex-col items-end justify-end gap-1 text-[13.5px] text-ink-soft md:order-last md:block md:pr-2 md:text-right">
                <span className="text-[12.5px] font-bold md:hidden">De $ 10.000 te quedan</span>
                <b className="vh-num flex h-11 items-center text-[15px] whitespace-nowrap text-ink md:inline md:h-auto">{nb(money(net))}</b>
              </p>
              <label className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1 md:block">
                <span className="text-[12.5px] font-bold text-ink-soft md:hidden">Entra en la cuenta</span>
                <AccountNameSelect value={m.account_id} onChange={(id) => set(m.key, { account_id: id })} label={m.label} />
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper px-3.5 py-3 text-[13.5px] leading-snug text-ink-soft">
          <p className="mb-1 font-extrabold text-ink">Valores de referencia</p>
          <ul className="space-y-0.5">
            <li>Mercado Pago (Point o QR): <b className="text-ink">~6 %</b></li>
            <li>Tarjeta de crédito: <b className="text-ink">~3,5 %</b></li>
            <li>Tarjeta de débito: <b className="text-ink">~1,5 %</b></li>
            <li>Efectivo y transferencia: <b className="text-ink">0 %</b></li>
          </ul>
          <p className="mt-1.5">Cambian según el plan y el plazo de acreditación: <b className="text-ink">revisá lo que te cobra tu banco</b> o el resumen de Mercado Pago.</p>
        </div>
        <div className="space-y-2">
          {mp && mp.fee_pct > 0 && (
            <Example>
              Vendés <b>$ 20.000</b> por {mp.label} al {nb(pct(mp.fee_pct / 100, 2))} → la comisión es <b>{nb(money(mpFee))}</b> y te quedan <b>{nb(money(20000 - mpFee))}</b>. Esa comisión aparece como costo en el
              resultado, no se pierde de vista.
            </Example>
          )}
          <p className="text-[13px] text-muted">Los cambios rigen para las ventas que cargues de acá en adelante; las ventas ya cargadas guardan la comisión con la que se registraron.</p>
        </div>
      </div>
    </SectionCard>
  )
}

// ───────────────────────── Cuentas ─────────────────────────

export function AccountsSection({ settings }: { settings: Settings }) {
  const { data: accounts, isLoading, error } = useAccounts()
  const active = (accounts ?? []).filter((a) => a.active)
  const total = active.reduce((s, a) => s + a.balance, 0)
  const methodsFor = (a: AccountWithBalance) => settings.payment_methods.filter((m) => m.account_id === a.id).map((m) => m.label)
  return (
    <SectionCard
      id="cuentas"
      icon={Landmark}
      title={
        <span className="inline-flex items-center gap-1.5">
          Tus cuentas <InfoTip term="caja" />
        </span>
      }
      why={
        <>
          Son los lugares donde está la plata (la caja del local, el banco, Mercado Pago…). Cada cobro y cada pago entra o sale de una de ellas, por eso el sistema sabe cuánta plata tenés. Para crear,
          renombrar o cargar el saldo inicial de una cuenta, andá a <b>Caja y bancos</b>.
        </>
      }
      extraActions={
        <Link to="/caja">
          <Button size="sm" iconRight={ArrowRight}>
            Administrar en Caja y bancos
          </Button>
        </Link>
      }
    >
      {isLoading ? (
        <Loading label="Buscando tus cuentas…" />
      ) : error ? (
        <p className="text-[14px] text-bad">No pudimos leer las cuentas. Probá recargar la página.</p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {active.map((a) => {
              const methods = methodsFor(a)
              const Icon = a.kind === 'efectivo' ? Banknote : a.kind === 'banco' ? Landmark : Wallet
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <Icon size={18} className="shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink">{a.name}</p>
                    <p className="text-[13px] text-muted">
                      {ACCOUNT_KIND_LABELS[a.kind]}
                      {methods.length > 0 && <> · Entra: {methods.join(', ')}</>}
                    </p>
                  </div>
                  <span className={`vh-num text-[16px] font-extrabold ${a.balance < 0 ? 'text-bad' : 'text-ink'}`}>{nb(money(a.balance))}</span>
                </li>
              )
            })}
            <li className="flex items-center gap-3 bg-cream/60 px-4 py-3">
              <span className="flex-1 font-extrabold text-ink">Plata disponible hoy</span>
              <span className={`vh-num text-[17px] font-extrabold ${total < 0 ? 'text-bad' : 'text-ink'}`}>{nb(money(total))}</span>
            </li>
          </ul>
          {(accounts ?? []).length > active.length && (
            <p className="mt-2 text-[13px] text-muted">
              Además tenés {plural((accounts ?? []).length - active.length, 'cuenta desactivada', 'cuentas desactivadas')}: las ves en Caja y bancos.
            </p>
          )}
        </>
      )}
    </SectionCard>
  )
}

// ───────────────────────── Categorías de gastos ─────────────────────────

interface CatDraft {
  uid: number
  /** Nombre con el que estaba guardada (null = nueva). */
  orig: string | null
  name: string
  nature: ExpenseNature
}

let uidSeq = 1
const toDraft = (cats: ExpenseCategorySetting[]): CatDraft[] => cats.map((c) => ({ uid: uidSeq++, orig: c.name, name: c.name, nature: c.nature }))
const clean = (d: CatDraft[]) => d.map((c) => ({ name: c.name.trim(), nature: c.nature }))
const NATURE_OPTIONS = [
  { value: 'fijo', label: 'Fijo' },
  { value: 'variable', label: 'Variable' },
]

export function CategoriesSection({ settings, onDirty }: { settings: Settings; onDirty?: OnDirty }) {
  const source = settings.expense_categories
  const sourceKey = JSON.stringify(source)
  const [items, setItems] = useState<CatDraft[]>(() => toDraft(source))
  const [touched, setTouched] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNature, setNewNature] = useState<ExpenseNature>('variable')
  const [addError, setAddError] = useState<string | null>(null)
  const usage = useApi<CategoryUsage>('/settings/category-usage')
  const confirm = useConfirm()

  useEffect(() => {
    if (!touched) setItems(toDraft(source))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])
  const dirty = touched && JSON.stringify(clean(items)) !== sourceKey
  useReportDirty('categorias', dirty, onDirty)
  const save = useSaveSettings('Listo, guardamos las categorías de gastos', () => setTouched(false))

  const usageOf = (name: string | null) => (name ? usage.data?.categories.find((c) => c.name === name) ?? usage.data?.others.find((c) => c.name === name) : undefined)
  const change = (fn: (d: CatDraft[]) => CatDraft[]) => {
    setTouched(true)
    setItems(fn)
  }

  const names = items.map((c) => norm(c.name))
  const dupIdx = names.findIndex((n, i) => n && names.indexOf(n) !== i)
  const emptyIdx = items.findIndex((c) => !c.name.trim())
  const error =
    items.length === 0
      ? 'Dejá al menos una categoría (por ejemplo «Otros»).'
      : emptyIdx >= 0
        ? 'Hay una categoría sin nombre: escribile uno o sacala.'
        : dupIdx >= 0
          ? `«${items[dupIdx].name.trim()}» está repetida. Dejá una sola.`
          : null

  const add = (name = newName, nature = newNature) => {
    const n = name.trim()
    if (!n) return setAddError('Escribí el nombre de la categoría.')
    if (items.some((c) => norm(c.name) === norm(n))) return setAddError(`Ya tenés «${n}».`)
    change((d) => [...d, { uid: uidSeq++, orig: null, name: n, nature }])
    setNewName('')
    setAddError(null)
  }

  const remove = async (c: CatDraft) => {
    const u = usageOf(c.orig)
    const count = (u?.expenses ?? 0) + (u?.recurring ?? 0)
    if (count > 0) {
      const ok = await confirm({
        title: `¿Sacar «${c.orig}» de la lista?`,
        message: (
          <>
            {u?.expenses ? (
              <p>
                Tenés <b>{plural(u.expenses, 'gasto cargado', 'gastos cargados')}</b> con esta categoría. <b>Esos gastos no cambian</b>: siguen apareciendo con «{c.orig}» en los reportes.
              </p>
            ) : null}
            {u?.recurring ? (
              <p className="mt-2">
                <b>Ojo:</b> {u.recurring === 1 ? 'un gasto fijo usa' : `${int(u.recurring)} gastos fijos usan`} esta categoría y {u.recurring === 1 ? 'se va' : 'se van'} a seguir generando con «{c.orig}». Si no querés eso, cambiales la
                categoría en <b>Gastos → Gastos fijos del mes</b>.
              </p>
            ) : null}
            <p className="mt-2">Solo deja de aparecer para elegir en los gastos nuevos. (Recordá tocar «Guardar» para que quede.)</p>
          </>
        ),
        confirmText: 'Sí, sacarla',
      })
      if (!ok) return
    }
    change((d) => d.filter((x) => x.uid !== c.uid))
  }

  const fixedCount = items.filter((c) => c.nature === 'fijo').length

  return (
    <SectionCard
      id="categorias"
      icon={Tags}
      title="Categorías de gastos"
      why={
        <>
          Agrupan tus gastos para ver <b>en qué se va la plata</b> (Reportes y Gastos). Marcá cada una como <b>fija</b> (se paga igual, vendas o no: alquiler, sueldos) o <b>variable</b> (acompaña a las
          ventas: envíos, packaging). Con los fijos se calcula el punto de equilibrio <InfoTip term="punto_equilibrio" />.
        </>
      }
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onReset={() => {
        setTouched(false)
        setItems(toDraft(source))
        setAddError(null)
      }}
      onSave={() =>
        save.mutate({
          expense_categories: clean(items),
          // Los gastos fijos (plantillas) pasan al nombre nuevo; los gastos ya cargados no cambian.
          category_renames: items.filter((c) => c.orig && c.name.trim() && c.name.trim() !== c.orig).map((c) => ({ from: c.orig!, to: c.name.trim() })),
        } as SettingsInput)
      }
    >
      <p className="mb-3 text-[13.5px] text-ink-soft">
        {int(items.length)} categorías · {int(fixedCount)} fijas y {int(items.length - fixedCount)} variables.{' '}
        <span className="text-muted">Si renombrás o sacás una, los gastos ya cargados mantienen su nombre viejo (los gastos fijos, en cambio, pasan solos al nombre nuevo).</span>
      </p>
      <ul className="space-y-2">
        {items.map((c) => {
          const u = usageOf(c.orig)
          const renamed = c.orig && c.name.trim() && norm(c.name) !== norm(c.orig)
          const used = (u?.expenses ?? 0) + (u?.recurring ?? 0)
          return (
            <li key={c.uid} className="grid grid-cols-[112px_minmax(0,1fr)_32px] items-center gap-x-2 gap-y-1.5 rounded-xl border border-line bg-paper p-2 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,260px)_32px]">
              <TextInput
                value={c.name}
                onChange={(e) => change((d) => d.map((x) => (x.uid === c.uid ? { ...x, name: e.target.value } : x)))}
                maxLength={80}
                className="order-1 col-span-2 !h-10 md:order-none md:col-span-1"
                aria-label="Nombre de la categoría"
                aria-invalid={!c.name.trim()}
              />
              <Select
                value={c.nature}
                onChange={(v) => change((d) => d.map((x) => (x.uid === c.uid ? { ...x, nature: v as ExpenseNature } : x)))}
                options={NATURE_OPTIONS}
                className="order-3 md:order-none [&_select]:!h-10"
                aria-label="Fijo o variable"
              />
              <p className="order-4 col-span-2 text-[12.5px] leading-snug text-muted md:order-none md:col-span-1">
                {c.orig == null ? (
                  <Badge tone="sky">Nueva: se agrega al guardar</Badge>
                ) : renamed && used > 0 ? (
                  <span className="font-semibold text-warn">
                    {u?.expenses ? `${u.expenses === 1 ? 'El gasto ya cargado sigue' : `Los ${int(u.expenses)} gastos ya cargados siguen`} como «${c.orig}». ` : ''}
                    {u?.recurring ? `${u.recurring === 1 ? 'El gasto fijo pasa' : `Los ${int(u.recurring)} gastos fijos pasan`} al nombre nuevo.` : ''}
                  </span>
                ) : used > 0 ? (
                  <>
                    {plural(u?.expenses ?? 0, 'gasto', 'gastos')}
                    {u?.recurring ? ` y ${plural(u.recurring, 'gasto fijo', 'gastos fijos')}` : ''}
                    {u?.amount ? (
                      <>
                        {' · '}
                        <span className="whitespace-nowrap">{nb(money(u.amount))}</span>
                      </>
                    ) : null}
                  </>
                ) : usage.isLoading ? (
                  '…'
                ) : (
                  'Todavía sin gastos'
                )}
              </p>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(c)} aria-label={`Sacar ${c.name || 'categoría'}`} title="Sacar de la lista" className="order-2 !px-0 md:order-none" />
            </li>
          )
        })}
      </ul>

      <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-cream/50 p-3">
        <p className="mb-2 text-[14px] font-bold text-ink">Agregar una categoría</p>
        <div className="flex flex-wrap items-start gap-2">
          <TextInput
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setAddError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            maxLength={80}
            placeholder="Ej: Fletes de bodega"
            className="min-w-[200px] flex-1"
            aria-label="Nombre de la categoría nueva"
          />
          <Select value={newNature} onChange={(v) => setNewNature(v as ExpenseNature)} options={NATURE_OPTIONS} className="w-[130px]" aria-label="Fija o variable" />
          <Button icon={Plus} onClick={() => add()}>
            Agregar
          </Button>
        </div>
        {addError ? <p className="mt-1.5 text-[13px] font-semibold text-bad">{addError}</p> : <p className="mt-1.5 text-[13px] text-muted">Apretá Enter para agregarla rápido. Después tocá «Guardar».</p>}
      </div>

      {usage.data && usage.data.others.length > 0 && (
        <div className="mt-4">
          <p className="text-[14px] font-bold text-ink">Categorías que aparecen en gastos viejos</p>
          <p className="mb-2 text-[13px] text-muted">Ya no están en la lista, pero hay gastos cargados con ese nombre. Si querés volver a usarlas, sumalas de nuevo.</p>
          <div className="flex flex-wrap gap-2">
            {usage.data.others
              .filter((o) => !items.some((c) => norm(c.name) === norm(o.name)))
              .map((o) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => add(o.name, 'variable')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 py-1 text-[13px] font-bold text-ink-soft hover:border-brown/50 hover:text-ink"
                  title={`${plural(o.expenses, 'gasto', 'gastos')} con esta categoría`}
                >
                  <Plus size={13} aria-hidden /> {o.name} <span className="font-semibold text-muted">({int(o.expenses)})</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ───────────────────────── Precios ─────────────────────────

export function PricingSection({ settings, onDirty }: { settings: Settings; onDirty?: OnDirty }) {
  const { draft, update, dirty, reset, saved } = useDraft(settings.pricing)
  useReportDirty('precios', dirty, onDirty)
  const save = useSaveSettings('Listo, guardamos los valores de precios', saved)
  if (!draft) return null
  const set = (k: keyof Settings['pricing'], v: number | null) => update((d) => ({ ...d, [k]: v ?? 0 }))
  const m = draft.target_margin_pct / 100
  const priceForM = m < 1 ? 6000 / (1 - m) : 0
  const markup = m < 1 ? m / (1 - m) : 0
  const wholesale = 10000 * (1 - draft.wholesale_discount_pct / 100)
  const iva = draft.iva_pct / 100
  const finalWithIva = 10000 * (1 + iva)
  const iibb = (10000 * draft.iibb_pct) / 100
  const errors = {
    target: draft.target_margin_pct < 0 || draft.target_margin_pct > 95 ? 'Entre 0 % y 95 %.' : null,
    wholesale: draft.wholesale_discount_pct < 0 || draft.wholesale_discount_pct > 90 ? 'Entre 0 % y 90 %.' : null,
    iva: draft.iva_pct < 0 || draft.iva_pct > 50 ? 'Entre 0 % y 50 %.' : null,
    iibb: draft.iibb_pct < 0 || draft.iibb_pct > 20 ? 'Entre 0 % y 20 %.' : null,
  }
  const error = Object.values(errors).some(Boolean) ? 'Revisá los porcentajes marcados en rojo.' : null
  return (
    <SectionCard
      id="precios"
      icon={Percent}
      title="Precios y márgenes"
      why={
        <>
          Son los valores que usa la <b>Calculadora de precios</b> y las sugerencias al cargar vinos. Con inflación conviene revisarlos seguido: si el costo sube y el precio no, ganás menos sin darte
          cuenta.
        </>
      }
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onReset={reset}
      onSave={() => save.mutate({ pricing: draft })}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Field htmlFor="cfg-margin" label="Margen objetivo" info="margen_vs_markup" error={errors.target} hint="Cuánto querés que te quede de cada venta, sobre el precio.">
            <NumberInput id="cfg-margin" value={draft.target_margin_pct} onChange={(v) => set('target_margin_pct', v)} suffix="%" decimals={1} aria-invalid={!!errors.target} />
          </Field>
          <Example>
            Con {nb(pct(m, 1))}, un vino que te cuesta <b>$ 6.000</b> lo vendés a <b>{nb(money(Math.round(priceForM)))}</b> (precio = costo ÷ (1 − {nb(pct(m, 1))})). Ojo: es un recargo del {nb(pct(markup, 1))} sobre el
            costo, no del {nb(pct(m, 1))}.
          </Example>
        </div>
        <div className="space-y-2">
          <Field
            htmlFor="cfg-wholesale"
            label={
              <span className="inline-flex items-center gap-1.5">
                Descuento mayorista
                <InfoTip title="Descuento mayorista" text="Cuánto más barato le vendés a restós y vinotecas que al público. Se usa como sugerencia para el precio mayorista al cargar un vino." />
              </span>
            }
            error={errors.wholesale}
            hint="Respecto del precio al público."
          >
            <NumberInput id="cfg-wholesale" value={draft.wholesale_discount_pct} onChange={(v) => set('wholesale_discount_pct', v)} suffix="%" decimals={1} aria-invalid={!!errors.wholesale} />
          </Field>
          <Example>
            Si el precio minorista es <b>$ 10.000</b>, el mayorista sugerido es <b>{nb(money(Math.round(wholesale)))}</b>.
          </Example>
        </div>
        <div className="space-y-2">
          <Field htmlFor="cfg-iva" label="IVA" info="iva" error={errors.iva} hint="El general es 21 %. Es de referencia: el sistema no le suma IVA a nada, porque todo se carga con impuestos incluidos.">
            <NumberInput id="cfg-iva" value={draft.iva_pct} onChange={(v) => set('iva_pct', v)} suffix="%" decimals={1} aria-invalid={!!errors.iva} />
          </Field>
          <Example>
            En un precio final de <b>{nb(money(Math.round(finalWithIva)))}</b>, <b>{nb(money(Math.round(finalWithIva - 10000)))}</b> son IVA y $ 10.000 es el precio sin IVA.
            {settings.business.fiscal_condition === 'monotributo' && ' Como sos monotributista, no lo discriminás: tus precios ya son finales.'}
          </Example>
        </div>
        <div className="space-y-2">
          <Field htmlFor="cfg-iibb" label="Ingresos Brutos (IIBB)" info="iibb" error={errors.iibb} hint="Depende de tu provincia y actividad (suele ir de 3 % a 5 %).">
            <NumberInput id="cfg-iibb" value={draft.iibb_pct} onChange={(v) => set('iibb_pct', v)} suffix="%" decimals={2} aria-invalid={!!errors.iibb} />
          </Field>
          <Example>
            De cada <b>$ 10.000</b> que vendés, <b>{nb(money(Math.round(iibb)))}</b> van a Ingresos Brutos.
          </Example>
        </div>
      </div>
    </SectionCard>
  )
}

// ───────────────────────── Dólar ─────────────────────────

export function UsdSection({ settings, onDirty }: { settings: Settings; onDirty?: OnDirty }) {
  const { draft, update, dirty, reset, saved } = useDraft({ usd_rate: settings.usd_rate, usd_rate_date: settings.usd_rate_date })
  useReportDirty('dolar', dirty, onDirty)
  const save = useSaveSettings('Listo, guardamos la cotización del dólar', saved)
  if (!draft) return null
  const rate = draft.usd_rate || 0
  const old = settings.usd_rate > 0 && settings.usd_rate_date ? (Date.now() - new Date(settings.usd_rate_date + 'T12:00:00').getTime()) / 86_400_000 > 30 : false
  const error = rate < 0 ? 'La cotización no puede ser negativa.' : rate > 0 && !draft.usd_rate_date ? 'Poné la fecha de la cotización (así sabés si está vieja).' : null
  return (
    <SectionCard
      id="dolar"
      icon={DollarSign}
      title={
        <span className="inline-flex items-center gap-1.5">
          Dólar de referencia <InfoTip term="dolar" />
        </span>
      }
      why={
        <>
          <b>Actualizala cuando quieras: se usa solo para mostrar equivalentes</b> en dólares: cuánta plata tenés en Caja y bancos y el precio de una caja en la Calculadora. El sistema trabaja siempre en pesos.
        </>
      }
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onReset={reset}
      onSave={() => save.mutate({ usd_rate: rate, usd_rate_date: rate > 0 ? draft.usd_rate_date : null })}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field htmlFor="cfg-usd" label="Cotización (pesos por dólar)" hint="La que uses de referencia: oficial, MEP, blue… Si dejás 0, no se muestran equivalentes.">
          <MoneyInput id="cfg-usd"
            value={draft.usd_rate}
            onChange={(v) => update((d) => ({ ...d, usd_rate: v ?? 0, usd_rate_date: v && v !== settings.usd_rate ? today() : d.usd_rate_date }))}
          />
        </Field>
        <Field htmlFor="cfg-usd-date" label="Fecha de la cotización" hint={draft.usd_rate_date ? `Cargada ${relativeDays(draft.usd_rate_date)} (${fmtDate(draft.usd_rate_date)}).` : 'Cuándo la miraste.'}>
          <div className="flex gap-2">
            <DateInput id="cfg-usd-date" value={draft.usd_rate_date} onChange={(v) => update((d) => ({ ...d, usd_rate_date: v || null }))} max={today()} className="flex-1" />
            <Button onClick={() => update((d) => ({ ...d, usd_rate_date: today() }))}>Hoy</Button>
          </div>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rate > 0 ? (
          <Example className="flex-1">
            Con <b>{nb(money(rate))}</b> por dólar, <b>$ 1.000.000</b> son <b>{nb(usd(1_000_000 / rate))}</b>.
          </Example>
        ) : (
          <Example className="flex-1">Sin cotización cargada, el sistema no muestra montos en dólares (y no pasa nada).</Example>
        )}
        {old && !dirty && <Badge tone="warn">La cotización tiene más de un mes: actualizala si la usás</Badge>}
      </div>
    </SectionCard>
  )
}

// ───────────────────────── Stock ─────────────────────────

export function StockDefaultsSection({ settings, onDirty }: { settings: Settings; onDirty?: OnDirty }) {
  const { draft, update, dirty, reset, saved } = useDraft(settings.defaults)
  useReportDirty('stock', dirty, onDirty)
  const save = useSaveSettings('Listo, guardamos los valores para vinos nuevos', saved)
  if (!draft) return null
  const errors = {
    min: draft.min_stock < 0 ? 'No puede ser negativo.' : null,
    box: draft.units_per_box < 1 || draft.units_per_box > 48 ? 'Entre 1 y 48 botellas.' : null,
  }
  const error = errors.min ?? errors.box
  const perBox = Math.max(draft.units_per_box || 1, 1)
  const example = perBox * 2 + Math.min(3, perBox - 1)
  return (
    <SectionCard
      id="stock"
      icon={Boxes}
      title="Stock: valores para vinos nuevos"
      why={
        <>
          Se completan solos cada vez que cargás un vino nuevo (después cada vino puede tener los suyos en su ficha). Así no te olvidás de ponerle un mínimo y el sistema te avisa a tiempo para reponer.
        </>
      }
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onReset={reset}
      onSave={() => save.mutate({ defaults: draft })}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Field htmlFor="cfg-min-stock" label="Stock mínimo" info="stock_minimo" error={errors.min} hint="En botellas.">
            <IntInput id="cfg-min-stock" value={draft.min_stock} onChange={(v) => update((d) => ({ ...d, min_stock: v ?? 0 }))} suffix="bot." aria-invalid={!!errors.min} />
          </Field>
          <Example>
            Con mínimo <b>{int(draft.min_stock)}</b>: cuando a un vino le queden {int(draft.min_stock)} botellas o menos, te avisamos en Inicio y en Vinos para que lo repongas.
          </Example>
        </div>
        <div className="space-y-2">
          <Field htmlFor="cfg-per-box" label="Botellas por caja" error={errors.box} hint="Lo más común son cajas de 6.">
            <IntInput id="cfg-per-box" value={draft.units_per_box} onChange={(v) => update((d) => ({ ...d, units_per_box: v ?? 1 }))} suffix="bot." aria-invalid={!!errors.box} />
          </Field>
          <Example>
            Con cajas de {int(perBox)}, {int(example)} botellas se muestran como{' '}
            <b>
              {Math.floor(example / perBox)} cajas{example % perBox ? ` y ${example % perBox} botella${example % perBox === 1 ? '' : 's'}` : ''}
            </b>
            , y los pedidos sugeridos se redondean a cajas cerradas.
          </Example>
        </div>
      </div>
    </SectionCard>
  )
}
