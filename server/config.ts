import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: Number(process.env.SERVER_PORT || process.env.PORT || 3100),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  publicOrigin: process.env.PUBLIC_ORIGIN || '',
  trustProxy: process.env.TRUST_PROXY || '',
  llm: {
    base: process.env.LLM_BASE_URL || '',
    key: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
  },
  embedding: {
    base: process.env.EMBEDDING_BASE_URL || '',
    key: process.env.EMBEDDING_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || '',
  },
  vision: {
    base: process.env.VISION_BASE_URL || '',
    key: process.env.VISION_API_KEY || '',
    model: process.env.VISION_MODEL || '',
  },
  modelTimeout: Math.max(1000, Math.min(Number(process.env.LLM_TIMEOUT_MS || 60000), 120000)),
  ocr: process.env.OCR_ENABLED !== 'false',
  ocrLanguages: process.env.OCR_LANGUAGES || 'chi_sim+eng',
  partyUrl: process.env.PARTY_URL || '/party/',
  tavilyKey: process.env.TAVILY_API_KEY || '',
  tavilyUrl: process.env.TAVILY_API_URL || 'https://api.tavily.com/search',
};
export const enabled = (service: { base: string; model: string }) => Boolean(service.base && service.model);
