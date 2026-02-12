const { makeDocSnapshot, makeQuerySnapshot } = require('../helpers/firestoreSnapshots');

const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockCollection = jest.fn();
const mockAddDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockQuery = jest.fn();
const mockWhere = jest.fn();
const mockUpdateDoc = jest.fn();
const mockServerTimestamp = jest.fn(() => 'SERVER_TS');
const mockWriteBatch = jest.fn();
const mockDoc = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  db: { __db: true },
}));

jest.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  collection: (...args) => mockCollection(...args),
  addDoc: (...args) => mockAddDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  query: (...args) => mockQuery(...args),
  where: (...args) => mockWhere(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  serverTimestamp: (...args) => mockServerTimestamp(...args),
  writeBatch: (...args) => mockWriteBatch(...args),
}));

const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const futureDateString = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().split('T')[0];
};

const loadService = () => {
  jest.resetModules();
  return require('../../src/services/consultantService');
};

describe('consultantService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCollection.mockImplementation((...args) => ({
      __type: 'collection',
      path: args.slice(1).join('/'),
    }));

    mockDoc.mockImplementation((...args) => {
      if (args[0] && args[0].__type === 'collection') {
        return { __type: 'doc', path: `${args[0].path}/${args[1]}`, id: args[1], ref: `${args[0].path}/${args[1]}` };
      }

      return { __type: 'doc', path: args.slice(1).join('/') };
    });

    mockWhere.mockImplementation((field, op, value) => ({ field, op, value }));
    mockQuery.mockImplementation((ref, ...filters) => ({ __type: 'query', ref, filters }));
    mockSetDoc.mockResolvedValue(undefined);
    mockAddDoc.mockResolvedValue({ id: 'new-booking' });
    mockUpdateDoc.mockResolvedValue(undefined);

    const batch = {
      set: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };
    mockWriteBatch.mockReturnValue(batch);
  });

  test('getSettings returns defaults when no settings document exists', async () => {
    const service = loadService();

    mockGetDoc.mockResolvedValueOnce(makeDocSnapshot({ exists: false }));
    mockGetDocs.mockResolvedValueOnce(makeQuerySnapshot([]));

    const settings = await service.getSettings('user-1');

    expect(settings.enabled).toBe(false);
    expect(settings.bookingType).toBe('hourly');
    expect(settings.slotDuration).toBe(30);
    expect(settings.schedule.monday).toBeDefined();
  });

  test('updateSettings sanitizes values and persists consultant schedule', async () => {
    const service = loadService();

    mockGetDocs.mockResolvedValueOnce(
      makeQuerySnapshot([makeDocSnapshot({ id: 'old-day', ref: 'old-ref', data: {} })])
    );

    const ok = await service.updateSettings('user-1', {
      enabled: true,
      bookingType: 'invalid-type',
      slotDuration: 10,
      maxTokensPerDay: 999,
      dynamicAllocation: 1,
      schedule: {
        monday: {
          enabled: true,
          start: '09:00',
          end: '11:00',
          breakStart: '10:00',
          breakEnd: '10:15',
        },
      },
    });

    expect(ok).toBe(true);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);

    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload.enabled).toBe(true);
    expect(payload.bookingType).toBe('hourly');
    expect(payload.slotDuration).toBe(15);
    expect(payload.maxTokensPerDay).toBe(500);

    const batch = mockWriteBatch.mock.results[0].value;
    expect(batch.delete).toHaveBeenCalledTimes(1);
    expect(batch.set).toHaveBeenCalledTimes(7);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  test('getAvailableSlots filters booked slots from generated schedule', async () => {
    const service = loadService();
    const dateStr = futureDateString();

    const [y, m, d] = dateStr.split('-').map(Number);
    const dayName = dayNames[new Date(y, m - 1, d).getDay()];

    mockGetDoc.mockResolvedValueOnce(
      makeDocSnapshot({
        data: { enabled: true, bookingType: 'hourly', slotDuration: 60 },
      })
    );

    mockGetDocs
      .mockResolvedValueOnce(
        makeQuerySnapshot([
          makeDocSnapshot({
            id: dayName,
            data: { enabled: true, start: '09:00', end: '11:00', breakStart: null, breakEnd: null },
          }),
        ])
      )
      .mockResolvedValueOnce(
        makeQuerySnapshot([
          makeDocSnapshot({ id: 'b1', data: { timeSlot: '09:00', status: 'confirmed' } }),
        ])
      );

    const result = await service.getAvailableSlots('user-1', dateStr);

    expect(result.available).toBe(true);
    expect(result.slots).toEqual(['10:00']);
    expect(result.bookedCount).toBe(1);
  });

  test('createBooking returns conflict when slot becomes unavailable', async () => {
    const service = loadService();
    const dateStr = futureDateString();
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayName = dayNames[new Date(y, m - 1, d).getDay()];

    mockGetDoc.mockResolvedValueOnce(
      makeDocSnapshot({
        data: { enabled: true, bookingType: 'hourly', slotDuration: 60 },
      })
    );

    mockGetDocs
      .mockResolvedValueOnce(
        makeQuerySnapshot([
          makeDocSnapshot({ id: dayName, data: { enabled: true, start: '09:00', end: '11:00' } }),
        ])
      )
      .mockResolvedValueOnce(makeQuerySnapshot([]))
      .mockResolvedValueOnce(
        makeQuerySnapshot([makeDocSnapshot({ id: 'already-booked', data: { status: 'confirmed' } })])
      );

    const result = await service.createBooking('user-1', {
      phone: '+911234',
      name: 'Aflah',
      reason: 'Discussion',
      date: dateStr,
      timeSlot: '09:00',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('just booked');
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  test('getBookings sorts newest first', async () => {
    const service = loadService();

    mockGetDocs.mockResolvedValueOnce(
      makeQuerySnapshot([
        makeDocSnapshot({ id: 'old', data: { createdAt: { seconds: 10 }, status: 'pending' } }),
        makeDocSnapshot({ id: 'new', data: { createdAt: { seconds: 20 }, status: 'confirmed' } }),
      ])
    );

    const bookings = await service.getBookings('user-1');

    expect(bookings.map((b) => b.id)).toEqual(['new', 'old']);
  });

  test('updateBookingStatus confirmed writes confirmedAt and note', async () => {
    const service = loadService();

    const result = await service.updateBookingStatus('user-1', 'booking-1', 'confirmed', 'Bring documents');

    expect(result.success).toBe(true);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);

    const [, payload] = mockUpdateDoc.mock.calls[0];
    expect(payload.status).toBe('confirmed');
    expect(payload.confirmedAt).toBe('SERVER_TS');
    expect(payload.staffNote).toBe('Bring documents');
  });
});
