import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AppError } from './domain.ts';

const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false });
addFormats(ajv);
const strings = { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 12, uniqueItems: true };
export const answerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'sections', 'insufficientEvidence'],
  properties: {
    schemaVersion: { const: 1 },
    insufficientEvidence: { type: 'boolean' },
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'basis', 'sourceChunkIds', 'externalSources'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 4000 },
          basis: { enum: ['course_material', 'general'] },
          sourceChunkIds: strings,
          externalSources: { type: 'array', maxItems: 0 },
        },
      },
    },
  },
};
export const quizSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'prompt', 'options', 'correctOptionId', 'explanation', 'sourceChunkIds'],
  properties: {
    schemaVersion: { const: 1 },
    prompt: { type: 'string', minLength: 5, maxLength: 1200 },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: {
          id: { enum: ['A', 'B', 'C', 'D'] },
          text: { type: 'string', minLength: 1, maxLength: 700 },
        },
      },
    },
    correctOptionId: { enum: ['A', 'B', 'C', 'D'] },
    explanation: { type: 'string', minLength: 1, maxLength: 2000 },
    sourceChunkIds: { ...strings, minItems: 1 },
  },
};
export const courseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'shape', 'palette', 'requestId'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 30 },
    shape: { enum: ['bean', 'polygon', 'crescent'] },
    palette: { enum: ['apricot', 'sage', 'lilac', 'sky'] },
    examDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    requestId: { type: 'string', format: 'uuid' },
    seaId: { type: 'integer', minimum: 0, maximum: 4 },
    slotId: { type: 'integer', minimum: 0, maximum: 5 },
  },
  dependencies: { seaId: ['slotId'], slotId: ['seaId'] },
};
export const knowledgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'items'],
  properties: {
    schemaVersion: { const: 1 },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 9,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'groupIndex', 'sourceChunkIds'],
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 80 },
          groupIndex: { type: 'integer', minimum: 0, maximum: 2 },
          sourceChunkIds: { ...strings, minItems: 1 },
        },
      },
    },
  },
};
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();
export function validate<T>(schema: object, value: unknown): asserts value is T {
  let fn = validators.get(schema);
  if (!fn) {
    fn = ajv.compile(schema);
    validators.set(schema, fn);
  }
  if (!fn(value)) throw new AppError(422, ajv.errorsText(fn.errors, { separator: '；' }), 'INVALID_SCHEMA');
}
