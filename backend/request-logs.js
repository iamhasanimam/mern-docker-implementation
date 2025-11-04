export default function requestLog(req, res, next) {
  const rid = req.headers['x-request-id'] || 'no-rid';
  const xff = req.headers['x-forwarded-for'] || req.ip;
  
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    requestId: rid,
    ip: xff,
    method: req.method,
    path: req.originalUrl,
    userAgent: req.headers['user-agent']
  }));
  
  next();
}