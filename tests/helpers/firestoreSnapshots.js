const makeDocSnapshot = ({ id = 'doc-id', data = {}, exists = true, ref = null } = {}) => ({
  id,
  ref,
  exists: () => exists,
  data: () => data,
});

const makeQuerySnapshot = (rows = []) => ({
  size: rows.length,
  empty: rows.length === 0,
  forEach: (cb) => rows.forEach((row) => cb(row)),
});

module.exports = {
  makeDocSnapshot,
  makeQuerySnapshot,
};
