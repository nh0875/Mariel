// Formulario de "gasto fijo" (plantilla): lo que se repite todos los meses (alquiler, sueldos, abonos).
// Se carga una vez; cada mes se genera el gasto real con un clic.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Repeat, Trash2, Waves } from 'lucide-react'
import { DEFAULT_EXPENSE_CATEGORIES, type ExpenseNature } from '@shared/constants'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useApiMutation, useSettings } from '@/lib/queries'
import { AccountSelect, Button, Checkbox, ChoiceCards, Combobox, Field, IntInput, Modal, MoneyInput, TextInput, useConfirm } from '@/components/ui'
import type { RecurringRow } from './types'

interface FormState {
  description: string
  category: string | null
  amount: number | null
  day: number | null
  nature: ExpenseNature
  accountId: number | null
  autoPaid: boolean
  active: boolean
}

const empty = (): FormState => ({ description: '', category: null, amount: null, day: 10, nature: 'fijo', accountId: null, autoPaid: false, active: true })

export function RecurringFormModal({ open, onClose, template }: { open: boolean; onClose: () => void; template?: RecurringRow | null }) {
  const { data: settings } = useSettings()
  const categories = settings?.expense_categories?.length ? settings.expense_categories : DEFAULT_EXPENSE_CATEGORIES
  const confirm = useConfirm()
  const [f, setF] = useState<FormState>(empty)
  const [touched, setTouched] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const isEdit = !!template

  useEffect(() => {
    if (!open) return
    setF(
      template
        ? {
            description: template.description,
            category: template.category,
            amount: template.amount,
            day: template.day_of_month,
            nature: template.nature,
            accountId: template.account_id,
            autoPaid: template.auto_paid,
            active: template.active,
          }
        : empty(),
    )
    setTouched(false)
    setShowErrors(false)
  }, [open, template])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setTouched(true)
    setF((s) => ({ ...s, [k]: v }))
  }

  const categoryOptions = useMemo(() => {
    const opts = categories.map((c) => ({ value: c.name, label: c.name, sublabel: c.nature === 'fijo' ? 'Fijo' : 'Variable' }))
    if (f.category && !opts.some((o) => o.value === f.category)) opts.unshift({ value: f.category, label: f.category, sublabel: 'Categoría propia' })
    return opts
  }, [categories, f.category])

  const errors = {
    description: !f.description.trim() ? 'Poné un nombre, ej: «Alquiler del local».' : undefined,
    category: !f.category ? 'Elegí una categoría.' : undefined,
    amount: !f.amount || f.amount <= 0 ? '¿Cuánto es por mes? Tiene que ser más de $ 0.' : undefined,
    day: !f.day || f.day < 1 || f.day > 28 ? 'Elegí un día entre 1 y 28.' : undefined,
    account: f.autoPaid && !f.accountId ? 'Si se paga solo, elegí de qué cuenta se debita.' : undefined,
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : undefined)

  // Candado para no mandar dos veces el mismo formulario (dos Enter seguidos llegan antes de que se vuelva a dibujar).
  const submitting = useRef(false)
  const save = useApiMutation(
    (body: Record<string, unknown>) => (isEdit ? api.put<RecurringRow>(`/recurring-expenses/${template!.id}`, body) : api.post<RecurringRow>('/recurring-expenses', body)),
    {
      success: (r) => (isEdit ? `Gasto fijo «${r.description}» actualizado` : `Gasto fijo «${r.description}» agregado: se va a cargar el día ${r.day_of_month} de cada mes`),
      onSuccess: () => onClose(),
    },
  )
  const remove = useApiMutation(
    async (id: number) => {
      onClose()
      await api.del(`/recurring-expenses/${id}`)
    },
    { success: 'Gasto fijo borrado. Los gastos que ya se habían cargado quedan como están.' },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    // Enter dos veces seguidas no tiene que crear el gasto fijo dos veces.
    if (save.isPending || submitting.current) return
    if (hasErrors) {
      setShowErrors(true)
      return
    }
    submitting.current = true
    save.mutate(
      {
        description: f.description.trim(),
        category: f.category,
        amount: f.amount,
        nature: f.nature,
        day_of_month: f.day,
        account_id: f.accountId,
        auto_paid: f.autoPaid,
        active: f.active,
      },
      { onSettled: () => (submitting.current = false) },
    )
  }

  const askDelete = async () => {
    if (!template) return
    const ok = await confirm({
      title: `¿Borrar «${template.description}»?`,
      message: (
        <div className="space-y-2">
          <p>Deja de generarse cada mes.</p>
          {template.generated_count > 0 && (
            <p>
              Los {template.generated_count} gasto{template.generated_count === 1 ? '' : 's'} que ya se cargaron desde acá quedan como están: son gastos reales.
            </p>
          )}
          <p>
            Si solo querés frenarlo un tiempo (ej: un empleado de licencia), mejor <b>pausalo</b> desde Editar.
          </p>
        </div>
      ),
      confirmText: 'Sí, borrar',
      danger: true,
    })
    if (ok) remove.mutate(template.id)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!touched}
      title={isEdit ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      subtitle={isEdit ? 'Los cambios valen para los meses que generes de ahora en adelante. Los gastos ya cargados no cambian.' : 'Algo que pagás todos los meses: lo cargás una vez y después se genera solo.'}
      footer={
        <>
          {isEdit && (
            <Button variant="ghost" icon={Trash2} className="mr-auto text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
              Borrar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="recurring-form" loading={save.isPending}>
            {isEdit ? 'Guardar cambios' : 'Agregar gasto fijo'}
          </Button>
        </>
      }
    >
      <form id="recurring-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="¿Qué es?" required error={err('description')} hint={!err('description') ? 'Ej: Alquiler del local, Sueldo de Laura, Internet.' : undefined}>
          <TextInput value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Ej: Alquiler del local" maxLength={200} aria-invalid={!!err('description')} aria-label="Nombre del gasto fijo" />
        </Field>
        <Field label="Categoría" required error={err('category')}>
          <Combobox
            options={categoryOptions}
            value={f.category}
            invalid={!!err('category')}
            onChange={(v) => {
              setTouched(true)
              const c = categories.find((x) => x.name === v)
              setF((s) => ({ ...s, category: v, nature: c?.nature ?? s.nature }))
            }}
            placeholder="Elegí una categoría…"
            searchPlaceholder="Buscá o escribí una nueva…"
            onCreate={(text) => {
              setTouched(true)
              setF((s) => ({ ...s, category: text.trim() }))
            }}
            createLabel="Usar la categoría"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Monto por mes" required error={err('amount')}>
            <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} aria-label="Monto por mes" />
          </Field>
          <Field label="Día del mes" required error={err('day')} hint={!err('day') ? 'Del 1 al 28, así existe en todos los meses.' : undefined}>
            <IntInput value={f.day} onChange={(v) => set('day', v)} aria-label="Día del mes" suffix="de c/mes" inputClassName="!pr-[5.5rem]" />
          </Field>
        </div>
        <ChoiceCards
          value={f.nature}
          onChange={(v) => set('nature', v)}
          options={[
            { value: 'fijo', title: 'Fijo', description: 'Lo pagás igual vendas o no.', icon: Repeat },
            { value: 'variable', title: 'Variable', description: 'Cambia según lo que vendés.', icon: Waves },
          ]}
        />
        <Field label="¿De qué cuenta sale?" error={err('account')} hint={!err('account') ? 'La que usás normalmente para pagarlo. Se sugiere al registrar el pago.' : undefined}>
          <AccountSelect value={f.accountId} onChange={(v) => set('accountId', v)} placeholder="Sin cuenta fija" />
        </Field>
        <Checkbox
          checked={f.autoPaid}
          onChange={(v) => set('autoPaid', v)}
          label="Se paga solo (débito automático)"
          hint="Al generarlo queda pagado desde esa cuenta. Si no lo tildás, queda «por pagar» hasta que registres el pago."
        />
        {isEdit && (
          <Checkbox
            checked={!f.active}
            onChange={(v) => set('active', !v)}
            label="Pausado: no generarlo por ahora"
            hint="Ej: un empleado de licencia o un abono suspendido. No se borra nada y lo podés reactivar cuando quieras."
          />
        )}
        {f.amount && f.amount > 0 && f.day ? (
          <p className="rounded-2xl bg-cream-deep px-4 py-3 text-[14px] text-ink-soft">
            Cada mes, al tocar «Generar», se carga un gasto {f.nature} de <b className="text-ink">{money(f.amount)}</b> con fecha del día <b className="text-ink">{f.day}</b>
            {f.autoPaid ? ' y ya pagado.' : ', «por pagar».'}
          </p>
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
