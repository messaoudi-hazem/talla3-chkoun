const appModule = require('../dist/server.cjs');
const app = appModule.default || appModule;

module.exports = app;
