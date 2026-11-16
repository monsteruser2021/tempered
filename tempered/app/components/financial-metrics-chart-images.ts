export type ExportChartImage = { name: string; base64: string; width: number; height: number };

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
    clone.setAttribute("width", String(Math.max(1, Math.ceil(bounds.width))));
    clone.setAttribute("height", String(Math.max(1, Math.ceil(bounds.height))));
    const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const imageUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(bounds.width * 2));
      canvas.height = Math.max(1, Math.ceil(bounds.height * 2));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la imagen de las gráficas.");
      context.scale(2, 2);
      context.drawImage(image, 0, 0, bounds.width, bounds.height);
      return {
        name: element.dataset.financialChart ?? "grafica",
        base64: canvas.toDataURL("image/png").split(",")[1],
        width: bounds.width,
        height: bounds.height,
      };
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }));
}
