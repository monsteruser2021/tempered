export type ExportChartImage = { name: string; base64: string; width: number; height: number };

function addPieLegend(clone: SVGSVGElement, element: HTMLElement, chartWidth: number, chartHeight: number) {
  const chartName = element.dataset.financialChart ?? "";
  if (!chartName.startsWith("incomes-") && !chartName.startsWith("expenses-")) {
    return { width: chartWidth, height: chartHeight };
  }

  const legend = element.parentElement?.querySelector<HTMLUListElement>("ul[aria-label]");
  const items = legend ? Array.from(legend.querySelectorAll("li")) : [];
  if (items.length === 0) return { width: chartWidth, height: chartHeight };

  const legendWidth = Math.max(220, legend?.getBoundingClientRect().width ?? 0);
  const legendX = chartWidth + 20;
  const rowHeight = 34;
  const legendHeight = 20 + items.length * rowHeight;
  const width = legendX + legendWidth;
  const height = Math.max(chartHeight, legendHeight);
  const namespace = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(namespace, "g");
  group.setAttribute("transform", `translate(${legendX}, 12)`);

  const divider = document.createElementNS(namespace, "line");
  divider.setAttribute("x1", "-10");
  divider.setAttribute("y1", "0");
  divider.setAttribute("x2", "-10");
  divider.setAttribute("y2", String(height - 24));
  divider.setAttribute("stroke", "#665638");
  divider.setAttribute("stroke-opacity", "0.7");
  group.appendChild(divider);

  items.forEach((item, index) => {
    const row = document.createElementNS(namespace, "g");
    row.setAttribute("transform", `translate(0, ${index * rowHeight})`);
    const primary = item.children[0];
    const marker = primary?.querySelector("span");
    const category = primary?.querySelector("span:last-child")?.textContent?.trim()
      ?? primary?.textContent?.trim()
      ?? "";
    const amount = item.children[1]?.textContent?.trim() ?? "";
    const markerStyle = marker ? window.getComputedStyle(marker) : null;

    const swatch = document.createElementNS(namespace, "rect");
    swatch.setAttribute("x", "0");
    swatch.setAttribute("y", "2");
    swatch.setAttribute("width", "10");
    swatch.setAttribute("height", "10");
    swatch.setAttribute("rx", "2");
    swatch.setAttribute("fill", markerStyle?.backgroundColor || "#d3a52e");
    row.appendChild(swatch);

    const categoryText = document.createElementNS(namespace, "text");
    categoryText.setAttribute("x", "17");
    categoryText.setAttribute("y", "11");
    categoryText.setAttribute("fill", "#f5f5f5");
    categoryText.setAttribute("font-family", "Arial, sans-serif");
    categoryText.setAttribute("font-size", "11");
    categoryText.textContent = category;
    row.appendChild(categoryText);

    const amountText = document.createElementNS(namespace, "text");
    amountText.setAttribute("x", "17");
    amountText.setAttribute("y", "26");
    amountText.setAttribute("fill", "#f2d98b");
    amountText.setAttribute("font-family", "Arial, sans-serif");
    amountText.setAttribute("font-size", "10");
    amountText.textContent = amount;
    row.appendChild(amountText);
    group.appendChild(row);
  });

  clone.appendChild(group);
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height };
}

export function captureFinancialChartImages(): Promise<ExportChartImage[]> {
  const chartElements = Array.from(document.querySelectorAll<HTMLElement>("[data-financial-chart]"));
  if (chartElements.length === 0) throw new Error("No se encontraron gráficas para incluir en el reporte.");

  return Promise.all(chartElements.map(async (element) => {
    const source = element.querySelector("svg");
    if (!source) throw new Error(`La gráfica "${element.dataset.financialChart ?? "financiera"}" aún no está lista.`);
    const clone = source.cloneNode(true) as SVGSVGElement;
    const originalNodes = [source, ...Array.from(source.querySelectorAll("*"))];
    const clonedNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
    originalNodes.forEach((node, index) => {
      const computed = window.getComputedStyle(node);
      (clonedNodes[index] as SVGElement).style.cssText = [
        `color:${computed.color}`,
        `fill:${computed.fill}`,
        `stroke:${computed.stroke}`,
        `font-family:${computed.fontFamily}`,
        `font-size:${computed.fontSize}`,
        `font-weight:${computed.fontWeight}`,
        `opacity:${computed.opacity}`,
      ].join(";");
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bounds = source.getBoundingClientRect();
    const dimensions = addPieLegend(clone, element, bounds.width, bounds.height);
    clone.setAttribute("width", String(Math.max(1, Math.ceil(dimensions.width))));
    clone.setAttribute("height", String(Math.max(1, Math.ceil(dimensions.height))));
    const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const imageUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(dimensions.width * 2));
      canvas.height = Math.max(1, Math.ceil(dimensions.height * 2));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la imagen de las gráficas.");
      context.scale(2, 2);
      context.fillStyle = "#121212";
      context.fillRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
      return {
        name: element.dataset.financialChart ?? "grafica",
        base64: canvas.toDataURL("image/png").split(",")[1],
        width: dimensions.width,
        height: dimensions.height,
      };
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }));
}
