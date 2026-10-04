// Exportar a Excel con formato lindo y listo para usar:
// título con el nombre del negocio, encabezados con color, columnas de plata con formato $,
// fechas como fechas reales (se pueden ordenar/filtrar), fila de totales con fórmulas,
// filtros activados y una nota que explica cómo leer cada planilla.
import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import type { Response } from 'express'
import { getSettings } from '../services/settings'
import { today } from '../../shared/dates'

export type ExcelColType = 'text' | 'money' | 'number' | 'int' | 'percent' | 'date'

export interface ExcelColumn<T = Record<string, unknown>> {
  header: string
  /** Propiedad de la fila. Si se pasa `value`, se usa eso en lugar de row[key]. */
  key: string
  value?: (row: T) => unknown
  type?: ExcelColType
  width?: number
  /** Si es true, la fila de totales suma esta columna. Por defecto suman money e int. */
  total?: boolean
}

export interface ExcelSheet<T = Record<string, unknown>> {
  /** Nombre de la pestaña (máx. 31 caracteres). */
  name: string
  /** Título grande arriba de la tabla. */
  title?: string
  /** Subtítulo (ej: "Período: 01/01/2026 al 31/01/2026"). */
  subtitle?: string
  columns: ExcelColumn<T>[]
  rows: T[]
  /** Agregar fila de totales (default: true si hay columnas sumables). */
  totals?: boolean
  /** Explicaciones que van debajo de la tabla. */
  notes?: string[]
}

const BROWN = 'FFA9520F'
const CREAM = 'FFFDFAF5'
const CORAL_LIGHT = 'FFFFE3E2'
const INK = 'FF3B2414'

const FORMATS: Record<ExcelColType, string | undefined> = {
  text: undefined,
  money: '"$ "#,##0.00;[Red]-"$ "#,##0.00',
  number: '#,##0.00',
  int: '#,##0',
  percent: '0.0%',
  date: 'dd/mm/yyyy',
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function toCellValue(v: unknown, type: ExcelColType): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  if ((type === 'money' || type === 'number' || type === 'int' || type === 'percent') && typeof v !== 'number') {
    const n = Number(v)
    return Number.isFinite(n) ? n : String(v)
  }
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  return v as ExcelJS.CellValue
}

/** Formatea 'YYYY-MM-DD' como 'dd/mm/yyyy' para títulos. */
export function fmtDate(s: string): string {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function periodSubtitle(from: string, to: string): string {
  return `Período: ${fmtDate(from)} al ${fmtDate(to)}`
}

export function addSheet<T>(wb: ExcelJS.Workbook, sheet: ExcelSheet<T>) {
  const business = getSettings().business.name || 'VINOH!'
  const safeName = sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja'
  let name = safeName
  let i = 2
  while (wb.getWorksheet(name)) name = `${safeName.slice(0, 28)} ${i++}`
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] })
  const ncols = Math.max(sheet.columns.length, 1)

  // Fila 1: negocio + título
  ws.mergeCells(1, 1, 1, ncols)
  const t = ws.getCell(1, 1)
  t.value = `${business} · ${sheet.title || sheet.name}`
  t.font = { bold: true, size: 15, color: { argb: BROWN } }
  ws.getRow(1).height = 24
  // Fila 2: subtítulo
  ws.mergeCells(2, 1, 2, ncols)
  const st = ws.getCell(2, 1)
  st.value = `${sheet.subtitle ? sheet.subtitle + ' · ' : ''}Exportado el ${fmtDate(today())}`
  st.font = { italic: true, size: 10, color: { argb: 'FF7A6A5E' } }
  // Fila 3 vacía, fila 4 encabezados
  const header = ws.getRow(4)
  sheet.columns.forEach((c, idx) => {
    const cell = header.getCell(idx + 1)
    cell.value = c.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BROWN } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: BROWN } } }
    const col = ws.getColumn(idx + 1)
    const type = c.type ?? 'text'
    col.width = c.width ?? (type === 'text' ? Math.min(Math.max(c.header.length + 4, 14), 40) : type === 'date' ? 12 : 16)
    if (FORMATS[type]) col.numFmt = FORMATS[type]!
  })
  header.height = 22

  const firstDataRow = 5
  sheet.rows.forEach((row, r) => {
    const values = sheet.columns.map((c) => toCellValue(c.value ? c.value(row) : (row as Record<string, unknown>)[c.key], c.type ?? 'text'))
    const xRow = ws.getRow(firstDataRow + r)
    values.forEach((v, idx) => {
      const cell = xRow.getCell(idx + 1)
      cell.value = v
      const type = sheet.columns[idx].type ?? 'text'
      if (FORMATS[type]) cell.numFmt = FORMATS[type]!
    })
    if (r % 2 === 1) {
      xRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } }
      })
    }
  })
  const lastDataRow = firstDataRow + sheet.rows.length - 1

  const summable = sheet.columns.map((c) => c.total ?? (c.type === 'money' || c.type === 'int'))
  let nextRow = lastDataRow + 1
  if ((sheet.totals ?? summable.some(Boolean)) && sheet.rows.length > 0) {
    const totalRow = ws.getRow(nextRow)
    totalRow.getCell(1).value = 'TOTAL'
    sheet.columns.forEach((c, idx) => {
      if (!summable[idx] || idx === 0) return
      const L = colLetter(idx + 1)
      const result = sheet.rows.reduce((s, row) => {
        const v = Number(c.value ? c.value(row) : (row as Record<string, unknown>)[c.key])
        return s + (Number.isFinite(v) ? v : 0)
      }, 0)
      const cell = totalRow.getCell(idx + 1)
      cell.value = { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`, result: Math.round(result * 100) / 100 }
      const type = c.type ?? 'text'
      if (FORMATS[type]) cell.numFmt = FORMATS[type]!
    })
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, color: { argb: INK } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORAL_LIGHT } }
      cell.border = { top: { style: 'thin', color: { argb: BROWN } } }
    })
    for (let c = 1; c <= ncols; c++) {
      const cell = totalRow.getCell(c)
      if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb !== CORAL_LIGHT) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORAL_LIGHT } }
      }
    }
    nextRow++
  }

  if (sheet.rows.length === 0) {
    ws.getCell(firstDataRow, 1).value = 'No hay datos para este período.'
    ws.getCell(firstDataRow, 1).font = { italic: true, color: { argb: 'FF7A6A5E' } }
    nextRow = firstDataRow + 1
  } else {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastDataRow, column: ncols } }
  }

  if (sheet.notes?.length) {
    nextRow += 1
    ws.getCell(nextRow, 1).value = '¿Cómo leer esta planilla?'
    ws.getCell(nextRow, 1).font = { bold: true, color: { argb: BROWN } }
    for (const note of sheet.notes) {
      nextRow++
      ws.mergeCells(nextRow, 1, nextRow, Math.max(ncols, 6))
      const cell = ws.getCell(nextRow, 1)
      cell.value = `• ${note}`
      cell.font = { italic: true, size: 10, color: { argb: 'FF5A4636' } }
      cell.alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(nextRow).height = Math.max(15, Math.ceil(note.length / 110) * 15)
    }
  }
  return ws
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'VINOH! Finanzas'
  wb.created = new Date()
  // Que Excel recalcule las fórmulas (totales) al abrir el archivo.
  wb.calcProperties.fullCalcOnLoad = true
  return wb
}

/** Arma un nombre de archivo seguro: "vinoh-ventas-2026-01-31.xlsx". */
export function excelFilename(base: string): string {
  const clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `vinoh-${clean || 'export'}-${today()}.xlsx`
}

/** Manda un Excel como descarga. */
export async function sendWorkbook(res: Response, filename: string, sheets: ExcelSheet<any>[]) {
  const wb = newWorkbook()
  for (const s of sheets) addSheet(wb, s)
  await sendWorkbookFile(res, filename, wb)
}

export async function sendWorkbookFile(res: Response, filename: string, wb: ExcelJS.Workbook) {
  const name = filename.endsWith('.xlsx') ? filename : excelFilename(filename)
  const buffer = await wb.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.send(Buffer.from(buffer as ArrayBuffer))
}

/** Lee un Excel subido y devuelve las filas de la primera hoja como objetos (usando la fila de encabezados). */
/** El Excel tiene más filas de las permitidas (se corta apenas se pasa, sin leer el resto). */
export class TooManyRowsError extends Error {}

/** Valor "útil" de una celda: resultado de fórmulas, texto de links y de texto con formato. */
function cellValue(cell: ExcelJS.Cell): unknown {
  let v: unknown = cell.value
  if (v && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result
  if (v && typeof v === 'object' && 'text' in (v as object)) v = (v as { text: unknown }).text
  if (v && typeof v === 'object' && 'richText' in (v as object)) v = cell.text
  return v
}

/**
 * Lee la primera hoja de un Excel subido, fila por fila y SIN cargar todo el archivo en memoria
 * (lector "en streaming"). Fila `headerRow` = encabezados; se saltean las filas vacías. Si hay más de
 * `maxRows` filas con datos, corta en el momento con TooManyRowsError: un Excel gigante no congela el
 * programa ni lo tira por falta de memoria. Devuelve cada fila con su número REAL en el Excel.
 */
export async function readSheetRows(
  buffer: Buffer,
  opts: { headerRow?: number; maxRows?: number } = {},
): Promise<{ rows: Record<string, unknown>[]; rowNumbers: number[] }> {
  const headerRow = opts.headerRow ?? 1
  const maxRows = opts.maxRows ?? Infinity
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache', // para reconocer las celdas con formato de fecha
    hyperlinks: 'ignore',
    entries: 'ignore',
  })
  const headers: string[] = []
  const rows: Record<string, unknown>[] = []
  const rowNumbers: number[] = []
  for await (const ws of reader) {
    for await (const row of ws) {
      const n = row.number
      if (n < headerRow) continue
      if (n === headerRow) {
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          headers[col] = String(cell.text ?? '').trim()
        })
        continue
      }
      const obj: Record<string, unknown> = {}
      let hasValue = false
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const h = headers[col]
        if (!h) return
        const v = cellValue(cell)
        if (v !== null && v !== undefined && v !== '') hasValue = true
        obj[h] = v
      })
      if (!hasValue) continue
      rows.push(obj)
      rowNumbers.push(n)
      if (rows.length > maxRows) throw new TooManyRowsError(`Más de ${maxRows} filas`)
    }
    break // solo la primera hoja
  }
  return { rows, rowNumbers }
}

/** Primera hoja como lista de objetos { encabezado: valor } (ver readSheetRows). */
export async function readFirstSheet(buffer: Buffer, headerRow = 1): Promise<Record<string, unknown>[]> {
  return (await readSheetRows(buffer, { headerRow })).rows
}
