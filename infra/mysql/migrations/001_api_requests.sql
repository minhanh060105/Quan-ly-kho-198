USE visinh_db;
CREATE TABLE IF NOT EXISTS api_requests (
  request_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
