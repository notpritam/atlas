export type CaptureType = 'screenshot' | 'selection' | 'bookmark' | 'image' | 'note' | 'tweet' | 'video' | 'audio' | 'document' | 'file';

export type Account = { id: string; email: string; name: string; createdAt: number; hasPassword?: boolean };
export type Usage = { captures: number; bytes: number; maxCaptures: number; maxBytes: number };
export type Connection = { id: string; name: string; createdAt: number; lastSeenAt: number | null };

export type CaptureProvenance = {
  schemaVersion?: 1;
  captureMethod?: string;
  pageUrl?: string | null;
  canonicalUrl?: string | null;
  pageTitle?: string | null;
  siteName?: string | null;
  description?: string | null;
  authors?: string[];
  publishedAt?: string | null;
  modifiedAt?: string | null;
  language?: string | null;
  leadImageUrl?: string | null;
  faviconUrl?: string | null;
  targetUrl?: string | null;
  capturedAt?: number;
  sourceApplication?: string | null;
  originalFileName?: string | null;
  declaredMime?: string | null;
  byteSize?: number | null;
};

export type Capture = {
  /** Card responses contain text excerpts. Detail responses always contain full text. */
  contentView?: 'card' | 'full';
  id: string;
  clientId: string;
  batchId: string | null;
  type: CaptureType;
  status: 'pending' | 'processing' | 'done' | 'failed';
  sourceUrl: string | null;
  sourceTitle: string | null;
  selectionText: string | null;
  noteText: string | null;
  articleText: string | null;
  summary: string | null;
  ocrText: string | null;
  category: string | null;
  tags: string[];
  userTags?: string[];
  folderId?: string | null;
  folder?: Folder | null;
  previewUrl?: string | null;
  blobUrl: string | null;
  fileName: string | null;
  fileMime: string | null;
  fileBytes: number;
  fileUrl: string | null;
  width: number | null;
  height: number | null;
  capturedAt: number;
  createdAt: number;
  savedVia?: 'iphone' | 'android' | 'browser' | 'dashboard' | null;
  updatedAt: number;
  enrichError: string | null;
  provenance: CaptureProvenance | null;
};

export type NativeSession = {
  account: Account;
  token: string;
  connection: Connection;
  recoveryCode?: string;
};

export type CaptureList = { captures: Capture[]; nextCursor: string | null; total: number };
export type RelatedSave = { capture: Capture; reasons: { kind: 'batch' | 'source' | 'tag' | 'folder' | 'agent'; label: string }[] };

export type Folder = { id: string; name: string; displayName?: string; parentId?: string; path?: string[]; count?: number };
export type Organization = { folders: Folder[]; tags: { name: string; count: number }[]; suggestedTags: string[]; suggestedFolders: string[] };
