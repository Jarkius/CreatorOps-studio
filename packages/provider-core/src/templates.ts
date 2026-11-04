export const TEMPLATE_IDS = ['product-showcase', 'problem-solution', 'review-style'] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface LocalizedText {
  th: string;
  en: string;
}

export interface ProductTemplate {
  id: TemplateId;
  version: number;
  name: LocalizedText;
  description: LocalizedText;
  defaultDurationSeconds: number;
}

/** Code-defined templates. Adding a template or bumping a version is a code change. */
export const TEMPLATES: readonly ProductTemplate[] = [
  {
    id: 'product-showcase',
    version: 1,
    name: { th: 'โชว์สินค้า', en: 'Product showcase' },
    description: {
      th: 'โชว์สินค้า การใช้งาน และจุดเด่นตามข้อมูลที่กรอกไว้',
      en: 'Shows the product, how it is used, and its listed selling points.',
    },
    defaultDurationSeconds: 30,
  },
  {
    id: 'problem-solution',
    version: 1,
    name: { th: 'ปัญหาและทางออก', en: 'Problem and solution' },
    description: {
      th: 'เปิดด้วยปัญหาที่กลุ่มเป้าหมายพบ แล้วนำเสนอสินค้าเป็นทางเลือก',
      en: 'Opens with a problem the audience knows, then presents the product as one option.',
    },
    defaultDurationSeconds: 45,
  },
  {
    id: 'review-style',
    version: 1,
    name: { th: 'รีวิวสไตล์ผู้ใช้จริง', en: 'Real user review style' },
    description: {
      th: 'เล่าประสบการณ์การใช้งานแบบคนใช้จริง จำกัดอยู่ในข้อมูลที่มี',
      en: 'A first-person account of using the product, limited to the facts provided.',
    },
    defaultDurationSeconds: 45,
  },
];

export function getTemplate(id: string, version: number): ProductTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id && template.version === version);
}

export function listTemplates(): readonly ProductTemplate[] {
  return TEMPLATES;
}
