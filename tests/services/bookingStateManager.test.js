describe('bookingStateManager', () => {
  let BOOKING_STEPS;
  let getState;
  let setState;
  let clearState;
  let startBooking;
  let setDate;
  let setTimeSlot;
  let setName;
  let isBookingAction;
  let parseButtonAction;
  const phone = `999${Date.now()}`;

  beforeAll(() => {
    jest.spyOn(global, 'setInterval').mockImplementation(() => 0);
    ({
      BOOKING_STEPS,
      getState,
      setState,
      clearState,
      startBooking,
      setDate,
      setTimeSlot,
      setName,
      isBookingAction,
      parseButtonAction,
    } = require('../../src/services/bookingStateManager'));
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    clearState(phone);
  });

  test('returns IDLE state by default', () => {
    expect(getState(phone)).toEqual({ step: BOOKING_STEPS.IDLE });
  });

  test('setState merges and persists values', () => {
    setState(phone, { step: BOOKING_STEPS.AWAITING_REASON, reason: 'Consultation' });
    const state = getState(phone);

    expect(state.step).toBe(BOOKING_STEPS.AWAITING_REASON);
    expect(state.reason).toBe('Consultation');
    expect(typeof state.updatedAt).toBe('number');
  });

  test('startBooking with reason skips to date step', () => {
    const state = startBooking(phone, 'Product demo');

    expect(state.step).toBe(BOOKING_STEPS.AWAITING_DATE);
    expect(state.reason).toBe('Product demo');
    expect(state.date).toBeNull();
  });

  test('startBooking without reason asks for reason', () => {
    const state = startBooking(phone);
    expect(state.step).toBe(BOOKING_STEPS.AWAITING_REASON);
  });

  test('progresses through date, slot and name steps', () => {
    startBooking(phone, 'General query');

    const withDate = setDate(phone, '2026-02-20');
    expect(withDate.step).toBe(BOOKING_STEPS.AWAITING_SLOT);
    expect(withDate.date).toBe('2026-02-20');

    const withSlot = setTimeSlot(phone, '10:30');
    expect(withSlot.step).toBe(BOOKING_STEPS.AWAITING_NAME);
    expect(withSlot.timeSlot).toBe('10:30');

    const withName = setName(phone, 'Aflah');
    expect(withName.step).toBe(BOOKING_STEPS.AWAITING_CONFIRM);
    expect(withName.name).toBe('Aflah');
  });

  test('clearState removes saved state', () => {
    setState(phone, { step: BOOKING_STEPS.AWAITING_SLOT });
    clearState(phone);

    expect(getState(phone)).toEqual({ step: BOOKING_STEPS.IDLE });
  });

  test('isBookingAction validates supported prefixes', () => {
    expect(isBookingAction('date_2026-02-20')).toBe(true);
    expect(isBookingAction('slot_10:00')).toBe(true);
    expect(isBookingAction('confirm_yes')).toBe(true);
    expect(isBookingAction('cancel_flow')).toBe(true);
    expect(isBookingAction('more_dates_2')).toBe(true);
    expect(isBookingAction('other_action')).toBe(false);
    expect(isBookingAction(null)).toBe(false);
  });

  test('parseButtonAction parses known action formats', () => {
    expect(parseButtonAction('date_2026-02-20')).toEqual({ type: 'date', value: '2026-02-20' });
    expect(parseButtonAction('slot_09:00')).toEqual({ type: 'slot', value: '09:00' });
    expect(parseButtonAction('confirm_yes')).toEqual({ type: 'confirm', value: 'yes' });
    expect(parseButtonAction('cancel_now')).toEqual({ type: 'cancel', value: true });
    expect(parseButtonAction('more_dates_3')).toEqual({ type: 'more_dates', page: 3 });
    expect(parseButtonAction('unsupported')).toBeNull();
    expect(parseButtonAction('')).toBeNull();
  });
});
