const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { PORT } = require('./config');
const { initSocket } = require('./sockets/socketHandler');
const engineManager = require('./services/engineManager');

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

engineManager.setIO(io);
initSocket(io);

server.listen(PORT, () => {
  console.log(`NetCode-RFT Backend listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
