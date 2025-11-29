declare module 'pdf-parse' {
  import { Buffer } from 'node:buffer';

  export interface PDFParseResult {
    text: string;
  }

  export default function pdfParse(data: Buffer): Promise<PDFParseResult>;
}
