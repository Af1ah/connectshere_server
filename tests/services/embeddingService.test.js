let mockEmbedContent;

jest.mock('@google/genai', () => {
  mockEmbedContent = jest.fn();
  return {
    GoogleGenAI: jest.fn(() => ({
      models: {
        embedContent: mockEmbedContent,
      },
    })),
  };
});

const loadService = () => {
  jest.resetModules();
  return require('../../src/services/embeddingService');
};

describe('embeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_EMBEDDING_MODELS;
  });

  test('throws when generating embedding before initialization', async () => {
    const service = loadService();
    await expect(service.generateEmbedding('hello')).rejects.toThrow('Embedding service not initialized');
  });

  test('initializes and returns embedding vector', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = loadService();

    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: [0.1, 0.2, 0.3] }],
    });

    service.initialize();
    const vector = await service.generateEmbedding('hello');

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  test('falls back to next model when first model is NOT_FOUND', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = loadService();

    mockEmbedContent
      .mockRejectedValueOnce({ status: 404, message: 'NOT_FOUND' })
      .mockResolvedValueOnce({ embedding: { values: [1, 2] } });

    service.initialize();
    const vector = await service.generateEmbedding('fallback test');

    expect(vector).toEqual([1, 2]);
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    expect(mockEmbedContent.mock.calls[0][0].model).toBe('gemini-embedding-001');
    expect(mockEmbedContent.mock.calls[1][0].model).toBe('text-embedding-004');
  });

  test('processText returns chunks with embeddings', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = loadService();

    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: [0.9, 0.8] }],
    });

    service.initialize();
    const chunks = await service.processText('Small text input.', 'unit-test');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].source).toBe('unit-test');
    expect(chunks[0].embedding).toEqual([0.9, 0.8]);
    expect(typeof chunks[0].createdAt).toBe('string');
  });

  test('chunkText splits long content and keeps metadata', () => {
    const service = loadService();
    const longText = 'A'.repeat(service.CHUNK_SIZE + 200);

    const chunks = service.chunkText(longText, 'doc-a');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].source).toBe('doc-a');
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
  });

  test('cosineSimilarity handles valid and invalid vector pairs', () => {
    const service = loadService();

    expect(service.cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(service.cosineSimilarity([1, 2], [1])).toBe(0);
  });
});
