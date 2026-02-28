const http = require('http');
const config = require('./server/config');
const { logInfo } = require('./server/utils');
const { createRoutes } = require('./server/routes');

const routes = createRoutes();
const server = http.createServer(routes);

server.listen(config.PORT, () => {
  logInfo('server.started', {
    port: config.PORT,
    baseUrl: `http://localhost:${config.PORT}`,
    logLevel: config.ACTIVE_LOG_LEVEL,
    maxLogChars: config.MAX_LOG_CHARS,
  });
});
