import * as fs from 'fs';
import { Pool } from 'pg';
import { notifier, NotifyEvent } from '../notifications/notify';

function buildSslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  const certPath = process.env.RDS_CA_CERT_PATH;
  if (certPath) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath, 'utf-8'),
    };
  }

  // No cert path configured in production — fall back to unverified SSL with warning
  console.warn('[DB] RDS_CA_CERT_PATH not set — SSL connections are NOT verified. Set RDS_CA_CERT_PATH to enable certificate pinning.');
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
  notifier.emit(NotifyEvent.DB_CONNECTION_FAILURE, 'Database pool error', undefined, err);
});

export default pool;
