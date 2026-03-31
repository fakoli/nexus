// Embeddings
export {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
  EmbeddingProviderConfigSchema,
} from "./embeddings.js";
export type { EmbeddingProvider, EmbeddingProviderConfig } from "./embeddings.js";

// Vector store
export { VectorStore, VectorTable } from "./vector-store.js";
export type { VectorRecord, SearchResult, SearchOptions } from "./vector-store.js";

// Memory index
export { MemoryIndex } from "./memory-index.js";
export type { MemorySearchResult, MemoryIndexOptions } from "./memory-index.js";

// Message indexer
export { MessageIndexer } from "./message-indexer.js";
export type { IndexedMessage, MessageIndexerOptions, MessageIndexerStats } from "./message-indexer.js";

// Stream indexer
export { StreamIndexer } from "./stream-indexer.js";
export type { StreamIndexerStats } from "./stream-indexer.js";
