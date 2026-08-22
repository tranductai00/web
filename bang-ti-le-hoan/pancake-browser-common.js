// Pancake POS browser adapter for GitHub Pages.
// IMPORTANT: This module ONLY fetches/normalizes Pancake data.
// It intentionally contains NO return-rate/success-rate calculation.
// All calculations continue to run through the untouched legacy parser.

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 60;
export const MAX_ORDERS = 60000;
export const DETAIL_CONCURRENCY = 6;
export const STATUS_LABELS = [
  'Mới','Cần xử lý','Chờ hàng','Đã đặt hàng','Chờ in','Đã in','Đang đóng hàng',
  'Đã xác nhận','Chờ chuyển hàng','Đã gửi hàng','Đang hoàn','Đang đổi',
  'Đã nhận','Đã thu tiền','Đã hoàn','Đã huỷ'
];

export const KNOWN_STATUS = {
  0: 'Mới',
  11: 'Chờ hàng',
  13: 'Đã in'
};

const detailCache = new Map();
const DETAIL_CACHE_LIMIT = 5000;
const RANGE_WEEK_SECONDS = 7 * 24 * 60 * 60;
const RANGE_DAY_SECONDS = 24 * 60 * 60;

function first(obj, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let cur = obj;
    let ok = true;
    for (const key of parts) {
      if (cur == null || typeof cur !== 'object' || !(key in cur)) { ok = false; break; }
      cur = cur[key];
    }
    if (ok && cur !== undefined && cur !== null) {
      if (typeof cur === 'string' && !cur.trim()) continue;
      return cur;
    }
  }
  return '';
}

function cleanText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return String(v).trim();
  return '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findStatusLabel(order) {
  const direct = first(order, [
    'status_name','statusName','order_status_name','orderStatusName',
    'status_text','statusText','status_label','statusLabel',
    'status_info.name','statusInfo.name','order_status.name','orderStatus.name'
  ]);
  if (cleanText(direct) && !/^-?\d+$/.test(cleanText(direct))) return cleanText(direct);

  const seen = new Set();
  function walk(value, depth) {
    if (!value || typeof value !== 'object' || depth > 3 || seen.has(value)) return '';
    seen.add(value);
    for (const [key, v] of Object.entries(value)) {
      const lk = String(key).toLowerCase();
      if (!lk.includes('status')) continue;
      if (typeof v === 'string' && v.trim() && !/^-?\d+$/.test(v.trim())) return v.trim();
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const nameKey of ['name','label','title','display_name','displayName','text']) {
          const s = cleanText(v[nameKey]);
          if (s && !/^-?\d+$/.test(s)) return s;
        }
      }
    }
    for (const v of Object.values(value)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
    }
    return '';
  }
  return walk(order, 0);
}

function statusFor(order) {
  const label = findStatusLabel(order);
  if (label) return label;
  const raw = first(order, ['status','order_status','orderStatus','status_id','statusId']);
  const n = Number(raw);
  if (Number.isFinite(n) && Object.prototype.hasOwnProperty.call(KNOWN_STATUS, n)) return KNOWN_STATUS[n];
  const s = cleanText(raw);
  if (s && !/^-?\d+$/.test(s)) return s;
  return s ? `Trạng thái ${s}` : 'Trạng thái không xác định';
}

function looksLikeItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return !!(
    cleanText(first(value, [
      'sku','seller_sku','sellerSku','product_code','productCode','barcode',
      'variation_id','variationId','variant_id','variantId','product_id','productId',
      'item_id','itemId','variation_display_id','variationDisplayId',
      'product_display_id','productDisplayId','variation_name','variationName',
      'product_name','productName'
    ])) ||
    (value.variation_info && (typeof value.variation_info === 'object' || typeof value.variation_info === 'string')) ||
    (value.variationInfo && (typeof value.variationInfo === 'object' || typeof value.variationInfo === 'string')) ||
    (value.product && (typeof value.product === 'object' || typeof value.product === 'string')) ||
    (value.variant && (typeof value.variant === 'object' || typeof value.variant === 'string')) ||
    (value.variation && (typeof value.variation === 'object' || typeof value.variation === 'string'))
  );
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t || !((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return value;
  try { return JSON.parse(t); } catch (_) { return value; }
}

function collectItemValue(value, depth=0) {
  if (!value || depth > 3) return [];
  value = parseMaybeJson(value);

  if (Array.isArray(value)) {
    const out = [];
    for (const v0 of value) {
      const v = parseMaybeJson(v0);
      if (!v) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (looksLikeItem(v)) out.push(v);
        else out.push(...collectItemValue(v, depth + 1));
      } else if (Array.isArray(v)) {
        out.push(...collectItemValue(v, depth + 1));
      }
    }
    return out;
  }

  if (typeof value !== 'object') return [];
  if (looksLikeItem(value)) return [value];

  // Pancake may return line-items as an object keyed by id or nested under a wrapper.
  const out = [];
  for (const v0 of Object.values(value)) {
    const v = parseMaybeJson(v0);
    if (!v) continue;
    if (v && typeof v === 'object') out.push(...collectItemValue(v, depth + 1));
  }
  return out;
}

function itemArrays(order) {
  const directKeys = [
    'items','order_items','orderItems','ordered_items','orderedItems',
    'products','product_items','productItems','products_info','productsInfo',
    'line_items','lineItems','details','order_details','orderDetails',
    'order_products','orderProducts','variations','variation_infos','variationInfos',
    'product_variations','productVariations','item_variations','itemVariations',
    'bundle_items','bundleItems','combo_items','comboItems'
  ];

  const direct = [];
  for (const key of directKeys) {
    if (order && Object.prototype.hasOwnProperty.call(order, key)) {
      direct.push(...collectItemValue(order[key]));
    }
  }
  if (direct.length) return direct;

  // Bounded fallback: scan nested structures and JSON-string wrappers.
  const found = [];
  const seenObjects = new Set();
  const seenItems = new Set();

  function addItem(it) {
    it = parseMaybeJson(it);
    if (!it || typeof it !== 'object' || Array.isArray(it) || seenItems.has(it)) return;
    if (!looksLikeItem(it)) return;
    seenItems.add(it);
    found.push(it);
  }

  function walk(raw, depth) {
    if (depth > 5) return;
    const obj = parseMaybeJson(raw);
    if (!obj || typeof obj !== 'object' || seenObjects.has(obj)) return;
    seenObjects.add(obj);

    if (Array.isArray(obj)) {
      for (const child of obj) {
        const parsed = parseMaybeJson(child);
        if (parsed && typeof parsed === 'object') {
          if (!Array.isArray(parsed) && looksLikeItem(parsed)) addItem(parsed);
          else walk(parsed, depth + 1);
        }
      }
      return;
    }

    if (looksLikeItem(obj)) addItem(obj);

    for (const [key, rawValue] of Object.entries(obj)) {
      const lk = String(key).toLowerCase();
      const value = parseMaybeJson(rawValue);

      if (/(^|_)(items?|products?|variations?|line_items?|order_items?|ordered_items?|order_details?|product_variations?)(_|$)/.test(lk) ||
          /(item|product|variation|variant|detail)/.test(lk)) {
        const candidates = collectItemValue(value);
        for (const it of candidates) addItem(it);
      }

      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }

  walk(order, 0);
  return found;
}

function productCode(item) {
  const raw = first(item, [
    'variation_info.display_id','variation_info.sku','variation_info.product_code','variation_info.code',
    'variation_info.product_display_id','variation_info.seller_sku','variation_info.barcode',
    'variationInfo.display_id','variationInfo.sku','variationInfo.product_code','variationInfo.code',
    'variationInfo.productDisplayId','variationInfo.sellerSku','variationInfo.barcode',
    'product.display_id','product.sku','product.product_code','product.code','product.seller_sku','product.barcode',
    'variant.display_id','variant.sku','variant.product_code','variant.code','variant.seller_sku','variant.barcode',
    'variation.display_id','variation.sku','variation.product_code','variation.code','variation.seller_sku','variation.barcode',
    'sku','seller_sku','sellerSku','product_sku','productSku','variation_sku','variationSku',
    'product_code','productCode','code','barcode','display_id','displayId',
    'variation_display_id','variationDisplayId','product_display_id','productDisplayId'
  ]);
  const code = cleanText(raw);
  if (code) return {code, fallback:false};

  // Some Pancake payloads serialize variation_info/product as JSON strings.
  for (const key of ['variation_info','variationInfo','product','variant','variation']) {
    const nested = parseMaybeJson(item?.[key]);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedCode = cleanText(first(nested, [
        'display_id','displayId','sku','seller_sku','sellerSku',
        'product_code','productCode','code','barcode',
        'product_display_id','productDisplayId'
      ]));
      if (nestedCode) return {code:nestedCode, fallback:false};
      const nestedId = cleanText(first(nested,['variation_id','variationId','variant_id','variantId','id']));
      if (nestedId) return {code:`VAR-${nestedId}`, fallback:true};
      const nestedProductId = cleanText(first(nested,['product_id','productId']));
      if (nestedProductId) return {code:`SP-${nestedProductId}`, fallback:true};
    }
  }

  // Stable fallback ids are acceptable because the untouched legacy formula groups by product code.
  const variationId = cleanText(first(item, [
    'variation_id','variationId','variant_id','variantId',
    'variation_info.id','variationInfo.id','variation.id','variant.id'
  ]));
  if (variationId) return {code:`VAR-${variationId}`, fallback:true};

  const productId = cleanText(first(item, [
    'product_id','productId','variation_info.product_id','variationInfo.productId','product.id'
  ]));
  if (productId) return {code:`SP-${productId}`, fallback:true};

  const id = cleanText(first(item, ['id','item_id','itemId']));
  if (id) return {code:`ITEM-${id}`, fallback:true};

  // Last-resort stable text code. Do not fabricate a random id.
  const textCode = cleanText(first(item, [
    'variation_name','variationName','product_name','productName','name','title'
  ]));
  if (textCode) return {code:`NAME-${textCode}`.slice(0,160), fallback:true};
  return {code:'', fallback:true};
}

function productName(item, code) {
  const raw = first(item, [
    'variation_info.name','variation_info.product_name','variation_info.display_name',
    'variation_info.product_display_name','variation_info.title',
    'variationInfo.name','variationInfo.product_name','variationInfo.display_name',
    'variationInfo.productName','variationInfo.productDisplayName','variationInfo.title',
    'product.name','product.product_name','product.display_name','product.title',
    'variant.name','variant.product_name','variant.display_name','variant.title',
    'variation.name','variation.product_name','variation.display_name','variation.title',
    'product_name','productName','variation_name','variationName',
    'name','display_name','displayName','title'
  ]);
  const direct = cleanText(raw);
  if (direct) return direct;

  // Some responses store variation_info/product as serialized JSON.
  for (const key of ['variation_info','variationInfo','product','variant','variation']) {
    const nested = parseMaybeJson(item?.[key]);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const text = cleanText(first(nested, ['name','product_name','productName','display_name','displayName','title','sku','display_id']));
      if (text) return text;
    }
  }
  return code;
}

function orderId(order) {
  return cleanText(first(order, [
    'display_id','displayId','order_number','orderNumber','order_code','orderCode','code','id'
  ]));
}

function orderApiIds(order) {
  const out = [];
  for (const path of ['id','order_id','orderId','display_id','displayId','order_number','orderNumber']) {
    const value = cleanText(first(order, [path]));
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function matchKeys(order) {
  return orderApiIds(order).map(v => String(v));
}

function mergeOrder(summary, detail) {
  if (!detail || typeof detail !== 'object') return summary;
  return {...summary, ...detail};
}

function unwrapOrderDetail(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.order,
    payload.data?.order,
    payload.result?.order,
    payload.data,
    payload.result,
    payload
  ];
  for (const value of candidates) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (Array.isArray(value) && value[0] && typeof value[0] === 'object') return value[0];
  }
  return null;
}

function listData(payload) {
  const candidates = [
    payload?.data,
    payload?.orders,
    payload?.results,
    payload?.data?.data,
    payload?.data?.orders,
    payload?.data?.results,
    payload?.result?.data,
    payload?.result?.orders,
    payload?.result?.results
  ];
  for (const value of candidates) if (Array.isArray(value)) return value;
  return [];
}

function mergePageOrders(summaryOrders, enrichedOrders) {
  if (!Array.isArray(summaryOrders) || !summaryOrders.length || !Array.isArray(enrichedOrders) || !enrichedOrders.length) {
    return summaryOrders || [];
  }

  const byKey = new Map();
  for (const detail of enrichedOrders) {
    for (const key of matchKeys(detail)) if (!byKey.has(key)) byKey.set(key, detail);
  }

  return summaryOrders.map((summary, index) => {
    let detail = null;
    for (const key of matchKeys(summary)) {
      if (byKey.has(key)) { detail = byKey.get(key); break; }
    }

    // Safe positional fallback only when both rows point to the same visible order id.
    if (!detail && enrichedOrders[index]) {
      const a = orderId(summary), b = orderId(enrichedOrders[index]);
      if (a && b && a === b) detail = enrichedOrders[index];
    }
    return detail ? mergeOrder(summary, detail) : summary;
  });
}

export function normalizeOrders(orders) {
  const rows = [];
  let ordersWithoutItems = 0;
  let itemsWithoutCode = 0;
  let fallbackCodeCount = 0;
  const statusCounts = {};
  const unknownNumericStatuses = {};

  for (const order of (Array.isArray(orders) ? orders : [])) {
    const oid = orderId(order);
    if (!oid) continue;

    const status = statusFor(order);
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const rawStatus = cleanText(first(order, ['status','order_status','orderStatus','status_id','statusId']));
    if (/^-?\d+$/.test(rawStatus) && !findStatusLabel(order) &&
        !Object.prototype.hasOwnProperty.call(KNOWN_STATUS, Number(rawStatus))) {
      unknownNumericStatuses[rawStatus] = (unknownNumericStatuses[rawStatus] || 0) + 1;
    }

    const items = itemArrays(order);
    if (!items.length) {
      ordersWithoutItems++;
      continue;
    }

    const seenCodes = new Set();
    for (const item of items) {
      const pc = productCode(item);
      if (!pc.code) {
        itemsWithoutCode++;
        continue;
      }
      if (pc.fallback) fallbackCodeCount++;

      // Exactly one row/product/order. The legacy parser later counts distinct order ids unchanged.
      if (seenCodes.has(pc.code)) continue;
      seenCodes.add(pc.code);

      const name = productName(item, pc.code);
      rows.push({
        product: name,
        orderId: oid,
        code: pc.code,
        name,
        status,
        statusCode: rawStatus
      });
    }
  }

  return {
    rows,
    ordersWithoutItems,
    itemsWithoutCode,
    fallbackCodeCount,
    statusCounts,
    unknownNumericStatuses
  };
}

export function validatePancakeConfig(config, {requireToken=true}={}) {
  const shopId = String(config?.shopId || '').trim();
  const savedFilterId = String(config?.savedFilterId || '').trim();
  const accessToken = String(config?.accessToken || '').trim();
  if (!/^\d{3,30}$/.test(shopId)) throw new Error('Shop ID không hợp lệ.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(savedFilterId)) throw new Error('Saved Filter ID không hợp lệ.');
  if (requireToken && !accessToken) throw new Error('Chưa có access token Pancake.');
  return {shopId, savedFilterId, accessToken};
}

export function unixDay(value, end=false) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  const d = end
    ? new Date(+m[1], +m[2]-1, +m[3], 23, 59, 59, 999)
    : new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
  return Math.floor(d.getTime()/1000);
}

export function monthFromDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-/);
  return m ? `Tháng ${Number(m[2])}/${m[1]}` : '';
}

export function buildPancakeUrl({
  shopId, savedFilterId, startDateTime, endDateTime,
  page=1, pageSize=PAGE_SIZE, accessToken, esOnly=true, filterProfile='neutral'
}) {
  validatePancakeConfig({shopId,savedFilterId,accessToken});
  const base = `https://pos.pancake.vn/api/v1/shops/${encodeURIComponent(shopId)}/orders/get_orders`;
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('editorId', 'none');
  params.set('endDateTime', String(endDateTime));

  // Saved filter itself is authoritative. Pancake's internal UI can send slightly
  // different helper flags depending on how a saved filter was created. "bare"
  // intentionally omits them; the other profiles reproduce common UI shapes.
  if (filterProfile !== 'bare') {
    params.set('is_filter_attributes_by_or', 'true');
    params.set('is_filter_conversation_tag_by_or', 'true');
    params.set('is_filter_customer_tag_by_or', 'true');
    params.set('is_filter_exclude', 'false');
    params.set('is_filter_exclude_conversation_tag', 'false');
    params.set('is_filter_exclude_customer_tag', 'false');
    params.set('is_filter_exclude_partner', 'false');
    params.set('is_filter_exclude_product_tag', 'false');
    params.set('is_filter_order_tag_by_or', 'true');
    params.set('is_filter_product_by_or', 'true');
    params.set('is_filter_tag_by_or', 'true');
  }

  const multipleKeys = [
    'is_filter_multiple_employee','is_filter_multiple_field_address',
    'is_filter_multiple_partner','is_filter_multiple_promotion','is_filter_multiple_source'
  ];
  if (filterProfile === 'legacy-source') {
    // Exact shape captured from Pancake POS for a saved filter with multiple sources.
    for (const key of multipleKeys) params.set(key, key === 'is_filter_multiple_source' ? 'true' : 'false');
  } else if (filterProfile === 'employee-source') {
    for (const key of multipleKeys) {
      params.set(key, (key === 'is_filter_multiple_employee' || key === 'is_filter_multiple_source') ? 'true' : 'false');
    }
  } else if (filterProfile === 'employee-only') {
    for (const key of multipleKeys) params.set(key, key === 'is_filter_multiple_employee' ? 'true' : 'false');
  } else if (filterProfile === 'all-multiple') {
    for (const key of multipleKeys) params.set(key, 'true');
  } else if (filterProfile === 'all-single') {
    for (const key of multipleKeys) params.set(key, 'false');
  }
  // neutral => generic flags are sent, but multiple_* keys are omitted.
  // bare    => all filter-helper flags are omitted and saved_filters_id stands alone.

  params.set('option_sort', 'inserted_at_desc');
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  params.set('saved_filters_id', savedFilterId);
  params.set('startDateTime', String(startDateTime));
  params.set('status', '-1');
  params.append('timeRange[]', '0');
  params.set('updateStatus', 'inserted_at');
  params.set('es_only', esOnly ? 'true' : 'false');
  return `${base}?${params.toString()}`;
}

async function fetchJson(url, {method='GET', attempts=3}={}) {
  let lastError = null;

  for (let attempt=0; attempt<attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        mode:'cors',
        credentials:'omit',
        headers:{'Accept':'application/json, text/plain, */*'}
      });

      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        const err = new Error(`Pancake trả dữ liệu không phải JSON (HTTP ${response.status}).`);
        err.status = response.status;
        throw err;
      }

      if (response.ok) return data;

      const message = cleanText(data?.message || data?.error || data?.error_message) || `HTTP ${response.status}`;
      const err = new Error(`Pancake POS: ${message}`);
      err.status = response.status;

      if ((response.status===429 || response.status>=500) && attempt+1<attempts) {
        lastError = err;
        await sleep(400*Math.pow(2,attempt));
        continue;
      }
      throw err;
    } catch (error) {
      lastError = error;
      if (error?.status && error.status < 500 && error.status !== 429) throw error;
      if (attempt+1<attempts) {
        await sleep(400*Math.pow(2,attempt));
        continue;
      }
    }
  }

  const err = lastError || new Error('Không kết nối được Pancake POS.');
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err?.message||''))) {
    throw new Error('Không gọi được Pancake POS từ trình duyệt. Có thể Pancake đang chặn CORS cho domain GitHub Pages.');
  }
  throw err;
}

async function fetchPage(args, attempts=3) {
  return fetchJson(buildPancakeUrl(args), {method:'POST', attempts});
}

function totalEntriesFromPayload(payload, fallback=0) {
  const values = [
    payload?.total_entries,payload?.totalEntries,payload?.total,
    payload?.data?.total_entries,payload?.data?.totalEntries,payload?.data?.total,
    payload?.result?.total_entries,payload?.result?.totalEntries,payload?.result?.total
  ];
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return Math.max(0, Number(fallback) || 0);
}

function totalPagesFromPayload(payload, fallback=1) {
  const values = [
    payload?.total_pages,payload?.totalPages,
    payload?.data?.total_pages,payload?.data?.totalPages,
    payload?.result?.total_pages,payload?.result?.totalPages
  ];
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return Math.max(1, Number(fallback) || 1);
}

async function fetchFirstUsablePage(baseArgs, {
  profiles=['legacy-source','bare','neutral','employee-source','employee-only','all-single','all-multiple'],
  esModes=[true,false]
}={}) {
  let best = null;
  let lastError = null;

  for (const filterProfile of profiles) {
    for (const esOnly of esModes) {
      try {
        const payload = await fetchPage({...baseArgs,filterProfile,esOnly}, 2);
        const orders = listData(payload);
        const totalEntries = totalEntriesFromPayload(payload, orders.length);
        const totalPages = totalPagesFromPayload(payload, 1);
        const current = {payload,orders,totalEntries,totalPages,filterProfile,esOnly};

        // A non-empty page is the strongest signal.
        if (orders.length) return current;
        if (!best || totalEntries > best.totalEntries) best = current;
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (best) return best;
  throw lastError || new Error('Không lấy được danh sách đơn từ Pancake.');
}

function mergeUniqueOrders(target, incoming) {
  const out = Array.isArray(target) ? target.slice() : [];
  const index = new Map();

  const register = (order, pos) => {
    const keys = matchKeys(order);
    if (!keys.length) {
      const visible = orderId(order);
      if (visible) keys.push(`visible:${visible}`);
    }
    for (const key of keys) if (!index.has(String(key))) index.set(String(key), pos);
  };

  for (let i=0;i<out.length;i++) register(out[i], i);

  for (const order of (Array.isArray(incoming) ? incoming : [])) {
    let existingIndex = -1;
    for (const key of matchKeys(order)) {
      if (index.has(String(key))) { existingIndex = index.get(String(key)); break; }
    }
    if (existingIndex < 0) {
      const visible = orderId(order);
      if (visible && index.has(`visible:${visible}`)) existingIndex = index.get(`visible:${visible}`);
    }

    if (existingIndex >= 0) {
      // Keep whichever copy contains richer line-item/detail data.
      out[existingIndex] = mergeOrder(out[existingIndex], order);
      register(out[existingIndex], existingIndex);
    } else {
      const pos = out.length;
      out.push(order);
      register(order, pos);
    }
  }
  return out;
}

function rangeChunks(startDateTime, endDateTime, chunkSeconds) {
  const chunks = [];
  let start = Number(startDateTime);
  const end = Number(endDateTime);
  const size = Math.max(60, Number(chunkSeconds) || RANGE_DAY_SECONDS);
  while (start <= end) {
    const chunkEnd = Math.min(end, start + size - 1);
    chunks.push([start, chunkEnd]);
    start = chunkEnd + 1;
  }
  return chunks;
}

async function collectRangePages({
  shopId, savedFilterId, accessToken, startDateTime, endDateTime,
  testOnly=false, onProgress=null, firstPageProfiles=null, forcedProfile='', forcedEsOnly=null,
  rangeIndex=1, rangeTotal=1
}) {
  let allOrders = [];
  let page = 1;
  let totalPages = 1;
  let totalEntries = 0;
  let enrichedPages = 0;
  let enrichmentFailures = 0;
  let requestProfile = forcedProfile || 'legacy-source';
  let listEsOnly = forcedEsOnly === null ? true : !!forcedEsOnly;
  const maxWantedPages = testOnly ? 1 : MAX_PAGES;

  do {
    onProgress?.({
      phase:'list',page,totalPages,totalEntries,fetchedOrders:allOrders.length,
      rangeIndex,rangeTotal,rangeStart:startDateTime,rangeEnd:endDateTime
    });

    const baseArgs = {
      shopId,savedFilterId,accessToken,startDateTime,endDateTime,
      page,pageSize:testOnly?20:PAGE_SIZE
    };

    let data, pageData;

    if (page === 1 && !forcedProfile) {
      const firstPage = await fetchFirstUsablePage(
        baseArgs,
        firstPageProfiles ? {profiles:firstPageProfiles} : undefined
      );
      data = firstPage.payload;
      pageData = firstPage.orders;
      totalPages = firstPage.totalPages;
      totalEntries = firstPage.totalEntries;
      requestProfile = firstPage.filterProfile;
      listEsOnly = firstPage.esOnly;
    } else {
      data = await fetchPage({
        ...baseArgs,filterProfile:requestProfile,esOnly:listEsOnly
      });
      pageData = listData(data);
      totalPages = totalPagesFromPayload(data,totalPages);
      totalEntries = totalEntriesFromPayload(data,totalEntries || pageData.length);
    }

    // Compact Elasticsearch rows often omit products. Ask for the same page from
    // the non-ES path and merge only exact matching order ids.
    if (pageData.some(order => !itemArrays(order).length) && listEsOnly) {
      try {
        const enrichedPayload = await fetchPage({
          ...baseArgs,filterProfile:requestProfile,esOnly:false
        }, 2);
        const enrichedData = listData(enrichedPayload);
        if (enrichedData.length) {
          pageData = mergePageOrders(pageData, enrichedData);
          enrichedPages++;
        }
      } catch (_) {
        enrichmentFailures++;
      }
    }

    allOrders = mergeUniqueOrders(allOrders, pageData);
    if (allOrders.length >= MAX_ORDERS) break;
    page++;
  } while (page <= totalPages && page <= maxWantedPages);

  return {
    orders:allOrders,
    totalEntries,
    totalPages,
    fetchedPages:Math.min(page-1,totalPages),
    enrichedPages,
    enrichmentFailures,
    requestProfile,
    listEsOnly
  };
}

async function collectChunkedRange({
  shopId,savedFilterId,accessToken,startDateTime,endDateTime,
  testOnly=false,onProgress=null,chunkSeconds=RANGE_WEEK_SECONDS,mode='weekly',
  profileCandidates=['legacy-source','bare','neutral','employee-source','employee-only']
}) {
  const chunks = rangeChunks(startDateTime,endDateTime,chunkSeconds);
  let allOrders = [];
  let totalEntries = 0;
  let totalPages = 0;
  let fetchedPages = 0;
  let enrichedPages = 0;
  let enrichmentFailures = 0;
  let requestProfile = '';
  let listEsOnly = true;
  let discoveredProfile = '';
  let discoveredEsOnly = null;

  for (let i=0;i<chunks.length;i++) {
    const [chunkStart,chunkEnd] = chunks[i];

    // Until a working profile is discovered, prioritize the exact captured Pancake
    // request and a "bare saved filter" request. Once one chunk has data, lock that
    // profile for every remaining chunk to keep requests small and consistent.
    const part = await collectRangePages({
      shopId,savedFilterId,accessToken,
      startDateTime:chunkStart,endDateTime:chunkEnd,
      testOnly,onProgress,
      firstPageProfiles:discoveredProfile ? null : profileCandidates,
      forcedProfile:discoveredProfile,
      forcedEsOnly:discoveredProfile ? discoveredEsOnly : null,
      rangeIndex:i+1,rangeTotal:chunks.length
    });

    if (!discoveredProfile && part.orders.length) {
      discoveredProfile = part.requestProfile;
      discoveredEsOnly = part.listEsOnly;
    }

    allOrders = mergeUniqueOrders(allOrders, part.orders);
    totalEntries += Number(part.totalEntries || part.orders.length || 0);
    totalPages += Number(part.totalPages || 0);
    fetchedPages += Number(part.fetchedPages || 0);
    enrichedPages += Number(part.enrichedPages || 0);
    enrichmentFailures += Number(part.enrichmentFailures || 0);
    requestProfile = part.requestProfile || requestProfile;
    listEsOnly = part.listEsOnly;

    if (allOrders.length >= MAX_ORDERS) break;

    // Connection test only needs proof that the saved filter can return real orders.
    if (testOnly && allOrders.length) break;
  }

  return {
    orders:allOrders,
    totalEntries:Math.max(totalEntries,allOrders.length),
    totalPages:Math.max(1,totalPages),
    fetchedPages,
    enrichedPages,
    enrichmentFailures,
    requestProfile:discoveredProfile || requestProfile || 'legacy-source',
    listEsOnly:discoveredProfile ? discoveredEsOnly : listEsOnly,
    rangeFallbackMode:mode,
    rangeChunksTried:chunks.length
  };
}

function detailUrl(shopId, orderId, accessToken) {
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('editorId', 'none');
  return `https://pos.pancake.vn/api/v1/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}?${params.toString()}`;
}

function orderLookupUrl(shopId, orderId, accessToken) {
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('editorId', 'none');
  params.set('page', '1');
  params.set('page_size', '20');
  params.set('status', '-1');
  params.set('option_sort', 'inserted_at_desc');
  params.set('updateStatus', 'inserted_at');
  params.set('es_only', 'false');
  params.set('search', String(orderId));
  return `https://pos.pancake.vn/api/v1/shops/${encodeURIComponent(shopId)}/orders/get_orders?${params.toString()}`;
}

function pickMatchingOrder(payload, expectedIds) {
  const wanted = new Set((expectedIds||[]).map(String));
  const rows = listData(payload);
  for (const row of rows) {
    if (matchKeys(row).some(key => wanted.has(String(key)))) return row;
  }
  return null;
}

function cacheSet(key, value) {
  if (detailCache.size >= DETAIL_CACHE_LIMIT) {
    const firstKey = detailCache.keys().next().value;
    if (firstKey !== undefined) detailCache.delete(firstKey);
  }
  detailCache.set(key, value);
}

async function fetchOneOrderDetail({shopId, accessToken, order}) {
  const ids = orderApiIds(order);
  if (!ids.length) throw new Error('Đơn không có ID để tải chi tiết.');

  let lastError = null;
  for (const id of ids) {
    const key = `${shopId}:${id}`;
    if (detailCache.has(key)) return detailCache.get(key);

    // 1) Direct detail endpoint (GET, then POST only if the server rejects the verb).
    for (const method of ['GET','POST']) {
      try {
        const payload = await fetchJson(detailUrl(shopId,id,accessToken), {method, attempts:2});
        const detail = unwrapOrderDetail(payload);
        if (detail) {
          const merged = mergeOrder(order, detail);
          if (itemArrays(merged).length) {
            cacheSet(key, merged);
            return merged;
          }
          lastError = new Error(`Chi tiết đơn ${id} chưa có dòng sản phẩm.`);
        } else {
          lastError = new Error(`Chi tiết đơn ${id} không có dữ liệu.`);
        }
      } catch (error) {
        lastError = error;
        if (error?.status === 401 || error?.status === 403) throw error;
        if (method === 'GET' && error?.status === 405) continue;
        if (error?.status && ![400,404,405,422].includes(error.status)) throw error;
      }
      // If GET returned 200 but lacked items, POST on the same route is still worth one try.
    }

    // 2) Internal order search fallback using the same access token. We only accept
    // an exact matching order id, so this cannot add orders outside the saved filter.
    try {
      const payload = await fetchJson(orderLookupUrl(shopId,id,accessToken), {method:'POST', attempts:2});
      const detail = pickMatchingOrder(payload, ids);
      if (detail) {
        const merged = mergeOrder(order, detail);
        if (itemArrays(merged).length) {
          cacheSet(key, merged);
          return merged;
        }
        lastError = new Error(`Tra cứu đơn ${id} có dữ liệu nhưng chưa có dòng sản phẩm.`);
      }
    } catch (error) {
      lastError = error;
      if (error?.status === 401 || error?.status === 403) throw error;
    }
  }

  throw lastError || new Error('Không tải được chi tiết đơn.');
}

async function hydrateMissingOrderItems(orders, {shopId, accessToken, onProgress=null}) {
  const output = (Array.isArray(orders) ? orders : []).slice();
  const missing = [];
  for (let i=0;i<output.length;i++) if (!itemArrays(output[i]).length) missing.push(i);

  if (!missing.length) {
    return {orders:output, requested:0, loaded:0, failures:0, failureSamples:[]};
  }

  let cursor = 0;
  let loaded = 0;
  let failures = 0;
  const failureSamples = [];

  async function worker() {
    while (true) {
      const current = cursor++;
      if (current >= missing.length) return;
      const index = missing[current];
      const order = output[index];
      try {
        output[index] = await fetchOneOrderDetail({shopId,accessToken,order});
        loaded++;
      } catch (error) {
        failures++;
        if (failureSamples.length < 5) {
          failureSamples.push(`${orderId(order)||'không mã'}: ${String(error?.message||error)}`);
        }
      }
      onProgress?.({
        phase:'details',
        detailsDone:loaded+failures,
        detailsTotal:missing.length,
        detailsLoaded:loaded,
        detailFailures:failures
      });
    }
  }

  const workers = Array.from(
    {length:Math.min(DETAIL_CONCURRENCY,missing.length)},
    () => worker()
  );
  await Promise.all(workers);

  return {
    orders:output,
    requested:missing.length,
    loaded,
    failures,
    failureSamples
  };
}

export async function fetchPancakeOrders({
  shopId, savedFilterId, accessToken, startDateTime, endDateTime,
  testOnly=false, onProgress=null
}) {
  validatePancakeConfig({shopId,savedFilterId,accessToken});
  startDateTime = Number(startDateTime);
  endDateTime = Number(endDateTime);

  if (!Number.isInteger(startDateTime) || !Number.isInteger(endDateTime) ||
      startDateTime<=0 || endDateTime<=0) {
    throw new Error('Khoảng thời gian không hợp lệ.');
  }
  if (endDateTime < startDateTime) throw new Error('Ngày kết thúc phải sau ngày bắt đầu.');
  if (endDateTime - startDateTime > 370*24*60*60) throw new Error('Mỗi lần đồng bộ tối đa 370 ngày.');

  const started = Date.now();
  const spanSeconds = endDateTime - startDateTime + 1;

  // First use the normal Pancake request for the whole selected range.
  let collected = await collectRangePages({
    shopId,savedFilterId,accessToken,startDateTime,endDateTime,testOnly,onProgress
  });

  let rangeFallbackMode = '';
  let rangeChunksTried = 1;

  // Pancake's saved-filter endpoint can return an empty list for a long historical
  // range even though the same filter returns orders for shorter windows. This was
  // observed with month syncs while one-day UI requests worked. Do not accept that
  // false zero: retry the SAME saved filter in non-overlapping 7-day windows.
  if (!collected.orders.length && spanSeconds > RANGE_WEEK_SECONDS) {
    const weekly = await collectChunkedRange({
      shopId,savedFilterId,accessToken,startDateTime,endDateTime,
      testOnly,onProgress,chunkSeconds:RANGE_WEEK_SECONDS,mode:'weekly'
    });
    rangeChunksTried += weekly.rangeChunksTried || 0;
    if (weekly.orders.length || weekly.totalEntries > collected.totalEntries) {
      collected = weekly;
      rangeFallbackMode = 'weekly';
    }
  }

  // Some Pancake filters behave like the captured UI request and only become
  // reliable on a one-day window. If weekly chunks still look empty, retry daily.
  // For very long ranges keep the fallback bounded; normal ranges (a month) are
  // fully covered day-by-day.
  if (!collected.orders.length && spanSeconds > RANGE_DAY_SECONDS) {
    const dayCount = Math.ceil(spanSeconds / RANGE_DAY_SECONDS);
    if (dayCount <= 62) {
      const daily = await collectChunkedRange({
        shopId,savedFilterId,accessToken,startDateTime,endDateTime,
        testOnly,onProgress,chunkSeconds:RANGE_DAY_SECONDS,mode:'daily',
        profileCandidates:['legacy-source','bare']
      });
      rangeChunksTried += daily.rangeChunksTried || 0;
      if (daily.orders.length || daily.totalEntries > collected.totalEntries) {
        collected = daily;
        rangeFallbackMode = 'daily';
      }
    }
  }

  const allOrders = collected.orders || [];
  const totalEntries = Math.max(Number(collected.totalEntries||0), allOrders.length);
  const totalPages = Math.max(1, Number(collected.totalPages||1));
  const enrichedPages = Number(collected.enrichedPages||0);
  const enrichmentFailures = Number(collected.enrichmentFailures||0);
  const requestProfile = collected.requestProfile || 'legacy-source';
  const listEsOnly = !!collected.listEsOnly;

  // Only after whole-range + chunk fallbacks are exhausted is an empty range real.
  if (!allOrders.length && totalEntries === 0) {
    return {
      ok:true,
      testOnly,
      totalEntries:0,
      fetchedOrders:0,
      fetchedPages:Number(collected.fetchedPages||1),
      totalPages,
      truncated:false,
      rows:[],
      meta:{
        rowCount:0,
        ordersWithoutItems:0,
        itemsWithoutCode:0,
        fallbackCodeCount:0,
        statusCounts:{},
        unknownNumericStatuses:{},
        enrichedPages,
        enrichmentFailures,
        detailRequested:0,
        detailLoaded:0,
        detailFailures:0,
        detailFailureSamples:[],
        requestProfile,
        listEsOnly,
        emptyRange:true,
        rangeFallbackMode:rangeFallbackMode || 'full',
        rangeChunksTried,
        elapsedMs:Date.now()-started
      }
    };
  }

  // Direct detail + exact internal order search for orders that still do not contain
  // product lines. The order set itself never expands beyond the saved-filter result.
  const hydrated = await hydrateMissingOrderItems(allOrders, {
    shopId,accessToken,onProgress
  });

  const normalized = normalizeOrders(hydrated.orders);
  return {
    ok:true,
    testOnly,
    totalEntries,
    fetchedOrders:allOrders.length,
    fetchedPages:Number(collected.fetchedPages||1),
    totalPages,
    truncated:!testOnly && (totalPages>MAX_PAGES || allOrders.length>=MAX_ORDERS),
    rows:testOnly ? normalized.rows.slice(0,200) : normalized.rows,
    meta:{
      rowCount:normalized.rows.length,
      ordersWithoutItems:normalized.ordersWithoutItems,
      itemsWithoutCode:normalized.itemsWithoutCode,
      fallbackCodeCount:normalized.fallbackCodeCount,
      statusCounts:normalized.statusCounts,
      unknownNumericStatuses:normalized.unknownNumericStatuses,
      enrichedPages,
      enrichmentFailures,
      detailRequested:hydrated.requested,
      detailLoaded:hydrated.loaded,
      detailFailures:hydrated.failures,
      detailFailureSamples:hydrated.failureSamples,
      requestProfile,
      listEsOnly,
      emptyRange:false,
      rangeFallbackMode:rangeFallbackMode || 'full',
      rangeChunksTried,
      elapsedMs:Date.now()-started
    }
  };
}

export function applyStatusMap(rows, statusMap={}) {
  const map = statusMap && typeof statusMap==='object' ? statusMap : {};
  return (Array.isArray(rows)?rows:[]).map(row=>{
    const code = String(row?.statusCode ?? '');
    if (map[code] && /^Trạng thái\s/i.test(String(row?.status||''))) {
      return {...row,status:String(map[code])};
    }
    return row;
  });
}

export function remainingUnknownStatuses(meta, statusMap={}) {
  const unknown = {...(meta?.unknownNumericStatuses || {})};
  const remaining = {};
  for (const code of Object.keys(unknown)) {
    if (!statusMap?.[code]) remaining[code]=unknown[code];
  }
  return remaining;
}
