const transientCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_SERVER_SHUTDOWN',
  'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS', 'ER_OPTION_PREVENTS_STATEMENT',
  'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_GROUP_REPLICATION_COMMAND_FAILURE'
]);
function databaseErrorStatus(err, fallback = 500) {
  return transientCodes.has(err.code) || /No connections available|closed state/i.test(err.message || '') ? 503 : fallback;
}
module.exports = { databaseErrorStatus };
