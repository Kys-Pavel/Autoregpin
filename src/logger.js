const winston = require('winston');
const path = require('path');
const fs = require('fs');

const config = require('../config.json');

const logsDir = path.resolve(__dirname, '..', config.paths.logsDir);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const today = new Date().toISOString().split('T')[0];

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })
      )
    }),
    new winston.transports.File({
      filename: path.join(logsDir, `reg-${today}.log`)
    }),
    new winston.transports.File({
      filename: path.join(logsDir, `errors-${today}.log`),
      level: 'error'
    })
  ]
});

module.exports = logger;
