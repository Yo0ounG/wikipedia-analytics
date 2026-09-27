declare module 'svg-to-pdfkit' {
  interface SvgToPdfOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    precision?: number;
    fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
    warningCallback?: (message: string) => void;
  }
  function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x: number,
    y: number,
    options?: SvgToPdfOptions,
  ): void;
  export default SVGtoPDF;
}
