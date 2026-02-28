const http = require('http');
const https = require('https');
const { URL } = require('url');
const { logDebug, logWarn, sanitizeUrlForLog, truncateLogString, normalizeAbsoluteHttpUrl } = require('./utils');

function requestJson(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const {
      method = 'GET',
      headers = {},
      body = null,
      timeoutMs = 10_000,
      maxRedirects = 4,
      allowStatusCodes = [],
    } = options;
    const startedAt = Date.now();
    const safeUrl = sanitizeUrlForLog(url);
    logDebug('remote.json.start', {
      method,
      url: safeUrl,
      timeoutMs,
      bodyBytes: body ? Buffer.byteLength(String(body)) : 0,
    });
    const client = String(url).startsWith('http://') ? http : https;
    const request = client.request(
      url,
      {
        method,
        headers: {
          'user-agent': 'greenit/3.0',
          ...headers,
        },
      },
      (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (depth >= maxRedirects) {
            logWarn('remote.json.redirect_limit', {
              method,
              url: safeUrl,
              statusCode: res.statusCode,
              location: sanitizeUrlForLog(res.headers.location),
              depth,
            });
            reject(new Error(`Remote redirect limit exceeded (${res.statusCode})`));
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          logDebug('remote.json.redirect', {
            method,
            from: safeUrl,
            to: sanitizeUrlForLog(nextUrl),
            statusCode: res.statusCode,
            depth,
          });
          requestJson(nextUrl, options, depth + 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          if (allowStatusCodes.includes(res.statusCode)) {
            logDebug('remote.json.allowed_status', {
              method,
              url: safeUrl,
              statusCode: res.statusCode,
              durationMs: Date.now() - startedAt,
            });
            resolve(null);
            return;
          }
          const sample = String(data || '').slice(0, 220);
          logWarn('remote.json.http_error', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            sample,
          });
          reject(new Error(`Remote request failed (${res.statusCode})${sample ? `: ${sample}` : ''}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          logDebug('remote.json.success', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            bytes: Buffer.byteLength(data),
          });
          resolve(parsed);
        } catch {
          logWarn('remote.json.parse_error', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            sample: truncateLogString(data, 220),
          });
          reject(new Error('Remote response is not JSON'));
        }
      });
      }
    );

    if (body) request.write(body);
    request.end();

    request.on('error', (error) => {
      logWarn('remote.json.request_error', {
        method,
        url: safeUrl,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      logWarn('remote.json.timeout', {
        method,
        url: safeUrl,
        timeoutMs,
      });
      request.destroy(new Error('Remote request timed out'));
    });
  });
}

function requestText(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const {
      method = 'GET',
      headers = {},
      body = null,
      timeoutMs = 10_000,
      maxRedirects = 4,
      allowStatusCodes = [],
    } = options;
    const startedAt = Date.now();
    const safeUrl = sanitizeUrlForLog(url);
    logDebug('remote.text.start', {
      method,
      url: safeUrl,
      timeoutMs,
      bodyBytes: body ? Buffer.byteLength(String(body)) : 0,
    });
    const client = String(url).startsWith('http://') ? http : https;
    const request = client.request(
      url,
      {
        method,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (depth >= maxRedirects) {
              logWarn('remote.text.redirect_limit', {
                method,
                url: safeUrl,
                statusCode: res.statusCode,
                location: sanitizeUrlForLog(res.headers.location),
                depth,
              });
              reject(new Error(`Remote redirect limit exceeded (${res.statusCode})`));
              return;
            }
            const nextUrl = new URL(res.headers.location, url).toString();
            logDebug('remote.text.redirect', {
              method,
              from: safeUrl,
              to: sanitizeUrlForLog(nextUrl),
              statusCode: res.statusCode,
              depth,
            });
            requestText(nextUrl, options, depth + 1).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            if (allowStatusCodes.includes(res.statusCode)) {
              logDebug('remote.text.allowed_status', {
                method,
                url: safeUrl,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
              });
              resolve('');
              return;
            }
            const sample = String(data || '').slice(0, 220);
            logWarn('remote.text.http_error', {
              method,
              url: safeUrl,
              statusCode: res.statusCode,
              durationMs: Date.now() - startedAt,
              sample,
            });
            reject(new Error(`Remote request failed (${res.statusCode})${sample ? `: ${sample}` : ''}`));
            return;
          }
          logDebug('remote.text.success', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            bytes: Buffer.byteLength(data),
          });
          resolve(String(data || ''));
        });
      }
    );

    if (body) request.write(body);
    request.end();

    request.on('error', (error) => {
      logWarn('remote.text.request_error', {
        method,
        url: safeUrl,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      logWarn('remote.text.timeout', {
        method,
        url: safeUrl,
        timeoutMs,
      });
      request.destroy(new Error('Remote request timed out'));
    });
  });
}

function requestBinary(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body = null, timeoutMs = 12_000, maxBytes = 8_000_000 } = options;
    const target = normalizeAbsoluteHttpUrl(url);
    if (!target) {
      reject(new Error('Invalid URL'));
      return;
    }
    if (depth > 4) {
      reject(new Error('Too many redirects'));
      return;
    }

    const startedAt = Date.now();
    const safeUrl = sanitizeUrlForLog(target);
    if (depth === 0) {
      logDebug('remote.binary.start', {
        method,
        url: safeUrl,
        timeoutMs,
        maxBytes,
      });
    }
    const client = target.startsWith('http://') ? http : https;
    const request = client.request(
      target,
      {
        method,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...headers,
        },
      },
      (res) => {
        const status = Number(res.statusCode) || 0;
        const location = String(res.headers.location || '').trim();
        if (status >= 300 && status < 400 && location) {
          const nextUrl = new URL(location, target).toString();
          logDebug('remote.binary.redirect', {
            method,
            from: safeUrl,
            to: sanitizeUrlForLog(nextUrl),
            statusCode: status,
            depth,
          });
          res.resume();
          requestBinary(nextUrl, options, depth + 1).then(resolve).catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          logWarn('remote.binary.http_error', {
            method,
            url: safeUrl,
            statusCode: status,
            depth,
            durationMs: Date.now() - startedAt,
          });
          reject(new Error(`Remote request failed (${status})`));
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error('Remote image too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          logDebug('remote.binary.success', {
            method,
            url: safeUrl,
            statusCode: status,
            bytes: size,
            depth,
            durationMs: Date.now() - startedAt,
          });
          resolve({
            data: Buffer.concat(chunks),
            contentType: String(res.headers['content-type'] || '').trim(),
            finalUrl: target,
          });
        });
      }
    );

    if (body) request.write(body);
    request.end();

    request.on('error', (error) => {
      logWarn('remote.binary.request_error', {
        method,
        url: safeUrl,
        depth,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      logWarn('remote.binary.timeout', {
        method,
        url: safeUrl,
        depth,
        timeoutMs,
      });
      request.destroy(new Error('Remote request timed out'));
    });
  });
}

function fetchJson(url, options = {}) {
  return requestJson(url, options);
}

module.exports = {
  requestJson,
  requestText,
  requestBinary,
  fetchJson,
};
