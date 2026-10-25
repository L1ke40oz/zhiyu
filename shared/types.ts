export type IslandShape = 'bean' | 'polygon' | 'crescent';
export type Palette = 'apricot' | 'sage' | 'lilac' | 'sky';
export type KnowledgeState = 'unexplored' | 'developing' | 'mastered';
export interface Course {
  id: string;
  name: string;
  shape: IslandShape;
  palette: Palette;
  examDate: string | null;
  seaId: number;
  slotId: number;
  createdAt: string;
  documentCount: number;
  pointCount: number;
  masteredCount: number;
  developingCount: number;
  dueCount: number;
  stuckCount: number;
  regions: { groupIndex: number; level: number; due: boolean }[];
}
export interface DocumentRecord {
  id: string;
  courseId: string;
  name: string;
  mime: string;
  status: 'uploaded' | 'parsing' | 'indexing' | 'ready' | 'partial' | 'failed';
  progress: number;
  pageCount: number;
  warnings: string[];
  error: string | null;
  createdAt: string;
}
export interface DocumentPage {
  number: number;
  text: string;
  method: 'native' | 'ocr' | 'vision' | 'unreadable';
  warning: string | null;
  hasImage: boolean;
}
export interface ReadingQuote {
  documentId: string;
  page: number;
  start: number;
  end: number;
  text: string;
}
export interface Highlight extends ReadingQuote {
  id: string;
  createdAt: string;
}
export interface ModelSettings {
  mode: 'site' | 'personal';
  base: string;
  model: string;
  hasKey: boolean;
  siteConfigured: boolean;
  configured: boolean;
}
export interface KnowledgePoint {
  id: string;
  courseId: string;
  title: string;
  groupIndex: number;
  sourceChunkIds: string[];
  state: KnowledgeState;
  streak: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  /** flagged by the learner as unfamiliar; shown in the knowledge graph */
  unfamiliar: boolean;
}
export interface Source {
  id: string;
  documentId: string;
  documentName: string;
  page: number;
  text: string;
}
export interface AnswerSection {
  text: string;
  basis: 'course_material' | 'general' | 'web';
  sourceChunkIds: string[];
  externalSources: { title: string; url: string }[];
}
export interface ChatMessage {
  id: string;
  courseId: string;
  documentId: string | null;
  role: 'user' | 'assistant';
  text: string;
  sections: AnswerSection[];
  sources: Source[];
  mode: 'model' | 'extractive' | null;
  createdAt: string;
}
export interface StuckPoint {
  id: string;
  courseId: string;
  pointId: string | null;
  documentId: string | null;
  page: number | null;
  text: string;
  resolved: boolean;
  createdAt: string;
}
export interface Quiz {
  id: string;
  pointId: string;
  courseId: string;
  prompt: string;
  options: { id: string; text: string }[];
  sources: Source[];
  mode: 'model' | 'source_cloze';
}
export interface QuizResult {
  quizId: string;
  correct: boolean;
  correctOptionId: string;
  explanation: string;
  before: KnowledgeState;
  after: KnowledgeState;
  nextReviewAt: string;
  eventId: string;
}
export interface ReviewTask {
  point: KnowledgePoint;
  courseName: string;
  reason: string;
  due: boolean;
  stuck: boolean;
  source?: Source;
}
export interface Profile {
  timezone: string;
  reducedMotion: boolean;
  seaSound: boolean;
  dailyMinutes: number;
  /** the first-visit cloud intro has been shown on this anonymous profile */
  introSeen: boolean;
}
export interface ActivityDay {
  date: string;
  count: number;
  events: { type: string; title: string }[];
}
export interface Capabilities {
  chat: boolean;
  embeddings: boolean;
  ocr: boolean;
  vision: boolean;
  party: boolean;
  partyUrl: string;
}
