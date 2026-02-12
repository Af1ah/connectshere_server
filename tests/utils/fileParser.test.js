const mockPdf = jest.fn();
const mockRead = jest.fn();
const mockCsv = jest.fn();
const mockMammoth = jest.fn();

jest.mock('pdf-parse', () => (...args) => mockPdf(...args));
jest.mock('xlsx', () => ({
  read: (...args) => mockRead(...args),
  utils: {
    sheet_to_csv: (...args) => mockCsv(...args),
  },
}));
jest.mock('mammoth', () => ({
  extractRawText: (...args) => mockMammoth(...args),
}));

const { parseFile } = require('../../src/utils/fileParser');

describe('fileParser', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('parses plain text files', async () => {
    const text = await parseFile(Buffer.from(' hello world '), 'text/plain', 'note.txt');
    expect(text).toBe('hello world');
  });

  test('parses PDF using pdf-parse', async () => {
    mockPdf.mockResolvedValueOnce({ text: 'PDF content' });

    const result = await parseFile(Buffer.from('pdf'), 'application/pdf', 'a.pdf');

    expect(mockPdf).toHaveBeenCalledTimes(1);
    expect(result).toBe('PDF content');
  });

  test('parses spreadsheet sheets into merged text', async () => {
    mockRead.mockReturnValueOnce({
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: { Sheet1: { id: 1 }, Sheet2: { id: 2 } },
    });
    mockCsv
      .mockReturnValueOnce('a,b\n1,2')
      .mockReturnValueOnce('x,y\n9,8');

    const output = await parseFile(
      Buffer.from('xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'sheet.xlsx'
    );

    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockCsv).toHaveBeenCalledTimes(2);
    expect(output).toContain('Sheet: Sheet1');
    expect(output).toContain('a,b');
    expect(output).toContain('Sheet: Sheet2');
  });

  test('parses docx via mammoth', async () => {
    mockMammoth.mockResolvedValueOnce({ value: 'Docx body' });

    const result = await parseFile(
      Buffer.from('docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc.docx'
    );

    expect(result).toBe('Docx body');
  });

  test('throws for unsupported mime type', async () => {
    await expect(parseFile(Buffer.from('x'), 'application/zip', 'z.zip')).rejects.toThrow(
      'Unsupported file type: application/zip'
    );
  });
});
