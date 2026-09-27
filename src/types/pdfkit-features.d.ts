/**
 * fontkit (used by PDFKit) accepts OpenType features as a toggle object, e.g. `{ liga: false }`,
 * but @types/pdfkit only declares the array form. The report switches ligatures off because
 * PDFKit writes no Unicode mapping for ligature glyphs: with ligatures on, copying or searching
 * "Traffic" in the PDF yields "Trafc". These overloads type that one supported usage.
 */
declare namespace PDFKit.Mixins {
  interface FeatureToggleTextOptions extends Omit<TextOptions, 'features'> {
    features: Record<string, boolean>;
  }

  interface PDFText {
    text(text: string, x: number, y: number, options: FeatureToggleTextOptions): this;
    text(text: string, options: FeatureToggleTextOptions): this;
    heightOfString(text: string, options: FeatureToggleTextOptions): number;
  }
}
