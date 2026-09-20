/**
 * API Client tích hợp Auto-Reconnect & Idempotency Key cho Hệ thống HA LAN.
 */

const savedApiUrl = localStorage.getItem('visinh_api_url');
const validSavedApiUrl = savedApiUrl && !(/localhost|127\.0\.0\.1/.test(window.location.hostname) && /\/api\/?$/.test(savedApiUrl) && !/:3000\/api\/?$/.test(savedApiUrl)) ? savedApiUrl : null;
if (!validSavedApiUrl && savedApiUrl) localStorage.removeItem('visinh_api_url');
const API_BASE_URL = validSavedApiUrl || (
  window.location.protocol === 'file:'
    ? 'http://192.168.1.200:3000/api'
    : (['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? 'http://127.0.0.1:3000/api'
      : `${window.location.origin}/api`)
);

class ApiService {
  constructor() {
    this.baseUrl = API_BASE_URL;
    this.token = localStorage.getItem('visinh_token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('visinh_token', token);
    else localStorage.removeItem('visinh_token');
  }

  generateUUID() {
    return 'IDEM-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
  }

  async request(endpoint, options = {}, retries = 8, delay = 500) {
    const url = `${this.baseUrl.replace(/\/$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (['POST', 'PUT', 'DELETE'].includes(options.method)) {
      options = { ...options, idempotencyKey: options.idempotencyKey || this.generateUUID() };
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    const method = (options.method || 'GET').toUpperCase();
    const canRetry = method === 'GET' || (method === 'POST' &&
      /^\/(imports|exports|exports\/[^/]+\/cancel|stocktakes|stocktakes\/[^/]+\/adjust)$/.test(endpoint));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      if (response.status === 401 && endpoint !== '/auth/login') {
        this.setToken(null);
        window.dispatchEvent(new CustomEvent('auth-expired'));
        throw new Error('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
      }

      if ([502, 503, 504].includes(response.status)) {
        const error = new Error('Backend chưa sẵn sàng. Kiểm tra kết nối MySQL và cấu hình DB trong server/.env.');
        error.retryable = true;
        throw error;
      }
      const raw = await response.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        const contentType = response.headers?.get?.('content-type') || '';
        throw Object.assign(new Error(contentType.includes('text/html')
          ? `Địa chỉ API không đúng hoặc backend chưa chạy (${response.status}).`
          : `Backend trả về phản hồi không hợp lệ (${response.status}).`), { status: response.status });
      }
      if (!data) {
        throw Object.assign(new Error(`Backend không trả dữ liệu (${response.status}). Kiểm tra server và DB.`), { status: response.status });
      }
      if (!response.ok) {
        throw Object.assign(new Error(data.message || 'Lỗi thao tác hệ thống.'), {status:response.status});
      }

      this.hideReconnectToast();
      return data;

    } catch (err) {
      clearTimeout(timer);
      if (canRetry && retries > 0 && (err.retryable || err.name === 'AbortError' || err.name === 'TypeError' || err.message.includes('Failed to fetch'))) {
        this.showReconnectToast(`Đang kết nối lại máy chủ hệ thống... (Thử lại ${9 - retries}/8)`);
        await new Promise(res => setTimeout(res, delay));
        return this.request(endpoint, options, retries - 1, Math.min(delay * 1.5, 3000));
      }

      this.hideReconnectToast();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  showReconnectToast(msg) {
    let toast = document.getElementById('ha-reconnect-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ha-reconnect-toast';
      toast.style.position = 'fixed';
      toast.style.top = '12px';
      toast.style.right = '20px';
      toast.style.zIndex = '99999';
      toast.style.background = '#F59E0B';
      toast.style.color = '#FFFFFF';
      toast.style.padding = '8px 16px';
      toast.style.borderRadius = '6px';
      toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      toast.style.fontWeight = '600';
      toast.style.fontSize = '13px';
      document.body.appendChild(toast);
    }
    toast.innerText = '⚡ ' + msg;
    toast.style.display = 'block';
  }

  hideReconnectToast() {
    const toast = document.getElementById('ha-reconnect-toast');
    if (toast) toast.style.display = 'none';
  }

  async mutate(endpoint, payload, method = 'POST') {
    const body = JSON.stringify(payload || {});
    const storageKey = 'pending:' + endpoint + ':' + body;
    const key = sessionStorage.getItem(storageKey) || this.generateUUID();
    sessionStorage.setItem(storageKey, key);
    try {
      const result = await this.request(endpoint, {method, body, idempotencyKey:key});
      sessionStorage.removeItem(storageKey); return result;
    } catch(err) {
      if (err.status >= 400 && err.status < 500) sessionStorage.removeItem(storageKey);
      throw err;
    }
  }

  async download(endpoint, filename) {
    const response = await fetch(this.baseUrl + endpoint, {headers:{Authorization:`Bearer ${this.token}`}});
    if (!response.ok) throw new Error('Không thể tải tệp. Vui lòng kiểm tra phiên đăng nhập và kết nối.');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }

  // Endpoints
  login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }

  getLocations() {
    return this.request('/locations');
  }

  getDashboardStats() {
    return this.request('/dashboard/stats');
  }

  scanBarcode(batchCode) {
    return this.request(`/batches/scan/${encodeURIComponent(batchCode)}`);
  }

  getInventory(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/inventory?${query}`);
  }

  createImportTicket(payload) {
    return this.request('/imports', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  createExportTicket(payload) {
    return this.request('/exports', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  cancelExportTicket(ticketId, cancelReason) {
    return this.request(`/exports/${ticketId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancel_reason: cancelReason })
    });
  }

  getTickets() {
    return this.request('/tickets');
  }

  getStocktakes() {
    return this.request('/stocktakes');
  }

  createStocktake(payload) {
    return this.request('/stocktakes', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  adjustStocktake(stocktakeId) {
    return this.request(`/stocktakes/${stocktakeId}/adjust`, {
      method: 'POST'
    });
  }

  getInventoryReport(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/reports/inventory?${query}`);
  }

  getUsers() {
    return this.request('/users');
  }

  toggleLockUser(userId) {
    return this.request(`/users/${userId}/lock`, {
      method: 'PUT'
    });
  }

  getAuditLogs() {
    return this.request('/audit-logs');
  }
}

const api = new ApiService();
