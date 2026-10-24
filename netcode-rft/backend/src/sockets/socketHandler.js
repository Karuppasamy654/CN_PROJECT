const store = require('../services/store');

function initSocket(io) {
  io.on('connection', (socket) => {
    // Client joins a specific transfer room to receive live events
    socket.on('join_transfer', (transferId) => {
      socket.join(transferId);
      // Send any existing events immediately
      const events = store.getEvents(transferId);
      socket.emit('initial_events', events);
    });

    socket.on('leave_transfer', (transferId) => {
      socket.leave(transferId);
    });

    socket.on('disconnect', () => {
      // Clean up
    });
  });
}

module.exports = { initSocket };
