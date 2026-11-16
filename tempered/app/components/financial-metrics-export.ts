import ExcelJS from "exceljs";
import type { ActiveDebtPoint, ExpenseCategoryPoint, FinancialCurrency } from "./financial-metrics-charts";
import type { ExportChartImage } from "./financial-metrics-chart-images";

export type ExportMetric = { label: string; bs: number | null; usd: number | null };
export type ExportMovement = {
  date: string;
  description: string;
  category: string;
  type: string;
  currency: FinancialCurrency;
  amount: number;
};
type ExportOptions = {
  period: string;
  metrics: ExportMetric[];
  expenses: ExpenseCategoryPoint[];
  totalIncome: { bs: number; usd: number };
  debts: ActiveDebtPoint[];
  movements: ExportMovement[];
  charts: ExportChartImage[];
};

const navy = "17233A";
const thinBorder = { style: "thin" as const, color: { argb: "FFD0D7E2" } };
const thickBorder = { style: "thick" as const, color: { argb: "FF17233A" } };
const currencyFormat = '"Bs" #,##0.00;[Red]("Bs" #,##0.00)';
const dollarFormat = '"$" #,##0.00;[Red]("$" #,##0.00)';

function applyTableBorders(worksheet: ExcelJS.Worksheet, firstRow: number, lastRow: number, firstColumn: number, lastColumn: number) {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    for (let columnNumber = firstColumn; columnNumber <= lastColumn; columnNumber += 1) {
      const cell = worksheet.getCell(rowNumber, columnNumber);
      cell.border = {
        top: rowNumber === firstRow ? thickBorder : thinBorder,
        bottom: rowNumber === lastRow ? thickBorder : thinBorder,
        left: columnNumber === firstColumn ? thickBorder : thinBorder,
        right: columnNumber === lastColumn ? thickBorder : thinBorder,
      };
    }
  }
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${navy}` } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

export async function exportFinancialMetrics(options: ExportOptions) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Isorropia Kairos";
  workbook.subject = `Reporte financiero ${options.period}`;
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Resumen y Estrategia", { views: [{ state: "frozen", ySplit: 3 }] });
  summary.columns = [
    { width: 34 }, { width: 18 }, { width: 18 }, { width: 4 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ];
  summary.mergeCells("A1:C1");
  summary.getCell("A1").value = "ISORROPIA KAIROS · RESUMEN FINANCIERO";
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFD3A52E" } };
  summary.getCell("A2").value = "Periodo analizado";
  summary.getCell("B2").value = options.period;
  summary.getCell("A2").font = { bold: true };

  summary.addRow(["Porcentajes calculados sobre los ingresos totales del periodo como presupuesto base."]);
  summary.addRow(["Indicador", "Bolívares (Bs)", "Dólares ($)"]);
  const summaryHeader = summary.getRow(4);
  styleHeader(summaryHeader);
  options.metrics.forEach((metric) => summary.addRow([metric.label, metric.bs, metric.usd]));
  const metricEndRow = summary.rowCount;
  summary.eachRow((row, rowNumber) => {
    if (rowNumber > 4 && rowNumber <= metricEndRow) {
      row.getCell(2).numFmt = currencyFormat;
      row.getCell(3).numFmt = dollarFormat;
      row.getCell(1).font = { bold: true };
    }
  });
  applyTableBorders(summary, 4, metricEndRow, 1, 3);

  const categoryHeaderRow = metricEndRow + 2;
  summary.getRow(categoryHeaderRow).values = ["Categoría de gasto", "Monto (Bs)", "% presupuesto Bs", "Monto ($)", "% presupuesto $"];
  styleHeader(summary.getRow(categoryHeaderRow));
  options.expenses.forEach((item, index) => {
    const row = summary.getRow(categoryHeaderRow + index + 1);
    row.values = [
      item.category,
      item.bs,
      options.totalIncome.bs > 0 ? item.bs / options.totalIncome.bs : 0,
      item.usd,
      options.totalIncome.usd > 0 ? item.usd / options.totalIncome.usd : 0,
    ];
    row.getCell(2).numFmt = currencyFormat;
    row.getCell(3).numFmt = "0.0%";
    row.getCell(4).numFmt = dollarFormat;
    row.getCell(5).numFmt = "0.0%";
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF5D6" } };
    });
  });
  const categoryEndRow = categoryHeaderRow + options.expenses.length;
  applyTableBorders(summary, categoryHeaderRow, categoryEndRow, 1, 5);

  const debtsHeaderRow = categoryEndRow + 2;
  summary.getRow(debtsHeaderRow).values = ["Deuda activa", "Tipo", "Moneda", "Saldo pendiente"];
  styleHeader(summary.getRow(debtsHeaderRow));
  const debts = options.debts.filter((debt) => debt.amount > 0).sort((a, b) => b.amount - a.amount);
  debts.forEach((debt, index) => {
    const row = summary.getRow(debtsHeaderRow + index + 1);
    row.values = [debt.title, debt.type === "payable" ? "Por pagar" : "Por cobrar", debt.currency, debt.amount];
    row.getCell(4).numFmt = debt.currency === "Bs" ? currencyFormat : dollarFormat;
  });
  applyTableBorders(summary, debtsHeaderRow, debtsHeaderRow + debts.length, 1, 4);

  options.charts.forEach((chart, index) => {
    const imageId = workbook.addImage({ base64: chart.base64, extension: "png" });
    const row = 4 + index * 19;
    summary.addImage(imageId, { tl: { col: 4, row }, ext: { width: 540, height: 300 } });
  });
  summary.getColumn(1).alignment = { vertical: "middle" };
  summary.getColumn(2).alignment = { vertical: "middle", horizontal: "right" };
  summary.getColumn(3).alignment = { vertical: "middle", horizontal: "right" };

  const movementSheet = workbook.addWorksheet("Movimientos Detallados", { views: [{ state: "frozen", ySplit: 1 }] });
  const movementHeaders = ["Fecha", "Concepto / Descripción", "Categoría", "Tipo de movimiento", "Moneda", "Monto"];
  movementSheet.addRow(movementHeaders);
  styleHeader(movementSheet.getRow(1));
  const movements = [...options.movements].sort((first, second) => first.date.localeCompare(second.date));
  movements.forEach((movement) => {
    const row = movementSheet.addRow([
      movement.date,
      movement.description,
      movement.category,
      movement.type,
      movement.currency,
      movement.amount,
    ]);
    row.getCell(6).numFmt = movement.currency === "Bs" ? currencyFormat : dollarFormat;
    row.alignment = { vertical: "top", wrapText: true };
  });
  const movementEndRow = Math.max(1, movementSheet.rowCount);
  applyTableBorders(movementSheet, 1, movementEndRow, 1, movementHeaders.length);
  movementSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: movementEndRow, column: movementHeaders.length } };
  for (let column = 1; column <= movementHeaders.length; column += 1) {
    const contentWidth = Math.max(
      movementHeaders[column - 1].length,
      ...movements.map((movement) => String([
        movement.date,
        movement.description,
        movement.category,
        movement.type,
        movement.currency,
        movement.amount,
      ][column - 1]).length),
    );
    movementSheet.getColumn(column).width = Math.min(48, Math.max(column === 2 ? 30 : 14, contentWidth + 2));
  }
  movementSheet.getColumn(6).alignment = { horizontal: "right" };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Isorropia_Reporte_${options.period.replaceAll(" ", "_")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
