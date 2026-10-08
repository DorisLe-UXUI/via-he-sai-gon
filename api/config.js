const { handler, send, CLIENT_ID } = require('./_lib/core');
module.exports = handler(['GET'], (req, res) => send(res, 200, { clientId: CLIENT_ID(), online: !!CLIENT_ID() }));
