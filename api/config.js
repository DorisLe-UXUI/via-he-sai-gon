const { handler, send, CLIENT_ID, dbStatus } = require('./_lib/core');
module.exports = handler(['GET'], (req, res) => send(res, 200, {
  clientId: CLIENT_ID(), online: !!CLIENT_ID(),
  fbAppId: process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET ? process.env.FACEBOOK_APP_ID : '',
  email: true,
  ...dbStatus(),
}));
