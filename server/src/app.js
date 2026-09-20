require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const admin = require('./controllers/adminController');
const history = require('./controllers/historyController');
const events = require('./controllers/eventsController');
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const WebSocket = require('ws');
const cors = require('cors');


const { checkReadiness, mode } = require('./config/db');
const { databaseErrorStatus } = require('./utils/databaseErrors');

// Middleware
const { verifyToken, requireRole, requirePermission } = require('./middleware/auth');
const { transactional } = require('./middleware/idempotency');

// Controllers
const authCtrl = require('./controllers/authController');
const batchCtrl = require('./controllers/batchController');
const importCtrl = require('./controllers/importController');
const exportCtrl = require('./controllers/exportController');
const reportCtrl = require('./controllers/reportController');
const auditCtrl = require('./controllers/auditController');
const configCtrl = require('./controllers/configController');
const locationCtrl = require('./controllers/locationController');
const stocktakeCtrl = require('./controllers/stocktakeController');

const app = express();
const server = http.createServer(app);

// Khởi tạo WebSocket Server (broadcast real-time cho các máy trạm)
const wss = new WebSocket.Server({ server });

function broadcastWebSocket(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

app.use(cors());
app.use(express.json());

const nodeId = process.env.NODE_ID || 'NodeA';
app.get('/api/live', (req, res) => res.json({ status: 'UP', node_id: nodeId }));
async function readiness(req, res) {
  const result = await checkReadiness();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.ready ? 200 : 503).json({
    status: result.ready ? 'UP' : 'DOWN', node_id: nodeId,
    ready: result.ready, mode, ha_enabled: mode === 'cluster',
    election_owner: mode === 'cluster' ? 'MYSQL_INNODB_CLUSTER' : null,
    primary_id: result.primary_id || null, online_members: result.online_members || 0
  });
}
app.get('/api/ready', readiness);
app.get('/api/health', readiness);

// No backend election: all nodes use Router's primary endpoint.
// MySQL enforces read-only/quorum at commit, including during a network partition.

// ==============================================================================
// BUSINESS API ROUTES
// ==============================================================================

// Fail closed if the configured Router does not expose a usable cluster primary.
// The database still enforces quorum for races after this preflight check.
app.use('/api', async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const state = await checkReadiness();
  if (!state.ready) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({ success: false, message: 'Cụm dữ liệu chưa sẵn sàng nhận ghi. Vui lòng thử lại.' });
  }
  next();
});

// Auth & Users
app.post('/api/auth/login', authCtrl.login);
app.get('/api/users', verifyToken, requireRole(['ADMIN']), wrap(admin.users));
app.post('/api/users', verifyToken, requireRole(['ADMIN']), wrap(admin.createUser));
app.put('/api/users/:id', verifyToken, requireRole(['ADMIN']), wrap(admin.updateUser));
app.delete('/api/users/:id', verifyToken, requireRole(['ADMIN']), wrap(admin.deleteUser));
app.get('/api/auth/me', verifyToken, wrap(admin.me));
app.put('/api/auth/password', verifyToken, wrap(admin.changePassword));
app.get('/api/events', verifyToken, events.stream);
app.get('/api/items', verifyToken, wrap(admin.items));
app.post('/api/items', verifyToken, requireRole(['ADMIN','MANAGER']), wrap(admin.saveItem));
app.put('/api/items/:id', verifyToken, requireRole(['ADMIN','MANAGER']), wrap(admin.saveItem));
app.post('/api/categories', verifyToken, requireRole(['ADMIN','MANAGER']), wrap(admin.category));

// Vị trí kho (Locations: KHO-A1, KHO-B1, KHO-TL)
app.get('/api/locations', verifyToken, locationCtrl.getLocations);
app.post('/api/locations', verifyToken, requireRole(['ADMIN', 'MANAGER']), locationCtrl.createLocation);

// Tra cứu lô hàng & Mã vạch Code 128
app.get('/api/batches/scan/:code', verifyToken, batchCtrl.scanBatchBarcode);
app.get('/api/inventory', verifyToken, batchCtrl.getInventory);

// Nhập kho (Idempotency Check)
app.post('/api/imports', verifyToken, requirePermission('can_import'), transactional(importCtrl.createImportTicket, () => broadcastWebSocket({ type: 'INVENTORY_UPDATE', action: 'IMPORT' })));

// Xuất kho & Phiếu đảo (Reversal Voucher) trong 24h
app.post('/api/exports', verifyToken, requirePermission('can_export'), transactional(exportCtrl.createExportTicket, () => broadcastWebSocket({ type: 'INVENTORY_UPDATE', action: 'EXPORT' })));

app.post('/api/exports/:id/cancel', verifyToken, requirePermission('can_export'), transactional(exportCtrl.cancelExportTicket, () => broadcastWebSocket({ type: 'INVENTORY_UPDATE', action: 'CANCEL_EXPORT' })));

app.get('/api/tickets', verifyToken, wrap(history.tickets));
app.get('/api/tickets/:type/:id', verifyToken, wrap(history.detail));
app.get('/api/imports/:id/labels', verifyToken, wrap(history.labels));
app.get('/api/stocktakes/:id', verifyToken, wrap(history.stocktakeDetail));
app.get('/api/reports/movements', verifyToken, wrap(history.movements));

// Kiểm kê kho & Xử lý xung đột số đếm (Stocktakes)
app.get('/api/stocktakes', verifyToken, stocktakeCtrl.getStocktakes);
app.post('/api/stocktakes', verifyToken, requireRole(['ADMIN', 'MANAGER']), transactional(stocktakeCtrl.createStocktake));
app.post('/api/stocktakes/:id/adjust', verifyToken, requireRole(['ADMIN', 'MANAGER']), transactional(stocktakeCtrl.adjustStocktake, () => broadcastWebSocket({ type: 'INVENTORY_UPDATE', action: 'STOCKTAKE_ADJUST' })));

// Dashboard & Báo cáo N-X-T
app.get('/api/dashboard/stats', verifyToken, reportCtrl.getDashboardStats);
app.get('/api/reports/inventory', verifyToken, reportCtrl.getInventoryReportData);
app.get('/api/reports/excel', verifyToken, reportCtrl.exportExcelReport);

// Audit Logs & Configs
app.get('/api/audit-logs', verifyToken, requireRole(['ADMIN','MANAGER']), wrap(history.audit));
app.get('/api/configs', verifyToken, wrap(admin.configs));
app.put('/api/configs', verifyToken, requireRole(['ADMIN']), wrap(admin.saveConfig));

// WebSocket connection log
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Kết nối WebSocket Server Khoa Vi sinh thành công' }));
});

app.use((err, req, res, next) => {
  console.error('[API Error]', err.message);
  if (res.headersSent) return next(err);
  const status=err.status || (err.code==='ER_DUP_ENTRY'?409:err.type==='entity.parse.failed'?400:databaseErrorStatus(err));
  res.status(status).json({success:false,message:err.status?err.message:status===409?'Mã đã tồn tại.':'Máy chủ không thể xử lý yêu cầu lúc này.'});
});

app.use(express.static(path.join(__dirname,'../../client/src')));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Backend Server Khoa Vi sinh đang chạy tại Port: ${PORT}`);
  console.log(`📌 Backend ${nodeId} | MySQL Router / InnoDB Cluster`);
  console.log(`=======================================================`);
});
