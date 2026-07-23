/* Certificate List view: the one-stop screen for browsing, filtering, and editing
   certificates. Covers what used to be separate Issue/Use/Void-Refund/Misc-Revenue tabs:
     - Bulk Issue panel (mini-spreadsheet, register several new certificates at once)
     - Checkbox row-selection -> bulk actions: unlock for inline editing, bulk Use,
       bulk Void/Refund, bulk Grace Use, bulk delete
     - Unlocked rows become fully editable cell-by-cell (every ledger column), with
       cross-field smart defaults + highlighting when status changes
     - Misc Revenue ledger, viewable inline via a toggle panel
     - A compact summary strip reflects the currently filtered rows; the period selector
       filters rows by whichever date field you pick (Issued/Expiry/Used)
     - The most recent bulk action can be undone with one click (single-level undo)
     - Kept deliberately dense (15 rows/page, small header) so a full page is visible
       without scrolling */
window.CertApp = window.CertApp || {};
CertApp.viewCertificateList = (function () {
  var ui = CertApp.ui;
  var acc = CertApp.accounting;
  var t = CertApp.i18n.t;
  var PAGE_SIZE = 20;
  var GC_AMOUNT_OPTIONS = [50000, 100000];
  // Curated payment methods for NEW issuance (the historical import data has 50+ messy one-off
  // values, unusable as a picker) — "기타" covers anything else. Service-detail options are
  // likewise curated per family below (SERVICE_DETAIL_OPTIONS).
  var PAYMENT_OPTIONS = ['CC', 'Cash', 'Bank transfer', 'COMP'];

  // Standard service-package options per certificate family for NEW issuance, grouped by 대분류
  // so the dropdown is organized instead of showing the hundreds of messy free-text variants in
  // the imported history. "기타" covers anything not listed. ★ EDIT THIS to match your packages.
  // Each entry is { group: '대분류 label', items: ['package', ...] } (rendered as an <optgroup>).
  var SERVICE_DETAIL_OPTIONS = {
    SC_FB_ROOMS: [
      { group: 'Room Only', items: [
        'Room Only (Deluxe Room)', 'Room Only (Premium Cityview Room)', 'Room Only (Premium Riverview Room)',
        'Room Only (Queen Corner Premium Room)', 'Room Only (Executive Room)', 'Room Only (Executive Riverview Room)',
        'Room Only (Deluxe King Corner Suite)', 'Room Only (Premium King Corner Suite)', 'Room Only (Executive King Corner Suite)'
      ] },
      { group: 'Bed & Breakfast', items: ['Bed & Breakfast (Deluxe Room)', 'Bed & Breakfast (Premium Riverview Room)'] },
      { group: 'F&B', items: ['Zest - 1 pax', 'Zest - 2 pax', 'Flames - Cake'] }
    ],
    SC_SPA: [{ group: 'SPA', items: ['Conrad Signature 60min', 'Conrad Signature 90min', 'Conrad Signature 120min'] }],
    SC_PULSE8: [{ group: 'Pulse 8', items: ['Pulse 8 1Day Pass'] }],
    GC_50000: [],
    GC_100000: []
  };

  // Current sellable voucher catalog — from "상품권 Voucher Market list_as of Jan 2026".
  // SPA-containing products and the 50,000 gift voucher are discontinued and deliberately omitted.
  // Picking a product in the new-issue form auto-fills category + amount + service detail; the
  // expiry then follows the standard rule (Service = 1 year, Gift = 5 years) via defaultExpiryFor().
  // Prices are the tax-inclusive selling prices (Room Only / B&B are the 2-guest price).
  var PRODUCT_CATALOG = [
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 715000, name: 'Deluxe Room', detail: 'Room Only (Deluxe Room)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 742500, name: 'Premium Cityview Room', detail: 'Room Only (Premium Cityview Room)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 770000, name: 'Premium Riverview Room', detail: 'Room Only (Premium Riverview Room)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 797500, name: 'Queen Corner Premium Room', detail: 'Room Only (Queen Corner Premium Room)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 918500, name: 'Executive Room', detail: 'Room Only (Executive Room)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 973500, name: 'Executive Riverview Room', detail: 'Room Only (Executive Riverview Room)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 1149500, name: 'Deluxe King Corner Suite', detail: 'Room Only (Deluxe King Corner Suite)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 1204500, name: 'Premium King Corner Suite', detail: 'Room Only (Premium King Corner Suite)' },
    { group: 'Room Only (2인)', category: 'SC_FB_ROOMS', amount: 1303500, name: 'Executive King Corner Suite', detail: 'Room Only (Executive King Corner Suite)' },
    { group: 'Bed & Breakfast (2인)', category: 'SC_FB_ROOMS', amount: 792000, name: 'Deluxe Room + 조식', detail: 'Bed & Breakfast (Deluxe Room)' },
    { group: 'Bed & Breakfast (2인)', category: 'SC_FB_ROOMS', amount: 847000, name: 'Premium Riverview + 조식', detail: 'Bed & Breakfast (Premium Riverview Room)' },
    { group: 'F&B (Zest)', category: 'SC_FB_ROOMS', amount: 180000, name: 'Zest 1인', detail: 'Zest - 1 pax' },
    { group: 'F&B (Zest)', category: 'SC_FB_ROOMS', amount: 360000, name: 'Zest 2인', detail: 'Zest - 2 pax' },
    { group: 'Pulse 8', category: 'SC_PULSE8', amount: 55000, name: 'Pulse 8 1Day Pass', detail: 'Pulse 8 1Day Pass' },
    { group: 'Gift Certificate', category: 'GC_100000', amount: 100000, name: 'Cash Voucher (10만원권)', detail: 'Cash Voucher' }
  ];

  // The single catalog product for a category, if the category has exactly one — used so that
  // picking such a 종류 (e.g. Service - Pulse8 = one 45,000원 pass, or the 100,000 Cash Voucher)
  // auto-fills 금액 + 서비스 포함내역 with no extra step. Multi-product categories (FB & Rooms)
  // return null, so the cashier still picks which package from 서비스 포함내역.
  function catalogSingleFor(category) {
    var m = PRODUCT_CATALOG.filter(function (p) { return p.category === category; });
    return m.length === 1 ? m[0] : null;
  }

  // Categories that can still be NEWLY issued — excludes discontinued SPA vouchers and the
  // 50,000 gift voucher. Legacy SC_SPA / GC_50000 records stay fully viewable, filterable, and
  // editable everywhere else; they just can't be created anew.
  var DISCONTINUED_FOR_ISSUE = { SC_SPA: true, GC_50000: true };
  function sellableCategoryKeys() {
    return Object.keys(CertApp.CATEGORY).filter(function (c) { return !DISCONTINUED_FOR_ISSUE[c]; });
  }
  // Gift voucher face value for NEW issuance: 100,000 only (50,000 discontinued). Inline editing of
  // legacy records keeps the full GC_AMOUNT_OPTIONS so existing 50,000 vouchers stay editable.
  var NEW_ISSUE_GC_OPTIONS = [100000];

  // ---- persisted change reasons (inline-edit save confirmation) ----
  // The same handful of reasons get typed over and over ("증서번호 오타수정", ...), so keep the
  // recent ones and offer them back: most recent as a Tab-able placeholder, all of them as a
  // <datalist>. Falls back to a sensible default the very first time.
  var EDIT_REASONS_KEY = 'certapp_edit_reasons';
  var EDIT_REASONS_MAX = 20;
  function loadEditReasons() {
    try { return JSON.parse(localStorage.getItem(EDIT_REASONS_KEY)) || []; } catch (e) { return []; }
  }
  function rememberEditReason(reason) {
    reason = (reason || '').trim();
    if (!reason) return;
    var list = loadEditReasons().filter(function (r) { return r !== reason; });
    list.unshift(reason);
    try { localStorage.setItem(EDIT_REASONS_KEY, JSON.stringify(list.slice(0, EDIT_REASONS_MAX))); } catch (e) {}
  }

  // ---- persisted custom service-detail entries (added via "기타") ----
  var CUSTOM_DETAILS_KEY = 'certapp_custom_details';
  function loadCustomDetails() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_DETAILS_KEY)) || {}; } catch (e) { return {}; }
  }
  // Remember a "기타"-entered package under a 대분류 so it shows in that group next time. Stored as
  // { category: { groupLabel: [values] } }; standard curated values are never duplicated here.
  function saveCustomDetail(category, group, value) {
    value = (value || '').trim();
    if (!value || !group) return;
    if (flatOptionValues(SERVICE_DETAIL_OPTIONS[category] || []).indexOf(value) !== -1) return;
    var store = loadCustomDetails();
    var cat = store[category] = store[category] || {};
    var list = cat[group] = cat[group] || [];
    if (list.indexOf(value) === -1) { list.push(value); try { localStorage.setItem(CUSTOM_DETAILS_KEY, JSON.stringify(store)); } catch (e) {} }
  }
  // Curated 대분류 groups for a category, merged with any saved custom entries (under their group).
  function mergedDetailGroups(category) {
    var curated = SERVICE_DETAIL_OPTIONS[category] || [];
    var custom = loadCustomDetails()[category] || {};
    return curated.map(function (g) {
      var extra = (custom[g.group] || []).filter(function (i) { return g.items.indexOf(i) === -1; });
      return { group: g.group, items: g.items.concat(extra) };
    });
  }

  // Typeahead pool for the "기타" free-text box: curated + custom package names PLUS the real
  // service-detail values already in the data for this category, so typing shows similar existing
  // examples to match against. Rendered into a <datalist> (native as-you-type filtering).
  var _detailDlSeq = 0;
  function detailSuggestionPool(category) {
    var set = {};
    flatOptionValues(mergedDetailGroups(category)).forEach(function (v) { set[v] = true; });
    CertApp.cache.certificates.forEach(function (r) {
      if (r.category !== category) return;
      var d = r.certificateDetail;
      if (d !== null && d !== undefined && String(d).trim() !== '') set[String(d)] = true;
    });
    return Object.keys(set).sort();
  }
  // Computed fresh (not a module-level constant) so labels pick up the active language on
  // every render() call, including after a language switch triggers router.refresh().
  function periodFieldLabels() {
    return { issuedDate: t('cl.field.issuedDate'), expiryDate: t('cl.field.expiryDate'), usedDate: t('cl.field.usedDate') };
  }

  var defaultPeriod = ui.defaultPeriod();
  var state = {
    category: '', status: '', needsReviewOnly: false, search: '',
    periodField: 'issuedDate', periodStart: defaultPeriod.start, periodEnd: defaultPeriod.end,
    page: 1, sortKey: 'certificateNo', sortDir: 'asc'
  };

  var selectedIds = {};    // checkbox selection -> target of bulk actions
  var unlockedIds = {};    // rows currently in inline cell-by-cell edit mode
  var pendingRowEdits = {}; // id -> { field: value, ... }, survives re-renders (sort/page/filter)
  var rowInputs = {};      // id -> { field: <input/select element> }, for cross-field smart defaults

  var bulkIssuePanelOpen = false;
  var issueMode = 'bulk'; // 'bulk' (연번 여러 장, default) | 'single' (1장씩)
  var bulkIssueRows = [];
  var quickFill = null; // 연번 자동 생성 form state (see newQuickFill)

  var NUMERIC_FIELDS = { amountA: 1, outletPostingAmountB: 1, arPostingAmountC: 1 };

  // ---------- filtering / sorting ----------

  function matches(r) {
    if (state.category && r.category !== state.category) return false;
    if (state.status) {
      // MISC_REVERSIBLE / MISC_FINAL are virtual filter values that split the single stored
      // EXPIRED_RECOGNIZED status by whether its write-off can still be clawed back via Grace
      // Use (Service Cert within 5 years of issue) or is permanent (Gift Cert, or SC past 5yr).
      if (state.status === 'MISC_REVERSIBLE') {
        if (!(r.status === CertApp.STATUS.EXPIRED_RECOGNIZED && !acc.isGiftCertificate(r.category) && !CertApp.isPastGraceWindow(r))) return false;
      } else if (state.status === 'MISC_FINAL') {
        if (!(r.status === CertApp.STATUS.EXPIRED_RECOGNIZED && (acc.isGiftCertificate(r.category) || CertApp.isPastGraceWindow(r)))) return false;
      } else if (state.status === CertApp.STATUS.ACTIVE || state.status === 'EXPIRED_PENDING') {
        // ACTIVE and EXPIRED_PENDING share the same stored status (ACTIVE) — they differ only
        // by whether the expiry date has passed. Compare against the DISPLAY status for both so
        // a past-expiry cert shows up under EXPIRED only, not under ACTIVE.
        if (displayStatus(r) !== state.status) return false;
      } else {
        if (r.status !== state.status) return false;
      }
    }
    if (state.needsReviewOnly && !r.needsReview) return false;
    if (state.search) {
      var s = state.search.toLowerCase();
      var hay = [r.certificateNo, r.certificateDetail, r.billNo].filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(s) === -1) return false;
    }
    var fieldVal = r[state.periodField];
    if (state.periodStart && (!fieldVal || fieldVal < state.periodStart)) return false;
    if (state.periodEnd && (!fieldVal || fieldVal > state.periodEnd)) return false;
    return true;
  }

  function compareRows(a, b) {
    var key = state.sortKey;
    var av = a[key], bv = b[key];
    var na = (av === null || av === undefined || av === '');
    var nb = (bv === null || bv === undefined || bv === '');
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    var cmp;
    if (NUMERIC_FIELDS[key]) cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return state.sortDir === 'asc' ? cmp : -cmp;
  }

  function resetFiltersState() {
    state.page = 1;
  }

  // Clears every filter back to its out-of-the-box default (full unfiltered list) — used
  // after a save completes a review session, since the rows that were just fixed (e.g. the
  // "needs review only" set) typically stop matching whatever filter found them, which
  // otherwise leaves the table looking empty even though the save succeeded.
  function resetFiltersToDefault() {
    var freshPeriod = ui.defaultPeriod();
    state.category = ''; state.status = ''; state.needsReviewOnly = false; state.search = '';
    state.sortKey = 'certificateNo'; state.sortDir = 'asc';
    state.periodField = 'issuedDate'; state.periodStart = freshPeriod.start; state.periodEnd = freshPeriod.end;
    state.page = 1;
  }

  // Jump target for other views (Overview's 종류 cell): clear every filter, then apply just the
  // requested one, so the list shows exactly what the caller asked for and nothing else. The
  // period is deliberately blanked — matches() skips date filtering when start/end are empty —
  // so clicking a category shows its FULL history, not just the Overview's current month.
  // Call this, then CertApp.router.go('certlist').
  function showFiltered(filter) {
    resetFiltersToDefault();
    state.periodStart = ''; state.periodEnd = '';
    Object.assign(state, filter || {});
    state.page = 1;
  }

  // ---------- top-level render ----------

  function render(container) {
    selectedIds = {}; unlockedIds = {}; pendingRowEdits = {}; rowInputs = {};
    bulkIssuePanelOpen = false; issueMode = 'bulk'; bulkIssueRows = []; quickFill = null;

    var wrap = ui.el('div', { class: 'view-certlist' });

    wrap.appendChild(ui.el('div', { id: 'cl-undo-bar' }));

    var catOptions = [ui.el('option', Object.assign({ value: '', text: t('common.allCategory') }, state.category === '' ? { selected: 'selected' } : {}))].concat(
      Object.keys(CertApp.CATEGORY).map(function (c) {
        return ui.el('option', Object.assign({ value: c, text: CertApp.CATEGORY_LABEL[c] }, c === state.category ? { selected: 'selected' } : {}));
      })
    );
    // EXPIRED_PENDING is a virtual/display-only status (past expiry, not yet write-off
    // processed — see schema.js VIRTUAL_STATUS) inserted right after ACTIVE so it's filterable
    // even though it's never actually stored on a record.
    var statusFilterValues = [];
    Object.keys(CertApp.STATUS).forEach(function (s) {
      // The stored EXPIRED_RECOGNIZED status is shown as two separate, selectable filter
      // options so "MISC INCOME" (still reversible) and "MISC (FINAL)" (permanent) don't get
      // lumped together — see matches() above.
      if (s === CertApp.STATUS.EXPIRED_RECOGNIZED) {
        statusFilterValues.push('MISC_REVERSIBLE', 'MISC_FINAL');
        return;
      }
      statusFilterValues.push(s);
      if (s === CertApp.STATUS.ACTIVE) statusFilterValues.push('EXPIRED_PENDING');
    });
    var statusOptions = [ui.el('option', Object.assign({ value: '', text: t('common.allStatus') }, state.status === '' ? { selected: 'selected' } : {}))].concat(
      statusFilterValues.map(function (s) { return ui.el('option', Object.assign({ value: s, text: CertApp.displayStatusLabel(s) }, s === state.status ? { selected: 'selected' } : {})); })
    );
    var fieldLabels = periodFieldLabels();
    var periodFieldOptions = Object.keys(fieldLabels).map(function (f) {
      return ui.el('option', Object.assign({ value: f, text: fieldLabels[f] }, f === state.periodField ? { selected: 'selected' } : {}));
    });

    var controls = ui.el('div', { class: 'panel controls-row controls-row-tight' }, [
      ui.el('select', { id: 'cl-category', onchange: function (e) { state.category = e.target.value; resetFiltersState(); refresh(); } }, catOptions),
      ui.el('select', { id: 'cl-status', onchange: function (e) { state.status = e.target.value; resetFiltersState(); refresh(); } }, statusOptions),
      ui.el('input', { type: 'text', id: 'cl-search', value: state.search, placeholder: t('cl.searchPlaceholder'), oninput: function (e) { state.search = e.target.value; resetFiltersState(); refresh(); } }),
      ui.el('label', {}, [
        ui.el('input', Object.assign({ type: 'checkbox', id: 'cl-needs-review', onchange: function (e) { state.needsReviewOnly = e.target.checked; resetFiltersState(); refresh(); } }, state.needsReviewOnly ? { checked: 'checked' } : {})),
        ' ' + t('cl.needsReviewOnly')
      ]),
      ui.el('span', { text: t('cl.periodBasis') }),
      ui.el('select', { onchange: function (e) { state.periodField = e.target.value; resetFiltersState(); refresh(); } }, periodFieldOptions),
      ui.el('input', {
        type: 'date', value: state.periodStart,
        onchange: function (e) { state.periodStart = e.target.value; resetFiltersState(); refresh(); }
      }),
      ui.el('span', { text: '~' }),
      ui.el('input', {
        type: 'date', value: state.periodEnd,
        onchange: function (e) { state.periodEnd = e.target.value; resetFiltersState(); refresh(); }
      }),
      ui.refreshButton(),
      ui.el('button', { class: 'btn btn-primary', text: t('cl.newIssue'), onclick: toggleBulkIssuePanel })
    ]);
    wrap.appendChild(controls);

    wrap.appendChild(ui.el('div', { id: 'cl-bulk-issue-panel' }));

    wrap.appendChild(ui.el('div', { class: 'bulk-toolbar', id: 'cl-bulk-toolbar' }));

    var countEl = ui.el('div', { class: 'muted', id: 'cl-count' });
    wrap.appendChild(countEl);

    var tableWrap = ui.el('div', { class: 'panel table-scroll', id: 'cl-table-wrap' });
    wrap.appendChild(tableWrap);

    var pagerWrap = ui.el('div', { class: 'pager', id: 'cl-pager' });
    wrap.appendChild(pagerWrap);

    container.appendChild(wrap);
    refresh();
  }

  function refresh() {
    renderTable();
    ui.renderUndoBar('cl-undo-bar', refresh);
  }

  // ---------- bulk issue (mini-spreadsheet) ----------

  function defaultExpiryFor(category, issuedDate) {
    var d = new Date(issuedDate);
    d.setFullYear(d.getFullYear() + (acc.isGiftCertificate(category) ? 5 : 1));
    return CertApp.formatLocalDate(d);
  }

  function defaultAmountFor(category) {
    if (category === CertApp.CATEGORY.GC_50000) return 50000;
    if (category === CertApp.CATEGORY.GC_100000) return 100000;
    if (category === CertApp.CATEGORY.SC_PULSE8) return 55000;   // one fixed 55,000원 day pass
    return '';
  }

  function newBulkIssueRow() {
    var today = CertApp.today();
    var category = sellableCategoryKeys()[0];
    return { category: category, certificateNo: '', issuedDate: today, expiryDate: defaultExpiryFor(category, today),
      amountA: defaultAmountFor(category), paymentType: '', certificateDetail: '', sellerOperaId: '', discountReceiptNote: '' };
  }

  function newQuickFill() {
    var today = CertApp.today();
    var category = sellableCategoryKeys()[0];
    return { category: category, startNo: '', qty: 10, amountA: defaultAmountFor(category),
      issuedDate: today, paymentType: '', certificateDetail: '', note: '', discountReceiptNote: '' };
  }

  function toggleBulkIssuePanel() {
    bulkIssuePanelOpen = !bulkIssuePanelOpen;
    if (bulkIssuePanelOpen) {
      // Default to 연번 여러 장: vouchers are almost always sold as a numbered batch (a Pulse 8
      // 10-pack, a block of gift certificates), so the batch form is the common case. The list
      // starts empty and is filled by 생성; "1장씩" is one click away.
      issueMode = 'bulk';
      bulkIssueRows = [];
      quickFill = newQuickFill();
    }
    renderBulkIssuePanel();
  }

  // Increment the trailing numeric run of a certificate number by `delta`, preserving any
  // prefix AND the original zero-padding width, e.g. incrementCertNo('SC010001', 3) ->
  // 'SC010004', incrementCertNo('000087', 1) -> '000088'. Returns '' if there's no trailing
  // number to key off (so the caller can reject the input rather than silently mis-number).
  function incrementCertNo(certNo, delta) {
    var m = String(certNo).match(/^(.*?)(\d+)$/);
    if (!m) return '';
    var prefix = m[1], digits = m[2];
    var next = String(parseInt(digits, 10) + delta);
    while (next.length < digits.length) next = '0' + next;
    return prefix + next;
  }

  // Next certificate number to issue for a category = the highest existing number (across the
  // certificate list AND any rows already entered in this panel) + 1, preserving its prefix and
  // zero-padding. Shown as a faint placeholder; Tab accepts it (see wireTabSuggestion).
  function suggestNextCertNo(category, excludeRow) {
    var maxNum = -1, maxNo = '';
    function consider(no) {
      if (!no) return;
      var m = String(no).match(/^(.*?)(\d+)$/); if (!m) return;
      var num = parseInt(m[2], 10);
      if (num > maxNum) { maxNum = num; maxNo = String(no); }
    }
    CertApp.cache.certificates.forEach(function (r) { if (r.category === category) consider(r.certificateNo); });
    bulkIssueRows.forEach(function (r) { if (r !== excludeRow && r.category === category) consider(r.certificateNo); });
    return maxNo ? incrementCertNo(maxNo, 1) : '';
  }

  // Faint suggestion in a text input: the placeholder shows the suggested value, and pressing Tab
  // on an empty field fills it in (Tab then still advances focus as usual). Used for the next
  // certificate number and for the last-used change reason.
  function wireTabSuggestion(input, suggestion, onAccept) {
    if (suggestion) input.placeholder = suggestion;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey && !input.value && suggestion) {
        input.value = suggestion;
        onAccept(suggestion);
      }
    });
  }

  // `options` may be a flat array of strings, OR grouped as [{ group, items }, ...] (rendered as
  // <optgroup>s). Returns every selectable string value regardless of shape.
  function isGroupedOptions(options) { return options.length > 0 && options[0] && typeof options[0] === 'object' && options[0].items; }
  function flatOptionValues(options) {
    if (!isGroupedOptions(options)) return options;
    var out = []; options.forEach(function (g) { (g.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  }

  // A <select> of known options (flat or grouped into 대분류 <optgroup>s) plus a "기타(직접 입력)"
  // choice that reveals a free-text box, so a value not in the list can still be entered. onChange
  // always receives the effective value.
  function selectWithOther(options, currentValue, onChange, placeholder) {
    var flat = flatOptionValues(options);
    var cur = currentValue == null ? '' : String(currentValue);
    var isCustom = cur !== '' && flat.indexOf(cur) === -1;
    var otherInput = ui.el('input', { type: 'text', value: isCustom ? cur : '', placeholder: placeholder || t('cl.otherPlaceholder') });
    otherInput.style.display = isCustom ? '' : 'none';
    otherInput.addEventListener('input', function () { onChange(otherInput.value); });

    function optionEl(o) { return ui.el('option', Object.assign({ value: o, text: o }, (!isCustom && o === cur) ? { selected: 'selected' } : {})); }
    var children = [ui.el('option', Object.assign({ value: '', text: '—' }, cur === '' ? { selected: 'selected' } : {}))];
    if (isGroupedOptions(options)) {
      options.forEach(function (g) { children.push(ui.el('optgroup', { label: g.group }, (g.items || []).map(optionEl))); });
    } else {
      options.forEach(function (o) { children.push(optionEl(o)); });
    }
    children.push(ui.el('option', Object.assign({ value: '__other__', text: t('cl.otherOption') }, isCustom ? { selected: 'selected' } : {})));

    var select = ui.el('select', {}, children);
    select.addEventListener('change', function () {
      if (select.value === '__other__') { otherInput.style.display = ''; otherInput.value = ''; otherInput.focus(); onChange(''); }
      else { otherInput.style.display = 'none'; onChange(select.value); }
    });
    return ui.el('div', { class: 'select-other' }, [select, otherInput]);
  }

  // New-issue "서비스 포함내역" picker, driven by the price-list catalog (PRODUCT_CATALOG). Since
  // that list IS the sellable-product list, picking an item also auto-fills 종류(category) and
  // 금액(amount) via onCatalogPick — so the old separate "상품(가격표)" picker is gone (it was the
  // same content twice). "기타(직접입력)" keeps a free-text escape hatch (with datalist typeahead)
  // for anything off the price list — e.g. Pulse 8, which isn't in the catalog.
  function catalogDetailSelect(currentCategory, currentValue, onCatalogPick, onFreeText) {
    // Only the packages that belong to the selected 종류 — picking Gift Certificate should offer
    // Cash Voucher and nothing else, not the whole price list.
    var groups = {};
    PRODUCT_CATALOG.forEach(function (p, i) {
      if (p.category !== currentCategory) return;
      (groups[p.group] = groups[p.group] || []).push({ p: p, i: i });
    });
    var catalogDetails = PRODUCT_CATALOG.filter(function (p) { return p.category === currentCategory; })
      .map(function (p) { return p.detail; });
    var cur = currentValue == null ? '' : String(currentValue);
    var isCatalog = catalogDetails.indexOf(cur) !== -1;
    var isCustom = cur !== '' && !isCatalog;

    var children = [ui.el('option', Object.assign({ value: '', text: '—' }, cur === '' ? { selected: 'selected' } : {}))];
    Object.keys(groups).forEach(function (g) {
      children.push(ui.el('optgroup', { label: g }, groups[g].map(function (o) {
        return ui.el('option', Object.assign({ value: String(o.i), text: o.p.detail }, (isCatalog && o.p.detail === cur) ? { selected: 'selected' } : {}));
      })));
    });
    children.push(ui.el('option', Object.assign({ value: '__other__', text: t('cl.otherOption') }, isCustom ? { selected: 'selected' } : {})));
    var select = ui.el('select', {}, children);

    var dlId = 'detail-dl-' + (_detailDlSeq++);
    var datalist = ui.el('datalist', { id: dlId }, detailSuggestionPool(currentCategory).map(function (v) { return ui.el('option', { value: v }); }));
    var otherInput = ui.el('input', { type: 'text', value: isCustom ? cur : '', placeholder: t('cl.otherPlaceholder'), list: dlId, autocomplete: 'off' });
    var otherWrap = ui.el('div', { class: 'detail-other' }, [otherInput, datalist]);
    otherWrap.style.display = isCustom ? '' : 'none';
    otherInput.addEventListener('input', function () { onFreeText(otherInput.value); });

    select.addEventListener('change', function () {
      if (select.value === '__other__') { otherWrap.style.display = ''; otherInput.value = ''; otherInput.focus(); onFreeText(''); }
      else if (select.value === '') { otherWrap.style.display = 'none'; onFreeText(''); }
      else { otherWrap.style.display = 'none'; onCatalogPick(PRODUCT_CATALOG[Number(select.value)]); }
    });
    return ui.el('div', { class: 'select-other detail-select' }, [select, otherWrap]);
  }

  // Native date field, so 발행일/만료일 can be picked from the calendar instead of typed. The
  // browser renders it in its own locale, but the underlying value is always YYYY-MM-DD — which
  // is what we read and store — and this matches the date inputs the rest of the app already
  // uses (period filters, inline row editing).
  function dateTextInput(value, onChange) {
    var input = ui.el('input', { type: 'date', value: value || '', class: 'date-text' });
    input.addEventListener('change', function () { onChange(input.value.trim()); });
    return input;
  }

  // 연번 자동 생성: builds `qty` bulk-issue rows with the same category/amount/date/payment and
  // consecutively numbered certificate numbers starting from startNo — so a "customer bought 20
  // at once" case is one entry + one click instead of 20 hand-typed rows (and no transcription
  // typos in the numbers). Generated rows drop into the editable spreadsheet below for review
  // before registering; any leftover blank rows there are ignored on submit.
  function onQuickGenerate() {
    var q = quickFill;
    var qty = parseInt(q.qty, 10);
    if (!qty || qty < 1) { ui.toast(t('cl.quickFill.needQty'), 'warn'); return; }
    if (qty > 500) { ui.toast(t('cl.quickFill.tooMany'), 'warn'); return; }
    // Blank 시작 증서번호 falls back to the suggested next number — the same one the placeholder
    // and the end-number readout show, so 생성 never rejects a batch the UI just previewed.
    var startNo = (q.startNo || '').trim() || (q._suggestedNo || '');
    if (!startNo || !incrementCertNo(startNo, 0)) { ui.toast(t('cl.quickFill.badNo'), 'warn'); return; }
    if (!q.amountA) { ui.toast(t('cl.bulkIssue.needFields'), 'warn'); return; }

    // Clear any still-blank spreadsheet rows first so the generated batch isn't buried under
    // the initial empty placeholders.
    bulkIssueRows = bulkIssueRows.filter(function (r) { return r.certificateNo; });
    for (var i = 0; i < qty; i++) {
      bulkIssueRows.push({
        category: q.category, certificateNo: incrementCertNo(startNo, i),
        issuedDate: q.issuedDate, expiryDate: defaultExpiryFor(q.category, q.issuedDate),
        amountA: q.amountA, paymentType: q.paymentType,
        certificateDetail: q.certificateDetail || '', _detailGroup: q._detailGroup, sellerOperaId: q.note || '',
        discountReceiptNote: q.discountReceiptNote || ''
      });
    }
    renderBulkIssuePanel();
    ui.toast(t('cl.quickFill.done', { n: qty, from: startNo, to: incrementCertNo(startNo, qty - 1) }), 'success');
  }

  // Gift Certificates only ever have two legitimate face values — render a fixed
  // 50,000/100,000 choice instead of a free-form number to prevent typos.
  function amountFieldFor(category, currentValue, onChange, gcOptions) {
    if (acc.isGiftCertificate(category)) {
      return ui.el('select', { onchange: function (e) { onChange(Number(e.target.value)); } },
        (gcOptions || GC_AMOUNT_OPTIONS).map(function (v) {
          return ui.el('option', Object.assign({ value: v, text: ui.formatCurrency(v) }, Number(currentValue) === v ? { selected: 'selected' } : {}));
        }));
    }
    // Text (not number) input so it can display a thousands-separated, right-aligned value
    // (e.g. "715,000"); we keep only the digits internally and hand a plain Number to onChange.
    // A trailing 원/₩ unit (matching formatCurrency, which the GC amount select already uses) is
    // shown next to it so Service amounts read as currency too.
    var input = ui.el('input', { type: 'text', inputmode: 'numeric', class: 'amount-input',
      value: (currentValue === '' || currentValue === null || currentValue === undefined) ? '' : ui.formatNumber(currentValue) });
    input.addEventListener('input', function () {
      var digits = input.value.replace(/[^\d]/g, '');
      onChange(digits === '' ? '' : Number(digits));
      input.value = digits === '' ? '' : ui.formatNumber(Number(digits));
      input.setSelectionRange(input.value.length, input.value.length);
    });
    var unit = ui.el('span', { class: 'amount-unit', text: CertApp.i18n.getLang() === 'en' ? 'KRW' : '원' });
    return ui.el('div', { class: 'amount-cell' }, [input, unit]);
  }

  // Switch between the two issue modes. Resets the working list so the modes don't bleed into
  // each other (single starts with one blank row; bulk starts empty, filled by 생성).
  function setIssueMode(mode) {
    if (issueMode === mode) return;
    issueMode = mode;
    if (mode === 'single') bulkIssueRows = [newBulkIssueRow()];
    else { bulkIssueRows = []; quickFill = newQuickFill(); }
    renderBulkIssuePanel();
  }

  function modeToggleBtn(mode, labelKey) {
    return ui.el('button', {
      class: 'btn mode-btn' + (issueMode === mode ? ' mode-btn-active' : ''),
      onclick: function () { setIssueMode(mode); }
    }, [t(labelKey)]);
  }

  // 연번 자동 생성 input row (bulk mode only): shared 종류/금액/발행일/결제수단/서비스포함내역/비고
  // + 시작 증서번호 (with a live end-number readout) + 수량, one "생성" button fills the list.
  function renderQuickFillInputs() {
    if (!quickFill) quickFill = newQuickFill();
    var q = quickFill;

    var catSelect = ui.el('select', { onchange: function (e) {
      q.category = e.target.value;
      var single = catalogSingleFor(q.category);
      if (single) { q.amountA = single.amount; q.certificateDetail = single.detail; }
      else { q.amountA = defaultAmountFor(q.category); q.certificateDetail = ''; }
      renderBulkIssuePanel();
    } }, sellableCategoryKeys().map(function (c) {
      return ui.el('option', Object.assign({ value: c, text: CertApp.CATEGORY_LABEL[c] }, c === q.category ? { selected: 'selected' } : {}));
    }));

    var startInput = ui.el('input', { type: 'text', class: 'cert-no-input', value: q.startNo, placeholder: t('cl.quickFill.startPlaceholder'), style: 'width:120px' });
    var endLabel = ui.el('span', { class: 'quickfill-end' });
    var qtyInput = ui.el('input', { type: 'number', min: '1', value: q.qty, style: 'width:64px' });
    // Next number for this category, shown as the faint placeholder. Stashed on the state so the
    // end-number readout AND 생성 both fall back to it when 시작 증서번호 is left blank — otherwise
    // just typing a 수량 showed nothing and 생성 rejected the batch, even though the suggested
    // start was right there on screen.
    q._suggestedNo = suggestNextCertNo(q.category);
    function effectiveStart() { return (q.startNo || '').trim() || (q._suggestedNo || ''); }
    function updateEnd() {
      var n = parseInt(q.qty, 10);
      var s = effectiveStart();
      if (!s || !incrementCertNo(s, 0) || !(n >= 1)) { endLabel.textContent = ''; return; }
      var last = incrementCertNo(s, n - 1);
      // Spell out the assumed start too when it came from the suggestion rather than typed input.
      endLabel.textContent = (q.startNo || '').trim() ? ('~ ' + last) : (s + ' ~ ' + last);
    }
    startInput.addEventListener('input', function () { q.startNo = startInput.value; updateEnd(); });
    qtyInput.addEventListener('input', function () { q.qty = qtyInput.value; updateEnd(); });
    // Tab on the empty field accepts the suggestion, then refreshes the end readout.
    wireTabSuggestion(startInput, q._suggestedNo, function (v) { q.startNo = v; updateEnd(); });
    updateEnd();

    var amountField = amountFieldFor(q.category, q.amountA, function (v) { q.amountA = v; }, NEW_ISSUE_GC_OPTIONS);
    var issuedInput = dateTextInput(q.issuedDate, function (v) { q.issuedDate = v; });
    var paymentField = selectWithOther(PAYMENT_OPTIONS, q.paymentType, function (v) { q.paymentType = v; });
    var detailField = catalogDetailSelect(q.category, q.certificateDetail,
      function (prod) { q.category = prod.category; q.amountA = prod.amount; q.certificateDetail = prod.detail; q._detailGroup = null; renderBulkIssuePanel(); },
      function (v) { q.certificateDetail = v; });
    var noteInput = ui.el('input', { type: 'text', value: q.note, style: 'width:120px', oninput: function (e) { q.note = e.target.value; } });
    var discountInput = ui.el('input', { type: 'text', value: q.discountReceiptNote, style: 'width:120px', oninput: function (e) { q.discountReceiptNote = e.target.value; } });

    function labeled(labelKey, el) { return ui.el('label', { class: 'quickfill-field' }, [ui.el('span', { text: t(labelKey) }), el]); }
    var certNoField = ui.el('label', { class: 'quickfill-field' }, [
      ui.el('span', { text: t('cl.quickFill.startNo') }),
      ui.el('div', { style: 'display:flex;align-items:center;gap:6px' }, [startInput, endLabel])
    ]);

    // Field order: 종류 · 서비스포함내역 · 증서번호(+끝번호) · 수량 · 금액 · 발행일 · 결제수단 · 판매자 · 비고2
    return ui.el('div', { class: 'quickfill-block' }, [
      ui.el('div', { class: 'muted', style: 'margin-bottom:8px;font-size:12px' }, [t('cl.quickFill.desc')]),
      ui.el('div', { class: 'quickfill-row' }, [
        labeled('cl.bulkIssue.col.category', catSelect),
        labeled('cl.bulkIssue.col.detail', detailField),
        certNoField,
        labeled('cl.quickFill.qty', qtyInput),
        labeled('cl.bulkIssue.col.amount', amountField),
        labeled('cl.bulkIssue.col.issuedDate', issuedInput),
        labeled('cl.bulkIssue.col.paymentType', paymentField),
        labeled('cl.bulkIssue.col.seller', noteInput),
        labeled('cl.col.discountReceipt', discountInput),
        ui.el('button', { class: 'btn btn-primary', text: t('cl.quickFill.generate'), onclick: onQuickGenerate })
      ])
    ]);
  }

  function renderIssueRow(row, idx) {
    var catSelect = ui.el('select', {
      onchange: function (e) {
        row.category = e.target.value;
        row.expiryDate = defaultExpiryFor(row.category, row.issuedDate);
        var single = catalogSingleFor(row.category);
        if (single) { row.amountA = single.amount; row.certificateDetail = single.detail; }
        else { row.amountA = defaultAmountFor(row.category); row.certificateDetail = ''; }
        renderBulkIssuePanel();
      }
    }, sellableCategoryKeys().map(function (c) {
      return ui.el('option', Object.assign({ value: c, text: CertApp.CATEGORY_LABEL[c] }, c === row.category ? { selected: 'selected' } : {}));
    }));
    var detailField = catalogDetailSelect(row.category, row.certificateDetail,
      function (prod) {
        row.category = prod.category; row.amountA = prod.amount; row.certificateDetail = prod.detail;
        row.expiryDate = defaultExpiryFor(prod.category, row.issuedDate);
        renderBulkIssuePanel();
      },
      function (v) { row.certificateDetail = v; });
    var certNoInput = ui.el('input', { type: 'text', class: 'cert-no-input', value: row.certificateNo, oninput: function (e) { row.certificateNo = e.target.value; } });
    wireTabSuggestion(certNoInput, suggestNextCertNo(row.category, row), function (v) { row.certificateNo = v; });
    var issuedInput = dateTextInput(row.issuedDate, function (v) { row.issuedDate = v; row.expiryDate = defaultExpiryFor(row.category, row.issuedDate); renderBulkIssuePanel(); });
    var expiryInput = dateTextInput(row.expiryDate, function (v) { row.expiryDate = v; });
    var amountField = amountFieldFor(row.category, row.amountA, function (v) { row.amountA = v; }, NEW_ISSUE_GC_OPTIONS);
    var paymentField = selectWithOther(PAYMENT_OPTIONS, row.paymentType, function (v) { row.paymentType = v; });
    var sellerInput = ui.el('input', { type: 'text', value: row.sellerOperaId, oninput: function (e) { row.sellerOperaId = e.target.value; } });
    var discountInput = ui.el('input', { type: 'text', value: row.discountReceiptNote, oninput: function (e) { row.discountReceiptNote = e.target.value; } });
    var removeBtn = ui.el('button', { class: 'btn', text: '✕', onclick: function () { bulkIssueRows.splice(idx, 1); renderBulkIssuePanel(); } });
    return ui.el('tr', {}, [catSelect, detailField, certNoInput, amountField, issuedInput, expiryInput, paymentField, sellerInput, discountInput, removeBtn]
      .map(function (el) { return ui.el('td', {}, [el]); }));
  }

  // Single "새 증서 발행" panel: a mode toggle picks 1장씩(single) vs 연번 여러 장(bulk); both modes
  // feed the SAME list/columns and the same 전체 등록, so cashiers only ever learn one form.
  function renderBulkIssuePanel() {
    var container = document.getElementById('cl-bulk-issue-panel');
    if (!container) return;
    container.innerHTML = '';
    if (!bulkIssuePanelOpen) return;

    var children = [];
    children.push(ui.el('div', { class: 'issue-header' }, [
      ui.el('h3', { text: t('cl.bulkIssue.title') }),
      ui.el('div', { class: 'mode-toggle' }, [
        modeToggleBtn('single', 'cl.issue.modeSingle'),
        modeToggleBtn('bulk', 'cl.issue.modeBulk')
      ])
    ]));
    children.push(ui.el('div', { class: 'muted', style: 'font-size:11.5px;margin:-2px 0 8px', text: t('cl.product.discontinuedNote') }));

    if (issueMode === 'bulk') children.push(renderQuickFillInputs());

    var headerLabels = [
      t('cl.bulkIssue.col.category'), t('cl.bulkIssue.col.detail'), t('cl.bulkIssue.col.certNo'), t('cl.bulkIssue.col.amount'), t('cl.bulkIssue.col.issuedDate'),
      t('cl.bulkIssue.col.expiryDate'), t('cl.bulkIssue.col.paymentType'), t('cl.bulkIssue.col.seller'), t('cl.col.discountReceipt'), ''
    ];
    var thead = ui.el('thead', {}, [ui.el('tr', {}, headerLabels.map(function (h) { return ui.el('th', { text: h }); }))]);
    var tbody = ui.el('tbody', {}, bulkIssueRows.map(renderIssueRow));
    var listBlock = [
      ui.el('div', { class: 'issue-list-label', text: t('cl.issue.listLabel') }),
      ui.el('div', { class: 'table-scroll' }, [ui.el('table', { class: 'data-table' }, [thead, tbody])])
    ];
    if (bulkIssueRows.length === 0) {
      listBlock.push(ui.el('div', { class: 'muted', style: 'padding:10px 2px;font-size:12px', text: t('cl.issue.bulkEmptyHint') }));
    }
    children.push(ui.el('div', {}, listBlock));

    children.push(ui.el('div', { style: 'margin-top:10px;display:flex;gap:8px' }, [
      ui.el('button', { class: 'btn', text: t('common.addRow'), onclick: function () { bulkIssueRows.push(newBulkIssueRow()); renderBulkIssuePanel(); } }),
      ui.el('button', { class: 'btn btn-primary', text: t('cl.bulkIssue.register'), onclick: onSubmitBulkIssue }),
      ui.el('button', { class: 'btn', text: t('common.close'), onclick: function () { bulkIssuePanelOpen = false; bulkIssueRows = []; renderBulkIssuePanel(); } })
    ]));
    children.push(ui.el('div', { id: 'cl-bulk-issue-msg', class: 'muted', style: 'margin-top:8px' }));

    container.appendChild(ui.el('div', { class: 'panel' }, children));
  }

  function onSubmitBulkIssue() {
    var msgEl = document.getElementById('cl-bulk-issue-msg');
    var rowsToSubmit = bulkIssueRows.filter(function (r) { return r.certificateNo && r.amountA; });
    if (rowsToSubmit.length === 0) { ui.toast(t('cl.bulkIssue.needFields'), 'warn'); return; }

    // Remember any "기타"-entered service detail under its chosen 대분류, so it appears in that
    // group's dropdown next time (see saveCustomDetail / mergedDetailGroups).
    rowsToSubmit.forEach(function (row) { if (row.certificateDetail) saveCustomDetail(row.category, row._detailGroup, row.certificateDetail); });

    var inputs = rowsToSubmit.map(function (row) {
      return {
        category: row.category, certificateNo: row.certificateNo, issuedDate: row.issuedDate,
        expiryDate: row.expiryDate, amountA: Number(row.amountA), paymentType: row.paymentType || null,
        certificateDetail: row.certificateDetail || null, sellerOperaId: row.sellerOperaId || null,
        discountReceiptNote: row.discountReceiptNote || null
      };
    });
    CertApp.certificateWorkflow.bulkIssueCertificates(inputs).then(function (result) {
      ui.toast(t('cl.toast.bulkDone', { n: result.createdIds.length, verb: t('cl.verb.issue') }) + (result.errors.length ? (', ' + result.errors.length + t('cl.toast.errorsSuffix')) : ''), result.errors.length ? 'warn' : 'success');
      if (msgEl) msgEl.textContent = result.errors.length ? result.errors.join(' / ') : '';
      bulkIssuePanelOpen = false;
      bulkIssueRows = [];
      renderBulkIssuePanel();
      refresh();
      CertApp.router.refresh();
    });
  }

  // ---------- sortable headers ----------

  function sortableHeader(label, key) {
    var indicator = state.sortKey === key ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return {
      label: label,
      sortIndicator: indicator,
      onHeaderClick: function () {
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = key; state.sortDir = 'asc'; }
        state.page = 1;
        renderTable();
      }
    };
  }

  function displayStatus(rec) {
    var display = rec.status;
    if (rec.status === CertApp.STATUS.ACTIVE && rec.expiryDate && rec.expiryDate < CertApp.today()) {
      display = 'EXPIRED_PENDING';
    }
    return display;
  }

  // ---------- editable-cell rendering (unlocked rows) ----------

  function cellValue(rec, field) {
    var edits = pendingRowEdits[rec.id];
    return (edits && edits[field] !== undefined) ? edits[field] : rec[field];
  }

  function wireEdit(rec, field, input, isNumber) {
    rowInputs[rec.id] = rowInputs[rec.id] || {};
    rowInputs[rec.id][field] = input;
    input.addEventListener('input', function () {
      pendingRowEdits[rec.id] = pendingRowEdits[rec.id] || {};
      pendingRowEdits[rec.id][field] = isNumber ? Number(input.value) : input.value;
      renderBulkToolbar();
    });
  }

  function editableText(rec, field) {
    if (!unlockedIds[rec.id]) return cellValue(rec, field);
    var input = ui.el('input', { type: 'text', value: cellValue(rec, field) || '' });
    wireEdit(rec, field, input, false);
    return input;
  }

  // Certificate No. cell: same inline edit as editableText when unlocked, but a clickable
  // link to the Certificate Detail panel (audit history + full field snapshot) when locked.
  function certNoCell(rec) {
    if (unlockedIds[rec.id]) return editableText(rec, 'certificateNo');
    return ui.el('button', {
      class: 'link-btn', text: cellValue(rec, 'certificateNo'), title: t('cd.viewDetailTitle'),
      onclick: function () { CertApp.ui.openCertificateDetail(rec.id); }
    });
  }

  // amountA gets the fixed 50,000/100,000 selector for Gift Certificates (see amountFieldFor).
  function editableAmount(rec) {
    if (!unlockedIds[rec.id]) return ui.formatCurrency(cellValue(rec, 'amountA'));
    if (acc.isGiftCertificate(rec.category)) {
      var select = amountFieldFor(rec.category, cellValue(rec, 'amountA'), function (v) {
        pendingRowEdits[rec.id] = pendingRowEdits[rec.id] || {};
        pendingRowEdits[rec.id].amountA = v;
        renderBulkToolbar();
      });
      rowInputs[rec.id] = rowInputs[rec.id] || {};
      rowInputs[rec.id].amountA = select;
      return select;
    }
    return editableNumber(rec, 'amountA');
  }

  function editableNumber(rec, field) {
    if (!unlockedIds[rec.id]) return ui.formatCurrency(cellValue(rec, field));
    var input = ui.el('input', { type: 'number', value: cellValue(rec, field) });
    wireEdit(rec, field, input, true);
    return input;
  }

  function editableDate(rec, field) {
    if (!unlockedIds[rec.id]) return cellValue(rec, field);
    var input = ui.el('input', { type: 'date', value: cellValue(rec, field) || '' });
    wireEdit(rec, field, input, false);
    return input;
  }

  // Sets a field's live input value (if rendered) AND the pending-edit record, and flags it
  // as "needs your attention" — used when a status change implies other fields must follow.
  function setFieldWithHighlight(rec, field, value) {
    var refs = rowInputs[rec.id] || {};
    pendingRowEdits[rec.id] = pendingRowEdits[rec.id] || {};
    pendingRowEdits[rec.id][field] = value;
    if (refs[field]) {
      refs[field].value = value;
      refs[field].classList.add('cell-input-warn');
    }
  }

  function isLateUse(rec, usedDate) {
    return !acc.isGiftCertificate(rec.category) && rec.expiryDate && usedDate > rec.expiryDate;
  }

  function applySmartDefaultsForStatus(rec, newStatus) {
    var today = CertApp.today();
    if (newStatus === CertApp.STATUS.ACTIVE) {
      // Reverting to ACTIVE means "still outstanding" — clear every resolution-only field so
      // manually undoing a mistaken status (e.g. USED -> ACTIVE) doesn't leave stale used/void
      // data behind. amountA is deliberately left alone: it is the certificate's face value,
      // which a status change never alters.
      setFieldWithHighlight(rec, 'usedDate', null);
      setFieldWithHighlight(rec, 'outletPostingAmountB', null);
      setFieldWithHighlight(rec, 'arPostingAmountC', null);
      setFieldWithHighlight(rec, 'voidReason', null);
      setFieldWithHighlight(rec, 'refundDate', null);
      setFieldWithHighlight(rec, 'refundAmount', null);
      setFieldWithHighlight(rec, 'graceUseDate', null);
    } else if (newStatus === CertApp.STATUS.USED) {
      var late = isLateUse(rec, today);
      var s = late ? acc.computeLateUseSplit(rec.amountA) : { outletPostingAmountB: rec.amountA, arPostingAmountC: 0 };
      setFieldWithHighlight(rec, 'usedDate', today);
      setFieldWithHighlight(rec, 'outletPostingAmountB', s.outletPostingAmountB);
      setFieldWithHighlight(rec, 'arPostingAmountC', s.arPostingAmountC);
    } else if (newStatus === CertApp.STATUS.EXPIRED_RECOGNIZED) {
      var s2 = acc.computeWriteOffSplit(rec.amountA, rec.category);
      setFieldWithHighlight(rec, 'usedDate', rec.usedDate || today);
      setFieldWithHighlight(rec, 'outletPostingAmountB', s2.outletPostingAmountB);
      setFieldWithHighlight(rec, 'arPostingAmountC', s2.arPostingAmountC);
    } else if (newStatus === CertApp.STATUS.GRACE_USED) {
      var s3 = acc.computeLateUseSplit(rec.amountA);
      setFieldWithHighlight(rec, 'outletPostingAmountB', s3.outletPostingAmountB);
      setFieldWithHighlight(rec, 'arPostingAmountC', s3.arPostingAmountC);
    }
    renderBulkToolbar();
  }

  function editableStatus(rec) {
    if (!unlockedIds[rec.id]) return ui.statusBadge(displayStatus(rec), rec);
    var current = cellValue(rec, 'status');
    var select = ui.el('select', {}, Object.keys(CertApp.STATUS).map(function (s) {
      return ui.el('option', Object.assign({ value: s, text: CertApp.displayStatusLabel(s) }, s === current ? { selected: 'selected' } : {}));
    }));
    rowInputs[rec.id] = rowInputs[rec.id] || {};
    rowInputs[rec.id].status = select;
    select.addEventListener('change', function () {
      pendingRowEdits[rec.id] = pendingRowEdits[rec.id] || {};
      pendingRowEdits[rec.id].status = select.value;
      applySmartDefaultsForStatus(rec, select.value);
    });
    return select;
  }

  function checkboxCell(rec) {
    var cb = ui.el('input', { type: 'checkbox' });
    cb.checked = !!selectedIds[rec.id];
    cb.addEventListener('change', function () {
      if (cb.checked) selectedIds[rec.id] = true; else delete selectedIds[rec.id];
      renderBulkToolbar();
    });
    return cb;
  }

  function fieldRow(label, inputEl) {
    return ui.el('div', {}, [ui.el('label', { text: label }), inputEl]);
  }

  // Standard toast for a bulk operation's {count, errors} (or {results, errors}) result —
  // one bad row no longer silently aborts the rest, so surface both halves.
  function reportBulkResult(count, errors, verb) {
    if (count > 0) ui.toast(t('cl.toast.bulkDone', { n: count, verb: verb }) + (errors.length ? (', ' + errors.length + t('cl.toast.errorsSuffix')) : ''), errors.length ? 'warn' : 'success');
    else ui.toast(t('cl.toast.bulkFail', { verb: verb, msg: errors[0] || t('cl.toast.noneProcessed') }), 'error');
    if (errors.length) console.warn('[CertApp] bulk ' + verb + ' errors:', errors);
  }

  // ---------- bulk toolbar (selection-driven actions) ----------

  function renderBulkToolbar() {
    var bar = document.getElementById('cl-bulk-toolbar');
    if (!bar) return;
    bar.innerHTML = '';

    var selCount = Object.keys(selectedIds).length;
    var unlockedCount = Object.keys(unlockedIds).length;
    var editCount = Object.keys(pendingRowEdits).length;

    if (selCount > 0) {
      bar.appendChild(ui.el('span', { class: 'muted', text: t('cl.toolbar.selected', { n: selCount }) }));
      bar.appendChild(ui.el('button', { class: 'btn', text: t('cl.toolbar.unlock'), onclick: onUnlockSelected }));
      // "이상없음 처리" only makes sense while working through the review queue, so it appears
      // only when the 검토 필요 항목만 filter is on — it clears needsReview and nothing else.
      if (state.needsReviewOnly) {
        bar.appendChild(ui.el('button', { class: 'btn', text: t('cl.toolbar.markReviewed'), onclick: onMarkReviewedSelected }));
      }
      bar.appendChild(ui.el('button', { class: 'btn', text: t('cl.toolbar.bulkUse'), onclick: onBulkUseSelected }));
      bar.appendChild(ui.el('button', { class: 'btn', text: t('cl.toolbar.bulkVoid'), onclick: onBulkVoidSelected }));
      bar.appendChild(ui.el('button', { class: 'btn', text: t('cl.toolbar.bulkGrace'), onclick: onBulkGraceUseSelected }));
      bar.appendChild(ui.el('button', { class: 'btn', style: 'border-color:var(--danger);color:var(--danger)', text: t('cl.toolbar.bulkDelete'), onclick: onBulkDeleteSelected }));
    }
    if (unlockedCount > 0) {
      bar.appendChild(ui.el('button', { class: 'btn', text: t('cl.toolbar.relock'), onclick: onDiscardRowEdits }));
    }
    if (editCount > 0) {
      bar.appendChild(ui.el('button', { class: 'btn btn-primary', text: t('cl.toolbar.saveEdits', { n: editCount }), onclick: onSaveRowEdits }));
    }
  }

  function onUnlockSelected() {
    Object.keys(selectedIds).forEach(function (id) { unlockedIds[id] = true; });
    renderTable();
  }

  // Dismisses the needsReview flag on selected rows WITHOUT editing any other field — for
  // rows that were reviewed and found to be fine as-is. Reuses correctRecord's existing
  // "always clears needsReview" behavior by sending an empty patch per id.
  function onMarkReviewedSelected() {
    var recs = Object.keys(selectedIds)
      .map(function (id) { return CertApp.cache.certificates.find(function (r) { return r.id === id; }); })
      .filter(function (r) { return r && r.needsReview; });
    if (recs.length === 0) { ui.toast(t('cl.noneNeedsReview'), 'warn'); return; }

    ui.openModal(t('cl.markReviewed.title', { n: recs.length }), [
      ui.el('div', { class: 'muted' }, [recs.map(function (r) { return r.certificateNo; }).join(', ')])
    ], function () {
      var patches = {};
      recs.forEach(function (r) { patches[r.id] = {}; });
      CertApp.certificateWorkflow.bulkCorrectRecords(patches, t('cl.markReviewed.note')).then(function (result) {
        reportBulkResult(result.count, result.errors, t('cl.verb.markReviewed'));
        selectedIds = {};
        resetFiltersToDefault();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('cl.bulkUse.confirm'));
  }

  function onSaveRowEdits() {
    var ids = Object.keys(pendingRowEdits);
    if (ids.length === 0) return;
    var reasons = loadEditReasons();
    var suggestion = reasons[0] || t('cl.saveConfirm.defaultReason');
    var dlId = 'edit-reason-dl';
    var datalist = ui.el('datalist', { id: dlId }, reasons.map(function (r) { return ui.el('option', { value: r }); }));
    var noteInput = ui.el('input', { type: 'text', list: dlId, autocomplete: 'off' });
    // Placeholder shows the suggested reason; Tab on the empty field accepts it.
    wireTabSuggestion(noteInput, suggestion, function () {});
    ui.openModal(t('cl.saveConfirm.title'), [
      ui.el('div', {}, [t('cl.saveConfirm.body', { n: ui.formatNumber(ids.length) })]),
      fieldRow(t('cl.saveConfirm.noteLabel'), noteInput),
      datalist
    ], function () {
      // A change reason is mandatory — an inline edit rewrites ledger figures, so the audit log
      // must say why. Returning false keeps the modal open (see ui.openModal).
      var reason = noteInput.value.trim();
      if (!reason) {
        ui.toast(t('cl.saveConfirm.reasonRequired'), 'warn');
        noteInput.focus();
        return false;
      }
      rememberEditReason(reason);
      CertApp.certificateWorkflow.bulkCorrectRecords(pendingRowEdits, reason).then(function (result) {
        reportBulkResult(result.count, result.errors, t('cl.verb.save'));
        pendingRowEdits = {}; unlockedIds = {}; rowInputs = {}; selectedIds = {};
        // A review session (e.g. clearing every "needs review" row) ends with those rows no
        // longer matching whatever filter found them — reset to the full unfiltered list
        // instead of leaving the table looking empty after a successful save.
        resetFiltersToDefault();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('common.save'));
  }

  // Re-locks every currently-unlocked row and discards any unsaved edits on them.
  function onDiscardRowEdits() {
    pendingRowEdits = {}; unlockedIds = {}; rowInputs = {};
    renderTable();
    ui.toast(t('cl.relockToast'), 'info');
  }

  function onBulkDeleteSelected() {
    var ids = Object.keys(selectedIds);
    if (ids.length === 0) return;
    ui.openModal(t('cl.deleteConfirm.title'), [
      ui.el('div', {}, [t('cl.deleteConfirm.body', { n: ui.formatNumber(ids.length) })]),
      ui.el('div', { class: 'warn-text', style: 'margin-top:8px' }, [t('cl.deleteConfirm.undoNote')])
    ], function () {
      CertApp.certificateWorkflow.bulkDeleteRecords(ids).then(function (count) {
        ui.toast(t('cl.toast.bulkDone', { n: count, verb: t('cl.verb.delete') }), 'success');
        selectedIds = {};
        refresh();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('cl.toolbar.bulkDelete'));
  }

  function onBulkUseSelected() {
    var recs = Object.keys(selectedIds)
      .map(function (id) { return CertApp.cache.certificates.find(function (r) { return r.id === id; }); })
      .filter(function (r) { return r && r.status === CertApp.STATUS.ACTIVE; });
    if (recs.length === 0) { ui.toast(t('cl.noActiveForUse'), 'warn'); return; }
    openBulkUsePanel(recs);
  }

  function openBulkUsePanel(recs) {
    var today = CertApp.today();
    var rowsData = recs.map(function (rec) {
      var late = isLateUse(rec, today);
      var split = late ? acc.computeLateUseSplit(rec.amountA) : { outletPostingAmountB: rec.amountA, arPostingAmountC: 0 };
      var arInput = ui.el('input', { type: 'number', value: split.arPostingAmountC });
      // Misc income posted at use time needs its own posting date — the ledger tracks when the
      // 잡이익 hit the books separately from the use date. Prefilled with today as soon as a
      // non-zero misc amount is entered, and required on save (see the confirm handler).
      var miscDateInput = ui.el('input', { type: 'date', value: split.arPostingAmountC > 0 ? today : '' });
      arInput.addEventListener('input', function () {
        if (Number(arInput.value) > 0 && !miscDateInput.value) miscDateInput.value = today;
      });

      // 잔액 환급 (partly-spent 금액권): entering a 매출금액(B) below the face value leaves a
      // balance. Korean law lets the guest take that balance back in cash once usage passes the
      // threshold, so surface the balance + whether it qualifies, and let it be recorded here
      // instead of leaving an unexplained A-B gap.
      var amountInput = ui.el('input', { type: 'number', value: split.outletPostingAmountB });
      var balanceCb = ui.el('input', { type: 'checkbox' });
      var balanceDateInput = ui.el('input', { type: 'date', value: today });
      var balanceInfo = ui.el('div', { class: 'balance-info' });
      var balanceRow = ui.el('div', { class: 'balance-refund-row' }, [
        ui.el('label', {}, [balanceCb, ' ' + t('cl.bulkUse.refundBalance')]),
        balanceDateInput
      ]);
      function balanceOf() { return acc.computeBalanceRefund(rec.amountA, Number(amountInput.value)); }
      function updateBalance() {
        var b = balanceOf();
        var hasBalance = b.refundAmount > 0;
        balanceRow.style.display = hasBalance ? '' : 'none';
        if (!hasBalance) {
          balanceInfo.textContent = '';
          balanceInfo.classList.remove('is-eligible');
          balanceCb.checked = false;
          return;
        }
        balanceInfo.textContent = t('cl.bulkUse.balanceInfo', {
          pct: Math.round(b.usedRatio * 100),
          balance: ui.formatCurrency(b.refundAmount),
          verdict: t(b.eligible ? 'cl.bulkUse.balanceEligible' : 'cl.bulkUse.balanceNotEligible',
            { pct: Math.round(acc.balanceRefundRate(rec.amountA) * 100) })
        });
        balanceInfo.classList.toggle('is-eligible', b.eligible);
        // Track eligibility in both directions until the cashier touches the box — otherwise
        // editing 60,000 down to 50,000 would leave it ticked and silently refund a balance the
        // law does not require. Once touched, their choice wins (a refund can still be granted).
        if (!balanceCb.dataset.touched) balanceCb.checked = b.eligible;
      }
      balanceCb.addEventListener('change', function () { balanceCb.dataset.touched = '1'; });
      amountInput.addEventListener('input', updateBalance);
      updateBalance();

      return {
        rec: rec,
        usedDateInput: ui.el('input', { type: 'date', value: today }),
        amountInput: amountInput,
        arInput: arInput,
        miscDateInput: miscDateInput,
        billNoInput: ui.el('input', { type: 'text', value: rec.billNo || '', placeholder: t('cl.bulkUse.billNoPlaceholder') }),
        balanceCb: balanceCb, balanceDateInput: balanceDateInput,
        balanceInfo: balanceInfo, balanceRow: balanceRow, balanceOf: balanceOf
      };
    });
    var body = rowsData.map(function (rd) {
      return ui.el('div', { style: 'border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:8px' }, [
        ui.el('div', { style: 'font-weight:700' }, [rd.rec.certificateNo + ' · ' + ui.formatCurrency(rd.rec.amountA)]),
        fieldRow(t('cl.bulkUse.usedDate'), rd.usedDateInput),
        fieldRow(t('cl.bulkUse.amountB'), rd.amountInput),
        rd.balanceInfo,
        rd.balanceRow,
        fieldRow(t('cl.bulkUse.amountC'), rd.arInput),
        fieldRow(t('cl.col.miscRevDate'), rd.miscDateInput),
        fieldRow(t('cl.col.billNo'), rd.billNoInput)
      ]);
    });
    ui.openModal(t('cl.bulkUse.title', { n: recs.length }), body, function () {
      // A misc-income amount without its posting date would leave the 잡이익 undated in the
      // ledger — block the save and point at the first offending certificate.
      var missing = rowsData.filter(function (rd) { return Number(rd.arInput.value) > 0 && !rd.miscDateInput.value; });
      if (missing.length) {
        ui.toast(t('cl.bulkUse.miscDateRequired', { certNo: missing[0].rec.certificateNo }), 'warn');
        missing[0].miscDateInput.focus();
        return false;
      }
      var missingRefundDate = rowsData.filter(function (rd) { return rd.balanceCb.checked && !rd.balanceDateInput.value; });
      if (missingRefundDate.length) {
        ui.toast(t('cl.bulkUse.refundDateRequired', { certNo: missingRefundDate[0].rec.certificateNo }), 'warn');
        missingRefundDate[0].balanceDateInput.focus();
        return false;
      }
      var inputsById = {};
      rowsData.forEach(function (rd) {
        var input = {
          usedDate: rd.usedDateInput.value,
          outletPostingAmountB: Number(rd.amountInput.value),
          arPostingAmountC: Number(rd.arInput.value),
          miscRevPostingDate: rd.miscDateInput.value || null,
          billNo: rd.billNoInput.value.trim() || null
        };
        if (rd.balanceCb.checked) {
          input.refundAmount = rd.balanceOf().refundAmount;
          input.refundDate = rd.balanceDateInput.value;
        }
        inputsById[rd.rec.id] = input;
      });
      CertApp.certificateWorkflow.bulkUseCertificates(inputsById).then(function (result) {
        reportBulkResult(result.count, result.errors, t('cl.verb.use'));
        selectedIds = {};
        refresh();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('cl.bulkUse.confirm'));
  }

  function onBulkVoidSelected() {
    // Only ACTIVE certs can legally transition to VOID (see schema.js TRANSITIONS) — anything
    // already USED/VOID/EXPIRED_RECOGNIZED/GRACE_USED would throw and silently abort the chain.
    var recs = Object.keys(selectedIds)
      .map(function (id) { return CertApp.cache.certificates.find(function (r) { return r.id === id; }); })
      .filter(function (r) { return r && r.status === CertApp.STATUS.ACTIVE; });
    if (recs.length === 0) { ui.toast(t('cl.noActiveForVoid'), 'warn'); return; }

    var today = CertApp.today();
    var reasonName = 'bulk-void-reason';
    var refundDateInput = ui.el('input', { type: 'date', value: today });
    var misprintRadio = ui.el('input', { type: 'radio', name: reasonName, value: 'MISPRINT', checked: 'checked' });
    var refundRadio = ui.el('input', { type: 'radio', name: reasonName, value: 'REFUND' });

    // 환불 위약금: keep a % of the face value as misc income and pay back the rest. Only
    // meaningful for 환불 (a misprint never involved money changing hands), so the option is
    // disabled unless 환불 is selected.
    var pct = Math.round(acc.REFUND_PENALTY_RATE * 100);
    var penaltyCb = ui.el('input', { type: 'checkbox' });
    var penaltyRow = ui.el('label', { class: 'void-penalty-row' }, [penaltyCb, ' ' + t('cl.bulkVoid.applyPenalty', { pct: pct })]);
    var previewEl = ui.el('div', { class: 'void-preview' });

    function updatePreview() {
      var isRefund = refundRadio.checked;
      penaltyCb.disabled = !isRefund;
      penaltyRow.classList.toggle('is-disabled', !isRefund);
      if (!isRefund) { previewEl.textContent = ''; return; }
      // Penalty is rounded per certificate — same as what actually gets written — so the
      // preview always reconciles exactly against the resulting rows.
      var face = 0, penalty = 0;
      recs.forEach(function (r) {
        face += (r.amountA || 0);
        penalty += acc.computeRefundSplit(r.amountA).arPostingAmountC;
      });
      previewEl.textContent = penaltyCb.checked
        ? t('cl.bulkVoid.previewPenalty', { n: recs.length, face: ui.formatCurrency(face), penalty: ui.formatCurrency(penalty), refund: ui.formatCurrency(face - penalty) })
        : t('cl.bulkVoid.previewPlain', { n: recs.length, face: ui.formatCurrency(face) });
    }
    [misprintRadio, refundRadio, penaltyCb].forEach(function (el) { el.addEventListener('change', updatePreview); });
    updatePreview();

    ui.openModal(t('cl.bulkVoid.title', { n: recs.length }), [
      ui.el('div', { class: 'muted' }, [recs.map(function (r) { return r.certificateNo; }).join(', ')]),
      ui.el('div', { style: 'margin:10px 0' }, [
        ui.el('label', { style: 'margin-right:16px' }, [misprintRadio, t('cl.bulkVoid.misprint')]),
        ui.el('label', {}, [refundRadio, t('cl.bulkVoid.refund')])
      ]),
      fieldRow(t('cl.bulkVoid.refundDate'), refundDateInput),
      penaltyRow,
      previewEl
    ], function () {
      var reason = refundRadio.checked ? 'REFUND' : 'MISPRINT';
      var ids = recs.map(function (r) { return r.id; });
      CertApp.certificateWorkflow.bulkVoidCertificates(ids, {
        reason: reason, refundDate: refundDateInput.value,
        applyPenalty: reason === 'REFUND' && penaltyCb.checked
      }).then(function (result) {
        reportBulkResult(result.count, result.errors, t('cl.verb.void'));
        selectedIds = {};
        refresh();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('cl.bulkUse.confirm'));
  }

  function onBulkGraceUseSelected() {
    var recs = Object.keys(selectedIds)
      .map(function (id) { return CertApp.cache.certificates.find(function (r) { return r.id === id; }); })
      .filter(function (r) { return r && r.status === CertApp.STATUS.EXPIRED_RECOGNIZED && !acc.isGiftCertificate(r.category); });
    if (recs.length === 0) { ui.toast(t('cl.noneForGrace'), 'warn'); return; }

    var today = CertApp.today();
    var graceDateInput = ui.el('input', { type: 'date', value: today });

    ui.openModal(t('cl.bulkGrace.title', { n: recs.length }), [
      ui.el('div', { class: 'muted' }, [recs.map(function (r) { return r.certificateNo; }).join(', ')]),
      ui.el('div', {}, [t('cl.bulkGrace.desc')]),
      fieldRow(t('cl.bulkGrace.date'), graceDateInput)
    ], function () {
      var ids = recs.map(function (r) { return r.id; });
      CertApp.certificateWorkflow.bulkGraceUseExpired(ids, { graceUseDate: graceDateInput.value }).then(function (result) {
        reportBulkResult(result.results.length, result.errors, t('cl.verb.grace'));
        selectedIds = {};
        refresh();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('cl.bulkUse.confirm'));
  }

  // ---------- table + pager ----------

  function renderTable() {
    var all = CertApp.cache.certificates.filter(matches);
    document.getElementById('cl-count').textContent = t('cl.resultCount', { n: ui.formatNumber(all.length) });

    all.sort(compareRows);

    var totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    var startIdx = (state.page - 1) * PAGE_SIZE;
    var pageRows = all.slice(startIdx, startIdx + PAGE_SIZE);
    var displayRows = pageRows.map(function (rec, idx) {
      var view = Object.create(rec);
      view.rowNo = startIdx + idx + 1;
      return view;
    });

    // Select-all-on-page header checkbox: checks/unchecks every row on the current page at once
    // (reflects "all currently selected" state, and toggling it re-renders so the row checkboxes
    // and bulk toolbar update).
    var pageIds = pageRows.map(function (r) { return r.id; });
    var allPageSelected = pageIds.length > 0 && pageIds.every(function (id) { return selectedIds[id]; });
    var selectAllCb = ui.el('input', { type: 'checkbox', title: t('cl.selectAllPage') });
    selectAllCb.checked = allPageSelected;
    selectAllCb.addEventListener('change', function () {
      if (selectAllCb.checked) pageIds.forEach(function (id) { selectedIds[id] = true; });
      else pageIds.forEach(function (id) { delete selectedIds[id]; });
      renderTable();
    });

    // Fixed pixel widths (see ui.renderTable colgroup) keep every column the same size across
    // sorts/pages regardless of the values shown.
    var columns = [
      { key: 'select', label: '', width: 34, headerNode: selectAllCb, format: function (v, r) { return checkboxCell(r); } },
      { key: 'rowNo', label: t('cl.col.no'), width: 46 },
      Object.assign({ key: 'certificateNo', width: 96, format: function (v, r) { return certNoCell(r); } }, sortableHeader(t('cl.col.certNo'), 'certificateNo')),
      Object.assign({ key: 'category', width: 132, align: 'left', format: function (v) { return CertApp.CATEGORY_LABEL[v] || v; } }, sortableHeader(t('cl.col.category'), 'category')),
      Object.assign({ key: 'status', width: 124, format: function (v, r) { return editableStatus(r); } }, sortableHeader(t('cl.col.status'), 'status')),
      Object.assign({ key: 'amountA', width: 92, align: 'right', format: function (v, r) { return editableAmount(r); } }, sortableHeader(t('cl.col.amountA'), 'amountA')),
      { key: 'paymentType', label: t('cl.col.paymentType'), width: 84, format: function (v, r) {
        // Unlocked rows edit the raw stored value; locked rows show the canonical label (CA -> Cash).
        return unlockedIds[r.id] ? editableText(r, 'paymentType') : CertApp.displayPaymentType(cellValue(r, 'paymentType'));
      } },
      Object.assign({ key: 'issuedDate', width: 100, format: function (v, r) { return editableDate(r, 'issuedDate'); } }, sortableHeader(t('cl.col.issuedDate'), 'issuedDate')),
      Object.assign({ key: 'expiryDate', width: 100, format: function (v, r) { return editableDate(r, 'expiryDate'); } }, sortableHeader(t('cl.col.expiryDate'), 'expiryDate')),
      Object.assign({ key: 'usedDate', width: 100, format: function (v, r) { return editableDate(r, 'usedDate'); } }, sortableHeader(t('cl.col.usedDate'), 'usedDate')),
      Object.assign({ key: 'outletPostingAmountB', width: 104, align: 'right', format: function (v, r) { return editableNumber(r, 'outletPostingAmountB'); } }, sortableHeader(t('cl.col.outletB'), 'outletPostingAmountB')),
      { key: 'miscRevPostingDate', label: t('cl.col.miscRevDate'), width: 118, format: function (v, r) { return editableDate(r, 'miscRevPostingDate'); } },
      Object.assign({ key: 'arPostingAmountC', width: 96, align: 'right', format: function (v, r) { return editableNumber(r, 'arPostingAmountC'); } }, sortableHeader(t('cl.col.arC'), 'arPostingAmountC')),
      // Sits between 잡이익(C) and 차액 so the row reads as the arithmetic it is: A − B − C − 환불액 = 차액.
      Object.assign({ key: 'refundAmount', width: 96, align: 'right', format: function (v, r) {
        // Only a handful of records are ever refunded — show a dash rather than "0원" on the
        // rest, so the column reads as "no refund" instead of "refunded nothing".
        var cur = cellValue(r, 'refundAmount');
        if (!unlockedIds[r.id] && (cur === null || cur === undefined || cur === '')) return '–';
        return editableNumber(r, 'refundAmount');
      } }, sortableHeader(t('cd.field.refundAmount'), 'refundAmount')),
      { key: 'variance', label: t('cl.col.variance'), width: 96, align: 'right', format: function (v, r) {
        // Mirrors accounting.varianceABC, but off the pending-edit values so an unlocked row
        // recomputes live as you type. Refunded cash is an accounted bucket, not a discrepancy.
        var a = cellValue(r, 'amountA') || 0, b = cellValue(r, 'outletPostingAmountB') || 0;
        var c = cellValue(r, 'arPostingAmountC') || 0, refund = cellValue(r, 'refundAmount') || 0;
        return ui.formatCurrency(a - b - c - refund);
      } },
      { key: 'certificateDetail', label: t('cl.col.detail'), width: 150, format: function (v, r) { return editableText(r, 'certificateDetail'); } },
      { key: 'billNo', label: t('cl.col.billNo'), width: 150, align: 'left', format: function (v, r) { return editableText(r, 'billNo'); } },
      { key: 'discountReceiptNote', label: t('cl.col.discountReceipt'), width: 140, align: 'left', format: function (v, r) { return editableText(r, 'discountReceiptNote'); } }
    ];

    ui.renderTable(document.getElementById('cl-table-wrap'), columns, displayRows);
    renderBulkToolbar();
    renderPager(totalPages);
  }

  function renderPager(totalPages) {
    var pager = document.getElementById('cl-pager');
    pager.innerHTML = '';

    function goToPage(p) {
      state.page = Math.max(1, Math.min(totalPages, p));
      renderTable();
    }

    var atFirst = state.page <= 1;
    var atLast = state.page >= totalPages;

    // Order: 처음으로(First) · 이전(Prev) · 페이지 [N] / M · 다음(Next).
    // No separate "Go" button — typing a page number and pressing Enter (or clicking away)
    // navigates directly. 처음으로 keeps the distinct accent "jump" style.
    pager.appendChild(ui.el('button', { class: 'btn btn-pager-jump', disabled: atFirst ? 'disabled' : null, onclick: function () { goToPage(1); } }, [t('common.first')]));
    pager.appendChild(ui.el('button', { class: 'btn', disabled: atFirst ? 'disabled' : null, onclick: function () { goToPage(state.page - 1); } }, [t('common.prev')]));

    var pageInput = ui.el('input', { type: 'number', min: '1', max: String(totalPages), value: state.page, title: t('common.pageJumpHint') });
    function jump() { var p = parseInt(pageInput.value, 10) || 1; if (p !== state.page) goToPage(p); }
    pageInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { jump(); pageInput.blur(); } });
    pageInput.addEventListener('change', jump);
    pager.appendChild(ui.el('span', { class: 'muted', text: ' ' + t('common.page') + ' ' }));
    pager.appendChild(pageInput);
    pager.appendChild(ui.el('span', { class: 'muted', text: ' / ' + totalPages + ' ' }));

    pager.appendChild(ui.el('button', { class: 'btn', disabled: atLast ? 'disabled' : null, onclick: function () { goToPage(state.page + 1); } }, [t('common.next')]));
  }

  return { render: render, showFiltered: showFiltered };
})();
