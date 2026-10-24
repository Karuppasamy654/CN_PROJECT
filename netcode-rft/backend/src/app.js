const express = require('express');
const cors = require('cors');
const multer = require('multer');
const healthRoutes = require('./routes/health');
const transferRoutes = require('./routes/transfers');
const calculationRoutes = require('./routes/calculations');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', healthRoutes);
app.use('/api', transferRoutes);
app.use('/api', calculationRoutes);

// Central error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File size exceeds maximum limit of 50MB' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
  next();
});

module.exports = app;
