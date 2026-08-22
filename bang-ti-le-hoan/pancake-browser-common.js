// Pancake POS browser adapter for GitHub Pages.
// IMPORTANT: This file does not calculate return/success rates.
// It only fetches Pancake orders and normalizes them for the legacy parser.

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 60;
export const MAX_ORDERS = 60000;
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

function first(obj, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let cur = obj;
    let ok = true;
    for (const key of parts) {
      if (cur == null || typeof cur !== 'object' || !(key in cur)) { ok = false; break; }
      cur = cur[key];
    }
    if (ok && cur !== undefined && cur !== null && String(cur).trim() !== '') return cur;
  }
  return '';
}

function cleanText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return String(v).trim();
  return '';
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

function itemArrays(order) {
  const directKeys = [
    'items','order_items','orderItems','products','product_items','productItems',
    'line_items','lineItems','details','order_details','orderDetails'
  ];
  const arrays = [];
  for (const key of directKeys) {
    if (Array.isArray(order && order[key]) && order[key].length) arrays.push(order[key]);
  }
  if (arrays.length) return arrays.flat();

  const found = [];
  const seen = new Set();
  function walk(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return;
    seen.add(obj);
    for (const [key, value] of Object.entries(obj)) {
      const lk = String(key).toLowerCase();
      if (Array.isArray(value) && /(item|product|variation|variant|detail)/.test(lk)) {
        for (const it of value) if (it && typeof it === 'object' && !Array.isArray(it)) found.push(it);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, depth + 1);
      }
    }
  }
  walk(order, 0);
  return found;
}

function productCode(item) {
  const raw = first(item, [
    'variation_info.display_id','variation_info.sku','variation_info.product_code','variation_info.code',
    'variationInfo.display_id','variationInfo.sku','variationInfo.product_code','variationInfo.code',
    'product.display_id','product.sku','product.product_code','product.code',
    'variant.display_id','variant.sku','variant.product_code','variant.code',
    'variation.display_id','variation.sku','variation.product_code','variation.code',
    'sku','seller_sku','sellerSku','product_code','productCode','code','barcode','display_id'
  ]);
  const code = cleanText(raw);
  if (code) return {code, fallback:false};

  const variationId = cleanText(first(item, ['variation_id','variationId','variant_id','variantId','variation.id','variant.id']));
  if (variationId) return {code:`VAR-${variationId}`, fallback:true};
  const productId = cleanText(first(item, ['product_id','productId','product.id']));
  if (productId) return {code:`SP-${productId}`, fallback:true};
  const id = cleanText(first(item, ['id','item_id','itemId']));
  if (id) return {code:`ITEM-${id}`, fallback:true};
  return {code:'', fallback:true};
}

function productName(item, code) {
  const raw = first(item, [
    'variation_info.name','variation_info.product_name','variation_info.display_name',
    'variationInfo.name','variationInfo.product_name','variationInfo.display_name',
    'product.name','product.product_name','product.display_name',
    'variant.name','variant.product_name','variation.name','variation.product_name',
    'product_name','productName','name','display_name','displayName','title'
  ]);
  return cleanText(raw) || code;
}

function orderId(order) {
  return cleanText(first(order, [
    'display_id','order_number','orderNumber','order_code','orderCode','code','id'
  ]));
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
    if (/^-?\d+$/.test(rawStatus) && !findStatusLabel(order) && !Object.prototype.hasOwnProperty.call(KNOWN_STATUS, Number(rawStatus))) {
      unknownNumericStatuses[rawStatus] = (unknownNumericStatuses[rawStatus] || 0) + 1;
    }

    const items = itemArrays(order);
    if (!items.length) { ordersWithoutItems++; continue; }

    const seenCodes = new Set();
    for (const item of items) {
      const pc = productCode(item);
      if (!pc.code) { itemsWithoutCode++; continue; }
      if (pc.fallback) fallbackCodeCount++;
      if (seenCodes.has(pc.code)) continue;
      seenCodes.add(pc.code);
      const name = productName(item, pc.code);
      rows.push({
        product:name,
        orderId:oid,
        code:pc.code,
        name,
        status,
        statusCode:rawStatus
      });
    }
  }
  return {rows, ordersWithoutItems, itemsWithoutCode, fallbackCodeCount, statusCounts, unknownNumericStatuses};
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

export function buildPancakeUrl({shopId, savedFilterId, startDateTime, endDateTime, page=1, pageSize=PAGE_SIZE, accessToken}) {
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
  params.set('es_only', 'true');
  return `${base}?${params.toString()}`;
}

async function fetchPage(args, attempts=3) {
  const url = buildPancakeUrl(args);
  let lastError = null;
  for (let attempt=0; attempt<attempts; attempt++) {
    try {
      // Keep the cross-origin request "simple" (no JSON Content-Type) to avoid
      // an unnecessary CORS preflight on static GitHub Pages.
      const response = await fetch(url, {
        method:'POST',
        mode:'cors',
        credentials:'omit',
        headers:{'Accept':'application/json, text/plain, */*'}
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; }
      catch (_) { throw new Error(`Pancake trả dữ liệu không phải JSON (HTTP ${response.status}).`); }
      if (response.ok) return data;
      const message = cleanText(data.message || data.error || data.error_message) || `HTTP ${response.status}`;
      const err = new Error(`Pancake POS: ${message}`);
      err.status = response.status;
      if ((response.status===429 || response.status>=500) && attempt+1<attempts) {
        lastError = err;
        await new Promise(r=>setTimeout(r, 400*Math.pow(2,attempt)));
        continue;
      }
      throw err;
    } catch (error) {
      lastError = error;
      if (error?.status) throw error;
      if (attempt+1<attempts) {
        await new Promise(r=>setTimeout(r, 400*Math.pow(2,attempt)));
        continue;
      }
    }
  }
  const err = lastError || new Error('Không kết nối được Pancake POS.');
  if (err instanceof TypeError || /failed to fetch|networkerror/i.test(String(err?.message||''))) {
    throw new Error('Không gọi được Pancake POS từ trình duyệt. Có thể Pancake đang chặn CORS cho domain GitHub Pages. Hãy kiểm tra lại domain/Network hoặc dùng một proxy backend riêng nếu Pancake không cho phép CORS.');
  }
  throw err;
}

export async function fetchPancakeOrders({
  shopId, savedFilterId, accessToken, startDateTime, endDateTime,
  testOnly=false, onProgress=null
}) {
  validatePancakeConfig({shopId,savedFilterId,accessToken});
  startDateTime = Number(startDateTime);
  endDateTime = Number(endDateTime);
  if (!Number.isInteger(startDateTime) || !Number.isInteger(endDateTime) || startDateTime<=0 || endDateTime<=0) {
    throw new Error('Khoảng thời gian không hợp lệ.');
  }
  if (endDateTime < startDateTime) throw new Error('Ngày kết thúc phải sau ngày bắt đầu.');
  if (endDateTime - startDateTime > 370*24*60*60) throw new Error('Mỗi lần đồng bộ tối đa 370 ngày.');

  const started = Date.now();
  const allOrders = [];
  let page = 1;
  let totalPages = 1;
  let totalEntries = 0;
  const maxWantedPages = testOnly ? 1 : MAX_PAGES;

  do {
    onProgress?.({page,totalPages,totalEntries,fetchedOrders:allOrders.length});
    const data = await fetchPage({
      shopId,savedFilterId,accessToken,startDateTime,endDateTime,
      page,pageSize:testOnly?20:PAGE_SIZE
    });
    const pageData = Array.isArray(data.data) ? data.data :
      Array.isArray(data.orders) ? data.orders :
      Array.isArray(data.results) ? data.results : [];
    allOrders.push(...pageData);
    totalPages = Math.max(1, Number(data.total_pages || data.totalPages || 1) || 1);
    totalEntries = Math.max(0, Number(data.total_entries || data.totalEntries || data.total || pageData.length) || 0);
    if (allOrders.length >= MAX_ORDERS) break;
    page++;
  } while (page <= totalPages && page <= maxWantedPages);

  const normalized = normalizeOrders(allOrders);
  return {
    ok:true,
    testOnly,
    totalEntries,
    fetchedOrders:allOrders.length,
    fetchedPages:Math.min(page-1,totalPages),
    totalPages,
    truncated:!testOnly && (totalPages>MAX_PAGES || allOrders.length>=MAX_ORDERS),
    rows:testOnly ? normalized.rows.slice(0,20) : normalized.rows,
    meta:{
      rowCount:normalized.rows.length,
      ordersWithoutItems:normalized.ordersWithoutItems,
      itemsWithoutCode:normalized.itemsWithoutCode,
      fallbackCodeCount:normalized.fallbackCodeCount,
      statusCounts:normalized.statusCounts,
      unknownNumericStatuses:normalized.unknownNumericStatuses,
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
  for (const code of Object.keys(unknown)) if (!statusMap?.[code]) remaining[code]=unknown[code];
  return remaining;
}
