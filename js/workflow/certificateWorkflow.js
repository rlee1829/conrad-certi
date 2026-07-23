/* Sole mutation point for certificate records. Every write to CertApp.cache.certificates
   (and the derived miscRevenueEntries store) goes through here, mutating the in-memory
   cache and persisting only the changed record(s) to IndexedDB — never a full re-serialize. */
window.CertApp = window.CertApp || {};
CertApp.certificateWorkflow = (function () {

  // ---------- single-level "undo last action" ----------
  // Every bulk* function below snapshots what it's about to change before mutating, so the
  // most recent bulk operation (edit/use/void/issue/delete/recognize/grace-use) can be
  // reverted as one unit. Only one action is remembered — a new one overwrites the last.
  var lastAction = null;

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // issueCertificate/useCertificate/voidCertificate/etc. validate synchronously (throw
  // immediately rather than rejecting a promise) — calling one directly inside a chained
  // .then() means a synchronous throw happens BEFORE its own .then()/.catch() can even be
  // attached, so it skips right past the per-row .catch() every bulk* function below relies
  // on for "one bad row doesn't abort the batch." Wrapping the call itself as the body of a
  // .then() callback (via Promise.resolve().then(fn)) normalizes a synchronous throw into a
  // real promise rejection, so the following .catch() actually catches it.
  function safeCall(fn) {
    return Promise.resolve().then(fn);
  }

  // ---------- audit log ----------
  // Every business mutation writes one entry with full before/after snapshots (never just a
  // diff — keeps the log self-contained for compliance review even if display logic changes
  // later). Not mirrored into an in-memory cache like certificates/miscRevenue: the Audit Log
  // view and Certificate Detail panel both just fetch fresh from IndexedDB on open, matching
  // the existing import-history pattern in viewImportExport.js.
  // Every logAudit() call made while a bulk operation's promise chain is running shares this
  // id, so the Audit Log view can group "19,145 rows imported" as one batch instead of 19,145
  // individual rows — see withBatch() below. A single shared module variable rather than
  // threading an explicit id through every function signature: safe because the UI only ever
  // runs one bulk operation at a time (a confirm modal blocks further action until it
  // resolves), so chains never actually interleave in practice.
  var currentBatchId = null;

  function logAudit(action, before, after, note) {
    var rec = after || before;
    return CertApp.db.put('auditLog', {
      certificateId: rec.id,
      certificateNo: rec.certificateNo,
      ts: CertApp.nowIso(),
      action: action,
      actor: CertApp.operator.get() || null,
      note: note || null,
      batchId: currentBatchId,
      before: before || null,
      after: after || null
    });
  }

  // Runs fn() (which returns a promise) with a fresh batchId active for logAudit() calls made
  // during its execution, clearing it again once fn()'s promise settles either way.
  function withBatch(fn) {
    currentBatchId = CertApp.uuid();
    return fn().then(function (result) {
      currentBatchId = null;
      return result;
    }, function (err) {
      currentBatchId = null;
      throw err;
    });
  }

  // logBulkImport(records) -> Promise — called from viewImportExport.js after a successful
  // import, since imported rows are inserted directly via db.putMany rather than through
  // issueCertificate() (import already carries its own row-level validation/report).
  function logBulkImport(records) {
    return withBatch(function () {
      var chain = Promise.resolve();
      records.forEach(function (rec) {
        chain = chain.then(function () { return logAudit(CertApp.AUDIT_ACTION.IMPORT, null, clone(rec)); });
      });
      return chain;
    });
  }

  function snapshotCertsByIds(ids) {
    return ids.map(function (id) {
      var rec = CertApp.cache.certificates.find(function (r) { return r.id === id; });
      return rec ? clone(rec) : null;
    }).filter(Boolean);
  }

  // Short "SC001, SC002 +3 more" preview of which certificates an action touched, so the undo
  // bar can show at a glance what will be reverted without opening the Audit Log.
  var CERT_PREVIEW_MAX = 3;
  function formatCertPreview(nos) {
    if (nos.length === 0) return '';
    if (nos.length <= CERT_PREVIEW_MAX) return nos.join(', ');
    return nos.slice(0, CERT_PREVIEW_MAX).join(', ') + ' ' + CertApp.i18n.t('undo.andMore', { n: nos.length - CERT_PREVIEW_MAX });
  }

  function setLastAction(label, certSnapshots, createdCertIds, createdMiscRevenueIds, miscRevenueSnapshots) {
    certSnapshots = certSnapshots || [];
    createdCertIds = createdCertIds || [];
    var nos = certSnapshots.map(function (s) { return s.certificateNo; }).filter(Boolean);
    if (nos.length === 0 && createdCertIds.length) {
      nos = createdCertIds.map(function (id) {
        var r = CertApp.cache.certificates.find(function (r) { return r.id === id; });
        return r ? r.certificateNo : null;
      }).filter(Boolean);
    }
    lastAction = {
      label: label,
      certPreview: formatCertPreview(nos),
      certSnapshots: certSnapshots,
      createdCertIds: createdCertIds,
      createdMiscRevenueIds: createdMiscRevenueIds || [],
      miscRevenueSnapshots: miscRevenueSnapshots || []
    };
  }

  function getLastActionLabel() { return lastAction ? lastAction.label : null; }
  function getLastActionDetail() { return lastAction ? lastAction.certPreview : null; }

  // Clears the pending undo without reverting anything — lets the user dismiss the undo bar
  // once they're satisfied with an action, instead of it lingering until some later action
  // happens to overwrite it.
  function dismissLastAction() { lastAction = null; }

  function undoLastAction() {
    if (!lastAction) return Promise.reject(new Error(CertApp.i18n.t('undo.none')));
    var action = lastAction;
    lastAction = null;
    return withBatch(function () { return runUndo(action); });
  }

  function runUndo(action) {
    var ops = [];

    action.certSnapshots.forEach(function (snap) {
      var idx = CertApp.cache.certificates.findIndex(function (r) { return r.id === snap.id; });
      var beforeUndo = idx !== -1 ? clone(CertApp.cache.certificates[idx]) : null;
      if (idx !== -1) CertApp.cache.certificates[idx] = snap; else CertApp.cache.certificates.push(snap);
      ops.push(CertApp.db.put('certificates', snap).then(function () {
        return logAudit(CertApp.AUDIT_ACTION.UNDO, beforeUndo, clone(snap));
      }));
    });

    if (action.createdCertIds.length) {
      var certIdSet = {};
      action.createdCertIds.forEach(function (id) { certIdSet[id] = true; });
      var removedSnaps = CertApp.cache.certificates.filter(function (r) { return certIdSet[r.id]; }).map(clone);
      CertApp.cache.certificates = CertApp.cache.certificates.filter(function (r) { return !certIdSet[r.id]; });
      ops.push(CertApp.db.removeMany('certificates', action.createdCertIds).then(function () {
        return Promise.all(removedSnaps.map(function (snap) { return logAudit(CertApp.AUDIT_ACTION.UNDO, snap, null); }));
      }));
    }

    action.miscRevenueSnapshots.forEach(function (snap) {
      var idx = CertApp.cache.miscRevenue.findIndex(function (e) { return e.id === snap.id; });
      if (idx !== -1) CertApp.cache.miscRevenue[idx] = snap; else CertApp.cache.miscRevenue.push(snap);
      ops.push(CertApp.db.put('miscRevenueEntries', snap));
    });

    if (action.createdMiscRevenueIds.length) {
      var mrIdSet = {};
      action.createdMiscRevenueIds.forEach(function (id) { mrIdSet[id] = true; });
      CertApp.cache.miscRevenue = CertApp.cache.miscRevenue.filter(function (e) { return !mrIdSet[e.id]; });
      ops.push(CertApp.db.removeMany('miscRevenueEntries', action.createdMiscRevenueIds));
    }

    return Promise.all(ops).then(function () { return action.label; });
  }

  function findRecord(id) {
    var rec = CertApp.cache.certificates.find(function (r) { return r.id === id; });
    if (!rec) throw new Error('Certificate not found: ' + id);
    return rec;
  }

  function assertTransition(rec, toStatus) {
    if (!CertApp.canTransition(rec.status, toStatus)) {
      throw new Error('Invalid transition: ' + rec.status + ' -> ' + toStatus + ' (certificate ' + rec.certificateNo + ')');
    }
  }

  function persist(rec) {
    rec.updatedAt = CertApp.nowIso();
    return CertApp.db.put('certificates', rec);
  }

  function todayIso() {
    return CertApp.today();
  }

  // "Issued by {operator}" (+ seller Opera ID if supplied) for the Note column on a newly
  // issued certificate — falls back to just the Opera ID (or null) if no operator is set.
  function issuerNote(sellerOperaId) {
    var operatorName = CertApp.operator.get();
    if (!operatorName) return sellerOperaId || null;
    var note = CertApp.i18n.t('cl.bulkIssue.issuedBy', { name: operatorName });
    return sellerOperaId ? (note + ' / ' + sellerOperaId) : note;
  }

  // issueCertificate(input) -> Promise<CertificateRecord>
  function issueCertificate(input) {
    if (!input.certificateNo) throw new Error('Certificate No. is required.');
    if (!input.category) throw new Error('Category is required.');
    if (input.amountA === null || input.amountA === undefined || input.amountA <= 0) {
      throw new Error('Amount must be a positive number.');
    }
    // Checked against the live cache, which already includes any earlier row from the same
    // bulk-issue batch (each row is pushed to cache synchronously before its DB write
    // resolves — see below), so this also catches duplicates entered within one batch.
    var dup = CertApp.cache.certificates.some(function (r) { return r.certificateNo === input.certificateNo; });
    if (dup) throw new Error(CertApp.i18n.t('cl.bulkIssue.duplicateCertNo', { certNo: input.certificateNo }));
    var issuedDate = input.issuedDate || todayIso();
    var expiryDate = input.expiryDate || defaultExpiryDate(issuedDate, input.category);
    var now = CertApp.nowIso();

    var rec = {
      id: CertApp.uuid(),
      category: input.category,
      certificateNo: input.certificateNo,
      issuedDate: issuedDate,
      expiryDate: expiryDate,
      status: CertApp.STATUS.ACTIVE,
      dc: null,
      amountA: input.amountA,
      paymentType: input.paymentType || null,
      certificateDetail: input.certificateDetail || null,
      usedDate: null,
      outletPostingAmountB: null,
      miscRevPostingDate: null,
      arPostingAmountC: null,
      // Note column: records who issued it (current operator — see operator.js) alongside
      // any seller Opera ID the caller supplied, so the issuer is traceable straight from
      // the ledger, not just from the Audit Log.
      billNo: issuerNote(input.sellerOperaId),
      sellerOperaId: input.sellerOperaId || null,
      voidReason: null,
      refundDate: null,
      graceUseDate: null,
      mateApprovalNo: null,
      // Second free-text note (right of billNo): discount applied / cash-receipt issued, etc.
      discountReceiptNote: input.discountReceiptNote || null,
      needsReview: false,
      sourceRowRef: null,
      createdAt: now,
      updatedAt: now
    };

    CertApp.cache.certificates.push(rec);
    return persist(rec).then(function () {
      return logAudit(CertApp.AUDIT_ACTION.ISSUE, null, clone(rec));
    }).then(function () { return rec; });
  }

  function addYears(isoDate, years) {
    var d = new Date(isoDate);
    d.setFullYear(d.getFullYear() + years);
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  // Gift Certificates are valid 5 years from issue (flat, no reduction). Service Certificates
  // are nominally 1 year, though late use up to 5 years is still possible at a 90% value
  // (see accounting.js computeLateUseSplit / useCertificate below).
  function defaultExpiryDate(issuedDate, category) {
    return addYears(issuedDate, CertApp.accounting.isGiftCertificate(category) ? 5 : 1);
  }

  // useCertificate(id, {usedDate, outletPostingAmountB, arPostingAmountC, billNo}) -> Promise<CertificateRecord>
  // If usedDate falls after the certificate's (nominal, for SC) expiryDate and the caller
  // didn't explicitly supply amounts, auto-applies the 90/10 late-use split — real service
  // was still delivered, just at a lateness penalty (see accounting.js header comment).
  function useCertificate(id, input) {
    var rec = findRecord(id);
    var before = clone(rec);
    assertTransition(rec, CertApp.STATUS.USED);
    var usedDate = input.usedDate || todayIso();
    var isLateUse = !CertApp.accounting.isGiftCertificate(rec.category) && rec.expiryDate && usedDate > rec.expiryDate;

    if (input.outletPostingAmountB !== undefined && input.outletPostingAmountB !== null) {
      rec.outletPostingAmountB = input.outletPostingAmountB;
      rec.arPostingAmountC = (input.arPostingAmountC !== undefined && input.arPostingAmountC !== null) ? input.arPostingAmountC : (rec.arPostingAmountC || 0);
    } else if (isLateUse) {
      var split = CertApp.accounting.computeLateUseSplit(rec.amountA || 0);
      rec.outletPostingAmountB = split.outletPostingAmountB;
      rec.arPostingAmountC = split.arPostingAmountC;
    } else {
      rec.outletPostingAmountB = rec.amountA;
      rec.arPostingAmountC = 0;
    }

    rec.usedDate = usedDate;
    rec.billNo = input.billNo || rec.billNo;
    rec.status = CertApp.STATUS.USED;
    return persist(rec).then(function () {
      return logAudit(CertApp.AUDIT_ACTION.USE, before, clone(rec));
    }).then(function () { return rec; });
  }

  // voidCertificate(id, {reason: 'MISPRINT'|'REFUND', refundDate}) -> Promise<CertificateRecord>
  function voidCertificate(id, input) {
    var rec = findRecord(id);
    var before = clone(rec);
    if (rec.status === CertApp.STATUS.USED) {
      throw new Error('Cannot void/refund a certificate that has already been used (certificate ' + rec.certificateNo + ').');
    }
    assertTransition(rec, CertApp.STATUS.VOID);
    var reason = input.reason === CertApp.VOID_REASON.REFUND ? CertApp.VOID_REASON.REFUND : CertApp.VOID_REASON.MISPRINT;
    rec.status = CertApp.STATUS.VOID;
    rec.voidReason = reason;
    var miscOps = [];
    if (reason === CertApp.VOID_REASON.REFUND) {
      rec.refundDate = input.refundDate || todayIso();
      // Refund with a retained penalty: book the penalty to AR Posting(C) as misc income and
      // leave amountA at face value — the cash paid back is the derived remainder (see
      // accounting.computeRefundSplit / refundAmount). Recorded in the Misc Revenue ledger too,
      // same as a write-off, so the misc income balance shows where it actually came from.
      if (input.applyPenalty) {
        var split = CertApp.accounting.computeRefundSplit(rec.amountA);
        rec.outletPostingAmountB = split.outletPostingAmountB;
        rec.arPostingAmountC = split.arPostingAmountC;
        if (split.arPostingAmountC > 0) {
          var penaltyEntry = {
            id: CertApp.uuid(), certificateId: rec.id, certificateNo: rec.certificateNo, category: rec.category,
            entryDate: rec.refundDate, type: 'REFUND_PENALTY', amount: split.arPostingAmountC,
            note: CertApp.i18n.t('mr.refundPenaltyNote', {
              pct: Math.round(CertApp.accounting.REFUND_PENALTY_RATE * 100),
              refund: (split.refundAmount || 0).toLocaleString('ko-KR')
            })
          };
          CertApp.cache.miscRevenue.push(penaltyEntry);
          miscOps.push(CertApp.db.put('miscRevenueEntries', penaltyEntry));
        }
      }
    }
    return persist(rec).then(function () {
      return Promise.all(miscOps);
    }).then(function () {
      return logAudit(CertApp.AUDIT_ACTION.VOID, before, clone(rec));
    }).then(function () { return rec; });
  }

  // recognizeExpiry(id, asOfDate) -> Promise<CertificateRecord>
  // Write-off for a certificate nobody claimed. GC posts 100% straight to revenue (B);
  // SC posts 100% to misc income (C) since no service was ever delivered — see accounting.js.
  function recognizeExpiry(id, asOfDate) {
    var rec = findRecord(id);
    var before = clone(rec);
    assertTransition(rec, CertApp.STATUS.EXPIRED_RECOGNIZED);
    asOfDate = asOfDate || todayIso();
    if (!rec.expiryDate || rec.expiryDate >= asOfDate) {
      throw new Error('Certificate ' + rec.certificateNo + ' has not expired as of ' + asOfDate + '.');
    }
    var split = CertApp.accounting.computeWriteOffSplit(rec.amountA || 0, rec.category);
    rec.outletPostingAmountB = split.outletPostingAmountB;
    rec.arPostingAmountC = split.arPostingAmountC;
    rec.usedDate = asOfDate;
    rec.status = CertApp.STATUS.EXPIRED_RECOGNIZED;

    // Only Service Certificates route write-off money into misc income (GC goes 100% to real
    // revenue — see accounting.js) — record that booking in the Misc Revenue ledger itself,
    // not just as a field on the certificate, so the ledger shows where the balance actually
    // came from, not only later Grace Use reversals against it.
    var writeOffOps = [];
    if (split.arPostingAmountC > 0) {
      var writeOffEntry = {
        id: CertApp.uuid(), certificateId: rec.id, certificateNo: rec.certificateNo, category: rec.category,
        entryDate: asOfDate, type: 'WRITE_OFF', amount: split.arPostingAmountC,
        note: CertApp.i18n.t('mr.writeOffNote')
      };
      CertApp.cache.miscRevenue.push(writeOffEntry);
      writeOffOps.push(CertApp.db.put('miscRevenueEntries', writeOffEntry));
    }

    return persist(rec).then(function () {
      return Promise.all(writeOffOps);
    }).then(function () {
      return logAudit(CertApp.AUDIT_ACTION.EXPIRE_RECOGNIZE, before, clone(rec));
    }).then(function () { return rec; });
  }

  // bulkYearEndRecognition(asOfDate) -> Promise<CertificateRecord[]>
  function bulkYearEndRecognition(asOfDate) {
    asOfDate = asOfDate || todayIso();
    var queue = CertApp.calculationEngine.computeExpiryQueue(asOfDate);
    var chain = Promise.resolve();
    var results = [];
    queue.forEach(function (item) {
      chain = chain.then(function () {
        return recognizeExpiry(item.record.id, asOfDate).then(function (rec) { results.push(rec); });
      });
    });
    return chain.then(function () { return results; });
  }

  // graceUseExpired(id, {graceUseDate, note}) -> Promise<CertificateRecord>
  // Customer shows up (up to 5 years from issue) to use an SC certificate that was already
  // written off at year-end (100% sitting in AR Posting/misc income). Releases 90% of that
  // back into real revenue and permanently keeps 10% as misc income. GC never reaches this
  // state (no grace concept — see accounting.js), so it's blocked here.
  function graceUseExpired(id, input) {
    var rec = findRecord(id);
    var before = clone(rec);
    if (CertApp.accounting.isGiftCertificate(rec.category)) {
      throw new Error('Gift Certificates do not have a grace-use period (certificate ' + rec.certificateNo + ').');
    }
    assertTransition(rec, CertApp.STATUS.GRACE_USED);
    var graceUseDate = (input && input.graceUseDate) || todayIso();
    var split = CertApp.accounting.computeLateUseSplit(rec.amountA || 0);
    var payoutAmount = split.outletPostingAmountB; // 90% released from misc income back to revenue

    var payoutEntry = {
      id: CertApp.uuid(), certificateId: rec.id, certificateNo: rec.certificateNo, category: rec.category,
      entryDate: graceUseDate, type: 'GRACE_USE_PAYOUT', amount: payoutAmount,
      note: (input && input.note) || 'Grace use payout for ' + rec.certificateNo
    };
    var reversalEntry = {
      id: CertApp.uuid(), certificateId: rec.id, certificateNo: rec.certificateNo, category: rec.category,
      entryDate: graceUseDate, type: 'GRACE_USE_REVERSAL', amount: -payoutAmount,
      note: (input && input.note) || 'Revenue reversal for ' + rec.certificateNo
    };

    // Reflect the final resolved state directly on the record too (90% revenue / 10% misc
    // income, variance back to 0), not just in the Misc Revenue audit trail.
    rec.outletPostingAmountB = split.outletPostingAmountB;
    rec.arPostingAmountC = split.arPostingAmountC;
    rec.status = CertApp.STATUS.GRACE_USED;
    rec.graceUseDate = graceUseDate;

    CertApp.cache.miscRevenue.push(payoutEntry, reversalEntry);
    return Promise.all([
      CertApp.db.put('miscRevenueEntries', payoutEntry),
      CertApp.db.put('miscRevenueEntries', reversalEntry),
      persist(rec)
    ]).then(function () {
      return logAudit(CertApp.AUDIT_ACTION.GRACE_USE, before, clone(rec));
    }).then(function () { return rec; });
  }

  // extendExpiry(id, {newExpiryDate, approvalNo, note}) -> Promise<CertificateRecord>
  // Extends the validity period of a certificate that is past its expiry date (still ACTIVE,
  // sitting in the Expiry Queue) once a manager ("Mate") has approved it. Requires a Mate
  // Approval # — recorded on the record (mateApprovalNo) AND in the audit note so the approval
  // is always traceable. Status stays ACTIVE; only expiryDate moves forward, so the certificate
  // drops out of the expiry queue and can be used normally again. Single-level undoable.
  function extendExpiry(id, input) {
    return withBatch(function () {
      var snaps = snapshotCertsByIds([id]);
      return safeCall(function () {
        var rec = findRecord(id);
        var before = clone(rec);
        if (rec.status !== CertApp.STATUS.ACTIVE) {
          throw new Error(CertApp.i18n.t('eq.extend.notActive', { certNo: rec.certificateNo }));
        }
        var approvalNo = ((input && input.approvalNo) || '').trim();
        if (!approvalNo) throw new Error(CertApp.i18n.t('eq.extend.needApproval'));
        var newExpiry = input && input.newExpiryDate;
        if (!newExpiry) throw new Error(CertApp.i18n.t('eq.extend.needDate'));
        if (newExpiry <= todayIso()) throw new Error(CertApp.i18n.t('eq.extend.dateMustBeFuture'));

        rec.expiryDate = newExpiry;
        rec.mateApprovalNo = approvalNo;
        var note = (input && input.note) || CertApp.i18n.t('eq.extend.auditNote', {
          approvalNo: approvalNo, from: before.expiryDate || '–', to: newExpiry
        });
        return persist(rec).then(function () {
          return logAudit(CertApp.AUDIT_ACTION.EXTEND_EXPIRY, before, clone(rec), note);
        }).then(function () { return rec; });
      }).then(function (rec) {
        setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: 1, verb: CertApp.i18n.t('eq.extend.verb') }), snaps);
        return rec;
      });
    });
  }

  // correctRecord(id, patch) -> Promise<CertificateRecord>
  // Manual data-quality correction for import-flagged (needsReview) rows, or a quick fix
  // from the Certificate List — bypasses the normal lifecycle state machine on purpose
  // (this corrects a record directly, it isn't a new business event) and always clears
  // needsReview once saved. patch may include any editable ledger field: certificateNo,
  // status, amountA, paymentType, issuedDate, expiryDate, usedDate, outletPostingAmountB,
  // miscRevPostingDate, arPostingAmountC, voidReason, refundDate, graceUseDate,
  // certificateDetail, billNo. Setting status to VOID always zeroes amountA (face value
  // forfeited) unless the caller explicitly supplies an amountA override.
  function correctRecord(id, patch, note) {
    var rec = findRecord(id);
    var before = clone(rec);
    var oldCertNo = rec.certificateNo;
    var certNoChanged = false;
    if (patch.certificateNo !== undefined && patch.certificateNo !== rec.certificateNo) {
      var dup = CertApp.cache.certificates.some(function (r) { return r.id !== id && r.certificateNo === patch.certificateNo; });
      if (dup) throw new Error(CertApp.i18n.t('cl.bulkIssue.duplicateCertNo', { certNo: patch.certificateNo }));
      rec.certificateNo = patch.certificateNo;
      certNoChanged = true;
    }
    if (patch.status !== undefined) {
      if (!CertApp.STATUS[patch.status]) throw new Error('Unknown status: ' + patch.status);
      rec.status = patch.status;
    }
    if (patch.amountA !== undefined) {
      rec.amountA = patch.amountA;
    } else if (rec.status === CertApp.STATUS.VOID) {
      rec.amountA = 0;
    }
    if (patch.paymentType !== undefined) rec.paymentType = patch.paymentType;
    if (patch.issuedDate !== undefined) rec.issuedDate = patch.issuedDate;
    if (patch.expiryDate !== undefined) rec.expiryDate = patch.expiryDate;
    if (patch.usedDate !== undefined) rec.usedDate = patch.usedDate;
    if (patch.outletPostingAmountB !== undefined) rec.outletPostingAmountB = patch.outletPostingAmountB;
    if (patch.miscRevPostingDate !== undefined) rec.miscRevPostingDate = patch.miscRevPostingDate;
    if (patch.arPostingAmountC !== undefined) rec.arPostingAmountC = patch.arPostingAmountC;
    if (patch.voidReason !== undefined) rec.voidReason = patch.voidReason;
    if (patch.refundDate !== undefined) rec.refundDate = patch.refundDate;
    if (patch.graceUseDate !== undefined) rec.graceUseDate = patch.graceUseDate;
    if (patch.certificateDetail !== undefined) rec.certificateDetail = patch.certificateDetail;
    if (patch.billNo !== undefined) rec.billNo = patch.billNo;
    if (patch.discountReceiptNote !== undefined) rec.discountReceiptNote = patch.discountReceiptNote;
    rec.needsReview = false;

    // Renaming this record's certificateNo may have resolved a duplicate — if exactly one
    // other record still carries the OLD number (the sibling this one used to collide with)
    // and that sibling is flagged needsReview, the duplicate that flagged it no longer
    // exists, so clear it too rather than leaving it stuck in the "needs review" filter for
    // a problem that's already fixed. If 2+ others still share the old number, a real
    // conflict remains among them, so their flags are left alone.
    var resolvedSibling = null;
    if (certNoChanged) {
      var stillSharingOldNo = CertApp.cache.certificates.filter(function (r) { return r.id !== id && r.certificateNo === oldCertNo; });
      if (stillSharingOldNo.length === 1 && stillSharingOldNo[0].needsReview) {
        resolvedSibling = stillSharingOldNo[0];
      }
    }

    return persist(rec).then(function () {
      return logAudit(CertApp.AUDIT_ACTION.CORRECT, before, clone(rec), note);
    }).then(function () {
      if (!resolvedSibling) return null;
      var siblingBefore = clone(resolvedSibling);
      resolvedSibling.needsReview = false;
      return persist(resolvedSibling).then(function () {
        return logAudit(CertApp.AUDIT_ACTION.CORRECT, siblingBefore, clone(resolvedSibling), CertApp.i18n.t('cl.autoResolvedDupNote', { certNo: rec.certificateNo }));
      });
    }).then(function () { return rec; });
  }

  // deleteRecords(ids) -> Promise<void>
  // Permanently removes whole certificate rows (and any Misc Revenue entries tied to them)
  // from both the in-memory cache and IndexedDB. Used for single-row delete, category-scoped
  // reset, and per-import-batch undo — see undoImportBatch below.
  function deleteRecords(ids) {
    if (!ids || ids.length === 0) return Promise.resolve();
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });

    var deletedSnaps = CertApp.cache.certificates.filter(function (r) { return idSet[r.id]; }).map(clone);
    CertApp.cache.certificates = CertApp.cache.certificates.filter(function (r) { return !idSet[r.id]; });
    var miscIdsToRemove = CertApp.cache.miscRevenue.filter(function (e) { return idSet[e.certificateId]; }).map(function (e) { return e.id; });
    CertApp.cache.miscRevenue = CertApp.cache.miscRevenue.filter(function (e) { return !idSet[e.certificateId]; });

    return withBatch(function () {
      return Promise.all([
        CertApp.db.removeMany('certificates', ids),
        CertApp.db.removeMany('miscRevenueEntries', miscIdsToRemove)
      ]).then(function () {
        return Promise.all(deletedSnaps.map(function (snap) { return logAudit(CertApp.AUDIT_ACTION.DELETE, snap, null); }));
      });
    });
  }

  function deleteRecord(id) {
    return deleteRecords([id]);
  }

  // flagDuplicateCertificateNumbers() -> Promise<{count, groups}>
  // Data-hygiene sweep: any certificateNo shared by more than one record (across all
  // categories/statuses — a real certificate number should never repeat) gets every one of
  // those records flagged needsReview, so they surface in Certificate List's "needs review
  // only" filter for a human to reconcile. Undoable like the other bulk actions below.
  function flagDuplicateCertificateNumbers() {
    var groups = {};
    CertApp.cache.certificates.forEach(function (r) {
      if (!r.certificateNo) return;
      (groups[r.certificateNo] = groups[r.certificateNo] || []).push(r);
    });
    var toFlag = [];
    var newlyFlaggedGroupCount = 0;
    Object.keys(groups).forEach(function (certNo) {
      var group = groups[certNo];
      // Only counts/flags groups with at least one record not already flagged — most
      // duplicate certNos left in the cache were already flagged by the import-time dedup
      // pass (see importPipeline.js dedupeReversalPairs), so re-running this shouldn't
      // report them again as "newly found."
      if (group.length > 1 && group.some(function (r) { return !r.needsReview; })) {
        toFlag = toFlag.concat(group);
        newlyFlaggedGroupCount++;
      }
    });
    if (toFlag.length === 0) return Promise.resolve({ count: 0, groups: 0 });

    var snaps = toFlag.map(clone);
    var ops = toFlag.map(function (rec) {
      rec.needsReview = true;
      return persist(rec);
    });
    return Promise.all(ops).then(function () {
      setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: toFlag.length, verb: CertApp.i18n.t('wf.verb.flagDup') }), snaps);
      return { count: toFlag.length, groups: newlyFlaggedGroupCount };
    });
  }

  // reclassifyMisimportedExpiries() -> Promise<{count, used, grace}>
  // Data repair that brings every REDEEMED record's stored status in line with the current
  // classification rules, without a re-import. Two things are corrected:
  //   1. Records wrongly stored as EXPIRED_RECOGNIZED by an older importer — those that actually
  //      posted real outlet revenue (Outlet Posting B > 0) and carry a genuine bill reference,
  //      not a year-end "To Revenue on ..." recognition note — were really redemptions.
  //   2. The USED vs GRACE_USED split itself, by the timing rule: a redemption that posted an AR
  //      Posting misc-income penalty (C > 0) AND was used AFTER the certificate's expiry date is
  //      a grace use (GRACE_USED); anything else is a plain USED. (The penalty is "up to 10%",
  //      so timing — not an exact 90/10 amount — is the reliable signal.)
  // Genuine write-offs (B = 0, or carrying a recognition note) are left untouched. Undoable.
  function reclassifyMisimportedExpiries() {
    var checkNo = /CHK\s*\d/;
    function correctStatus(r) {
      var isGrace = (r.arPostingAmountC || 0) > 0 && r.usedDate && r.expiryDate && r.usedDate > r.expiryDate;
      return isGrace ? CertApp.STATUS.GRACE_USED : CertApp.STATUS.USED;
    }
    function isCandidate(r) {
      // an already-redeemed record whose USED/GRACE_USED label may need re-checking...
      if (r.status === CertApp.STATUS.USED || r.status === CertApp.STATUS.GRACE_USED) return true;
      // ...or an expiry write-off that's really a redemption — identified ONLY by a check number
      // in the bill (the reliable "a customer redeemed it" signal, matching the importer). A
      // write-off carrying just an "EXPIRED" / "To Revenue" note and no check number is a genuine
      // unredeemed write-off and is left as-is.
      if (r.status !== CertApp.STATUS.EXPIRED_RECOGNIZED || !(r.outletPostingAmountB > 0)) return false;
      return checkNo.test(String(r.billNo || '').toUpperCase());
    }
    var toFix = [];
    CertApp.cache.certificates.forEach(function (r) {
      if (!isCandidate(r)) return;
      var correct = correctStatus(r);
      if (correct !== r.status) toFix.push({ rec: r, correct: correct });
    });
    if (toFix.length === 0) return Promise.resolve({ count: 0, used: 0, grace: 0 });
    var snaps = toFix.map(function (x) { return clone(x.rec); });
    var usedCount = 0, graceCount = 0;
    return withBatch(function () {
      var chain = Promise.resolve();
      toFix.forEach(function (x, i) {
        chain = chain.then(function () {
          x.rec.status = x.correct;
          if (x.correct === CertApp.STATUS.GRACE_USED) { x.rec.graceUseDate = x.rec.graceUseDate || x.rec.usedDate; graceCount++; }
          else { x.rec.graceUseDate = null; usedCount++; }
          return persist(x.rec).then(function () {
            return logAudit(CertApp.AUDIT_ACTION.CORRECT, snaps[i], clone(x.rec), CertApp.i18n.t('ie.reclassify.note'));
          });
        });
      });
      return chain;
    }).then(function () {
      setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: toFix.length, verb: CertApp.i18n.t('ie.reclassify.verb') }), snaps);
      return { count: toFix.length, used: usedCount, grace: graceCount };
    });
  }

  // undoImportBatch(batchId) -> Promise<number> (count of records removed)
  // Removes exactly the certificates created by one import run (tracked via the batch's
  // recordIds — see importPipeline.js) and the batch record itself.
  function undoImportBatch(batchId) {
    return CertApp.db.get('importBatches', batchId).then(function (batch) {
      if (!batch) throw new Error('Import batch not found: ' + batchId);
      var ids = batch.recordIds || [];
      return deleteRecords(ids).then(function () {
        return CertApp.db.remove('importBatches', batchId);
      }).then(function () { return ids.length; });
    });
  }

  // ---------- bulk variants: snapshot first, mutate, record ONE undoable action ----------
  // Each item is applied independently (one bad row doesn't abort the rest) — errors are
  // collected and returned alongside the successes, and only the successful ids' "before"
  // state is kept for undo (nothing to undo for a row that never actually changed).

  // bulkCorrectRecords({id: patch, ...}, note) -> Promise<{count, errors}>
  // note is an optional free-text reason recorded on each row's audit entry (see logAudit) —
  // lets the person saving explain WHY, not just show what changed.
  function bulkCorrectRecords(patchesById, note) {
    return withBatch(function () {
      var ids = Object.keys(patchesById);
      var snaps = snapshotCertsByIds(ids);
      var succeededIds = [];
      var errors = [];
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return safeCall(function () { return correctRecord(id, patchesById[id], note); }).then(function () { succeededIds.push(id); })
            .catch(function (err) { errors.push(err.message); });
        });
      });
      return chain.then(function () {
        var succeededSnaps = snaps.filter(function (s) { return succeededIds.indexOf(s.id) !== -1; });
        if (succeededIds.length) setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: succeededIds.length, verb: CertApp.i18n.t('wf.verb.correct') }), succeededSnaps);
        return { count: succeededIds.length, errors: errors };
      });
    });
  }

  // bulkUseCertificates({id: {usedDate, outletPostingAmountB, arPostingAmountC, billNo}, ...}) -> Promise<{count, errors}>
  function bulkUseCertificates(inputsById) {
    return withBatch(function () {
      var ids = Object.keys(inputsById);
      var snaps = snapshotCertsByIds(ids);
      var succeededIds = [];
      var errors = [];
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return safeCall(function () { return useCertificate(id, inputsById[id]); }).then(function () { succeededIds.push(id); })
            .catch(function (err) { errors.push(err.message); });
        });
      });
      return chain.then(function () {
        var succeededSnaps = snaps.filter(function (s) { return succeededIds.indexOf(s.id) !== -1; });
        if (succeededIds.length) setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: succeededIds.length, verb: CertApp.i18n.t('cl.verb.use') }), succeededSnaps);
        return { count: succeededIds.length, errors: errors };
      });
    });
  }

  // bulkVoidCertificates([id, ...], {reason, refundDate}) -> Promise<{count, errors}>
  function bulkVoidCertificates(ids, input) {
    return withBatch(function () {
      var snaps = snapshotCertsByIds(ids);
      var succeededIds = [];
      var createdMiscIds = [];   // refund-penalty bookings, so undo removes them too
      var errors = [];
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          var beforeLen = CertApp.cache.miscRevenue.length;
          return safeCall(function () { return voidCertificate(id, input); }).then(function () {
            succeededIds.push(id);
            CertApp.cache.miscRevenue.slice(beforeLen).forEach(function (e) { createdMiscIds.push(e.id); });
          }).catch(function (err) { errors.push(err.message); });
        });
      });
      return chain.then(function () {
        var succeededSnaps = snaps.filter(function (s) { return succeededIds.indexOf(s.id) !== -1; });
        if (succeededIds.length) setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: succeededIds.length, verb: CertApp.i18n.t('cl.verb.void') }), succeededSnaps, [], createdMiscIds);
        return { count: succeededIds.length, errors: errors };
      });
    });
  }

  // bulkIssueCertificates([input, ...]) -> Promise<{createdIds, errors}>
  function bulkIssueCertificates(inputsArray) {
    return withBatch(function () {
      var createdIds = [];
      var errors = [];
      var chain = Promise.resolve();
      inputsArray.forEach(function (input) {
        chain = chain.then(function () {
          return safeCall(function () { return issueCertificate(input); }).then(function (rec) { createdIds.push(rec.id); })
            .catch(function (err) { errors.push(input.certificateNo + ': ' + err.message); });
        });
      });
      return chain.then(function () {
        if (createdIds.length) setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: createdIds.length, verb: CertApp.i18n.t('cl.verb.issue') }), [], createdIds);
        return { createdIds: createdIds, errors: errors };
      });
    });
  }

  // bulkDeleteRecords([id, ...]) -> Promise<number>
  function bulkDeleteRecords(ids) {
    var certSnaps = snapshotCertsByIds(ids);
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    var miscSnaps = CertApp.cache.miscRevenue.filter(function (e) { return idSet[e.certificateId]; }).map(clone);
    return deleteRecords(ids).then(function () {
      setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: ids.length, verb: CertApp.i18n.t('cl.verb.delete') }), certSnaps, [], [], miscSnaps);
      return ids.length;
    });
  }

  // bulkRecognizeExpiry([id, ...], asOfDate) -> Promise<{results, errors}>
  function bulkRecognizeExpiry(ids, asOfDate) {
    return withBatch(function () {
      var snaps = snapshotCertsByIds(ids);
      var createdMiscIds = [];
      var chain = Promise.resolve();
      var results = [];
      var errors = [];
      ids.forEach(function (id) {
        chain = chain.then(function () {
          var beforeLen = CertApp.cache.miscRevenue.length;
          return safeCall(function () { return recognizeExpiry(id, asOfDate); }).then(function (r) {
            results.push(r);
            CertApp.cache.miscRevenue.slice(beforeLen).forEach(function (e) { createdMiscIds.push(e.id); });
          }).catch(function (err) { errors.push(err.message); });
        });
      });
      return chain.then(function () {
        var resultIds = results.map(function (r) { return r.id; });
        var succeededSnaps = snaps.filter(function (s) { return resultIds.indexOf(s.id) !== -1; });
        if (results.length) setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: results.length, verb: CertApp.i18n.t('wf.verb.recognize') }), succeededSnaps, [], createdMiscIds);
        return { results: results, errors: errors };
      });
    });
  }

  // bulkGraceUseExpired([id, ...], {graceUseDate, note}) -> Promise<{results, errors}>
  function bulkGraceUseExpired(ids, input) {
    return withBatch(function () {
      var snaps = snapshotCertsByIds(ids);
      var createdMiscIds = [];
      var chain = Promise.resolve();
      var results = [];
      var errors = [];
      ids.forEach(function (id) {
        chain = chain.then(function () {
          var beforeLen = CertApp.cache.miscRevenue.length;
          return safeCall(function () { return graceUseExpired(id, input); }).then(function (rec) {
            results.push(rec);
            CertApp.cache.miscRevenue.slice(beforeLen).forEach(function (e) { createdMiscIds.push(e.id); });
          }).catch(function (err) { errors.push(err.message); });
        });
      });
      return chain.then(function () {
        var resultIds = results.map(function (r) { return r.id; });
        var succeededSnaps = snaps.filter(function (s) { return resultIds.indexOf(s.id) !== -1; });
        if (results.length) setLastAction(CertApp.i18n.t('cl.toast.bulkDone', { n: results.length, verb: CertApp.i18n.t('cl.verb.grace') }), succeededSnaps, [], createdMiscIds);
        return { results: results, errors: errors };
      });
    });
  }

  return {
    logBulkImport: logBulkImport,
    flagDuplicateCertificateNumbers: flagDuplicateCertificateNumbers,
    reclassifyMisimportedExpiries: reclassifyMisimportedExpiries,
    issueCertificate: issueCertificate,
    useCertificate: useCertificate,
    voidCertificate: voidCertificate,
    recognizeExpiry: recognizeExpiry,
    bulkYearEndRecognition: bulkYearEndRecognition,
    graceUseExpired: graceUseExpired,
    extendExpiry: extendExpiry,
    correctRecord: correctRecord,
    deleteRecord: deleteRecord,
    deleteRecords: deleteRecords,
    undoImportBatch: undoImportBatch,
    bulkCorrectRecords: bulkCorrectRecords,
    bulkUseCertificates: bulkUseCertificates,
    bulkVoidCertificates: bulkVoidCertificates,
    bulkIssueCertificates: bulkIssueCertificates,
    bulkDeleteRecords: bulkDeleteRecords,
    bulkRecognizeExpiry: bulkRecognizeExpiry,
    bulkGraceUseExpired: bulkGraceUseExpired,
    getLastActionLabel: getLastActionLabel,
    getLastActionDetail: getLastActionDetail,
    dismissLastAction: dismissLastAction,
    undoLastAction: undoLastAction
  };
})();
