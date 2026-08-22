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
      'item_id','itemId'
    ])) ||
    (value.variation_info && typeof value.variation_info === 'object') ||
    (value.variationInfo && typeof value.variationInfo === 'object') ||
    (value.product && typeof value.product === 'object') ||
    (value.variant && typeof value.variant === 'object') ||
    (value.variation && typeof value.variation === 'object')
  );
}

function collectItemValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if (typeof value !== 'object') return [];
  if (looksLikeItem(value)) return [value];

  // Some Pancake responses serialize line items as an object keyed by id.
  const vals = Object.values(value).filter(v => v && typeof v === 'object' && !Array.isArray(v));
  const itemVals = vals.filter(looksLikeItem);
  return itemVals.length ? itemVals : [];
}

function itemArrays(order) {
  const directKeys = [
    'items','order_items','orderItems','products','product_items','productItems',
    'line_items','lineItems','details','order_details','orderDetails',
    'order_products','orderProducts'
  ];

  const direct = [];
  for (const key of directKeys) {
    if (order && Object.prototype.hasOwnProperty.call(order, key)) {
      direct.push(...collectItemValue(order[key]));
    }
  }
  if (direct.length) return direct;

  // Bounded fallback: scan nested structures for item/product containers.
  const found = [];
  const seenObjects = new Set();
  const seenItems = new Set();

  function addItem(it) {
    if (!it || typeof it !== 'object' || Array.isArray(it) || seenItems.has(it)) return;
    if (!looksLikeItem(it)) return;
    seenItems.add(it);
    found.push(it);
  }

  function walk(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4 || seenObjects.has(obj)) return;
    seenObjects.add(obj);

    for (const [key, value] of Object.entries(obj)) {
      const lk = String(key).toLowerCase();

      if (/(^|_)(items?|products?|line_items?|order_items?|order_details?)(_|$)/.test(lk) ||
          /(item|product|variation|variant|detail)/.test(lk)) {
        const candidates = collectItemValue(value);
        for (const it of candidates) addItem(it);
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, depth + 1);
      } else if (Array.isArray(value) && depth < 3) {
        for (const child of value) {
          if (child && typeof child === 'object' && !Array.isArray(child)) walk(child, depth + 1);
        }
      }
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
    'product_code','productCode','code','barcode','display_id','displayId'
  ]);
  const code = cleanText(raw);
  if (code) return {code, fallback:false};

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
    'product_name','productName','name','display_name','displayName','title'
  ]);
  return cleanText(raw) || code;
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
  return Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.orders) ? payload.orders :
    Array.isArray(payload?.results) ? payload.results : [];
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
  page=1, pageSize=PAGE_SIZE, accessToken, esOnly=true
}) {
  validatePancakeConfig({shopId,savedFilterId,accessToken});
  const base = `https://pos.pancake.vn/api/v1/shops/${encodeURIComponent(shopId)}/orders/get_orders`;
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('editorId', 'none');
  params.set('endDateTime', String(endDateTime));
  params.set('is_filter_attributes_by_or', 'true');
  params.set('is_filter_conversation_tag_by_or', 'true');
  params.set('is_filter_customer_tag_by_or', 'true');
  params.set('is_filter_exclude', 'false');
  params.set('is_filter_exclude_conversation_tag', 'false');
  params.set('is_filter_exclude_customer_tag', 'false');
  params.set('is_filter_exclude_partner', 'false');
  params.set('is_filter_exclude_product_tag', 'false');
  params.set('is_filter_multiple_employee', 'false');
  params.set('is_filter_multiple_field_address', 'false');
  params.set('is_filter_multiple_partner', 'false');
  params.set('is_filter_multiple_promotion', 'false');
  params.set('is_filter_multiple_source', 'true');
  params.set('is_filter_order_tag_by_or', 'true');
  params.set('is_filter_product_by_or', 'true');
  params.set('is_filter_tag_by_or', 'true');
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

function detailUrl(shopId, orderId, accessToken) {
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('editorId', 'none');
  return `https://pos.pancake.vn/api/v1/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}?${params.toString()}`;
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

    try {
      const payload = await fetchJson(detailUrl(shopId,id,accessToken), {method:'GET', attempts:2});
      const detail = unwrapOrderDetail(payload);
      if (!detail) {
        lastError = new Error(`Chi tiết đơn ${id} không có dữ liệu.`);
        continue;
      }
      const merged = mergeOrder(order, detail);
      if (!itemArrays(merged).length) {
        lastError = new Error(`Chi tiết đơn ${id} chưa có dòng sản phẩm.`);
        continue;
      }
      cacheSet(key, merged);
      return merged;
    } catch (error) {
      lastError = error;
      // Try another candidate id on 400/404; authentication errors are fatal for all ids.
      if (error?.status === 401 || error?.status === 403) throw error;
      if (error?.status && ![400,404,405,422].includes(error.status)) throw error;
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
  const allOrders = [];
  let page = 1;
  let totalPages = 1;
  let totalEntries = 0;
  let enrichedPages = 0;
  let enrichmentFailures = 0;
  const maxWantedPages = testOnly ? 1 : MAX_PAGES;

  do {
    onProgress?.({phase:'list',page,totalPages,totalEntries,fetchedOrders:allOrders.length});

    const baseArgs = {
      shopId,savedFilterId,accessToken,startDateTime,endDateTime,
      page,pageSize:testOnly?20:PAGE_SIZE
    };

    const data = await fetchPage({...baseArgs,esOnly:true});
    let pageData = listData(data);

    totalPages = Math.max(1, Number(data.total_pages || data.totalPages || 1) || 1);
    totalEntries = Math.max(
      0,
      Number(data.total_entries || data.totalEntries || data.total || pageData.length) || 0
    );

    // The saved-filter endpoint often returns compact Elasticsearch rows without line items.
    // Retry the SAME filtered page with es_only=false, then merge only matching orders.
    if (pageData.some(order => !itemArrays(order).length)) {
      try {
        const enrichedPayload = await fetchPage({...baseArgs,esOnly:false}, 2);
        const enrichedData = listData(enrichedPayload);
        if (enrichedData.length) {
          pageData = mergePageOrders(pageData, enrichedData);
          enrichedPages++;
        }
      } catch (_) {
        enrichmentFailures++;
        // Continue: the per-order official detail route below is the second fallback.
      }
    }

    allOrders.push(...pageData);
    if (allOrders.length >= MAX_ORDERS) break;
    page++;
  } while (page <= totalPages && page <= maxWantedPages);

  // Second fallback: GET official order detail only for orders still missing line items.
  const hydrated = await hydrateMissingOrderItems(allOrders, {
    shopId,accessToken,onProgress
  });

  const normalized = normalizeOrders(hydrated.orders);
  return {
    ok:true,
    testOnly,
    totalEntries,
    fetchedOrders:allOrders.length,
    fetchedPages:Math.min(page-1,totalPages),
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
